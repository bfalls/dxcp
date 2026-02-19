#!/usr/bin/env python3
"""
Phase 2 governance harness runner.

Current scope:
- GOV_ config loading and validation.
- Optional local .env.govtest loading.
- Auth0 M2M token minting for admin/owner/observer/ci.
- /v1/whoami sanity checks for all minted tokens.
- Version discovery and run-version computation.
- Dry-run planning when required GOV_ secrets are absent.
"""

from __future__ import annotations

import argparse
import json
import os
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Iterable, List, Mapping, Sequence
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from auth0 import Auth0Error, decodeJwtClaims, getClientCredentialsToken


VERSION_RE = re.compile(r"^0\.(\d+)\.(\d+)$")
SEMVER_IN_TEXT_RE = re.compile(r"(?:^|[^0-9])v?(0\.\d+\.\d+)(?:[^0-9]|$)")
TARGET_MINOR = 1
DOTENV_PATH = ".env.govtest"
SERVICE_NAME = "demo-service"

BASE_REQUIRED_KEYS: Sequence[str] = (
    "GOV_DXCP_UI_BASE",
    "GOV_DXCP_API_BASE",
    "GOV_AWS_REGION",
)

FULL_MODE_IDENTITY_KEYS: Sequence[str] = (
    "GOV_AUTH0_DOMAIN",
    "GOV_AUTH0_AUDIENCE",
    "GOV_ADMIN_CLIENT_ID",
    "GOV_ADMIN_CLIENT_SECRET",
    "GOV_OWNER_CLIENT_ID",
    "GOV_OWNER_CLIENT_SECRET",
    "GOV_OBSERVER_CLIENT_ID",
    "GOV_OBSERVER_CLIENT_SECRET",
    "GOV_CI_CLIENT_ID",
    "GOV_CI_CLIENT_SECRET",
)

TOKEN_KEY_TO_ENV: Mapping[str, str] = {
    "admin": "GOV_ADMIN_TOKEN",
    "owner": "GOV_OWNER_TOKEN",
    "observer": "GOV_OBSERVER_TOKEN",
    "ci": "GOV_CI_TOKEN",
}


class GovTestError(RuntimeError):
    pass


@dataclass(frozen=True)
class RoleCredentials:
    role: str
    client_id: str
    client_secret: str


@dataclass(frozen=True)
class RunContext:
    dry_run: bool
    version_endpoint: str
    source_count: int
    max_patch: int
    gov_run_version: str
    token_sources: Mapping[str, str]


def _log(level: str, message: str) -> None:
    print(f"[{level}] {message}")


def _load_local_dotenv() -> None:
    if os.getenv("GITHUB_ACTIONS") == "true":
        return

    env_path = Path.cwd() / DOTENV_PATH
    if not env_path.exists():
        _log("INFO", f"No {DOTENV_PATH} file found; using environment only.")
        return

    _log("INFO", f"Loading local env file: {DOTENV_PATH}")
    for raw in env_path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        if not key or key in os.environ:
            continue
        os.environ[key] = value.strip().strip("'").strip('"')


def _missing_keys(keys: Iterable[str]) -> List[str]:
    missing: List[str] = []
    for key in keys:
        value = os.getenv(key, "").strip()
        if not value:
            missing.append(key)
    return missing


def _redact_token(token: str) -> str:
    if len(token) <= 12:
        return "***"
    return f"{token[:6]}...{token[-4:]}"


def _compute_run_version(versions: Sequence[str]) -> RunContext:
    parsed_patches: List[int] = []
    normalized = _normalize_version_values(versions)
    for value in normalized:
        match = VERSION_RE.match(value)
        if not match:
            continue
        minor = int(match.group(1))
        patch = int(match.group(2))
        if minor == TARGET_MINOR:
            parsed_patches.append(patch)

    max_patch = max(parsed_patches) if parsed_patches else 0
    gov_run_version = f"0.{TARGET_MINOR}.{max_patch + 1}"
    api_base = os.getenv("GOV_DXCP_API_BASE", "").rstrip("/")
    endpoint = f"{api_base}/v1/services/{SERVICE_NAME}/versions"
    return RunContext(
        dry_run=False,
        version_endpoint=endpoint,
        source_count=len(versions),
        max_patch=max_patch,
        gov_run_version=gov_run_version,
        token_sources={},
    )


def _extract_version_candidate(value: Any) -> str | None:
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return None
        if VERSION_RE.match(text):
            return text
        found = SEMVER_IN_TEXT_RE.search(text)
        return found.group(1) if found else None

    if isinstance(value, dict):
        for key in ("version", "name", "artifactRef", "artifact_ref", "key"):
            candidate = value.get(key)
            if isinstance(candidate, str):
                normalized = _extract_version_candidate(candidate)
                if normalized:
                    return normalized
        return None

    return _extract_version_candidate(str(value))


def _normalize_version_values(values: Sequence[Any]) -> List[str]:
    normalized: List[str] = []
    for raw in values:
        candidate = _extract_version_candidate(raw)
        if candidate:
            normalized.append(candidate)
    return normalized


def _fetch_versions(endpoint: str, token: str) -> List[str]:
    request = Request(endpoint, headers={"Authorization": f"Bearer {token}"})
    try:
        with urlopen(request, timeout=20) as response:
            payload = response.read().decode("utf-8")
    except HTTPError as exc:
        raise GovTestError(f"Version fetch failed ({exc.code}): {exc.reason}") from exc
    except URLError as exc:
        raise GovTestError(f"Version fetch failed: {exc.reason}") from exc

    try:
        data = json.loads(payload)
    except json.JSONDecodeError as exc:
        raise GovTestError("Version fetch returned non-JSON response.") from exc

    if isinstance(data, list):
        return [str(item) for item in data]
    if isinstance(data, dict):
        candidate = data.get("versions")
        if isinstance(candidate, list):
            return [str(item) for item in candidate]

    raise GovTestError("Version response format unsupported; expected array or {versions:[...]}.")


def _http_get_json(url: str, token: str) -> Any:
    request = Request(url, headers={"Authorization": f"Bearer {token}"})
    try:
        with urlopen(request, timeout=20) as response:
            payload = response.read().decode("utf-8")
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise GovTestError(f"GET {url} failed ({exc.code}): {detail}") from exc
    except URLError as exc:
        raise GovTestError(f"GET {url} failed: {exc.reason}") from exc

    try:
        return json.loads(payload)
    except json.JSONDecodeError as exc:
        raise GovTestError(f"GET {url} returned non-JSON response.") from exc


def _build_role_credentials() -> List[RoleCredentials]:
    return [
        RoleCredentials(
            role="admin",
            client_id=os.getenv("GOV_ADMIN_CLIENT_ID", "").strip(),
            client_secret=os.getenv("GOV_ADMIN_CLIENT_SECRET", "").strip(),
        ),
        RoleCredentials(
            role="owner",
            client_id=os.getenv("GOV_OWNER_CLIENT_ID", "").strip(),
            client_secret=os.getenv("GOV_OWNER_CLIENT_SECRET", "").strip(),
        ),
        RoleCredentials(
            role="observer",
            client_id=os.getenv("GOV_OBSERVER_CLIENT_ID", "").strip(),
            client_secret=os.getenv("GOV_OBSERVER_CLIENT_SECRET", "").strip(),
        ),
        RoleCredentials(
            role="ci",
            client_id=os.getenv("GOV_CI_CLIENT_ID", "").strip(),
            client_secret=os.getenv("GOV_CI_CLIENT_SECRET", "").strip(),
        ),
    ]


def _mint_tokens() -> Dict[str, str]:
    domain = os.getenv("GOV_AUTH0_DOMAIN", "").strip()
    audience = os.getenv("GOV_AUTH0_AUDIENCE", "").strip()
    tokens: Dict[str, str] = {}
    for creds in _build_role_credentials():
        _log("INFO", f"Minting Auth0 token for role={creds.role}")
        token = getClientCredentialsToken(
            domain=domain,
            audience=audience,
            clientId=creds.client_id,
            clientSecret=creds.client_secret,
        )
        tokens[creds.role] = token
        os.environ[TOKEN_KEY_TO_ENV[creds.role]] = token
        _log("INFO", f"Minted role={creds.role} token={_redact_token(token)}")
    return tokens


def _log_identity_sanity(base_api: str, role: str, token: str) -> None:
    claims = decodeJwtClaims(token)
    whoami_url = f"{base_api}/v1/whoami"
    whoami = _http_get_json(whoami_url, token)
    actor_id = whoami.get("actor_id") if isinstance(whoami, dict) else None
    _log(
        "INFO",
        "Identity sanity role="
        + role
        + f" actor_id={actor_id} sub={claims.get('sub')} azp={claims.get('azp')} "
        + f"aud={claims.get('aud')} iss={claims.get('iss')}",
    )


def _print_plan(context: RunContext) -> None:
    mode = "DRY_RUN" if context.dry_run else "FULL"
    _log("INFO", "Run Plan")
    print(f"  mode: {mode}")
    print(f"  service: {SERVICE_NAME}")
    print(f"  versions_endpoint: {context.version_endpoint}")
    print(f"  discovered_versions: {context.source_count}")
    print(f"  target_minor: {TARGET_MINOR}")
    print(f"  max_patch: {context.max_patch}")
    print(f"  GOV_RUN_VERSION: {context.gov_run_version}")
    print("  token_usage:")
    print(f"    - ui_read: {context.token_sources.get('ui_read', 'n/a')}")
    print(f"    - admin_write: {context.token_sources.get('admin_write', 'n/a')}")
    print(f"    - build_registration: {context.token_sources.get('build_registration', 'n/a')}")
    print("  next_phases:")
    print("    - phase_3_actions: governance scenario execution")
    print("    - phase_4_assertions: policy and outcome verification")


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="DXCP governance test harness (phase 2).")
    parser.add_argument("--dry-run", action="store_true", help="Force dry-run mode.")
    return parser


def main() -> int:
    args = _build_parser().parse_args()

    _load_local_dotenv()

    base_missing = _missing_keys(BASE_REQUIRED_KEYS)
    if base_missing:
        raise GovTestError(
            "Missing required GOV_ configuration:\n  - " + "\n  - ".join(base_missing)
        )

    api_base = os.getenv("GOV_DXCP_API_BASE", "").rstrip("/")
    endpoint = f"{api_base}/v1/services/{SERVICE_NAME}/versions"

    missing_full_mode = _missing_keys(FULL_MODE_IDENTITY_KEYS)
    dry_run = bool(args.dry_run) or bool(missing_full_mode)

    if dry_run and missing_full_mode:
        _log(
            "WARN",
            "Required GOV_ Auth0 values missing; running dry-run.\n  - "
            + "\n  - ".join(missing_full_mode),
        )

    if bool(args.dry_run):
        _log("INFO", "Dry-run forced by flag.")

    versions: List[str] = []
    token_sources = {
        "ui_read": "GOV_OWNER_TOKEN",
        "admin_write": "GOV_ADMIN_TOKEN",
        "build_registration": "GOV_CI_TOKEN",
    }

    if dry_run:
        _log("INFO", "Dry-run mode enabled; skipping version API call.")
    else:
        try:
            tokens = _mint_tokens()
        except Auth0Error as exc:
            raise GovTestError(f"Auth0 mint failed: {exc}") from exc

        for role, token in tokens.items():
            _log_identity_sanity(api_base, role, token)

        ui_token = tokens["owner"]
        _log("INFO", f"Fetching discovered versions from {endpoint}")
        versions = _fetch_versions(endpoint, ui_token)
        _log("INFO", f"Fetched {len(versions)} version entries.")

    context = _compute_run_version(versions)
    context = RunContext(
        dry_run=dry_run,
        version_endpoint=context.version_endpoint,
        source_count=context.source_count,
        max_patch=context.max_patch,
        gov_run_version=context.gov_run_version,
        token_sources=token_sources,
    )
    _print_plan(context)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except GovTestError as exc:
        _log("ERROR", str(exc))
        raise SystemExit(1)
