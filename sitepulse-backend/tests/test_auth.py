"""Tests for local Supabase JWT validation (main.get_current_user).

This is the security-critical auth path. This Supabase project signs user access
tokens with an ASYMMETRIC key (ES256), so get_current_user verifies the signature
against the project's published JWKS public key (PyJWKClient, cached — no
per-request network call) and never calls supabase.auth.get_user() (see
AGENTS.md §7). These tests pin its behavior: a valid 'authenticated' token passes;
expired, wrong-role, tokens signed by a key that isn't the project's, and
malformed tokens are all rejected with 401.

The JWKS lookup is stubbed to an in-test EC public key, so the suite stays
hermetic (no network) while still exercising real ES256 signature verification.
"""
import types
import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials

import main
from main import get_current_user


def _make_es256_keypair():
    priv = ec.generate_private_key(ec.SECP256R1())
    return priv, priv.public_key()


# The "project" signing key the JWKS would publish, generated once for the module.
_SERVER_PRIV, _SERVER_PUB = _make_es256_keypair()


@pytest.fixture(autouse=True)
def _stub_jwks(monkeypatch):
    """Point main's cached JWKS client at our in-test public key (no network)."""
    monkeypatch.setattr(
        main._jwk_client,
        "get_signing_key_from_jwt",
        lambda token: types.SimpleNamespace(key=_SERVER_PUB),
    )


def make_token(payload: dict, key=_SERVER_PRIV) -> str:
    return jwt.encode(payload, key, algorithm="ES256")


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
    # exp in the distant past -> PyJWT raises ExpiredSignatureError after the
    # signature verifies against the stubbed public key.
    token = make_token({"sub": "user-123", "role": "authenticated", "exp": 1_000_000_000})
    with pytest.raises(HTTPException) as exc:
        get_current_user(creds(token))
    assert exc.value.status_code == 401
    assert exc.value.detail == "Token expired"


def test_token_signed_with_wrong_key_is_rejected():
    # Signed by a different EC key than the one JWKS publishes -> bad signature.
    other_priv, _ = _make_es256_keypair()
    token = make_token({"sub": "user-123", "role": "authenticated"}, key=other_priv)
    with pytest.raises(HTTPException) as exc:
        get_current_user(creds(token))
    assert exc.value.status_code == 401
    assert exc.value.detail == "Invalid authentication credentials"


def test_malformed_token_is_rejected():
    with pytest.raises(HTTPException) as exc:
        get_current_user(creds("this.is.not.a.jwt"))
    assert exc.value.status_code == 401


def test_token_without_sub_is_rejected_401_not_500():
    # A validly-signed 'authenticated' token missing `sub` used to raise a
    # KeyError -> 500; it is malformed for our purposes and must be a clean 401.
    token = make_token({"role": "authenticated"})
    with pytest.raises(HTTPException) as exc:
        get_current_user(creds(token))
    assert exc.value.status_code == 401
