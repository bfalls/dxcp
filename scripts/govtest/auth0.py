from __future__ import annotations

import base64
import json
from typing import Any, Dict
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


class Auth0Error(RuntimeError):
    pass


def _b64url_decode(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(value + padding)


def decodeJwtClaims(token: str) -> Dict[str, Any]:
    parts = token.split(".")
    if len(parts) != 3:
        raise Auth0Error("JWT decode failed: token does not have 3 parts.")
    try:
        payload = _b64url_decode(parts[1]).decode("utf-8")
        decoded = json.loads(payload)
    except (ValueError, json.JSONDecodeError) as exc:
        raise Auth0Error("JWT decode failed: payload is not valid JSON.") from exc
    if not isinstance(decoded, dict):
        raise Auth0Error("JWT decode failed: payload is not a JSON object.")
    return decoded


def getClientCredentialsToken(
    *, domain: str, audience: str, clientId: str, clientSecret: str
) -> str:
    token_url = f"https://{domain.strip().rstrip('/')}/oauth/token"
    payload = json.dumps(
        {
            "grant_type": "client_credentials",
            "audience": audience.strip(),
            "client_id": clientId.strip(),
            "client_secret": clientSecret.strip(),
        }
    ).encode("utf-8")
    request = Request(
        token_url,
        method="POST",
        data=payload,
        headers={"Content-Type": "application/json"},
    )
    try:
        with urlopen(request, timeout=20) as response:
            body = response.read().decode("utf-8")
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise Auth0Error(f"Auth0 token request failed ({exc.code}): {detail}") from exc
    except URLError as exc:
        raise Auth0Error(f"Auth0 token request failed: {exc.reason}") from exc

    try:
        data = json.loads(body)
    except json.JSONDecodeError as exc:
        raise Auth0Error("Auth0 token request returned non-JSON response.") from exc

    access_token = data.get("access_token") if isinstance(data, dict) else None
    if not isinstance(access_token, str) or not access_token.strip():
        raise Auth0Error("Auth0 token response missing access_token.")
    return access_token
