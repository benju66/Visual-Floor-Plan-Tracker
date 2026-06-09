"""Endpoint-level smoke tests via FastAPI's TestClient.

Exercises the app through the ASGI stack (including the lifespan startup
validation) without touching Supabase: the health check needs no auth, and
protected routes are rejected at the HTTPBearer dependency before any handler
or network call runs.
"""
from fastapi.testclient import TestClient

from main import app


def test_health_check_is_public():
    with TestClient(app) as client:
        res = client.get("/")
    assert res.status_code == 200
    assert res.json() == {"status": "success", "message": "Backend is online!"}


def test_protected_route_requires_bearer_token():
    # No Authorization header -> the HTTPBearer dependency short-circuits before
    # the handler runs, so no Supabase call is attempted. (FastAPI rejects a
    # missing bearer with 401/403 depending on version.)
    with TestClient(app) as client:
        res = client.get("/extract-vectors/some-sheet-id")
    assert res.status_code in (401, 403)
