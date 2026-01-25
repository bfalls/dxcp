from __future__ import annotations

import base64
import json
import os
from datetime import datetime, timezone
from typing import Any, Dict, Optional, Tuple

import boto3


SSM_CLIENT = boto3.client("ssm")
SECRETS_CLIENT = boto3.client("secretsmanager")
LAMBDA_CLIENT = boto3.client("lambda")
DDB_RESOURCE = boto3.resource("dynamodb")

_TOKEN_CACHE: Optional[str] = None


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _get_env(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(f"Missing required env var: {name}")
    return value


def _read_secret(secret_id: str) -> str:
    response = SECRETS_CLIENT.get_secret_value(SecretId=secret_id)
    secret = response.get("SecretString")
    if secret is not None:
        return secret
    return base64.b64decode(response["SecretBinary"]).decode("utf-8")


def _get_expected_token() -> str:
    global _TOKEN_CACHE
    if _TOKEN_CACHE is not None:
        return _TOKEN_CACHE
    param_name = _get_env("DXCP_RUNTIME_TOKEN_PARAM")
    response = SSM_CLIENT.get_parameter(Name=param_name, WithDecryption=True)
    value = response["Parameter"]["Value"]
    if value.startswith("arn:aws:secretsmanager:"):
        value = _read_secret(value)
    _TOKEN_CACHE = value
    return _TOKEN_CACHE


def _extract_path(event: Dict[str, Any]) -> str:
    return (
        event.get("rawPath")
        or event.get("path")
        or event.get("requestContext", {}).get("http", {}).get("path")
        or ""
    )


def _extract_method(event: Dict[str, Any]) -> str:
    return (
        event.get("requestContext", {}).get("http", {}).get("method")
        or event.get("httpMethod")
        or ""
    ).upper()


def _extract_header(event: Dict[str, Any], header: str) -> Optional[str]:
    headers = event.get("headers") or {}
    header_lower = header.lower()
    for key, value in headers.items():
        if key.lower() == header_lower:
            return value
    return None


def _parse_body(event: Dict[str, Any]) -> Dict[str, Any]:
    body = event.get("body") or ""
    if event.get("isBase64Encoded"):
        body = base64.b64decode(body).decode("utf-8")
    if not body:
        return {}
    return json.loads(body)


def _parse_artifact_ref(payload: Dict[str, Any]) -> Tuple[str, str, str]:
    artifact_ref = payload.get("artifactRef")
    if artifact_ref:
        if not artifact_ref.startswith("s3://"):
            raise ValueError("artifactRef must start with s3://")
        without_scheme = artifact_ref[len("s3://") :]
        if "/" not in without_scheme:
            raise ValueError("artifactRef must include bucket and key")
        bucket, key = without_scheme.split("/", 1)
        return artifact_ref, bucket, key
    bucket = payload.get("s3Bucket")
    key = payload.get("s3Key")
    if not bucket or not key:
        raise ValueError("s3Bucket and s3Key are required when artifactRef is omitted")
    return f"s3://{bucket}/{key}", bucket, key


def _service_map() -> Dict[str, str]:
    return {
        "demo-service": _get_env("DEMO_SERVICE_FUNCTION_NAME"),
        "demo-service-2": _get_env("DEMO_SERVICE_2_FUNCTION_NAME"),
    }


def _table():
    table_name = _get_env("DXCP_RUNTIME_STATE_TABLE")
    return DDB_RESOURCE.Table(table_name)


def _respond(status_code: int, payload: Dict[str, Any]):
    return {
        "statusCode": status_code,
        "headers": {"Content-Type": "application/json"},
        "body": json.dumps(payload),
    }


def _require_auth(event: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    provided = _extract_header(event, "x-dxcp-runtime-token")
    if not provided:
        return _respond(401, {"error": "missing_token"})
    expected = _get_expected_token()
    if provided != expected:
        return _respond(403, {"error": "invalid_token"})
    return None


def _deploy(payload: Dict[str, Any]) -> Dict[str, Any]:
    service = payload.get("service")
    if not service:
        return _respond(400, {"error": "missing_service"})

    service_map = _service_map()
    function_name = service_map.get(service)
    if not function_name:
        return _respond(400, {"error": "unknown_service"})

    try:
        artifact_ref, bucket, key = _parse_artifact_ref(payload)
    except ValueError as exc:
        return _respond(400, {"error": str(exc)})

    expected_bucket = _get_env("DXCP_ARTIFACT_BUCKET")
    if bucket != expected_bucket:
        return _respond(400, {"error": "artifact_bucket_mismatch"})

    table = _table()
    existing = table.get_item(Key={"pk": service}).get("Item", {})
    current = existing.get("currentArtifactRef")

    print(f"Deploying {service} from {artifact_ref} to {function_name}")
    LAMBDA_CLIENT.update_function_code(FunctionName=function_name, S3Bucket=bucket, S3Key=key)

    table.put_item(
        Item={
            "pk": service,
            "currentArtifactRef": artifact_ref,
            "previousArtifactRef": current,
            "updatedAt": _now(),
        }
    )

    return _respond(
        200,
        {
            "service": service,
            "artifactRef": artifact_ref,
            "previousArtifactRef": current,
        },
    )


def _rollback(payload: Dict[str, Any]) -> Dict[str, Any]:
    service = payload.get("service")
    if not service:
        return _respond(400, {"error": "missing_service"})

    service_map = _service_map()
    function_name = service_map.get(service)
    if not function_name:
        return _respond(400, {"error": "unknown_service"})

    table = _table()
    existing = table.get_item(Key={"pk": service}).get("Item", {})
    previous = existing.get("previousArtifactRef")
    current = existing.get("currentArtifactRef")
    if not previous:
        return _respond(409, {"error": "no_previous_artifact"})

    if not previous.startswith("s3://"):
        return _respond(409, {"error": "invalid_previous_artifact"})

    without_scheme = previous[len("s3://") :]
    bucket, key = without_scheme.split("/", 1)
    expected_bucket = _get_env("DXCP_ARTIFACT_BUCKET")
    if bucket != expected_bucket:
        return _respond(409, {"error": "artifact_bucket_mismatch"})

    print(f"Rolling back {service} to {previous}")
    LAMBDA_CLIENT.update_function_code(FunctionName=function_name, S3Bucket=bucket, S3Key=key)

    table.put_item(
        Item={
            "pk": service,
            "currentArtifactRef": previous,
            "previousArtifactRef": current,
            "updatedAt": _now(),
        }
    )

    return _respond(
        200,
        {
            "service": service,
            "artifactRef": previous,
            "previousArtifactRef": current,
        },
    )


def handler(event, context):
    auth_error = _require_auth(event)
    if auth_error:
        return auth_error

    method = _extract_method(event)
    path = _extract_path(event)
    if method != "POST":
        return _respond(405, {"error": "method_not_allowed"})

    payload = _parse_body(event)

    if path.endswith("/deploy"):
        return _deploy(payload)
    if path.endswith("/rollback"):
        return _rollback(payload)

    return _respond(404, {"error": "not_found"})
