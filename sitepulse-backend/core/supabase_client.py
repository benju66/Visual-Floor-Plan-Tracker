"""The global service-role Supabase client + the storage/DB helpers bound to it.

This module hard-fails at import when the SUPABASE_* env vars are missing —
the same fail-fast contract main.py always had (conftest.py sets hermetic
fakes before any test import).

Seam rule: consumers reference the client via module-attribute lookup
(`from core import supabase_client as db` … `db.supabase.table(...)` inside the
function), never `from core.supabase_client import supabase` — tests patch
`core.supabase_client.supabase` and import-time binding would detach them.
"""
import os
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Optional

from fastapi import HTTPException
from storage3.exceptions import StorageApiError
from supabase import create_client, Client
from supabase.lib.client_options import ClientOptions as _BaseClientOptions
from supabase_auth._sync.storage import SyncSupportedStorage

from core import config  # noqa: F401  (imported first so load_dotenv() has run)


@dataclass
class SafeClientOptions(_BaseClientOptions):
    """Guard against supabase-py v2.28.3 regression where ClientOptions
    dropped the 'storage' and 'httpx_client' fields but _init_supabase_auth_client
    still reads them. Uses the correct types per library contract."""
    storage: Optional[SyncSupportedStorage] = None
    httpx_client: Optional[object] = None


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


def download_original_pdf(sheet_id: str) -> bytes:
    """Download `originals/<sheet_id>.pdf`, translating a missing storage object
    into a clean 404. A missing object raises storage3's StorageApiError — the
    `except fitz.FileDataError` branches only fire when DOWNLOADED bytes aren't
    a valid PDF, so without this a legacy sheet with no original returned a
    generic 500 that leaked the raw storage error string."""
    try:
        return supabase.storage.from_("floorplans").download(f"originals/{sheet_id}.pdf")
    except StorageApiError as e:
        print(f"[WARN] Original PDF unavailable for sheet {sheet_id}: {e}")
        raise HTTPException(
            status_code=404,
            detail="Original PDF not found in Storage. Please re-upload or attach the source file.",
        )


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
