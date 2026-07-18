"""Upload routes: POST /upload-floorplan/{sheet_id}, POST /attach-original/{sheet_id}."""
from fastapi import APIRouter, UploadFile, File, HTTPException, Depends
import fitz  # PyMuPDF

from core import auth, config, pdf, sheet_assets
from core import supabase_client as db

router = APIRouter()


@router.post("/upload-floorplan/{sheet_id}")
async def upload_and_convert_floorplan(
    sheet_id: str,
    page_number: int = 1,
    file: UploadFile = File(...),
    user: dict = Depends(auth.get_current_user),
):
    if not file.filename or not file.filename.lower().endswith('.pdf'):
        raise HTTPException(status_code=400, detail="Only PDF files are allowed")

    try:
        await auth.verify_sheet_access(sheet_id, user["sub"])
        pdf_bytes = await pdf.read_upload_capped(file)

        def process_upload():
            # `with` so both PyMuPDF docs close on every path (incl. errors),
            # not only via GC. Behavior-preserving — operation order is unchanged.
            with fitz.open(stream=pdf_bytes, filetype="pdf") as doc:
                if page_number < 1 or page_number > len(doc):
                    raise HTTPException(status_code=400, detail=f"Page {page_number} does not exist. This PDF has {len(doc)} pages.")

                page = doc.load_page(page_number - 1)

                # Render fallback PNG at 4x for backward compat (zoom-clamped to
                # the pixel budget; upsert-in-place — see sheet_assets).
                file_path = sheet_assets.render_and_store_preview(page, sheet_id)

                # Extract and store single-page PDF for vector extraction + PDF export
                with fitz.open() as single_page_doc:
                    single_page_doc.insert_pdf(doc, from_page=page_number - 1, to_page=page_number - 1)
                    single_page_pdf_bytes = single_page_doc.write()

                # Overwrite in place (x-upsert) — never remove-then-upload: a failure
                # between the two would permanently delete the sheet's existing file
                # with nothing to replace it.
                pdf_path = f"originals/{sheet_id}.pdf"
                db.supabase.storage.from_("floorplans").upload(
                    path=pdf_path,
                    file=single_page_pdf_bytes,
                    file_options={"content-type": "application/pdf", "cache-control": config.STORAGE_CACHE_SECONDS, "upsert": "true"},
                )

                public_url = db.supabase.storage.from_("floorplans").get_public_url(file_path)
                db.supabase.table("sheets").update({"base_image_url": public_url}).eq("id", sheet_id).execute()
                db.bump_pdf_version(sheet_id)

                # Pre-extract snapping vectors and populate the cache (non-fatal).
                # Note: tile-pyramid generation was removed — the frontend renders the
                # PDF client-side via pdf.js (PdfBaseLayer), so DZI tiles are unused.
                try:
                    sheet_assets.cache_sheet_vectors(sheet_id, single_page_pdf_bytes)
                except Exception as vec_err:
                    print(f"[WARN] Vector pre-extraction skipped: {vec_err}")

                return public_url

        import asyncio
        public_url = await asyncio.to_thread(process_upload)
        return {"status": "success", "image_url": public_url, "base_image_url": public_url}

    except fitz.FileDataError:
        # Corrupt / non-PDF bytes — fitz.open raises this (an empty file too, via
        # its EmptyFileError subclass). Retrying can't help, so say so with a 400
        # instead of the generic "server error, try again" 500.
        raise HTTPException(status_code=400, detail="The file is not a valid PDF.")
    except HTTPException:
        raise
    except Exception as e:
        # Full detail goes to the server log only — raw supabase/fitz error
        # strings (internal URLs, table names) must not reach the client. (The
        # page-number check now raises HTTPException(400) directly, so no library
        # ValueError text can echo to the client here anymore.)
        print(f"Error processing upload for {sheet_id}: {str(e)}")
        raise HTTPException(status_code=500, detail="Upload processing failed on the server. Please try again.")


@router.post("/attach-original/{sheet_id}")
async def attach_original_pdf(
    sheet_id: str,
    file: UploadFile = File(...),
    user: dict = Depends(auth.get_current_user),
):
    if not file.filename or not file.filename.lower().endswith('.pdf'):
        raise HTTPException(status_code=400, detail="Only PDF files are allowed")

    try:
        await auth.verify_sheet_access(sheet_id, user["sub"])
        pdf_bytes = await pdf.read_upload_capped(file)

        def process_attach():
            # Validate the bytes ARE a real PDF before storing anything: a
            # corrupt/renamed file would otherwise be stored as a broken
            # "original" (the fitz calls further down are non-fatal + swallowed,
            # so nothing else would reject it). A FileDataError here surfaces as
            # a clean 400 via the route below.
            with fitz.open(stream=pdf_bytes, filetype="pdf"):
                pass

            # Overwrite in place (x-upsert) — never remove-then-upload; see
            # upload_and_convert_floorplan.
            pdf_path = f"originals/{sheet_id}.pdf"
            db.supabase.storage.from_("floorplans").upload(
                path=pdf_path,
                file=pdf_bytes,
                file_options={"content-type": "application/pdf", "cache-control": config.STORAGE_CACHE_SECONDS, "upsert": "true"},
            )
            db.bump_pdf_version(sheet_id)
            # Pre-extract vectors from the new PDF (non-fatal)
            try:
                sheet_assets.cache_sheet_vectors(sheet_id, pdf_bytes)
            except Exception as vec_err:
                print(f"[WARN] Vector pre-extraction from attached PDF skipped: {vec_err}")
            # Regenerate the converted preview PNG so the canvas placeholder and
            # dashboard preload reflect the new drawing (non-fatal; previously the
            # stale PNG from the original upload was left in place forever).
            try:
                with fitz.open(stream=pdf_bytes, filetype="pdf") as doc:
                    page = doc.load_page(0)
                    sheet_assets.render_and_store_preview(page, sheet_id)
            except Exception as png_err:
                print(f"[WARN] Preview PNG regeneration skipped: {png_err}")

        import asyncio
        await asyncio.to_thread(process_attach)
        return {"status": "success", "message": "Original PDF attached successfully!"}
    except fitz.FileDataError:
        # Corrupt / non-PDF bytes (caught by the up-front validation open above).
        raise HTTPException(status_code=400, detail="The file is not a valid PDF.")
    except HTTPException:
        raise
    except Exception as e:
        print(f"Error attaching pdf for {sheet_id}: {str(e)}")
        raise HTTPException(status_code=500, detail="Attaching the PDF failed on the server. Please try again.")
