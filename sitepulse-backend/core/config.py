"""Environment-derived configuration constants.

Every constant here has a safe default, so importing this module NEVER requires
env vars (that keeps `core.extraction` — which reads the two vector knobs —
importable by scripts and tests with a clean environment). The Supabase
credentials (which DO hard-fail when missing) live in core.supabase_client.

Seam rule: consumers reference these via module-attribute lookup
(`from core import config` … `config.MAX_UPLOAD_BYTES` inside the function),
never `from core.config import MAX_UPLOAD_BYTES` — import-time binding would
silently detach the monkeypatch seams (tests patch `core.config.MAX_UPLOAD_BYTES`
and `core.config.VECTOR_CAP_LINES`).
"""
import os

from dotenv import load_dotenv

load_dotenv()

# Local dev runs on :3010 (npm run dev:3010) — the old :3000 default was a
# standing CORS exception that served nobody.
FRONTEND_URL = os.environ.get("FRONTEND_URL", "http://localhost:3010")

# Split by comma if the env var contains multiple domains, and natively support production
allowed_origins = [url.strip() for url in FRONTEND_URL.split(",")]
for default_url in ["http://localhost:3010", "https://sitepulse.build"]:
    if default_url not in allowed_origins:
        allowed_origins.append(default_url)

# Storage objects are addressed by versioned public URLs on the frontend
# (?v=<sheets.pdf_version>), so browsers/CDN may cache them long-term. The
# frontend falls back to revalidating fetches when no version is available.
STORAGE_CACHE_SECONDS = "604800"  # 7 days

# ── Upload guardrails ────────────────────────────────────────────────────────
# The upload handlers buffer the whole PDF in memory for PyMuPDF, so an
# unbounded upload can OOM the single Render instance and take the backend down
# for everyone. The cap is enforced by a chunked read (a client-supplied
# Content-Length header can lie) and is env-overridable for bigger plan sets.
MAX_UPLOAD_MB = int(os.environ.get("MAX_UPLOAD_MB", "80"))
MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024
_UPLOAD_CHUNK_BYTES = 1024 * 1024

# Preview-render pixel budget. An E-size (36x24") page at the standard 4x zoom
# is 10368x6912 px (~72 MP, ~215 MB of RGB) and is proven to fit; the budget sits
# just above that so every normal sheet renders exactly as before, while a
# degenerate/oversized page gets its zoom scaled down (still sharp, bounded
# memory) instead of exploding the pixmap allocation.
MAX_RENDER_PIXELS = 80_000_000
PREVIEW_ZOOM = 4.0

# Minimum segment length (in PDF points, 1pt = 1/72") for a line to be kept as a
# snapping vector. Sub-point segments are hatching/detail noise that can't be
# meaningfully snapped to, and they dominate the raw extraction count (a typical
# sheet yields ~67k raw lines, of which the vast majority are degenerate or duplicate).
# 1pt is well below any real wall, so this filter removes noise without dropping
# structural geometry. Combined with order-insensitive dedupe it shrinks the cached
# payload by ~70% — critical for staying under the backend timeout and keeping the
# IndexedDB-persisted query cache small (see AGENTS.md §5/§7).
MIN_SEGMENT_PTS = 1.0

# Hard cap on snapping vectors per sheet. A pathologically dense sheet can still
# yield ~66k lines AFTER the filters above, and that payload is too large for the
# sheet_vectors upsert to finish inside the DB's 8s statement_timeout (a role
# setting on authenticated/authenticator — configured in the database, not this
# repo). Over the cap we keep the LONGEST segments: walls are long; the tail is
# dimension ticks / hatching that snapping can't use anyway. Prod sheets up to
# ~43k lines write comfortably; 40k leaves margin under the 8s cliff.
VECTOR_CAP_LINES = int(os.environ.get("VECTOR_CAP_LINES", "40000"))
