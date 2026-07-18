"""Route modules (Backend Structure Phase 2).

Each module exposes a `router = APIRouter()` with FULL route paths (no prefix)
— main.py includes them with no prefix, so every URL is byte-identical to the
pre-split app. Handlers follow the seam rule: shared state is referenced via
module-attribute lookup on the core modules (`auth.verify_sheet_access`,
`db.supabase`, `config.STORAGE_CACHE_SECONDS`), never import-time binding.
"""
