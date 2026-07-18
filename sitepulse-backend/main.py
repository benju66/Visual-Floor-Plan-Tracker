from fastapi import FastAPI, HTTPException, Depends
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
import io
import fitz  # PyMuPDF for fast PDF to Image conversion

# Non-route layers live in core/ (Backend Structure Phase 1). Handlers reference
# the moved names via module-attribute lookup (auth.verify_sheet_access,
# db.supabase, config.STORAGE_CACHE_SECONDS, ...) — never import-time binding —
# so the tests' monkeypatch seams on the core modules reach every call site
# (the seam rule). Importing core.supabase_client also keeps the original
# fail-fast contract: main still refuses to import without SUPABASE_* env vars.
from core import auth, config, extraction, pdf
from core import supabase_client as db
from core.models import ExportRequest
from routers import uploads


@asynccontextmanager
async def lifespan(app):
    """Fail fast with clear diagnostics if Supabase sub-clients failed to init."""
    checks = {
        "auth": hasattr(db.supabase, "auth"),
        "storage": hasattr(db.supabase, "storage"),
        "postgrest": hasattr(db.supabase, "postgrest"),
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
    allow_origins=config.allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
def health_check():
    return {"status": "success", "message": "Backend is online!"}


app.include_router(uploads.router)


@app.delete("/sheet-storage/{sheet_id}")
async def delete_sheet_storage(sheet_id: str, user: dict = Depends(auth.get_current_user)):
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
        await auth.verify_sheet_access(sheet_id, user["sub"])

        def process_delete():
            paths = [f"converted/{sheet_id}.png", f"originals/{sheet_id}.pdf"]
            db.supabase.storage.from_("floorplans").remove(paths)
            return paths

        import asyncio
        removed = await asyncio.to_thread(process_delete)
        return {"status": "success", "removed": removed}
    except HTTPException:
        raise
    except Exception as e:
        print(f"Error deleting sheet storage for {sheet_id}: {str(e)}")
        raise HTTPException(status_code=500, detail="Deleting the sheet's stored files failed on the server. Please try again.")


@app.delete("/project/{project_id}")
async def delete_project(project_id: str, user: dict = Depends(auth.get_current_user)):
    """Hard-delete a project and reclaim its storage — admin only.

    This is the service-side half of the Global Settings → Projects "Delete"
    action. Order of operations:

      1. `verify_project_admin` — the caller must hold `owner`/`admin` on this
         project (a real JWT-derived `sub`, not a client-supplied id).
      2. Collect the project's sheet ids (they are unreadable after the cascade),
         then delete the `projects` row FIRST. Every child table FKs to
         `projects` with `ON DELETE CASCADE` (sheets → units →
         status_logs/audit/vectors, project_members, activities,
         lookahead_plans, project_contacts), so the whole data tree goes with
         it in one statement. The row delete is the authoritative destruction:
         if it fails or times out, NOTHING has been touched and the retry is
         clean — never a live, visible project whose drawings were already
         destroyed (the pre-fix ordering).
      3. Only after the cascade succeeds, remove each sheet's storage blobs
         (`converted/<id>.png`, `originals/<id>.pdf`) with the service-role
         client — the `floorplans` bucket's RLS denies a client `.remove()`, so
         this MUST happen server-side or the blobs orphan. Idempotent: Supabase
         storage does not error on already-absent paths.

    Storage removal is best-effort/non-fatal — worst case a sweep hiccup
    orphans blobs (recoverable from the Storage dashboard). Deprecated
    `tiles/<id>/...` objects (OpenSeadragon path, removed) are not swept here —
    they are absent for any recent sheet; the canonical `delete_sheet_storage`
    route doesn't sweep them either.
    """
    try:
        await auth.verify_project_admin(project_id, user["sub"])

        def process_delete():
            sheets_res = (
                db.supabase.table("sheets").select("id").eq("project_id", project_id).execute()
            )
            sheet_ids = [s["id"] for s in (sheets_res.data or [])]

            # Authoritative destruction first — see docstring ordering rationale.
            db.supabase.table("projects").delete().eq("id", project_id).execute()

            paths = []
            for sid in sheet_ids:
                paths.append(f"converted/{sid}.png")
                paths.append(f"originals/{sid}.pdf")
            if paths:
                try:
                    # Supabase storage remove supports batches; cap at 100/call.
                    for i in range(0, len(paths), 100):
                        db.supabase.storage.from_("floorplans").remove(paths[i:i + 100])
                except Exception as storage_err:  # non-fatal — see docstring
                    print(f"Project {project_id} storage cleanup warning (non-fatal): {storage_err}")

            return len(sheet_ids)

        import asyncio
        sheet_count = await asyncio.to_thread(process_delete)
        return {"status": "success", "deleted_sheets": sheet_count}
    except HTTPException:
        raise
    except Exception as e:
        print(f"Error deleting project {project_id}: {str(e)}")
        raise HTTPException(status_code=500, detail="Deleting the project failed on the server. Nothing was removed — please try again.")

@app.get("/extract-vectors/{sheet_id}")
async def extract_snapping_vectors(sheet_id: str, user: dict = Depends(auth.get_current_user)):
    """Fallback endpoint for legacy sheets without pre-extracted vectors.
    Extracts vectors from the stored PDF and writes through to sheet_vectors cache."""
    try:
        await auth.verify_sheet_access(sheet_id, user["sub"])

        def process():
            res = db.download_original_pdf(sheet_id)
            vectors = extraction.extract_vectors_from_pdf(res)
            # Write-through: cache for future reads (non-fatal, but LOGGED — a
            # silent swallow here is exactly the known "vector cache write
            # timeout → repeated slow extraction / no wall data" failure mode).
            try:
                db.supabase.table("sheet_vectors").upsert(
                    {"sheet_id": sheet_id, "vectors": vectors},
                    on_conflict="sheet_id"
                ).execute()
            except Exception as cache_err:
                print(f"[WARN] sheet_vectors cache write failed for {sheet_id}: {cache_err}")
            return vectors

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


@app.get("/extract-text/{sheet_id}")
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


@app.post("/export-pdf/{sheet_id}")
async def export_status_pdf(
    sheet_id: str, 
    req: ExportRequest,
    user: dict = Depends(auth.get_current_user),
):
    try:
        await auth.verify_sheet_access(sheet_id, user["sub"])
        def process_export():
            # Download as raw bytes directly from Supabase (404s cleanly when missing)
            res = db.download_original_pdf(sheet_id)

            with fitz.open(stream=res, filetype="pdf") as doc:
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
                
                    color_rgb = pdf.hex_to_rgb(poly.color)
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
                    
                    # legend_data is a loosely-typed client Dict — coerce/guard every
                    # field so one malformed value degrades that legend entry instead
                    # of 500ing the whole export.
                    def _num(v, fallback):
                        try:
                            return float(v)
                        except (TypeError, ValueError):
                            return fallback

                    pctX = _num(legend.get('pctX'), 0.05)
                    pctY = _num(legend.get('pctY'), 0.05)
                    scaleX = _num(legend.get('scaleX'), 1.0)
                    # milestone->activity rename: prefer the new payload key, fall back
                    # to the legacy one so an older frontend still exports a full legend.
                    active_activities = legend.get('active_activities') or legend.get('active_milestones', [])
                    if not isinstance(active_activities, list):
                        active_activities = []

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
                    if not isinstance(active_temporal_states, list):
                        active_temporal_states = []
                    active_temporal_states = [s for s in active_temporal_states if isinstance(s, str)]

                    activities_height = (30 * overall_scale) + (len(active_activities) * item_height) if active_activities else 0
                    statuses_height = (30 * overall_scale) + (len(active_temporal_states) * item_height) if active_temporal_states else 0

                    middle_pad = padding if (active_activities and active_temporal_states) else 0
                    total_items_height = activities_height + statuses_height + middle_pad
                
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

                    if active_activities:
                        # Title 1
                        title_1_pt = map_offset_pt(padding, padding + title_size * 0.8)
                        page.insert_text(title_1_pt, "Activities", fontsize=title_size, fontname="hebo", color=pdf.hex_to_rgb("#334155"), rotate=page.rotation)

                        y_offset = padding + (30 * overall_scale)
                        for m in active_activities:
                            if not isinstance(m, dict):
                                continue
                            r_rgb = pdf.hex_to_rgb(m.get('color'))
                            # Swatch is 14x14
                            swatch_quad = map_offset_quad(padding, y_offset, 14 * overall_scale, 14 * overall_scale)
                            page.draw_quad(swatch_quad, color=pdf.hex_to_rgb("#cbd5e1"), fill=r_rgb, width=1*overall_scale)

                            # Text
                            text_pt = map_offset_pt(padding + 22 * overall_scale, y_offset + 11 * overall_scale)
                            page.insert_text(text_pt, str(m.get('name') or ''), fontsize=font_size, fontname="helv", color=pdf.hex_to_rgb("#475569"), rotate=page.rotation)

                            y_offset += item_height

                    if active_temporal_states:
                        start_y = padding + activities_height + middle_pad
                        title_2_pt = map_offset_pt(padding, start_y + title_size * 0.8)
                        page.insert_text(title_2_pt, "Map Statuses", fontsize=title_size, fontname="hebo", color=pdf.hex_to_rgb("#334155"), rotate=page.rotation)

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
                        
                            page.draw_circle(center_pt, r_val, color=pdf.hex_to_rgb(icon_color), fill=pdf.hex_to_rgb("#ffffff"), width=2.5*overall_scale)
                        
                            # Draw custom icons perfectly matching vector offsets
                            if state == 'completed':
                                c1 = map_offset_pt(center_vx - 4 * overall_scale, center_vy + 1 * overall_scale)
                                c2 = map_offset_pt(center_vx - 1 * overall_scale, center_vy + 4 * overall_scale)
                                c3 = map_offset_pt(center_vx + 5 * overall_scale, center_vy - 4 * overall_scale)
                                page.draw_polyline([c1, c2, c3], color=pdf.hex_to_rgb(icon_color), width=2*overall_scale)
                            elif state == 'planned':
                                rc_w = 8 * overall_scale
                                rc_h = 8 * overall_scale
                                r_q = map_offset_quad(center_vx - 4*overall_scale, center_vy - 4*overall_scale, rc_w, rc_h)
                                page.draw_quad(r_q, color=pdf.hex_to_rgb(icon_color), width=1.5*overall_scale)
                                l1 = map_offset_pt(center_vx - 4*overall_scale, center_vy - 1*overall_scale)
                                l2 = map_offset_pt(center_vx + 4*overall_scale, center_vy - 1*overall_scale)
                                page.draw_line(l1, l2, color=pdf.hex_to_rgb(icon_color), width=1.5*overall_scale)
                                p1 = map_offset_pt(center_vx - 2*overall_scale, center_vy - 6*overall_scale)
                                p2 = map_offset_pt(center_vx - 2*overall_scale, center_vy - 4*overall_scale)
                                p3 = map_offset_pt(center_vx + 2*overall_scale, center_vy - 6*overall_scale)
                                p4 = map_offset_pt(center_vx + 2*overall_scale, center_vy - 4*overall_scale)
                                page.draw_line(p1, p2, color=pdf.hex_to_rgb(icon_color), width=1.5*overall_scale)
                                page.draw_line(p3, p4, color=pdf.hex_to_rgb(icon_color), width=1.5*overall_scale)
                            elif state == 'ongoing':
                                h1 = map_offset_pt(center_vx - 4*overall_scale, center_vy - 4*overall_scale)
                                h2 = map_offset_pt(center_vx + 4*overall_scale, center_vy - 4*overall_scale)
                                h3 = map_offset_pt(center_vx - 4*overall_scale, center_vy + 4*overall_scale)
                                h4 = map_offset_pt(center_vx + 4*overall_scale, center_vy + 4*overall_scale)
                                page.draw_polyline([h1, h2, h3, h4, h1], color=pdf.hex_to_rgb(icon_color), width=1.5*overall_scale)
                        
                            state_text = state.capitalize()
                            text_pt = map_offset_pt(padding + 32 * overall_scale, y_offset + 14 * overall_scale)
                            page.insert_text(text_pt, state_text, fontsize=font_size, fontname="helv", color=pdf.hex_to_rgb("#475569"), rotate=page.rotation)
                        
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
            
            return pdf_bytes

        import asyncio
        pdf_bytes = await asyncio.to_thread(process_export)
        return StreamingResponse(
            io.BytesIO(pdf_bytes),
            media_type="application/pdf",
            headers={
                # Unicode-safe (RFC 5987): a project name with an em dash or
                # accents used to crash Starlette's latin-1 header encode.
                "Content-Disposition": pdf.content_disposition_attachment(f"{req.project_name}_{req.sheet_name}_Status.pdf"),
                "Access-Control-Expose-Headers": "Content-Disposition"
            }
        )

    except fitz.FileDataError:
        raise HTTPException(status_code=404, detail="Original PDF not found in Storage. Please re-upload or attach the source file.")
    except HTTPException:
        # Without this branch, verify_sheet_access's 403/404 fell into the
        # generic handler below and re-emitted as a 500 — masking authz results
        # from the frontend and from monitoring. Every other route has it.
        raise
    except Exception as e:
         print(f"Error exporting pdf for {sheet_id}: {str(e)}")
         raise HTTPException(status_code=500, detail="PDF export failed on the server. Please try again.")