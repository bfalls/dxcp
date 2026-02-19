import json
import logging
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
DEFAULT_ROLES_CLAIM = "https://dxcp.example/claims/roles"
ROLE_PLATFORM_ADMINS = "dxcp-platform-admins"
ROLE_DELIVERY_OWNERS = "dxcp-delivery-owners"
ROLE_OBSERVERS = "dxcp-observers"
ROLE_CI_PUBLISHERS = "dxcp-ci-publishers"
ROLE_CI_PUBLISHER_LEGACY = "dxcp-ci-publisher"
logger = logging.getLogger("dxcp.auth")


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
    if not _roles_claim_key():
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


def _roles_claim_key() -> str:
    configured = (SETTINGS.oidc_roles_claim or "").strip()
    return configured or DEFAULT_ROLES_CLAIM


def _map_role(roles: list) -> Role:
    if ROLE_PLATFORM_ADMINS in roles:
        return Role.PLATFORM_ADMIN
    if ROLE_DELIVERY_OWNERS in roles:
        return Role.DELIVERY_OWNER
    if ROLE_OBSERVERS in roles:
        return Role.OBSERVER
    if ROLE_CI_PUBLISHERS in roles:
        return Role.CI_PUBLISHER
    if ROLE_CI_PUBLISHER_LEGACY in roles:
        logger.warning("event=auth.role_legacy_alias_seen role=%s", ROLE_CI_PUBLISHER_LEGACY)
        return Role.CI_PUBLISHER
    _auth_error(403, "AUTHZ_ROLE_REQUIRED", "No recognized DXCP role in token")
    raise AssertionError("unreachable")


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
    roles_claim_key = _roles_claim_key()
    roles_claim_exists = roles_claim_key in claims
    roles_value = claims.get(roles_claim_key, [])
    extracted_roles = roles_value if isinstance(roles_value, list) else []
    logger.info(
        "event=auth.roles_claim evaluated claim_key=%s claim_present=%s extracted_roles=%s",
        roles_claim_key,
        roles_claim_exists,
        extracted_roles,
    )
    if not isinstance(roles_value, list):
        logger.warning(
            "event=auth.roles_claim invalid claim_key=%s claim_present=%s claim_type=%s",
            roles_claim_key,
            roles_claim_exists,
            type(roles_value).__name__,
        )
        _auth_error(403, "AUTHZ_ROLE_REQUIRED", "Roles claim missing or invalid")
    role = _map_role(roles_value)
    actor_id = _extract_actor_id(claims)
    email = claims.get("email") or claims.get("https://dxcp.example/claims/email")
    normalized_email = email.strip().lower() if isinstance(email, str) and email.strip() else None
    return Actor(actor_id=actor_id, role=role, email=normalized_email), claims


def get_actor(authorization: Optional[str]) -> Actor:
    actor, _ = get_actor_and_claims(authorization)
    return actor
