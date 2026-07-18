"""One-time backfill: extract vectors for all sheets missing a sheet_vectors cache entry.

Usage:
    cd sitepulse-backend
    .\venv\Scripts\activate  (Windows) or source venv/bin/activate (Mac/Linux)
    python backfill_vectors.py
"""
import os
from dotenv import load_dotenv
from supabase import create_client
from core.extraction import extract_vectors_from_pdf

load_dotenv()

supabase_url = os.environ.get("SUPABASE_URL")
supabase_key = os.environ.get("SUPABASE_KEY")

if not supabase_url or not supabase_key:
    raise ValueError("SUPABASE_URL and SUPABASE_KEY must be set in .env")

supabase = create_client(supabase_url, supabase_key)

# Get all sheets
sheets = supabase.table("sheets").select("id").execute().data

# Get sheets that already have cached vectors
cached = supabase.table("sheet_vectors").select("sheet_id").execute().data
cached_ids = {row["sheet_id"] for row in cached}

missing = [s for s in sheets if s["id"] not in cached_ids]
print(f"Found {len(missing)} sheets without cached vectors (of {len(sheets)} total)")

if not missing:
    print("Nothing to backfill — all sheets have cached vectors.")
    exit(0)

success_count = 0
skip_count = 0

for i, sheet in enumerate(missing):
    sheet_id = sheet["id"]
    try:
        pdf_bytes = supabase.storage.from_("floorplans").download(f"originals/{sheet_id}.pdf")
        vectors = extract_vectors_from_pdf(pdf_bytes)
        supabase.table("sheet_vectors").upsert(
            {"sheet_id": sheet_id, "vectors": vectors},
            on_conflict="sheet_id"
        ).execute()
        print(f"  [{i+1}/{len(missing)}] {sheet_id}: {len(vectors)} vectors cached")
        success_count += 1
    except Exception as e:
        print(f"  [{i+1}/{len(missing)}] {sheet_id}: SKIPPED ({e})")
        skip_count += 1

print(f"\nBackfill complete. Success: {success_count}, Skipped: {skip_count}")
