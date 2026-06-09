"""Tests for local Supabase JWT validation (main.get_current_user).

This is the security-critical auth path. It MUST validate tokens locally with
PyJWT and SUPABASE_JWT_SECRET and never make a network call to
supabase.auth.get_user() (see AGENTS.md §7). These tests pin its behavior:
a valid 'authenticated' token passes; expired, wrong-role, and tampered tokens
are rejected with 401.
"""
import jwt
import pytest
from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials

from conftest import TEST_JWT_SECRET
from main import get_current_user


def make_token(payload: dict, secret: str = TEST_JWT_SECRET) -> str:
    return jwt.encode(payload, secret, algorithm="HS256")


def creds(token: str) -> HTTPAuthorizationCredentials:
    return HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)


def test_valid_authenticated_token_returns_identity():
    token = make_token({"sub": "user-123", "role": "authenticated"})
    result = get_current_user(creds(token))
    assert result == {"sub": "user-123", "role": "authenticated"}


def test_non_authenticated_role_is_rejected():
    token = make_token({"sub": "user-123", "role": "anon"})
    with pytest.raises(HTTPException) as exc:
        get_current_user(creds(token))
    assert exc.value.status_code == 401
    assert exc.value.detail == "Not authorized"


def test_expired_token_is_rejected():
    # exp in the distant past -> PyJWT raises ExpiredSignatureError.
    token = make_token({"sub": "user-123", "role": "authenticated", "exp": 1_000_000_000})
    with pytest.raises(HTTPException) as exc:
        get_current_user(creds(token))
    assert exc.value.status_code == 401
    assert exc.value.detail == "Token expired"


def test_token_signed_with_wrong_secret_is_rejected():
    token = make_token(
        {"sub": "user-123", "role": "authenticated"},
        secret="a-completely-different-secret-at-least-32-bytes-long",
    )
    with pytest.raises(HTTPException) as exc:
        get_current_user(creds(token))
    assert exc.value.status_code == 401
    assert exc.value.detail == "Invalid authentication credentials"


def test_malformed_token_is_rejected():
    with pytest.raises(HTTPException) as exc:
        get_current_user(creds("this.is.not.a.jwt"))
    assert exc.value.status_code == 401
