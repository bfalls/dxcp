import json
import os
import time
from typing import Iterable

import jwt
import requests
from jwt.algorithms import RSAAlgorithm
from cryptography.hazmat.primitives.asymmetric import rsa

ISSUER = "https://dxcp.example/"
AUDIENCE = "https://dxcp-api"
ROLES_CLAIM = "https://dxcp.example/claims/roles"
EMAIL_CLAIM = "https://dxcp.example/claims/email"
JWKS_URL = "https://dxcp.example/.well-known/jwks.json"
KID = "dxcp-test-key"

_PRIVATE_KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
_PUBLIC_JWK = json.loads(RSAAlgorithm.to_jwk(_PRIVATE_KEY.public_key()))
_PUBLIC_JWK["kid"] = KID


def configure_auth_env() -> None:
    os.environ["DXCP_OIDC_ISSUER"] = ISSUER
    os.environ["DXCP_OIDC_AUDIENCE"] = AUDIENCE
    os.environ["DXCP_OIDC_JWKS_URL"] = JWKS_URL
    os.environ["DXCP_OIDC_ROLES_CLAIM"] = ROLES_CLAIM


def jwks_payload() -> dict:
    return {"keys": [_PUBLIC_JWK]}


def build_token(
    roles: Iterable[str],
    subject: str = "user-1",
    email: str = "user@example.com",
    issuer: str = ISSUER,
    audience: str = AUDIENCE,
    include_roles: bool = True,
) -> str:
    now = int(time.time())
    payload = {
        "iss": issuer,
        "aud": audience,
        "sub": subject,
        "iat": now,
        "exp": now + 3600,
        EMAIL_CLAIM: email,
    }
    if include_roles:
        payload[ROLES_CLAIM] = list(roles)
    return jwt.encode(payload, _PRIVATE_KEY, algorithm="RS256", headers={"kid": KID})


def auth_header(roles: Iterable[str]) -> dict:
    return {"Authorization": f"Bearer {build_token(roles)}"}


def mock_jwks(monkeypatch) -> None:
    payload = jwks_payload()

    class FakeResponse:
        def __init__(self, data: dict) -> None:
            self._data = data

        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict:
            return self._data

    def _fake_get(url: str, timeout: int = 5):
        if url != JWKS_URL:
            raise requests.RequestException(f"unexpected jwks url {url}")
        return FakeResponse(payload)

    monkeypatch.setattr(requests, "get", _fake_get)
