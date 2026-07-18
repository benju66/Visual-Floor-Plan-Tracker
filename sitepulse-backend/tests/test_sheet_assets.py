"""Direct pins for the Phase-2 consolidation helpers (core/sheet_assets.py).

Route-level behavior is already pinned through the upload/attach/extract routes
(test_backend_safety.py, test_error_hygiene.py); these pin the helpers' own
contracts: the preview write stays upsert-mode at the canonical path, and a
vectors cache-WRITE failure is non-fatal (logged, vectors still returned) while
extraction errors propagate.
"""
from types import SimpleNamespace

import fitz
import pytest

from core import sheet_assets, supabase_client


class _RecorderBucket:
    def __init__(self):
        self.uploads = []

    def upload(self, path=None, file=None, file_options=None):
        self.uploads.append((path, file, dict(file_options or {})))


class _RecorderQuery:
    def __init__(self, events, table, fail_execute):
        self._events, self._table, self._fail = events, table, fail_execute
        self._payload = None

    def upsert(self, payload, **kwargs):
        self._payload = (payload, kwargs)
        return self

    def execute(self):
        if self._fail:
            raise RuntimeError("simulated cache-write timeout")
        self._events.append((self._table, self._payload))
        return SimpleNamespace(data=[])


class _FakeSupabase:
    def __init__(self, fail_upsert=False):
        self.events = []
        self._fail = fail_upsert
        self.bucket = _RecorderBucket()
        self.storage = SimpleNamespace(from_=lambda name: self.bucket)

    def table(self, name):
        return _RecorderQuery(self.events, name, self._fail)


def _line_pdf_bytes() -> bytes:
    doc = fitz.open()
    page = doc.new_page(width=200, height=100)
    page.draw_line(fitz.Point(10, 20), fitz.Point(160, 20))
    return doc.tobytes()


def test_render_and_store_preview_writes_upsert_png_and_returns_path(monkeypatch):
    fake = _FakeSupabase()
    monkeypatch.setattr(supabase_client, "supabase", fake)

    with fitz.open() as doc:
        page = doc.new_page(width=200, height=100)
        path = sheet_assets.render_and_store_preview(page, "sheet-1")

    assert path == "converted/sheet-1.png"
    assert len(fake.bucket.uploads) == 1
    upload_path, file_bytes, options = fake.bucket.uploads[0]
    assert upload_path == "converted/sheet-1.png"
    assert file_bytes[:8] == b"\x89PNG\r\n\x1a\n"
    # The load-bearing options: overwrite in place, never remove-then-upload.
    assert options.get("upsert") == "true"
    assert options.get("content-type") == "image/png"


def test_cache_sheet_vectors_writes_through_and_returns_vectors(monkeypatch):
    fake = _FakeSupabase()
    monkeypatch.setattr(supabase_client, "supabase", fake)

    vectors = sheet_assets.cache_sheet_vectors("sheet-1", _line_pdf_bytes())

    assert vectors, "the drawn wall should extract to at least one vector"
    assert fake.events == [
        ("sheet_vectors", ({"sheet_id": "sheet-1", "vectors": vectors}, {"on_conflict": "sheet_id"})),
    ]


def test_cache_sheet_vectors_cache_write_failure_is_nonfatal_but_logged(monkeypatch, capsys):
    fake = _FakeSupabase(fail_upsert=True)
    monkeypatch.setattr(supabase_client, "supabase", fake)

    vectors = sheet_assets.cache_sheet_vectors("sheet-1", _line_pdf_bytes())

    assert vectors  # extraction result still returned despite the failed write
    assert "sheet_vectors cache write failed for sheet-1" in capsys.readouterr().out


def test_cache_sheet_vectors_extraction_errors_propagate(monkeypatch):
    fake = _FakeSupabase()
    monkeypatch.setattr(supabase_client, "supabase", fake)

    with pytest.raises(fitz.FileDataError):
        sheet_assets.cache_sheet_vectors("sheet-1", b"not a pdf")
    assert fake.events == []  # nothing cached when extraction never produced vectors
