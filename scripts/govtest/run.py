#!/usr/bin/env python3
"""
Phase 1 governance harness runner.

Current scope:
- GOV_ config loading and validation.
- Optional local .env.govtest loading.
- Version discovery and run-version computation.
- Dry-run planning when placeholder token is absent.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Iterable, List, Sequence
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


VERSION_RE = re.compile(r"^0\.(\d+)\.(\d+)$")
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


class GovTestError(RuntimeError):
    pass


@dataclass(frozen=True)
class RunContext:
    dry_run: bool
    version_endpoint: str
    source_count: int
    max_minor: int
    gov_run_version: str


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


def _compute_run_version(versions: Sequence[str]) -> RunContext:
    parsed_minors: List[int] = []
    for value in versions:
        match = VERSION_RE.match(str(value).strip())
        if not match:
            continue
        parsed_minors.append(int(match.group(1)))

    max_minor = max(parsed_minors) if parsed_minors else 0
    gov_run_version = f"0.{max_minor + 1}.1"
    api_base = os.getenv("GOV_DXCP_API_BASE", "").rstrip("/")
    endpoint = f"{api_base}/v1/services/{SERVICE_NAME}/versions"
    return RunContext(
        dry_run=False,
        version_endpoint=endpoint,
        source_count=len(versions),
        max_minor=max_minor,
        gov_run_version=gov_run_version,
    )


def _fetch_versions_with_placeholder_token(endpoint: str, token: str) -> List[str]:
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


def _print_plan(context: RunContext) -> None:
    mode = "DRY_RUN" if context.dry_run else "FULL"
    _log("INFO", "Run Plan")
    print(f"  mode: {mode}")
    print(f"  service: {SERVICE_NAME}")
    print(f"  versions_endpoint: {context.version_endpoint}")
    print(f"  discovered_versions: {context.source_count}")
    print(f"  max_minor: {context.max_minor}")
    print(f"  GOV_RUN_VERSION: {context.gov_run_version}")
    print("  next_phases:")
    print("    - phase_2_auth: acquire Auth0 tokens for admin/owner/observer/ci")
    print("    - phase_3_actions: governance scenario execution")
    print("    - phase_4_assertions: policy and outcome verification")


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="DXCP governance test harness (phase 1).")
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

    placeholder_token = os.getenv("GOV_CI_CLIENT_SECRET", "").strip()
    dry_run = bool(args.dry_run) or not placeholder_token

    if dry_run and not placeholder_token:
        _log("WARN", "GOV_CI_CLIENT_SECRET is missing; running dry-run with no network fetch.")

    if not dry_run:
        identity_missing = _missing_keys(FULL_MODE_IDENTITY_KEYS)
        if identity_missing:
            raise GovTestError(
                "Full mode requested but required identity GOV_ keys are missing:\n  - "
                + "\n  - ".join(identity_missing)
            )

    versions: List[str] = []
    if dry_run:
        _log("INFO", "Dry-run mode enabled; skipping version API call.")
    else:
        _log("INFO", f"Fetching discovered versions from {endpoint}")
        versions = _fetch_versions_with_placeholder_token(endpoint, placeholder_token)
        _log("INFO", f"Fetched {len(versions)} version entries.")

    context = _compute_run_version(versions)
    context = RunContext(
        dry_run=dry_run,
        version_endpoint=context.version_endpoint,
        source_count=context.source_count,
        max_minor=context.max_minor,
        gov_run_version=context.gov_run_version,
    )
    _print_plan(context)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except GovTestError as exc:
        _log("ERROR", str(exc))
        raise SystemExit(1)
