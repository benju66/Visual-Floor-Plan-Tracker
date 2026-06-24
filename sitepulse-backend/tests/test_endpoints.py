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


def test_delete_sheet_storage_requires_bearer_token():
    # The storage-cleanup route is auth-gated the same way: a missing bearer is
    # rejected at the HTTPBearer dependency before verify_sheet_access or any
    # service-role storage call runs.
    with TestClient(app) as client:
        res = client.delete("/sheet-storage/some-sheet-id")
    assert res.status_code in (401, 403)


def test_delete_project_requires_bearer_token():
    # Project deletion is destructive and admin-gated, but the very first gate is
    # the HTTPBearer dependency: a missing bearer is rejected before
    # verify_project_admin or any service-role delete runs.
    with TestClient(app) as client:
        res = client.delete("/project/some-project-id")
    assert res.status_code in (401, 403)
