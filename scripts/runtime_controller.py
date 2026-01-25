#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import urllib.request


def run_aws(args: list[str]) -> str:
    result = subprocess.run(args, check=True, capture_output=True, text=True)
    return result.stdout.strip()


def build_aws_args(base: list[str], region: str, profile: str | None) -> list[str]:
    args = base + ["--region", region]
    if profile:
        args += ["--profile", profile]
    return args


def get_ssm_value(name: str, region: str, profile: str | None) -> str:
    args = build_aws_args(
        ["aws", "ssm", "get-parameter", "--name", name, "--query", "Parameter.Value", "--output", "text"],
        region,
        profile,
    )
    return run_aws(args)


def get_secret_value(secret_id: str, region: str, profile: str | None) -> str:
    args = build_aws_args(
        ["aws", "secretsmanager", "get-secret-value", "--secret-id", secret_id, "--query", "SecretString", "--output", "text"],
        region,
        profile,
    )
    return run_aws(args)


def call_endpoint(url: str, token: str, payload: dict) -> tuple[int, str]:
    data = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=data,
        headers={
            "Content-Type": "application/json",
            "x-dxcp-runtime-token": token,
        },
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        body = response.read().decode("utf-8")
        return response.status, body


def main() -> int:
    parser = argparse.ArgumentParser(description="Call the DXCP runtime controller endpoint.")
    parser.add_argument("action", choices=["deploy", "rollback"])
    parser.add_argument("--service", required=True, choices=["demo-service", "demo-service-2"])
    parser.add_argument("--artifact-ref", help="s3://bucket/key for deploy")
    parser.add_argument("--s3-bucket", help="S3 bucket for deploy")
    parser.add_argument("--s3-key", help="S3 key for deploy")
    parser.add_argument("--region", default="us-east-1")
    parser.add_argument("--profile")
    parser.add_argument("--prefix", default="/dxcp/config")

    args = parser.parse_args()

    if args.action == "deploy":
        if not args.artifact_ref and not (args.s3_bucket and args.s3_key):
            parser.error("deploy requires --artifact-ref or --s3-bucket and --s3-key")

    endpoint_url = get_ssm_value(f"{args.prefix}/runtime/controller_url", args.region, args.profile)
    token_param = get_ssm_value(f"{args.prefix}/runtime/controller_token", args.region, args.profile)
    if token_param.startswith("arn:aws:secretsmanager:"):
        token = get_secret_value(token_param, args.region, args.profile)
    else:
        token = token_param

    endpoint = endpoint_url.rstrip("/") + f"/{args.action}"
    payload = {"service": args.service}
    if args.action == "deploy":
        if args.artifact_ref:
            payload["artifactRef"] = args.artifact_ref
        else:
            payload["s3Bucket"] = args.s3_bucket
            payload["s3Key"] = args.s3_key

    try:
        status, body = call_endpoint(endpoint, token, payload)
    except Exception as exc:
        print(f"Request failed: {exc}", file=sys.stderr)
        return 1

    print(f"HTTP {status}")
    print(body)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
