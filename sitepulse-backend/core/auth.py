"""Authentication + authorization: local JWT verification and the two
per-resource permission gates every protected route leans on.

Seam rule: routes call these via module-attribute lookup
(`from core import auth` … `await auth.verify_sheet_access(...)`), and the
helpers reach the Supabase client the same way (`db.supabase`), so tests can
patch `core.auth.verify_sheet_access`, `core.auth._jwk_client`, and
`core.supabase_client.supabase` without dead seams.
"""
import asyncio

import jwt  # PyJWT — local JWT validation, no network round-trip
from fastapi import Depends, HTTPException
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

from core import supabase_client as db

security = HTTPBearer()

# This Supabase project signs user access tokens with an ASYMMETRIC key (ES256),
# so tokens are verified against the project's published JWKS public key — not the
# legacy HS256 shared secret. (The old SUPABASE_JWT_SECRET in .env was actually the
# public key id, which can't — and must not — be used to verify a signature: doing
# HS256 against a publicly-known value would let anyone forge a token.)
#
# Still LOCAL + CACHED, so the no-blocking-auth-network-call rule (§7) holds: that
# rule was about the per-request supabase.auth.get_user() round-trip. PyJWKClient
# fetches the JWKS once and caches it (lifespan), so steady-state verification does
# no network I/O. A short timeout keeps a JWKS outage from hanging the request.
JWKS_URL = f"{db.supabase_url}/auth/v1/.well-known/jwks.json"
_jwk_client = jwt.PyJWKClient(JWKS_URL, cache_keys=True, lifespan=600, timeout=10)
ALLOWED_ASYMMETRIC_ALGS = ["ES256", "RS256"]


def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)):
    """Validate the Supabase user JWT locally against the project's JWKS public key.

    Verifies the asymmetric (ES256) signature using the key whose `kid` matches the
    token header, requires the `authenticated` role, and never calls
    supabase.auth.get_user() (the former cause of /extract-vectors timeouts).
    """
    token = credentials.credentials
    try:
        signing_key = _jwk_client.get_signing_key_from_jwt(token)
        payload = jwt.decode(
            token,
            signing_key.key,
            algorithms=ALLOWED_ASYMMETRIC_ALGS,
            options={"verify_aud": False},  # Supabase uses role claim, not URL audience
        )
        if payload.get("role") != "authenticated":
            raise HTTPException(status_code=401, detail="Not authorized")
        # A token without `sub` is malformed for our purposes — reject it as 401
        # rather than letting the KeyError surface as a 500.
        sub = payload.get("sub")
        if not sub:
            raise HTTPException(status_code=401, detail="Not authorized")
        return {"sub": sub, "role": payload["role"]}
    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=401,
            detail="Token expired",
            headers={"WWW-Authenticate": "Bearer"},
        )
    except jwt.PyJWTError:
        # Covers bad signatures, unknown kid, and JWKS fetch/parse failures
        # (PyJWKClientError is a PyJWTError) — never leak detail, always 401.
        raise HTTPException(
            status_code=401,
            detail="Invalid authentication credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )


# The two gates below raise HTTPException directly inside the threaded check —
# it propagates cleanly out of asyncio.to_thread. (This replaced the old
# magic-string plumbing, where the inner fn returned sentinel strings and the
# caller string-compared them to pick 404 vs 403. Same status codes, same
# messages — pinned by tests/test_authorization.py.)

async def verify_sheet_access(sheet_id: str, user_id: str):
    def check_access():
        sheet_res = db.supabase.table("sheets").select("project_id").eq("id", sheet_id).execute()
        if not sheet_res.data or len(sheet_res.data) == 0:
            raise HTTPException(status_code=404, detail="Sheet not found")
        project_id = sheet_res.data[0]["project_id"]

        member_res = db.supabase.table("project_members").select("id").eq("project_id", project_id).eq("user_id", user_id).execute()
        if not member_res.data or len(member_res.data) == 0:
            raise HTTPException(status_code=403, detail="Not authorized to access this project")
        return project_id

    return await asyncio.to_thread(check_access)


async def verify_project_admin(project_id: str, user_id: str):
    """Authorize a privileged, project-wide operation (e.g. deleting the project).

    Mirrors `verify_sheet_access` but additionally requires the caller hold a
    privileged role on the project. Project creation assigns either `'admin'`
    (the `/api/projects` Next.js route) or `'owner'` (the `create_new_project`
    RPC), so both count as privileged here. PMs/superintendents/viewers are not
    allowed to destroy a project.
    """
    def check_access():
        member_res = (
            db.supabase.table("project_members")
            .select("role")
            .eq("project_id", project_id)
            .eq("user_id", user_id)
            .execute()
        )
        if not member_res.data or len(member_res.data) == 0:
            raise HTTPException(status_code=403, detail="Not authorized to access this project")
        roles = {m.get("role") for m in member_res.data}
        if not roles & {"owner", "admin"}:
            raise HTTPException(status_code=403, detail="Admin role required for this action")

    await asyncio.to_thread(check_access)
