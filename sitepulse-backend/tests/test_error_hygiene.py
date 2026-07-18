"""Backend error-manners fixes (2026-07-13 audit, Group B).

Pins five behaviors, all hermetic (auth dependency overridden, storage stubbed):

  1. /export-pdf passes an authorization denial through as 403 — it used to
     swallow verify_sheet_access's HTTPException into the generic handler and
     re-emit it as a 500.
  2. A missing original PDF is a clean 404 (storage3 raises StorageApiError on
     a missing object; the old fitz.FileDataError->404 branch never fired for
     that case, so callers got a 500 leaking the raw storage error string).
  3. A real 500 carries a generic message — internal error text (postgrest
     URLs, table names, library internals) stays in the server log only.
  4. Unicode project/sheet names export successfully: the Content-Disposition
     header is latin-1 safe (RFC 5987 filename*), where it used to crash
     Starlette's header encode.
  5. Malformed client legend data degrades per-entry instead of 500ing the
     whole export; hex_to_rgb never raises on junk color strings.
"""
import types

import fitz
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from storage3.exceptions import StorageApiError

from core import auth, supabase_client
from core.pdf import content_disposition_attachment, hex_to_rgb
from main import app


AUTH_USER = {"sub": "user-1", "role": "authenticated"}


@pytest.fixture()
def client(monkeypatch):
    app.dependency_overrides[auth.get_current_user] = lambda: AUTH_USER

    async def fake_sheet_access(sheet_id, user_id):
        return "project-1"

    monkeypatch.setattr(auth, "verify_sheet_access", fake_sheet_access)
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.pop(auth.get_current_user, None)


def _export_body(project_name="Proj", sheet_name="Level 1", legend=None):
    return {
        "include_data": False,
        "polygons": [],
        "project_name": project_name,
        "sheet_name": sheet_name,
        "legend_data": legend,
    }


def _stub_download(monkeypatch, download_fn):
    """Replace the supabase client with a storage-only stub whose download is download_fn."""
    bucket = types.SimpleNamespace(download=download_fn)
    monkeypatch.setattr(
        supabase_client, "supabase",
        types.SimpleNamespace(storage=types.SimpleNamespace(from_=lambda name: bucket)),
    )


def _tiny_pdf() -> bytes:
    doc = fitz.open()
    doc.new_page(width=200, height=100)
    return doc.write()


# ── 1. Authorization results survive the export route ────────────────────────

def test_export_pdf_authz_denial_is_403_not_500(client, monkeypatch):
    async def denied(sheet_id, user_id):
        raise HTTPException(status_code=403, detail="Not authorized to access this project")

    monkeypatch.setattr(auth, "verify_sheet_access", denied)
    res = client.post("/export-pdf/sheet-1", json=_export_body())
    assert res.status_code == 403  # was 500 with detail "403: Not authorized..."


# ── 2. Missing original → 404, not a leaked 500 ──────────────────────────────

def test_export_pdf_missing_original_is_404(client, monkeypatch):
    def gone(path):
        raise StorageApiError("Object not found", "404", 404)

    _stub_download(monkeypatch, gone)
    res = client.post("/export-pdf/sheet-1", json=_export_body())
    assert res.status_code == 404
    assert "re-upload" in res.json()["detail"]


def test_extract_vectors_missing_original_is_404(client, monkeypatch):
    def gone(path):
        raise StorageApiError("Object not found", "404", 404)

    _stub_download(monkeypatch, gone)
    res = client.get("/extract-vectors/sheet-1")
    assert res.status_code == 404


# ── 3. 500s carry a generic message; internals stay in the log ───────────────

def test_export_pdf_500_does_not_leak_internal_error_text(client, monkeypatch):
    def boom(path):
        raise RuntimeError("secret-internal postgrest url table=sheet_vectors")

    _stub_download(monkeypatch, boom)
    res = client.post("/export-pdf/sheet-1", json=_export_body())
    assert res.status_code == 500
    detail = res.json()["detail"]
    assert "secret-internal" not in detail
    assert "sheet_vectors" not in detail


# ── 4 + 5. Unicode names + malformed legend still export ─────────────────────

def test_export_survives_unicode_name_and_malformed_legend(client, monkeypatch):
    _stub_download(monkeypatch, lambda path: _tiny_pdf())
    legend = {
        "pctX": "not-a-number",          # coerced to the default
        "active_activities": [
            "junk-entry",                 # non-dict → skipped
            {"name": None, "color": "#zzzzzz"},  # junk fields → degraded, not fatal
        ],
        "active_temporal_states": ["completed", 42],  # non-string → filtered
    }

    res = client.post(
        "/export-pdf/sheet-1",
        json=_export_body(project_name="Café Tower — Phase 2", legend=legend),
    )
    assert res.status_code == 200
    assert res.content[:4] == b"%PDF"
    # The header the old code crashed on: latin-1 safe fallback + exact UTF-8 name.
    cd = res.headers["content-disposition"]
    assert "filename*=UTF-8''Caf%C3%A9" in cd


def test_content_disposition_attachment_is_latin1_safe():
    value = content_disposition_attachment("Café Tower — 2_Status.pdf")
    value.encode("latin-1")  # must not raise — Starlette encodes headers latin-1
    assert 'filename="Caf_ Tower _ 2_Status.pdf"' in value
    assert "filename*=UTF-8''Caf%C3%A9%20Tower%20%E2%80%94%202_Status.pdf" in value


def test_hex_to_rgb_never_raises_on_malformed_input():
    assert hex_to_rgb("#zzzzzz") == (0, 0, 0)
    assert hex_to_rgb(None) == (0, 0, 0)
    assert hex_to_rgb("") == (0, 0, 0)
    assert hex_to_rgb("#3366aa") == pytest.approx((0.2, 0.4, 170 / 255))


# ── 6. Corrupt / non-PDF upload → friendly 400 (not a leaked 500) ────────────
# A file that passes the filename `.pdf` check but isn't a real PDF hits
# fitz.open, which raises fitz.FileDataError. Both upload routes now translate
# that to a 400 "not a valid PDF" — retrying can't help, so don't say "try again".

CORRUPT_PDF = b"this is not a pdf, just some bytes named .pdf"


def test_upload_floorplan_corrupt_pdf_is_400(client):
    res = client.post(
        "/upload-floorplan/sheet-1",
        files={"file": ("plans.pdf", CORRUPT_PDF, "application/pdf")},
    )
    assert res.status_code == 400
    assert res.json()["detail"] == "The file is not a valid PDF."


def test_attach_original_corrupt_pdf_is_400(client):
    res = client.post(
        "/attach-original/sheet-1",
        files={"file": ("drawing.pdf", CORRUPT_PDF, "application/pdf")},
    )
    assert res.status_code == 400
    assert res.json()["detail"] == "The file is not a valid PDF."
