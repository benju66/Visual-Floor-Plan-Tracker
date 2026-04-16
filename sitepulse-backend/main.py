from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from supabase import create_client, Client
from pydantic import BaseModel
from typing import List, Optional, Dict
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
    temporal_state: str = 'completed'
    points: List[PointData]

class ExportRequest(BaseModel):
    include_data: bool
    polygons: List[PolygonData]
    project_name: str
    sheet_name: str
    legend_data: Optional[Dict] = None

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
            fill_rgb = color_rgb
            
            # temporal state formatting mapping frontend styling
            shape_opacity = 0.8
            stroke_dash = None
            
            if poly.temporal_state == 'none':
                fill_rgb = None
                shape_opacity = 0.8
            elif poly.temporal_state == 'planned':
                shape_opacity = 0.3
                stroke_dash = [10, 6]
            elif poly.temporal_state == 'ongoing':
                shape_opacity = 0.55
            elif poly.temporal_state == 'completed':
                shape_opacity = 0.8
                
            if poly.status == 'Not Started':
                shape_opacity = 0.2
            
            # Create standard Interactive Data Layer Markup (Allows moving, coloring, and Bluebeam modification seamlessly)
            annot = page.add_polygon_annot(fitz_points)
            if fill_rgb:
                annot.set_colors(stroke=color_rgb, fill=fill_rgb)
            else:
                annot.set_colors(stroke=color_rgb)
                
            annot.set_opacity(shape_opacity)
            annot.set_blendmode(fitz.PDF_BM_Multiply)
            
            if stroke_dash:
                annot.set_border(width=1.5, dashes=stroke_dash)
            else:
                annot.set_border(width=1.5)
            
            info = annot.info
            info["title"] = "SitePulse Tracking"
            info["content"] = f"Location {poly.unit_number}: {poly.status}"
            info["subject"] = "Visual Status"
            annot.set_info(info)
            
            annot.update()

        if req.legend_data:
            legend = req.legend_data
            pctX = legend.get('pctX', 0.05)
            pctY = legend.get('pctY', 0.05)
            scaleX = legend.get('scaleX', 1)
            active_milestones = legend.get('active_milestones', [])

            # Correctly map a visual percentage point to the underlying unrotated PDF canvas
            def get_mapped_pt(px_pct, py_pct):
                return fitz.Point(
                    page.rect.x0 + (page.rect.width * px_pct),
                    page.rect.y0 + (page.rect.height * py_pct)
                ) * page.derotation_matrix

            font_size = 14 * scaleX
            title_size = 16 * scaleX
            item_height = 24 * scaleX
            padding = 16 * scaleX
            legend_w = 200 * scaleX

            active_temporal_states = legend.get('active_temporal_states', [])

            milestones_height = (30 * scaleX) + (len(active_milestones) * item_height) if active_milestones else 0
            statuses_height = (30 * scaleX) + (len(active_temporal_states) * item_height) if active_temporal_states else 0
            
            middle_pad = padding if (active_milestones and active_temporal_states) else 0
            total_items_height = milestones_height + statuses_height + middle_pad
            
            legend_h = padding * 2 + total_items_height

            def map_quad(vx_pct, vy_pct, vw_pct, vh_pct):
                p1 = get_mapped_pt(vx_pct, vy_pct)
                p2 = get_mapped_pt(vx_pct + vw_pct, vy_pct)
                p3 = get_mapped_pt(vx_pct, vy_pct + vh_pct)
                p4 = get_mapped_pt(vx_pct + vw_pct, vy_pct + vh_pct)
                return fitz.Quad(p1, p2, p3, p4)

            w_pct = legend_w / page.rect.width
            h_pct = legend_h / page.rect.height

            # BG Quad
            bg_quad = map_quad(pctX, pctY, w_pct, h_pct)
            # Remove shadows, add gray border as requested by user
            page.draw_quad(bg_quad, color=(0.8,0.8,0.8), fill=(1,1,1), width=1.5)

            def map_offset_pt(x_off, y_off):
                return get_mapped_pt(pctX + (x_off / page.rect.width), pctY + (y_off / page.rect.height))

            def map_offset_quad(x_off, y_off, w, h):
                return map_quad(pctX + (x_off / page.rect.width), pctY + (y_off / page.rect.height), w / page.rect.width, h / page.rect.height)

            if active_milestones:
                # Title 1
                title_1_pt = map_offset_pt(padding, padding + title_size * 0.8)
                page.insert_text(title_1_pt, "Milestones", fontsize=title_size, fontname="hebo", color=hex_to_rgb("#334155"), rotate=page.rotation)

                y_offset = padding + (30 * scaleX)
                for m in active_milestones:
                    r_rgb = hex_to_rgb(m['color'])
                    # Swatch is 14x14 
                    swatch_quad = map_offset_quad(padding, y_offset, 14 * scaleX, 14 * scaleX)
                    page.draw_quad(swatch_quad, color=hex_to_rgb("#cbd5e1"), fill=r_rgb, width=1*scaleX)
                    
                    # Text
                    text_pt = map_offset_pt(padding + 22 * scaleX, y_offset + 11 * scaleX)
                    page.insert_text(text_pt, m['name'], fontsize=font_size, fontname="helv", color=hex_to_rgb("#475569"), rotate=page.rotation)
                    
                    y_offset += item_height

            if active_temporal_states:
                start_y = padding + milestones_height + middle_pad
                title_2_pt = map_offset_pt(padding, start_y + title_size * 0.8)
                page.insert_text(title_2_pt, "Map Statuses", fontsize=title_size, fontname="hebo", color=hex_to_rgb("#334155"), rotate=page.rotation)

                y_offset = start_y + (30 * scaleX)
                TEMPORAL_COLORS = {
                    'planned': '#94a3b8',
                    'ongoing': '#f59e0b',
                    'completed': '#10b981',
                }
                for state in active_temporal_states:
                    icon_color = TEMPORAL_COLORS.get(state, '#cbd5e1')
                    
                    center_pt = map_offset_pt(padding + (16.6 * scaleX), y_offset + (10 * scaleX))
                    page.draw_circle(center_pt, 9.6 * scaleX, color=hex_to_rgb(icon_color), fill=hex_to_rgb("#ffffff"), width=2.5*scaleX)
                    
                    state_text = state.capitalize()
                    text_pt = map_offset_pt(padding + 32 * scaleX, y_offset + 14 * scaleX)
                    page.insert_text(text_pt, state_text, fontsize=font_size, fontname="helv", color=hex_to_rgb("#475569"), rotate=page.rotation)
                    
                    y_offset += item_height

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