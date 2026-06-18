from fastapi import FastAPI, UploadFile, File, HTTPException, Depends
from fastapi.responses import StreamingResponse, Response
from fastapi.middleware.cors import CORSMiddleware
from supabase import create_client, Client
from supabase.lib.client_options import ClientOptions as _BaseClientOptions
from supabase_auth._sync.storage import SyncSupportedStorage
from dataclasses import dataclass
from pydantic import BaseModel
from typing import List, Optional, Dict
from contextlib import asynccontextmanager
import os
import io
import shutil
import tempfile
import fitz  # PyMuPDF for fast PDF to Image conversion
import jwt  # PyJWT — local JWT validation, no network round-trip
from datetime import datetime, timezone
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from dotenv import load_dotenv

load_dotenv()

@dataclass
class SafeClientOptions(_BaseClientOptions):
    """Guard against supabase-py v2.28.3 regression where ClientOptions
    dropped the 'storage' and 'httpx_client' fields but _init_supabase_auth_client
    still reads them. Uses the correct types per library contract."""
    storage: Optional[SyncSupportedStorage] = None
    httpx_client: Optional[object] = None

FRONTEND_URL = os.environ.get("FRONTEND_URL", "http://localhost:3000")

# Split by comma if the env var contains multiple domains, and natively support production
allowed_origins = [url.strip() for url in FRONTEND_URL.split(",")]
for default_url in ["http://localhost:3000", "https://sitepulse.build"]:
    if default_url not in allowed_origins:
        allowed_origins.append(default_url)

supabase_url = os.environ.get("SUPABASE_URL")
supabase_key = os.environ.get("SUPABASE_KEY")
supabase_jwt_secret = os.environ.get("SUPABASE_JWT_SECRET")

if not supabase_url or not supabase_key or not supabase_jwt_secret:
    raise ValueError("FATAL ERROR: Supabase keys are missing from the .env file!")

# Configure explicit timeouts to prevent PDF/storage downloads from hanging
# until Render's 30-second platform deadline fires an opaque process kill.
supabase: Client = create_client(
    supabase_url,
    supabase_key,
    options=SafeClientOptions(
        postgrest_client_timeout=25,
        storage_client_timeout=25,
    )
)

@asynccontextmanager
async def lifespan(app):
    """Fail fast with clear diagnostics if Supabase sub-clients failed to init."""
    checks = {
        "auth": hasattr(supabase, "auth"),
        "storage": hasattr(supabase, "storage"),
        "postgrest": hasattr(supabase, "postgrest"),
    }
    failed = [name for name, ok in checks.items() if not ok]
    if failed:
        raise RuntimeError(
            f"FATAL: Supabase client missing sub-clients: {', '.join(failed)}. "
            f"Check supabase-py version compatibility."
        )
    yield

app = FastAPI(title="SitePulse Backend API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins, 
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
def health_check():
    return {"status": "success", "message": "Backend is online!"}

security = HTTPBearer()

# This Supabase project signs user access tokens with an ASYMMETRIC key (ES256),
# so tokens are verified against the project's published JWKS public key — not the
# legacy HS256 shared secret. (The old SUPABASE_JWT_SECRET in .env was actually the
# public key id, which can't — and must not — be used to verify a signature: doing
# HS256 against a publicly-known value would let anyone forge a token.)
#
# Still LOCAL + CACHED, so the no-blocking-auth-network-call rule (§7) holds: that
# rule was about the per-request supabase.auth.get_user() round-trip. PyJWKClient
# fetches the JWKS once and caches it (lifespan), so steady-state verification does
# no network I/O. A short timeout keeps a JWKS outage from hanging the request.
JWKS_URL = f"{supabase_url}/auth/v1/.well-known/jwks.json"
_jwk_client = jwt.PyJWKClient(JWKS_URL, cache_keys=True, lifespan=600, timeout=10)
ALLOWED_ASYMMETRIC_ALGS = ["ES256", "RS256"]

def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)):
    """Validate the Supabase user JWT locally against the project's JWKS public key.

    Verifies the asymmetric (ES256) signature using the key whose `kid` matches the
    token header, requires the `authenticated` role, and never calls
    supabase.auth.get_user() (the former cause of /extract-vectors timeouts).
    """
    token = credentials.credentials
    try:
        signing_key = _jwk_client.get_signing_key_from_jwt(token)
        payload = jwt.decode(
            token,
            signing_key.key,
            algorithms=ALLOWED_ASYMMETRIC_ALGS,
            options={"verify_aud": False},  # Supabase uses role claim, not URL audience
        )
        if payload.get("role") != "authenticated":
            raise HTTPException(status_code=401, detail="Not authorized")
        return {"sub": payload["sub"], "role": payload["role"]}
    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=401,
            detail="Token expired",
            headers={"WWW-Authenticate": "Bearer"},
        )
    except jwt.PyJWTError:
        # Covers bad signatures, unknown kid, and JWKS fetch/parse failures
        # (PyJWKClientError is a PyJWTError) — never leak detail, always 401.
        raise HTTPException(
            status_code=401,
            detail="Invalid authentication credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )

async def verify_sheet_access(sheet_id: str, user_id: str):
    def check_access():
        sheet_res = supabase.table("sheets").select("project_id").eq("id", sheet_id).execute()
        if not sheet_res.data or len(sheet_res.data) == 0:
            return None, "Sheet not found"
        project_id = sheet_res.data[0]["project_id"]
        
        member_res = supabase.table("project_members").select("id").eq("project_id", project_id).eq("user_id", user_id).execute()
        if not member_res.data or len(member_res.data) == 0:
            return None, "Not authorized to access this project"
        return project_id, None
        
    import asyncio
    project_id, err = await asyncio.to_thread(check_access)
    if err == "Sheet not found":
        raise HTTPException(status_code=404, detail=err)
    if err == "Not authorized to access this project":
        raise HTTPException(status_code=403, detail=err)
    return project_id

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

# Storage objects are addressed by versioned public URLs on the frontend
# (?v=<sheets.pdf_version>), so browsers/CDN may cache them long-term. The
# frontend falls back to revalidating fetches when no version is available.
STORAGE_CACHE_SECONDS = "604800"  # 7 days

def bump_pdf_version(sheet_id: str):
    """Best-effort bump of sheets.pdf_version — cache-busts the public PDF/PNG
    URLs after an upload or re-attach. Non-fatal if the column does not exist
    yet (pre-migration deploys)."""
    try:
        supabase.table("sheets").update(
            {"pdf_version": datetime.now(timezone.utc).isoformat()}
        ).eq("id", sheet_id).execute()
    except Exception as e:
        print(f"[WARN] pdf_version bump skipped for {sheet_id}: {e}")

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
    user: dict = Depends(get_current_user),
):
    if not file.filename.lower().endswith('.pdf'):
        raise HTTPException(status_code=400, detail="Only PDF files are allowed")

    try:
        await verify_sheet_access(sheet_id, user["sub"])
        pdf_bytes = await file.read()

        def process_upload():
            doc = fitz.open(stream=pdf_bytes, filetype="pdf")

            if page_number < 1 or page_number > len(doc):
                raise ValueError(f"Page {page_number} does not exist. This PDF has {len(doc)} pages.")

            page = doc.load_page(page_number - 1)

            # Render fallback PNG at 4x for backward compat
            zoom = 4.0
            mat = fitz.Matrix(zoom, zoom)
            pix = page.get_pixmap(matrix=mat, alpha=False)
            img_bytes = pix.tobytes("png")

            file_path = f"converted/{sheet_id}.png"
            supabase.storage.from_("floorplans").remove([file_path])
            supabase.storage.from_("floorplans").upload(
                path=file_path,
                file=img_bytes,
                file_options={"content-type": "image/png", "cache-control": STORAGE_CACHE_SECONDS},
            )

            # Extract and store single-page PDF for vector extraction + PDF export
            single_page_doc = fitz.open()
            single_page_doc.insert_pdf(doc, from_page=page_number - 1, to_page=page_number - 1)
            single_page_pdf_bytes = single_page_doc.write()

            pdf_path = f"originals/{sheet_id}.pdf"
            supabase.storage.from_("floorplans").remove([pdf_path])
            supabase.storage.from_("floorplans").upload(
                path=pdf_path,
                file=single_page_pdf_bytes,
                file_options={"content-type": "application/pdf", "cache-control": STORAGE_CACHE_SECONDS},
            )

            public_url = supabase.storage.from_("floorplans").get_public_url(file_path)
            supabase.table("sheets").update({"base_image_url": public_url}).eq("id", sheet_id).execute()
            bump_pdf_version(sheet_id)

            # Pre-extract snapping vectors and populate the cache (non-fatal).
            # Note: tile-pyramid generation was removed — the frontend renders the
            # PDF client-side via pdf.js (PdfBaseLayer), so DZI tiles are unused.
            try:
                vectors = extract_vectors_from_pdf(single_page_pdf_bytes)
                supabase.table("sheet_vectors").upsert(
                    {"sheet_id": sheet_id, "vectors": vectors},
                    on_conflict="sheet_id"
                ).execute()
            except Exception as vec_err:
                print(f"[WARN] Vector pre-extraction skipped: {vec_err}")

            return public_url

        import asyncio
        public_url = await asyncio.to_thread(process_upload)
        return {"status": "success", "image_url": public_url, "tile_manifest_url": None}

    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except HTTPException:
        raise
    except Exception as e:
        print(f"Error processing upload: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/attach-original/{sheet_id}")
async def attach_original_pdf(
    sheet_id: str, 
    file: UploadFile = File(...),
    user: dict = Depends(get_current_user),
):
    if not file.filename.lower().endswith('.pdf'):
        raise HTTPException(status_code=400, detail="Only PDF files are allowed")
    
    try:
        await verify_sheet_access(sheet_id, user["sub"])
        pdf_bytes = await file.read()
        
        def process_attach():
            pdf_path = f"originals/{sheet_id}.pdf"
            supabase.storage.from_("floorplans").remove([pdf_path])
            supabase.storage.from_("floorplans").upload(
                path=pdf_path,
                file=pdf_bytes,
                file_options={"content-type": "application/pdf", "cache-control": STORAGE_CACHE_SECONDS},
            )
            bump_pdf_version(sheet_id)
            # Pre-extract vectors from the new PDF (non-fatal)
            try:
                vectors = extract_vectors_from_pdf(pdf_bytes)
                supabase.table("sheet_vectors").upsert(
                    {"sheet_id": sheet_id, "vectors": vectors},
                    on_conflict="sheet_id"
                ).execute()
            except Exception as vec_err:
                print(f"[WARN] Vector pre-extraction from attached PDF skipped: {vec_err}")
            # Regenerate the converted preview PNG so the canvas placeholder and
            # dashboard preload reflect the new drawing (non-fatal; previously the
            # stale PNG from the original upload was left in place forever).
            try:
                doc = fitz.open(stream=pdf_bytes, filetype="pdf")
                page = doc.load_page(0)
                pix = page.get_pixmap(matrix=fitz.Matrix(4.0, 4.0), alpha=False)
                png_path = f"converted/{sheet_id}.png"
                supabase.storage.from_("floorplans").remove([png_path])
                supabase.storage.from_("floorplans").upload(
                    path=png_path,
                    file=pix.tobytes("png"),
                    file_options={"content-type": "image/png", "cache-control": STORAGE_CACHE_SECONDS},
                )
            except Exception as png_err:
                print(f"[WARN] Preview PNG regeneration skipped: {png_err}")

        import asyncio
        await asyncio.to_thread(process_attach)
        return {"status": "success", "message": "Original PDF attached successfully!"}
    except HTTPException:
        raise
    except Exception as e:
        print(f"Error attaching pdf: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/sheet-storage/{sheet_id}")
async def delete_sheet_storage(sheet_id: str, user: dict = Depends(get_current_user)):
    """Service-role delete of a sheet's storage objects — the converted preview
    PNG and the original PDF.

    The `floorplans` bucket has storage RLS enabled with ZERO policies, so the
    client's own `supabase.storage.from('floorplans').remove(...)` is denied
    project-wide and the blobs orphan when a drawing/level is deleted. This
    authenticated route removes them with the same service-role client that
    uploaded them (the upload/attach handlers above), keyed by the sheet UUID.

    Both the live app's delete (`handleDeleteSheet`) and the workbench hard-delete
    (`useHardDeleteWorkbenchDrawing`) call this BEFORE they delete the `sheets`
    row — `verify_sheet_access` resolves the project + caller membership from the
    still-present row, the same membership gate as upload/export/extract (it
    covers the hidden `kind='workbench'` container too, since access is via
    `project_members`). Removal is idempotent: Supabase storage does not error on
    an already-absent path, so a re-run (or a sheet whose blobs were never
    written) is a harmless no-op.
    """
    try:
        await verify_sheet_access(sheet_id, user["sub"])

        def process_delete():
            paths = [f"converted/{sheet_id}.png", f"originals/{sheet_id}.pdf"]
            supabase.storage.from_("floorplans").remove(paths)
            return paths

        import asyncio
        removed = await asyncio.to_thread(process_delete)
        return {"status": "success", "removed": removed}
    except HTTPException:
        raise
    except Exception as e:
        print(f"Error deleting sheet storage for {sheet_id}: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

# Minimum segment length (in PDF points, 1pt = 1/72") for a line to be kept as a
# snapping vector. Sub-point segments are hatching/detail noise that can't be
# meaningfully snapped to, and they dominate the raw extraction count (a typical
# sheet yields ~67k raw lines, of which the vast majority are degenerate or duplicate).
# 1pt is well below any real wall, so this filter removes noise without dropping
# structural geometry. Combined with order-insensitive dedupe it shrinks the cached
# payload by ~70% — critical for staying under the backend timeout and keeping the
# IndexedDB-persisted query cache small (see AGENTS.md §5/§7).
MIN_SEGMENT_PTS = 1.0


def extract_vectors_from_pdf(pdf_bytes: bytes) -> list:
    """Extract structural line vectors from a PDF page.
    Returns a list of {start: {pctX, pctY}, end: {pctX, pctY}} dicts.
    Filters out curves (fixtures), microscopic lineweights (hatching),
    sub-point degenerate segments, and duplicate/overlapping segments."""
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    page = doc[0]

    width = page.rect.width
    height = page.rect.height

    # Inverse the derotation matrix to map PDF coordinates back to the map percentages
    inv_derot = ~page.derotation_matrix
    tl = page.cropbox.tl

    drawings = page.get_drawings()

    def map_point(p):
        p_mapped = (p - tl) * inv_derot
        return {"pctX": p_mapped.x / width, "pctY": p_mapped.y / height}

    # Collect candidate segments, then filter by length and dedupe.
    candidates = []

    for path in drawings:
        # FILTER 1: Reject curves (doors, toilets, fixtures)
        if any(item[0] in ('c', 'v', 'y') for item in path["items"]):
            continue

        # FILTER 2: Reject microscopic lineweights (hatching, shading)
        path_width = path.get("width")
        if path_width is not None and path_width < 0.2:
            continue

        for item in path["items"]:
            if item[0] == 'l':
                candidates.append((map_point(item[1]), map_point(item[2])))

            elif item[0] == 're':
                rect = item[1]
                corners = [rect.tl, rect.tr, rect.br, rect.bl]
                mapped = [map_point(c) for c in corners]
                for i in range(4):
                    candidates.append((mapped[i], mapped[(i + 1) % 4]))

    doc.close()

    # FILTER 3 + dedupe: drop sub-point segments (hatching/noise) and collapse
    # exact/reversed duplicates. Length is measured back in PDF points (pct * page
    # dimension) so the threshold is aspect-correct and resolution-independent.
    clean_lines = []
    seen = set()
    for start, end in candidates:
        dx_pts = (end["pctX"] - start["pctX"]) * width
        dy_pts = (end["pctY"] - start["pctY"]) * height
        if (dx_pts * dx_pts + dy_pts * dy_pts) < (MIN_SEGMENT_PTS * MIN_SEGMENT_PTS):
            continue

        a = (round(start["pctX"], 5), round(start["pctY"], 5))
        b = (round(end["pctX"], 5), round(end["pctY"], 5))
        key = (a, b) if a <= b else (b, a)
        if key in seen:
            continue
        seen.add(key)
        clean_lines.append({"start": start, "end": end})

    return clean_lines


@app.get("/extract-vectors/{sheet_id}")
async def extract_snapping_vectors(sheet_id: str, user: dict = Depends(get_current_user)):
    """Fallback endpoint for legacy sheets without pre-extracted vectors.
    Extracts vectors from the stored PDF and writes through to sheet_vectors cache."""
    try:
        await verify_sheet_access(sheet_id, user["sub"])

        def process():
            pdf_path = f"originals/{sheet_id}.pdf"
            res = supabase.storage.from_("floorplans").download(pdf_path)
            vectors = extract_vectors_from_pdf(res)
            # Write-through: cache for future reads
            try:
                supabase.table("sheet_vectors").upsert(
                    {"sheet_id": sheet_id, "vectors": vectors},
                    on_conflict="sheet_id"
                ).execute()
            except Exception:
                pass
            return vectors

        import asyncio
        clean_lines = await asyncio.to_thread(process)
        return {"status": "success", "vectors": clean_lines}

    except fitz.FileDataError:
        raise HTTPException(status_code=404, detail="Original PDF not found for vector extraction.")
    except HTTPException:
        raise
    except Exception as e:
        print(f"Error extracting vectors: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/export-pdf/{sheet_id}")
async def export_status_pdf(
    sheet_id: str, 
    req: ExportRequest,
    user: dict = Depends(get_current_user),
):
    try:
        await verify_sheet_access(sheet_id, user["sub"])
        def process_export():
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
                    (fitz.Point(
                        p.pctX * page.rect.width, 
                        p.pctY * page.rect.height
                    ) * page.derotation_matrix) + page.cropbox.tl
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
                
                # (debug file write removed — was leaking user data to disk in production)
                    
                pctX = legend.get('pctX', 0.05)
                pctY = legend.get('pctY', 0.05)
                scaleX = legend.get('scaleX', 1)
                active_milestones = legend.get('active_milestones', [])

                # Correctly map a visual percentage point to the underlying unrotated PDF canvas
                def get_mapped_pt(px_pct, py_pct):
                    return (fitz.Point(
                        page.rect.width * px_pct,
                        page.rect.height * py_pct
                    ) * page.derotation_matrix) + page.cropbox.tl

                # Scale proportionally to what a user sees on a standard ~1200px map canvas
                overall_scale = scaleX * (page.rect.width / 1200.0)

                font_size = 14 * overall_scale
                title_size = 16 * overall_scale
                item_height = 24 * overall_scale
                padding = 16 * overall_scale
                legend_w = 200 * overall_scale

                active_temporal_states = legend.get('active_temporal_states', [])

                milestones_height = (30 * overall_scale) + (len(active_milestones) * item_height) if active_milestones else 0
                statuses_height = (30 * overall_scale) + (len(active_temporal_states) * item_height) if active_temporal_states else 0
                
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
                page.draw_quad(bg_quad, color=(0.8,0.8,0.8), fill=(1,1,1), width=1.5 * overall_scale)

                def map_offset_pt(x_off, y_off):
                    return get_mapped_pt(pctX + (x_off / page.rect.width), pctY + (y_off / page.rect.height))

                def map_offset_quad(x_off, y_off, w, h):
                    return map_quad(pctX + (x_off / page.rect.width), pctY + (y_off / page.rect.height), w / page.rect.width, h / page.rect.height)

                if active_milestones:
                    # Title 1
                    title_1_pt = map_offset_pt(padding, padding + title_size * 0.8)
                    page.insert_text(title_1_pt, "Milestones", fontsize=title_size, fontname="hebo", color=hex_to_rgb("#334155"), rotate=page.rotation)

                    y_offset = padding + (30 * overall_scale)
                    for m in active_milestones:
                        r_rgb = hex_to_rgb(m['color'])
                        # Swatch is 14x14 
                        swatch_quad = map_offset_quad(padding, y_offset, 14 * overall_scale, 14 * overall_scale)
                        page.draw_quad(swatch_quad, color=hex_to_rgb("#cbd5e1"), fill=r_rgb, width=1*overall_scale)
                        
                        # Text
                        text_pt = map_offset_pt(padding + 22 * overall_scale, y_offset + 11 * overall_scale)
                        page.insert_text(text_pt, m['name'], fontsize=font_size, fontname="helv", color=hex_to_rgb("#475569"), rotate=page.rotation)
                        
                        y_offset += item_height

                if active_temporal_states:
                    start_y = padding + milestones_height + middle_pad
                    title_2_pt = map_offset_pt(padding, start_y + title_size * 0.8)
                    page.insert_text(title_2_pt, "Map Statuses", fontsize=title_size, fontname="hebo", color=hex_to_rgb("#334155"), rotate=page.rotation)

                    y_offset = start_y + (30 * overall_scale)
                    TEMPORAL_COLORS = {
                        'planned': '#94a3b8',
                        'ongoing': '#f59e0b',
                        'completed': '#10b981',
                    }
                    for state in active_temporal_states:
                        icon_color = TEMPORAL_COLORS.get(state, '#cbd5e1')
                        
                        center_vx = padding + 14 * overall_scale
                        center_vy = y_offset + 10 * overall_scale
                        center_pt = map_offset_pt(center_vx, center_vy)
                        
                        # Radius for the circle (match 9.6 from before but visually it was 12 * 0.8 = 9.6)
                        r_val = 9.6 * overall_scale
                        
                        page.draw_circle(center_pt, r_val, color=hex_to_rgb(icon_color), fill=hex_to_rgb("#ffffff"), width=2.5*overall_scale)
                        
                        # Draw custom icons perfectly matching vector offsets
                        if state == 'completed':
                            c1 = map_offset_pt(center_vx - 4 * overall_scale, center_vy + 1 * overall_scale)
                            c2 = map_offset_pt(center_vx - 1 * overall_scale, center_vy + 4 * overall_scale)
                            c3 = map_offset_pt(center_vx + 5 * overall_scale, center_vy - 4 * overall_scale)
                            page.draw_polyline([c1, c2, c3], color=hex_to_rgb(icon_color), width=2*overall_scale)
                        elif state == 'planned':
                            rc_w = 8 * overall_scale
                            rc_h = 8 * overall_scale
                            r_q = map_offset_quad(center_vx - 4*overall_scale, center_vy - 4*overall_scale, rc_w, rc_h)
                            page.draw_quad(r_q, color=hex_to_rgb(icon_color), width=1.5*overall_scale)
                            l1 = map_offset_pt(center_vx - 4*overall_scale, center_vy - 1*overall_scale)
                            l2 = map_offset_pt(center_vx + 4*overall_scale, center_vy - 1*overall_scale)
                            page.draw_line(l1, l2, color=hex_to_rgb(icon_color), width=1.5*overall_scale)
                            p1 = map_offset_pt(center_vx - 2*overall_scale, center_vy - 6*overall_scale)
                            p2 = map_offset_pt(center_vx - 2*overall_scale, center_vy - 4*overall_scale)
                            p3 = map_offset_pt(center_vx + 2*overall_scale, center_vy - 6*overall_scale)
                            p4 = map_offset_pt(center_vx + 2*overall_scale, center_vy - 4*overall_scale)
                            page.draw_line(p1, p2, color=hex_to_rgb(icon_color), width=1.5*overall_scale)
                            page.draw_line(p3, p4, color=hex_to_rgb(icon_color), width=1.5*overall_scale)
                        elif state == 'ongoing':
                            h1 = map_offset_pt(center_vx - 4*overall_scale, center_vy - 4*overall_scale)
                            h2 = map_offset_pt(center_vx + 4*overall_scale, center_vy - 4*overall_scale)
                            h3 = map_offset_pt(center_vx - 4*overall_scale, center_vy + 4*overall_scale)
                            h4 = map_offset_pt(center_vx + 4*overall_scale, center_vy + 4*overall_scale)
                            page.draw_polyline([h1, h2, h3, h4, h1], color=hex_to_rgb(icon_color), width=1.5*overall_scale)
                        
                        state_text = state.capitalize()
                        text_pt = map_offset_pt(padding + 32 * overall_scale, y_offset + 14 * overall_scale)
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
            
            return pdf_bytes

        import asyncio
        pdf_bytes = await asyncio.to_thread(process_export)
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