from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from supabase import create_client, Client
from pydantic import BaseModel
from typing import List
import os
import io
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

class PointData(BaseModel):
    pctX: float
    pctY: float

class PolygonData(BaseModel):
    unit_id: str
    unit_number: str
    status: str
    color: str
    points: List[PointData]

class ExportRequest(BaseModel):
    include_data: bool
    polygons: List[PolygonData]
    project_name: str
    sheet_name: str

def hex_to_rgb(color_str: str):
    import re
    rgba_match = re.search(r'rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)', color_str)
    if rgba_match:
        return tuple(int(rgba_match.group(i))/255.0 for i in (1, 2, 3))
    
    color_str = color_str.lstrip('#')
    if len(color_str) >= 6:
        return tuple(int(color_str[i:i+2], 16)/255.0 for i in (0, 2, 4))
    return (0, 0, 0)

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

        pdf_path = f"originals/{sheet_id}.pdf"
        supabase.storage.from_("floorplans").remove([pdf_path])
        supabase.storage.from_("floorplans").upload(
            path=pdf_path,
            file=pdf_bytes,
            file_options={"content-type": "application/pdf"},
        )

        public_url = supabase.storage.from_("floorplans").get_public_url(file_path)
        supabase.table("sheets").update({"base_image_url": public_url}).eq("id", sheet_id).execute()

        return {"status": "success", "image_url": public_url}

    except HTTPException:
        raise
    except Exception as e:
        print(f"Error processing upload: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/attach-original/{sheet_id}")
async def attach_original_pdf(sheet_id: str, file: UploadFile = File(...)):
    if not file.filename.lower().endswith('.pdf'):
        raise HTTPException(status_code=400, detail="Only PDF files are allowed")
    
    try:
        pdf_bytes = await file.read()
        pdf_path = f"originals/{sheet_id}.pdf"
        supabase.storage.from_("floorplans").remove([pdf_path])
        supabase.storage.from_("floorplans").upload(
            path=pdf_path,
            file=pdf_bytes,
            file_options={"content-type": "application/pdf"},
        )
        return {"status": "success", "message": "Original PDF attached successfully!"}
    except Exception as e:
        print(f"Error attaching pdf: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/export-pdf/{sheet_id}")
async def export_status_pdf(sheet_id: str, req: ExportRequest):
    try:
        pdf_path = f"originals/{sheet_id}.pdf"
        # Download as raw bytes directly from Supabase
        res = supabase.storage.from_("floorplans").download(pdf_path)
        
        doc = fitz.open(stream=res, filetype="pdf")
        page = doc[0]
        
        width = page.rect.width
        height = page.rect.height
        
        for poly in req.polygons:
            if len(poly.points) < 3: continue
            
            # Re-map standard visual percentages to the exact unrotated PDF canvas logic
            fitz_points = [
                fitz.Point(
                    page.rect.x0 + p.pctX * page.rect.width, 
                    page.rect.y0 + p.pctY * page.rect.height
                ) * page.derotation_matrix 
                for p in poly.points
            ]
            
            color_rgb = hex_to_rgb(poly.color)
            
            # Create standard Interactive Data Layer Markup (Allows moving, coloring, and Bluebeam modification seamlessly)
            annot = page.add_polygon_annot(fitz_points)
            annot.set_colors(stroke=color_rgb, fill=color_rgb)
            annot.set_opacity(0.4)
            annot.set_blendmode(fitz.PDF_BM_Multiply)
            annot.set_border(width=1.5)
            
            info = annot.info
            info["title"] = "SitePulse Tracking"
            info["content"] = f"Location {poly.unit_number}: {poly.status}"
            info["subject"] = "Visual Status"
            annot.set_info(info)
            
            annot.update()
        if req.include_data:
            # We determine landscape or portrait to append a correctly oriented trailing page
            p_w, p_h = (height, width) if width > height else (width, height)
            new_page = doc.new_page(width=p_w, height=p_h)
            
            title = f"{req.project_name} - {req.sheet_name} Status Report"
            new_page.insert_text(fitz.Point(30, 50), title, fontsize=24, fontname="helv", color=(0,0,0))
            
            y_offset = 100
            x_offset = 30
            for i, p in enumerate(req.polygons):
                text = f"Unit {p.unit_number}: {p.status}"
                col = i % 4
                row = i // 4
                px = x_offset + (col * (p_w - 60) / 4)
                py = y_offset + (row * 20)
                new_page.insert_text(fitz.Point(px, py), text, fontsize=12, fontname="helv", color=(0,0,0))
                
        pdf_bytes = doc.write()
        doc.close()
        
        return StreamingResponse(
            io.BytesIO(pdf_bytes),
            media_type="application/pdf",
            headers={
                "Content-Disposition": f"attachment; filename={req.project_name}_{req.sheet_name}_Status.pdf",
                "Access-Control-Expose-Headers": "Content-Disposition"
            }
        )
        
    except fitz.FileDataError:
        raise HTTPException(status_code=404, detail="Original PDF not found in Storage. Please re-upload or attach the source file.")
    except Exception as e:
         print(f"Error exporting pdf: {str(e)}")
         raise HTTPException(status_code=500, detail=str(e))