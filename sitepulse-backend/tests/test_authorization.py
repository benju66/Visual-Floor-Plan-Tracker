"""Authorization gate — verify_sheet_access / verify_project_admin.

These two helpers are the project-membership + privileged-role check that every
protected route leans on, and they had ZERO direct coverage (every other suite
stubs them out — the biggest untested risk in the backend). Driven here through
the REAL helpers (no stubs) with a small configurable in-test Supabase, mirroring
the recorder pattern in test_backend_safety.py.

Two route-level tests additionally pin that a helper's 404/403 reaches the client
(the load-bearing `except HTTPException: raise` tail, AGENTS §7) instead of being
re-wrapped as a generic 500.
"""
import asyncio
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from core import auth, supabase_client
from main import app


AUTH_USER = {"sub": "user-1", "role": "authenticated"}


# ── Configurable in-test Supabase (models only the two tables the helpers read) ──
# `.select(...).eq(...).eq(...).execute()` -> SimpleNamespace(data=rows).

class _Query:
    def __init__(self, rows):
        self._rows = rows

    def select(self, *_a, **_k):
        return self

    def eq(self, *_a, **_k):
        return self

    def execute(self):
        return SimpleNamespace(data=list(self._rows))


class _FakeSupabase:
    """Canned rows per table: `sheets` feeds verify_sheet_access's project_id
    lookup; `project_members` feeds the membership/role lookups."""

    def __init__(self, sheets=None, members=None):
        self._sheets = sheets if sheets is not None else []
        self._members = members if members is not None else []

    def table(self, name):
        if name == "sheets":
            return _Query(self._sheets)
        if name == "project_members":
            return _Query(self._members)
        return _Query([])


@pytest.fixture()
def install_supabase(monkeypatch):
    """Return an installer so each test can set exactly the rows it needs."""

    def _install(**kwargs):
        fake = _FakeSupabase(**kwargs)
        monkeypatch.setattr(supabase_client, "supabase", fake)
        return fake

    return _install


# ── verify_sheet_access (helper, direct) ─────────────────────────────────────

def test_sheet_access_missing_sheet_is_404(install_supabase):
    install_supabase(sheets=[])  # no sheet row
    with pytest.raises(HTTPException) as exc:
        asyncio.run(auth.verify_sheet_access("sheet-x", "user-1"))
    assert exc.value.status_code == 404


def test_sheet_access_non_member_is_403(install_supabase):
    install_supabase(sheets=[{"project_id": "proj-1"}], members=[])
    with pytest.raises(HTTPException) as exc:
        asyncio.run(auth.verify_sheet_access("sheet-1", "user-1"))
    assert exc.value.status_code == 403


def test_sheet_access_member_returns_project_id(install_supabase):
    install_supabase(sheets=[{"project_id": "proj-1"}], members=[{"id": "m-1"}])
    assert asyncio.run(auth.verify_sheet_access("sheet-1", "user-1")) == "proj-1"


# ── verify_project_admin (helper, direct) ────────────────────────────────────

def test_project_admin_non_member_is_403(install_supabase):
    install_supabase(members=[])
    with pytest.raises(HTTPException) as exc:
        asyncio.run(auth.verify_project_admin("proj-1", "user-1"))
    assert exc.value.status_code == 403


@pytest.mark.parametrize("role", ["pm", "superintendent", "viewer"])
def test_project_admin_underprivileged_is_403(install_supabase, role):
    install_supabase(members=[{"role": role}])
    with pytest.raises(HTTPException) as exc:
        asyncio.run(auth.verify_project_admin("proj-1", "user-1"))
    assert exc.value.status_code == 403


@pytest.mark.parametrize("role", ["owner", "admin"])
def test_project_admin_privileged_proceeds(install_supabase, role):
    install_supabase(members=[{"role": role}])
    # Success path: no raise, returns None.
    assert asyncio.run(auth.verify_project_admin("proj-1", "user-1")) is None


def test_project_admin_privileged_among_multiple_roles_proceeds(install_supabase):
    # A caller holding several rows counts as privileged if ANY row is owner/admin
    # (the `roles & {"owner","admin"}` set logic).
    install_supabase(members=[{"role": "viewer"}, {"role": "admin"}])
    assert asyncio.run(auth.verify_project_admin("proj-1", "user-1")) is None


# ── Route-level wiring: a helper's 404/403 reaches the client (not a 500) ─────
# Pins AGENTS §7's load-bearing `except HTTPException: raise` tail: without it a
# 404/403 from verify_sheet_access re-emits as 500 (the bug /export-pdf once had).

@pytest.fixture()
def client():
    app.dependency_overrides[auth.get_current_user] = lambda: AUTH_USER
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.pop(auth.get_current_user, None)


def test_sheet_route_missing_sheet_propagates_404(client, install_supabase):
    install_supabase(sheets=[])  # verify_sheet_access -> 404
    res = client.get("/extract-vectors/sheet-x")
    assert res.status_code == 404


def test_sheet_route_non_member_propagates_403(client, install_supabase):
    install_supabase(sheets=[{"project_id": "proj-1"}], members=[])  # -> 403
    res = client.get("/extract-vectors/sheet-x")
    assert res.status_code == 403
