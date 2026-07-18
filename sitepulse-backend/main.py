"""App assembly ONLY (Backend Structure Phase 2): FastAPI(), lifespan startup
validation, CORS, the public health route, and the four routers.

The non-route layers live in core/ and the handlers in routers/ — both follow
the seam rule (module-attribute lookup on core modules, never import-time
binding), so the tests' monkeypatch seams reach every call site. Importing
core.supabase_client here keeps the original fail-fast contract: main still
refuses to import without SUPABASE_* env vars, and `uvicorn main:app` stays
the deploy entrypoint (Dockerfile CMD + Render start command).
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager

from core import config
from core import supabase_client as db
from routers import export as export_routes
from routers import extraction as extraction_routes
from routers import storage as storage_routes
from routers import uploads as uploads_routes


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

# Full route paths live in the routers (no prefixes) — URLs are byte-identical
# to the pre-split app.
app.include_router(uploads_routes.router)
app.include_router(storage_routes.router)
app.include_router(extraction_routes.router)
app.include_router(export_routes.router)
