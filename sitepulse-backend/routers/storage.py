"""Storage-reclaim routes: DELETE /sheet-storage/{sheet_id}, DELETE /project/{project_id}."""
from fastapi import APIRouter, HTTPException, Depends

from core import auth
from core import supabase_client as db

router = APIRouter()


@router.delete("/sheet-storage/{sheet_id}")
async def delete_sheet_storage(sheet_id: str, user: dict = Depends(auth.get_current_user)):
    """Service-role delete of a sheet's storage objects — the converted preview
    PNG and the original PDF.

    The `floorplans` bucket has storage RLS enabled with ZERO policies, so the
    client's own `supabase.storage.from('floorplans').remove(...)` is denied
    project-wide and the blobs orphan when a drawing/level is deleted. This
    authenticated route removes them with the same service-role client that
    uploaded them (the upload/attach handlers), keyed by the sheet UUID.

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


@router.delete("/project/{project_id}")
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
