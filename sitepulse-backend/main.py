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
async def upload_and_convert_floorplan(sheet_id: str, file: UploadFile = File(...)):
    if not file.filename.lower().endswith('.pdf'):
        raise HTTPException(status_code=400, detail="Only PDF files are allowed")
        
    try:
        # 1. Read the PDF into memory
        pdf_bytes = await file.read()
        
        # 2. Open PDF and extract the first page using PyMuPDF
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        page = doc.load_page(0)
        
        # 3. Zoom in to get a high-resolution image (2x scale)
        zoom = 2.0
        mat = fitz.Matrix(zoom, zoom)
        pix = page.get_pixmap(matrix=mat, alpha=False)
        
        # 4. Convert to PNG bytes
        img_bytes = pix.tobytes("png")
        
        # 5. Upload to Supabase Storage
        file_path = f"converted/{sheet_id}.png"
        
        # Remove existing file if overwriting
        supabase.storage.from_("floorplans").remove([file_path])
        
        # Upload the new PNG
        supabase.storage.from_("floorplans").upload(
            path=file_path,
            file=img_bytes,
            file_options={"content-type": "image/png"}
        )
        
        # 6. Get the public URL and update the database
        public_url = supabase.storage.from_("floorplans").get_public_url(file_path)
        supabase.table("sheets").update({"base_image_url": public_url}).eq("id", sheet_id).execute()
        
        return {"status": "success", "image_url": public_url}
        
    except Exception as e:
        print(f"Error processing upload: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/export-pdf/{sheet_id}")
async def export_status_pdf(sheet_id: str):
    return {"status": "pending", "message": "Export logic coming next."}