"""Extraction routes: GET /extract-vectors/{sheet_id}, GET /extract-text/{sheet_id}."""
from fastapi import APIRouter, HTTPException, Depends
import fitz  # PyMuPDF

from core import auth, extraction, sheet_assets
from core import supabase_client as db

router = APIRouter()


@router.get("/extract-vectors/{sheet_id}")
async def extract_snapping_vectors(sheet_id: str, user: dict = Depends(auth.get_current_user)):
    """Fallback endpoint for legacy sheets without pre-extracted vectors.
    Extracts vectors from the stored PDF and writes through to sheet_vectors cache."""
    try:
        await auth.verify_sheet_access(sheet_id, user["sub"])

        def process():
            res = db.download_original_pdf(sheet_id)
            # Extract + write-through cache (cache write is non-fatal but LOGGED
            # inside the helper; extraction errors propagate — see sheet_assets).
            return sheet_assets.cache_sheet_vectors(sheet_id, res)

        import asyncio
        clean_lines = await asyncio.to_thread(process)
        return {"status": "success", "vectors": clean_lines}

    except fitz.FileDataError:
        raise HTTPException(status_code=404, detail="Original PDF not found for vector extraction.")
    except HTTPException:
        raise
    except Exception as e:
        print(f"Error extracting vectors for {sheet_id}: {str(e)}")
        raise HTTPException(status_code=500, detail="Vector extraction failed on the server. Please try again.")


@router.get("/extract-text/{sheet_id}")
async def extract_sheet_text(sheet_id: str, user: dict = Depends(auth.get_current_user)):
    """Extract a sheet's PDF text layer (located words) and write through to the
    sheet_text cache. The free foundation that later capture tools read from to
    auto-fill room names, parse the title block, and label gridlines.

    A scanned PDF with no text layer caches an empty list and is flagged for OCR
    later (the empty list IS the flag) — that is NOT an error."""
    try:
        await auth.verify_sheet_access(sheet_id, user["sub"])

        def process():
            res = db.download_original_pdf(sheet_id)
            words = extraction.extract_text_from_pdf(res)
            # Write-through: cache for future reads. An empty list is valid — a
            # scanned sheet caches [] and becomes an OCR candidate. Non-fatal
            # but LOGGED (mirrors the sheet_vectors cache-write warning).
            try:
                db.supabase.table("sheet_text").upsert(
                    {"sheet_id": sheet_id, "text": words},
                    on_conflict="sheet_id"
                ).execute()
            except Exception as cache_err:
                print(f"[WARN] sheet_text cache write failed for {sheet_id}: {cache_err}")
            return words

        import asyncio
        words = await asyncio.to_thread(process)
        return {"status": "success", "text": words}

    except fitz.FileDataError:
        raise HTTPException(status_code=404, detail="Original PDF not found for text extraction.")
    except HTTPException:
        raise
    except Exception as e:
        print(f"Error extracting text for {sheet_id}: {str(e)}")
        raise HTTPException(status_code=500, detail="Text extraction failed on the server. Please try again.")
