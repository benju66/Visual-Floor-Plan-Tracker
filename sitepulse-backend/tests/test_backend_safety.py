"""Backend safety guardrails (2026-07-13 audit fixes).

Pins three behaviors, all hermetic (no Supabase network; the client is replaced
with an in-test recorder and the auth dependency is overridden):

  1. Upload size cap — an over-cap body is rejected 413 by the chunked read
     BEFORE any PyMuPDF/storage work runs (a lying Content-Length can't bypass
     it), and the preview render's zoom is clamped to the pixel budget.
  2. Overwrite-mode uploads — the storage writes carry `upsert: true` and there
     is NO remove-then-upload window (a failure between the two used to
     permanently delete the sheet's existing file).
  3. Project-delete ordering — the authoritative `projects` row delete happens
     BEFORE the best-effort storage sweep, so a failure can never leave a live
     project whose drawings were already destroyed.
"""
import asyncio
import io
from types import SimpleNamespace

import fitz
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from starlette.datastructures import UploadFile

from core import auth, config, supabase_client
from core.pdf import preview_matrix, read_upload_capped
from main import app


AUTH_USER = {"sub": "user-1", "role": "authenticated"}


@pytest.fixture()
def client(monkeypatch):
    """TestClient with auth passed and per-resource checks stubbed (the auth
    path itself is pinned by test_auth.py / test_endpoints.py)."""
    app.dependency_overrides[auth.get_current_user] = lambda: AUTH_USER

    async def fake_sheet_access(sheet_id, user_id):
        return "project-1"

    async def fake_project_admin(project_id, user_id):
        return None

    monkeypatch.setattr(auth, "verify_sheet_access", fake_sheet_access)
    monkeypatch.setattr(auth, "verify_project_admin", fake_project_admin)
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.pop(auth.get_current_user, None)


# ── In-test Supabase recorder ────────────────────────────────────────────────
# Records every storage/postgrest call in ONE ordered event list so tests can
# assert both payloads and cross-client ordering.

class _FakeQuery:
    def __init__(self, events, table):
        self._events, self._table, self._op = events, table, "select"

    def select(self, *_a, **_k):
        self._op = "select"
        return self

    def delete(self):
        self._op = "delete"
        return self

    def update(self, *_a, **_k):
        self._op = "update"
        return self

    def upsert(self, *_a, **_k):
        self._op = "upsert"
        return self

    def eq(self, *_a):
        return self

    def execute(self):
        self._events.append(f"db:{self._op}:{self._table}")
        if self._op == "select" and self._table == "sheets":
            return SimpleNamespace(data=[{"id": "sheet-1"}, {"id": "sheet-2"}])
        return SimpleNamespace(data=[])


class _FakeBucket:
    def __init__(self, events):
        self._events = events

    def remove(self, paths):
        self._events.append(("storage:remove", tuple(paths)))

    def upload(self, path=None, file=None, file_options=None):
        self._events.append(("storage:upload", path, dict(file_options or {})))

    def get_public_url(self, path):
        return f"https://storage.test/{path}"


class _FakeSupabase:
    def __init__(self):
        self.events = []
        self._bucket = _FakeBucket(self.events)
        self.storage = SimpleNamespace(from_=lambda name: self._bucket)

    def table(self, name):
        return _FakeQuery(self.events, name)


@pytest.fixture()
def fake_supabase(monkeypatch):
    fake = _FakeSupabase()
    monkeypatch.setattr(supabase_client, "supabase", fake)
    return fake


def _tiny_pdf_bytes() -> bytes:
    doc = fitz.open()
    doc.new_page(width=200, height=100)
    return doc.write()


# ── 1. Upload size cap ───────────────────────────────────────────────────────

def test_oversized_upload_is_rejected_413_before_processing(client, fake_supabase, monkeypatch):
    monkeypatch.setattr(config, "MAX_UPLOAD_BYTES", 1024)  # keep the test body small
    res = client.post(
        "/upload-floorplan/sheet-1",
        files={"file": ("plans.pdf", b"%PDF-" + b"x" * 4096, "application/pdf")},
    )
    assert res.status_code == 413
    assert "upload limit" in res.json()["detail"]
    # Rejected by the capped read: no storage or DB call was ever attempted.
    assert fake_supabase.events == []


def test_read_upload_capped_passes_an_under_cap_file_through():
    payload = b"%PDF-under-cap"
    uf = UploadFile(file=io.BytesIO(payload), filename="ok.pdf")
    assert asyncio.run(read_upload_capped(uf)) == payload


def test_read_upload_capped_rejects_over_cap_stream(monkeypatch):
    monkeypatch.setattr(config, "MAX_UPLOAD_BYTES", 10)
    uf = UploadFile(file=io.BytesIO(b"x" * 11), filename="big.pdf")
    with pytest.raises(HTTPException) as exc:
        asyncio.run(read_upload_capped(uf))
    assert exc.value.status_code == 413


def test_preview_matrix_keeps_standard_sheets_at_4x_and_clamps_oversized_pages():
    # E-size 36x24" = 2592x1728 pt -> ~72 MP at 4x: inside budget, zoom unchanged.
    e_size = SimpleNamespace(rect=SimpleNamespace(width=2592, height=1728))
    assert preview_matrix(e_size).a == pytest.approx(4.0)

    # A degenerate 10x-oversized page gets its zoom scaled down so the render
    # stays inside MAX_RENDER_PIXELS instead of allocating ~10x the budget.
    huge = SimpleNamespace(rect=SimpleNamespace(width=25920, height=17280))
    mat = preview_matrix(huge)
    assert mat.a < 4.0
    rendered_px = (huge.rect.width * mat.a) * (huge.rect.height * mat.b)
    assert rendered_px <= config.MAX_RENDER_PIXELS * 1.001


# ── 2. Overwrite-mode uploads (no remove-then-upload window) ─────────────────

def test_attach_original_overwrites_in_place_never_removes_first(client, fake_supabase):
    res = client.post(
        "/attach-original/sheet-1",
        files={"file": ("drawing.pdf", _tiny_pdf_bytes(), "application/pdf")},
    )
    assert res.status_code == 200

    removes = [e for e in fake_supabase.events if e[0] == "storage:remove"]
    uploads = [e for e in fake_supabase.events if e[0] == "storage:upload"]
    # The load-bearing assertions: nothing is deleted ahead of the write, and
    # every storage write carries the overwrite flag.
    assert removes == []
    assert len(uploads) >= 1  # original PDF (+ regenerated preview PNG)
    for _, _path, options in uploads:
        assert options.get("upsert") == "true"


def test_upload_floorplan_overwrites_in_place_never_removes_first(client, fake_supabase):
    res = client.post(
        "/upload-floorplan/sheet-1",
        files={"file": ("plans.pdf", _tiny_pdf_bytes(), "application/pdf")},
    )
    assert res.status_code == 200

    removes = [e for e in fake_supabase.events if e[0] == "storage:remove"]
    uploads = [e for e in fake_supabase.events if e[0] == "storage:upload"]
    assert removes == []
    paths = {p for _, p, _ in uploads}
    assert paths == {"converted/sheet-1.png", "originals/sheet-1.pdf"}
    for _, _path, options in uploads:
        assert options.get("upsert") == "true"


# ── Upload response contract ─────────────────────────────────────────────────
# The frontend (`UploadFloorplanResult`) reads `base_image_url` off this response;
# the old shape returned `tile_manifest_url` (vestigial — the DZI tile path was
# removed, AGENTS.md §5) and no `base_image_url`, so the client destructured
# `undefined` and its write-back silently no-op'd. Pin the truthful shape.

def test_upload_floorplan_response_contract(client, fake_supabase):
    res = client.post(
        "/upload-floorplan/sheet-1",
        files={"file": ("plans.pdf", _tiny_pdf_bytes(), "application/pdf")},
    )
    assert res.status_code == 200
    body = res.json()
    # The converted-preview public URL the fake bucket hands back for this sheet.
    expected_url = "https://storage.test/converted/sheet-1.png"
    assert body == {
        "status": "success",
        "image_url": expected_url,
        "base_image_url": expected_url,
    }
    # The vestigial key must be gone (nothing reads it; its presence was the lie).
    assert "tile_manifest_url" not in body


# ── 3. Project delete: authoritative row delete BEFORE the storage sweep ────

def test_delete_project_deletes_row_before_sweeping_storage(client, fake_supabase):
    res = client.delete("/project/project-1")
    assert res.status_code == 200
    assert res.json()["deleted_sheets"] == 2

    events = fake_supabase.events
    row_delete = events.index("db:delete:projects")
    sweep_indexes = [i for i, e in enumerate(events) if isinstance(e, tuple) and e[0] == "storage:remove"]
    assert sweep_indexes, "storage sweep should still run"
    # The ordering that prevents "live project, drawings destroyed": the row
    # (cascade) delete precedes every storage removal.
    assert all(row_delete < i for i in sweep_indexes)
    # And the sweep covers both blobs of every sheet collected beforehand.
    swept = [p for i in sweep_indexes for p in events[i][1]]
    assert set(swept) == {
        "converted/sheet-1.png", "originals/sheet-1.pdf",
        "converted/sheet-2.png", "originals/sheet-2.pdf",
    }
