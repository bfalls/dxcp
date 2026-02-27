#!/usr/bin/env python3
"""Register an existing build artifact in DXCP via /v1/builds/register.

This helper is designed for CI usage and preserves current workflow semantics:
- Auth0 client_credentials token mint
- /v1/whoami identity validation (enabled by default)
- Idempotent POST /v1/builds/register
- Optional metadata fallback for commit/run URLs on INVALID_REQUEST
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from dataclasses import dataclass
from typing import Any
from urllib import error, request


class CliError(RuntimeError):
    """Raised for user-facing validation/runtime errors."""


@dataclass(frozen=True)
class EnvConfig:
    dxcp_api_base: str
    auth0_domain: str
    auth0_audience: str
    ci_client_id: str
    ci_client_secret: str


def _required_env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise CliError(f"Missing required env var: {name}")
    return value


def _normalize_auth0_domain(value: str) -> str:
    domain = value.strip()
    if domain.startswith("https://"):
        domain = domain[len("https://") :]
    elif domain.startswith("http://"):
        domain = domain[len("http://") :]
    return domain.rstrip("/")


def normalize_dxcp_api_base(value: str) -> str:
    base = value.strip().rstrip("/")
    if not base:
        raise CliError("DXCP_API_BASE must not be empty")
    if not base.endswith("/v1"):
        base = f"{base}/v1"
    return base


def default_idempotency_key(
    *,
    explicit: str | None,
    ci_provider: str,
    ci_run_id: str,
    service: str,
    version: str,
) -> str:
    if explicit:
        return explicit
    if ci_provider.lower() == "github":
        return f"github-{ci_run_id}-{service}-{version}"
    raise CliError("Provide --idempotency-key for non-github ci-provider values")


def _request_json(
    *,
    method: str,
    url: str,
    payload: dict[str, Any] | None = None,
    headers: dict[str, str] | None = None,
) -> tuple[int, dict[str, str], str, dict[str, Any] | None]:
    body: bytes | None = None
    request_headers = dict(headers or {})
    if payload is not None:
        body = json.dumps(payload).encode("utf-8")
        request_headers.setdefault("Content-Type", "application/json")

    req = request.Request(url=url, data=body, method=method, headers=request_headers)
    try:
        with request.urlopen(req) as resp:
            raw = resp.read().decode("utf-8")
            parsed = _try_json(raw)
            return int(resp.status), dict(resp.headers.items()), raw, parsed
    except error.HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        parsed = _try_json(raw)
        return int(exc.code), dict(exc.headers.items()), raw, parsed
    except error.URLError as exc:
        raise CliError(f"HTTP request failed for {url}: {exc}") from exc


def _header_value_case_insensitive(headers: dict[str, str], name: str) -> str | None:
    expected = name.lower()
    for key, value in headers.items():
        if key.lower() == expected:
            return value
    return None


def _try_json(text: str) -> dict[str, Any] | None:
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        return None
    if isinstance(parsed, dict):
        return parsed
    return None


def _mint_ci_token(config: EnvConfig) -> str:
    url = f"https://{config.auth0_domain}/oauth/token"
    payload = {
        "grant_type": "client_credentials",
        "audience": config.auth0_audience,
        "client_id": config.ci_client_id,
        "client_secret": config.ci_client_secret,
    }
    status, _, raw, parsed = _request_json(method="POST", url=url, payload=payload)
    if status != 200:
        raise CliError(f"Auth0 token request failed status={status} body={raw}")
    token = (parsed or {}).get("access_token")
    if not token:
        raise CliError("Auth0 token response missing access_token")
    return str(token)


def _whoami(config: EnvConfig, token: str) -> dict[str, Any]:
    url = f"{config.dxcp_api_base}/whoami"
    status, _, raw, parsed = _request_json(
        method="GET",
        url=url,
        headers={"Authorization": f"Bearer {token}"},
    )
    if status != 200:
        raise CliError(f"GET /whoami failed status={status} body={raw}")
    if not isinstance(parsed, dict):
        raise CliError("GET /whoami returned non-JSON response")
    return parsed


def _assert_ci_identity(config: EnvConfig, whoami_payload: dict[str, Any]) -> None:
    iss = str(whoami_payload.get("iss") or "")
    azp = str(whoami_payload.get("azp") or "")
    sub = str(whoami_payload.get("sub") or "")
    aud_claim = whoami_payload.get("aud")
    expected_iss = f"https://{config.auth0_domain}/"
    expected_sub_fragment = f"{config.ci_client_id}@clients"

    if isinstance(aud_claim, list):
        aud_ok = config.auth0_audience in [str(v) for v in aud_claim]
    else:
        aud_ok = str(aud_claim) == config.auth0_audience

    failures: list[str] = []
    if iss != expected_iss:
        failures.append(f"iss mismatch: expected {expected_iss!r}, got {iss!r}")
    if not aud_ok:
        failures.append(
            f"aud mismatch: expected {config.auth0_audience!r} to match claim {aud_claim!r}"
        )
    if azp != config.ci_client_id:
        failures.append(f"azp mismatch: expected {config.ci_client_id!r}, got {azp!r}")
    if expected_sub_fragment not in sub:
        failures.append(
            f"sub mismatch: expected to contain {expected_sub_fragment!r}, got {sub!r}"
        )

    if failures:
        joined = "; ".join(failures)
        raise CliError(f"/whoami identity assertions failed: {joined}")


def _build_register_payload(args: argparse.Namespace) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "service": args.service,
        "version": args.version,
        "artifactRef": args.artifact_ref,
        "git_sha": args.git_sha,
        "git_branch": args.git_branch,
        "ci_provider": args.ci_provider,
        "ci_run_id": args.ci_run_id,
        "built_at": args.built_at,
    }
    optional_mappings = {
        "commit_url": args.commit_url,
        "run_url": args.run_url,
        "checksum_sha256": args.checksum_sha256,
        "repo": args.repo,
        "actor": args.actor,
    }
    for key, value in optional_mappings.items():
        if value is not None:
            payload[key] = value
    return payload


def _register_build(
    *,
    dxcp_api_base: str,
    token: str,
    idempotency_key: str,
    payload: dict[str, Any],
    metadata_fallback_mode: str,
) -> tuple[int, dict[str, str], dict[str, Any], str]:
    url = f"{dxcp_api_base}/builds/register"
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "Idempotency-Key": idempotency_key,
    }

    metadata_mode = (
        "with_metadata"
        if "commit_url" in payload or "run_url" in payload
        else "without_metadata"
    )
    status, response_headers, raw, parsed = _request_json(
        method="POST", url=url, payload=payload, headers=headers
    )

    if (
        status == 400
        and metadata_fallback_mode == "auto"
        and isinstance(parsed, dict)
        and parsed.get("code") == "INVALID_REQUEST"
        and ("commit_url" in payload or "run_url" in payload)
    ):
        fallback_payload = dict(payload)
        fallback_payload.pop("commit_url", None)
        fallback_payload.pop("run_url", None)
        metadata_mode = "without_metadata"
        status, response_headers, raw, parsed = _request_json(
            method="POST", url=url, payload=fallback_payload, headers=headers
        )

    if status not in (200, 201):
        raise CliError(f"Build registration failed status={status} body={raw}")
    if not isinstance(parsed, dict):
        raise CliError("Build registration response was not a JSON object")
    return status, response_headers, parsed, metadata_mode


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Register existing build in DXCP.")
    parser.add_argument("--service", required=True)
    parser.add_argument("--version", required=True)
    parser.add_argument("--artifact-ref", required=True, dest="artifact_ref")
    parser.add_argument("--git-sha", required=True, dest="git_sha")
    parser.add_argument("--git-branch", required=True, dest="git_branch")
    parser.add_argument("--ci-provider", required=True, dest="ci_provider")
    parser.add_argument("--ci-run-id", required=True, dest="ci_run_id")
    parser.add_argument("--built-at", required=True, dest="built_at")
    parser.add_argument("--commit-url", dest="commit_url")
    parser.add_argument("--run-url", dest="run_url")
    parser.add_argument("--checksum-sha256", dest="checksum_sha256")
    parser.add_argument("--repo", dest="repo")
    parser.add_argument("--actor", dest="actor")
    parser.add_argument("--idempotency-key", dest="idempotency_key")
    parser.add_argument("--skip-whoami-assert", action="store_true")
    parser.add_argument(
        "--metadata-fallback-mode",
        choices=("auto", "off"),
        default="auto",
        dest="metadata_fallback_mode",
    )
    return parser.parse_args(argv)


def main(argv: list[str]) -> int:
    try:
        args = parse_args(argv)
        config = EnvConfig(
            dxcp_api_base=normalize_dxcp_api_base(_required_env("DXCP_API_BASE")),
            auth0_domain=_normalize_auth0_domain(_required_env("GOV_AUTH0_DOMAIN")),
            auth0_audience=_required_env("GOV_AUTH0_AUDIENCE"),
            ci_client_id=_required_env("GOV_CI_CLIENT_ID"),
            ci_client_secret=_required_env("GOV_CI_CLIENT_SECRET"),
        )
        idempotency_key = default_idempotency_key(
            explicit=args.idempotency_key,
            ci_provider=args.ci_provider,
            ci_run_id=args.ci_run_id,
            service=args.service,
            version=args.version,
        )
        token = _mint_ci_token(config)
        whoami_payload = _whoami(config, token)
        if not args.skip_whoami_assert:
            _assert_ci_identity(config, whoami_payload)

        payload = _build_register_payload(args)
        _, response_headers, response_payload, metadata_mode = _register_build(
            dxcp_api_base=config.dxcp_api_base,
            token=token,
            idempotency_key=idempotency_key,
            payload=payload,
            metadata_fallback_mode=args.metadata_fallback_mode,
        )

        ci_publisher = response_payload.get("ci_publisher")
        if not ci_publisher:
            raise CliError("Build registration response missing ci_publisher")
        idempotency_replayed = _header_value_case_insensitive(
            response_headers, "Idempotency-Replayed"
        ) or "missing"
        print(
            "registered "
            f"service={args.service} "
            f"version={args.version} "
            f"artifactRef={args.artifact_ref} "
            f"idempotency_key={idempotency_key} "
            f"ci_publisher={ci_publisher} "
            f"idempotency_replayed={idempotency_replayed} "
            f"metadata_mode={metadata_mode}"
        )
        return 0
    except CliError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
