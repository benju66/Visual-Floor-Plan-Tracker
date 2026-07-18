"""Non-route layers of the SitePulse backend (Backend Structure Phase 1).

Deliberately empty of imports: submodules are imported explicitly
(`from core import config`, `from core import supabase_client as db`, ...)
so that importing one module — in particular the pure, env-free
`core.extraction` — never drags in the Supabase client or env validation.
"""
