"""One-off operator sweep of dead `floorplans` storage objects (audit D2).

Two kinds of debris, enumerated via SQL against storage.objects and fed in as a
manifest file (one object name per line):

  1. Sheet-orphaned `converted/<id>.png` / `originals/<id>.pdf` — files whose
     `sheets` row was deleted before the DELETE /sheet-storage route existed
     (the bucket's RLS denies client removes, so they orphaned silently).
  2. Every `tiles/<id>/...` object — the removed OpenSeadragon pipeline; nothing
     reads tiles since the frontend moved to client-side pdf.js rendering, and
     the canonical delete route deliberately doesn't sweep them.

Safety: converted/originals names are re-checked against the LIVE sheets table
at run time — a stale manifest can never delete a live sheet's files. tiles/*
is swept unconditionally (dead feature). Dry-run by default; pass --apply to
delete. Removal goes through the storage API (service-role, same client the
upload handlers use) so both the DB row and the underlying object are freed —
never DELETE FROM storage.objects directly.

Usage (from sitepulse-backend/, with .env providing SUPABASE_URL/SUPABASE_KEY):
    python sweep_storage_orphans.py <manifest.txt>          # dry run
    python sweep_storage_orphans.py <manifest.txt> --apply  # delete
"""
import os
import re
import sys

from dotenv import load_dotenv
from supabase import create_client

load_dotenv()

UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
BATCH = 100


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: python sweep_storage_orphans.py <manifest.txt> [--apply]")
        return 1
    manifest_path = sys.argv[1]
    apply_mode = "--apply" in sys.argv

    supabase = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_KEY"])

    with open(manifest_path, encoding="utf-8-sig") as f:
        names = [line.strip() for line in f if line.strip()]

    # Run-time guard: resolve every uuid-shaped converted/originals ref against
    # the live sheets table. Anything that resolves is SKIPPED, whatever the
    # manifest says.
    refs = set()
    for n in names:
        if n.startswith(("converted/", "originals/")):
            ref = n.split("/", 1)[1].rsplit(".", 1)[0]
            if UUID_RE.match(ref):
                refs.add(ref)
    live: set[str] = set()
    ref_list = sorted(refs)
    for i in range(0, len(ref_list), BATCH):
        res = supabase.table("sheets").select("id").in_("id", ref_list[i:i + BATCH]).execute()
        live.update(r["id"] for r in (res.data or []))

    to_delete: list[str] = []
    skipped: list[str] = []
    for n in names:
        if n.startswith("tiles/"):
            to_delete.append(n)
        elif n.startswith(("converted/", "originals/")):
            ref = n.split("/", 1)[1].rsplit(".", 1)[0]
            if UUID_RE.match(ref) and ref in live:
                skipped.append(n)  # live sheet — never touch
            else:
                to_delete.append(n)  # orphan (or the folder placeholder)
        else:
            skipped.append(n)  # unknown prefix — never delete blind

    tiles = sum(1 for n in to_delete if n.startswith("tiles/"))
    print(f"manifest: {len(names)} names | delete: {len(to_delete)} "
          f"({tiles} tiles, {len(to_delete) - tiles} orphaned files) | "
          f"skipped (live/unknown): {len(skipped)}")
    for s in skipped:
        print(f"  SKIP {s}")

    if not apply_mode:
        print("dry run — pass --apply to delete.")
        return 0

    failed = 0
    for i in range(0, len(to_delete), BATCH):
        chunk = to_delete[i:i + BATCH]
        try:
            supabase.storage.from_("floorplans").remove(chunk)
            print(f"removed {min(i + BATCH, len(to_delete))}/{len(to_delete)}")
        except Exception as e:  # keep sweeping; report at the end
            failed += len(chunk)
            print(f"[WARN] batch at {i} failed: {e}")

    print(f"done: {len(to_delete) - failed} removed, {failed} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
