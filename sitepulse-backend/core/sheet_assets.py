"""Composite sheet-asset helpers that mix fitz + supabase.

NOT in core/extraction.py on purpose — that module stays pure (no supabase,
env-free import). These consolidate the blocks that were copy-pasted across
routes (Backend Structure Phase 2): the preview-PNG render+store (upload +
attach) and the vector extract+cache write (upload + attach + extract-vectors).

Seam rule: supabase/config are reached via module-attribute lookup so the
`core.supabase_client.supabase` and `core.config.*` monkeypatch seams hold.
"""
from core import config, extraction, pdf
from core import supabase_client as db


def render_and_store_preview(page, sheet_id: str) -> str:
    """Render `page` at the 4x zoom-clamped preview matrix and store it at
    converted/<sheet_id>.png. Overwrite in place (x-upsert) — never
    remove-then-upload: a failure between the two would permanently delete the
    sheet's existing file with nothing to replace it. Returns the storage path.
    """
    pix = page.get_pixmap(matrix=pdf.preview_matrix(page), alpha=False)
    file_path = f"converted/{sheet_id}.png"
    db.supabase.storage.from_("floorplans").upload(
        path=file_path,
        file=pix.tobytes("png"),
        file_options={"content-type": "image/png", "cache-control": config.STORAGE_CACHE_SECONDS, "upsert": "true"},
    )
    return file_path


def cache_sheet_vectors(sheet_id: str, pdf_bytes: bytes) -> list:
    """Extract snapping vectors from `pdf_bytes` and write-through to the
    sheet_vectors cache. Extraction errors PROPAGATE to the caller (routes
    decide whether that is fatal); the cache write is non-fatal but LOGGED — a
    silent swallow here is exactly the known "vector cache write timeout →
    repeated slow extraction / no wall data" failure mode. Returns the vectors.
    """
    vectors = extraction.extract_vectors_from_pdf(pdf_bytes)
    try:
        db.supabase.table("sheet_vectors").upsert(
            {"sheet_id": sheet_id, "vectors": vectors},
            on_conflict="sheet_id"
        ).execute()
    except Exception as cache_err:
        print(f"[WARN] sheet_vectors cache write failed for {sheet_id}: {cache_err}")
    return vectors
