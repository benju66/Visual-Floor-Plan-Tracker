"""Pytest bootstrap for the SitePulse backend.

This file lives at the backend root so that:
  1. The repo root is on sys.path, making `import main` work from tests/.
  2. Required environment variables are set BEFORE `main` is first imported.

`main` raises at import time if SUPABASE_* vars are missing and constructs a
Supabase client from them, so the values must exist before any test imports it.
We set hermetic test values here; `load_dotenv()` in main uses override=False,
so these win over any real .env that may be present locally.
"""
import os

# A known secret so tests can mint JWTs that main.get_current_user will accept.
TEST_JWT_SECRET = "test-jwt-secret-do-not-use-in-prod"

os.environ.setdefault("SUPABASE_URL", "https://test.supabase.co")
os.environ.setdefault("SUPABASE_KEY", "test-service-key")
os.environ["SUPABASE_JWT_SECRET"] = TEST_JWT_SECRET
