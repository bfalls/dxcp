from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path


SERVICE_NAME = "demo-service-2"


def load_version() -> str:
    version_file = Path(__file__).parent / "VERSION"
    if version_file.exists():
        return version_file.read_text().strip()
    return "0.0.0"


def handler(event, context):
    version = load_version()
    now = datetime.now(timezone.utc).isoformat()
    request_id = getattr(context, "aws_request_id", "unknown")
    body = f"""<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>{SERVICE_NAME}</title>
  </head>
  <body style="font-family: Arial, sans-serif; padding: 40px;">
    <h1>{SERVICE_NAME}</h1>
    <p>Version: <strong>{version}</strong></p>
    <p>Rendered at: <strong>{now}</strong></p>
    <p>Request ID: <strong>{request_id}</strong></p>
  </body>
</html>
"""
    return {
        "statusCode": 200,
        "headers": {"Content-Type": "text/html"},
        "body": body,
    }
