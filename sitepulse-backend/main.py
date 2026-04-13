from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from supabase import create_client, Client
import os
import fitz  # PyMuPDF for fast PDF to Image conversion
from dotenv import load_dotenv

load_dotenv()

app = FastAPI(title="SitePulse Backend API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], 
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

supabase_url = os.environ.get("SUPABASE_URL")
supabase_key = os.environ.get("SUPABASE_KEY")

if not supabase_url or not supabase_key:
    raise ValueError("FATAL ERROR: Supabase keys are missing from the .env file!")

supabase: Client = create_client(supabase_url, supabase_key)

@app.get("/")
def health_check():
    return {"status": "success", "message": "Backend is online!"}

@app.post("/upload-floorplan/{sheet_id}")
async def upload_and_convert_floorplan(
    sheet_id: str,
    page_number: int = 1,
    file: UploadFile = File(...),
):
    if not file.filename.lower().endswith('.pdf'):
        raise HTTPException(status_code=400, detail="Only PDF files are allowed")

    try:
        pdf_bytes = await file.read()
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")

        if page_number < 1 or page_number > len(doc):
            raise HTTPException(
                status_code=400,
                detail=f"Page {page_number} does not exist. This PDF has {len(doc)} pages.",
            )

        page = doc.load_page(page_number - 1)

        # Upgrade the zoom from 2.0 to 4.0 for high-fidelity rendering
        zoom = 4.0
        mat = fitz.Matrix(zoom, zoom)
        pix = page.get_pixmap(matrix=mat, alpha=False)
        img_bytes = pix.tobytes("png")

        file_path = f"converted/{sheet_id}.png"
        supabase.storage.from_("floorplans").remove([file_path])
        supabase.storage.from_("floorplans").upload(
            path=file_path,
            file=img_bytes,
            file_options={"content-type": "image/png"},
        )

        public_url = supabase.storage.from_("floorplans").get_public_url(file_path)
        supabase.table("sheets").update({"base_image_url": public_url}).eq("id", sheet_id).execute()

        return {"status": "success", "image_url": public_url}

    except HTTPException:
        raise
    except Exception as e:
        print(f"Error processing upload: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/export-pdf/{sheet_id}")
async def export_status_pdf(sheet_id: str):
    return {"status": "pending", "message": "Export logic coming next."}