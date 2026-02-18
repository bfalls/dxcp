import json
import time
from typing import Any, Dict, Optional

import jwt
import requests
from fastapi import HTTPException
from jwt.algorithms import RSAAlgorithm

from config import SETTINGS
from models import Actor, Role

_JWKS_CACHE: Dict[str, Any] = {"url": None, "fetched_at": 0.0, "keys": {}}
_JWKS_TTL_SECONDS = 300


def _auth_error(status_code: int, code: str, message: str) -> None:
    raise HTTPException(status_code=status_code, detail={"code": code, "message": message})


def _jwks_url() -> str:
    if SETTINGS.oidc_jwks_url:
        return SETTINGS.oidc_jwks_url
    if not SETTINGS.oidc_issuer:
        return ""
    issuer = SETTINGS.oidc_issuer.rstrip("/")
    return f"{issuer}/.well-known/jwks.json"


def _fetch_jwks(jwks_url: str) -> Dict[str, dict]:
    now = time.time()
    if _JWKS_CACHE["url"] == jwks_url and (now - _JWKS_CACHE["fetched_at"]) < _JWKS_TTL_SECONDS:
        return _JWKS_CACHE["keys"]
    response = requests.get(jwks_url, timeout=5)
    response.raise_for_status()
    payload = response.json()
    keys = {}
    for key in payload.get("keys", []):
        kid = key.get("kid")
        if kid:
            keys[kid] = key
    _JWKS_CACHE["url"] = jwks_url
    _JWKS_CACHE["fetched_at"] = now
    _JWKS_CACHE["keys"] = keys
    return keys


def _decode_jwt(token: str) -> dict:
    if not SETTINGS.oidc_issuer:
        _auth_error(500, "OIDC_CONFIG_MISSING", "DXCP_OIDC_ISSUER is required")
    if not SETTINGS.oidc_audience:
        _auth_error(500, "OIDC_CONFIG_MISSING", "DXCP_OIDC_AUDIENCE is required")
    if not SETTINGS.oidc_roles_claim:
        _auth_error(500, "OIDC_CONFIG_MISSING", "DXCP_OIDC_ROLES_CLAIM is required")
    jwks_url = _jwks_url()
    if not jwks_url:
        _auth_error(500, "OIDC_CONFIG_MISSING", "DXCP_OIDC_JWKS_URL is required")
    try:
        header = jwt.get_unverified_header(token)
    except jwt.InvalidTokenError:
        _auth_error(401, "UNAUTHORIZED", "Invalid token header")
    kid = header.get("kid")
    if not kid:
        _auth_error(401, "UNAUTHORIZED", "Token is missing kid")
    keys = _fetch_jwks(jwks_url)
    jwk = keys.get(kid)
    if not jwk:
        _auth_error(401, "UNAUTHORIZED", "Unknown signing key")
    try:
        key = RSAAlgorithm.from_jwk(json.dumps(jwk))
        return jwt.decode(
            token,
            key=key,
            algorithms=["RS256"],
            audience=SETTINGS.oidc_audience,
            issuer=SETTINGS.oidc_issuer,
        )
    except jwt.ExpiredSignatureError:
        _auth_error(401, "UNAUTHORIZED", "Token expired")
    except jwt.InvalidTokenError:
        _auth_error(401, "UNAUTHORIZED", "Invalid token")
    return {}


def _map_role(roles: list) -> Role:
    if "dxcp-platform-admins" in roles:
        return Role.PLATFORM_ADMIN
    if "dxcp-delivery-owners" in roles:
        return Role.DELIVERY_OWNER
    if "dxcp-observers" in roles:
        return Role.OBSERVER
    _auth_error(403, "AUTHZ_ROLE_REQUIRED", "No recognized DXCP role in token")
    return Role.OBSERVER


def _extract_actor_id(claims: dict) -> str:
    return (
        claims.get("sub")
        or claims.get("email")
        or claims.get("https://dxcp.example/claims/email")
        or "unknown"
    )


def get_actor_and_claims(authorization: Optional[str]) -> tuple[Actor, dict]:
    if not authorization:
        _auth_error(401, "UNAUTHORIZED", "Authorization header required")
    parts = authorization.split(" ")
    if len(parts) != 2 or parts[0].lower() != "bearer":
        _auth_error(401, "UNAUTHORIZED", "Authorization must be Bearer token")
    token = parts[1].strip()
    if not token:
        _auth_error(401, "UNAUTHORIZED", "Authorization token missing")
    claims = _decode_jwt(token)
    roles_value = claims.get(SETTINGS.oidc_roles_claim, [])
    if not isinstance(roles_value, list):
        _auth_error(403, "AUTHZ_ROLE_REQUIRED", "Roles claim missing or invalid")
    role = _map_role(roles_value)
    actor_id = _extract_actor_id(claims)
    email = claims.get("email") or claims.get("https://dxcp.example/claims/email")
    normalized_email = email.strip().lower() if isinstance(email, str) and email.strip() else None
    return Actor(actor_id=actor_id, role=role, email=normalized_email), claims


def get_actor(authorization: Optional[str]) -> Actor:
    actor, _ = get_actor_and_claims(authorization)
    return actor
