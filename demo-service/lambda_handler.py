from __future__ import annotations

from datetime import datetime, timezone
from html import escape
import os
from pathlib import Path


SERVICE_NAME = "demo-service"
BASE_VALUE = 7


def load_version() -> str:
    version_file = Path(__file__).parent / "VERSION"
    if version_file.exists():
        return version_file.read_text().strip()
    return "0.0.0"


def lambda_invocation_metadata(context) -> tuple[str, str, str, str]:
    lambda_version = str(getattr(context, "function_version", os.getenv("AWS_LAMBDA_FUNCTION_VERSION", "unknown")))
    lambda_name = str(os.getenv("AWS_LAMBDA_FUNCTION_NAME", SERVICE_NAME))
    invoked_arn = str(getattr(context, "invoked_function_arn", "unknown"))
    qualifier = ""
    arn_parts = invoked_arn.split(":")
    if len(arn_parts) >= 8 and arn_parts[5] == "function":
        qualifier = arn_parts[7]
    if lambda_version == "$LATEST":
        version_note = "Executing unqualified function code ($LATEST). Publish and invoke an alias/version to see a numeric Lambda version."
    else:
        version_note = "Executing a published Lambda version."
    return lambda_version, lambda_name, invoked_arn, qualifier or "-", version_note


def handler(event, context):
    version = load_version()
    now = datetime.now(timezone.utc).isoformat()
    request_id = getattr(context, "aws_request_id", "unknown")
    lambda_version, lambda_name, invoked_arn, invoked_qualifier, lambda_version_note = lambda_invocation_metadata(context)
    params = (event or {}).get("queryStringParameters") or {}
    raw_x = params.get("x", "5")
    try:
        x_value = int(raw_x)
        calc_result = x_value + BASE_VALUE
        calc_error = ""
    except (TypeError, ValueError):
        x_value = 5
        calc_result = x_value + BASE_VALUE
        calc_error = "Invalid x; showing default."
    body = f"""<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>{SERVICE_NAME}</title>
  </head>
  <body style="font-family: Arial, sans-serif; padding: 40px; background-color: #F2FDF2; color: #000;">
    <h1>{SERVICE_NAME}</h1>
    <p>Version: <strong>{version}</strong></p>
    <p>Lambda Function Version: <strong>{escape(str(lambda_version))}</strong></p>
    <p>Invoked Qualifier: <strong>{escape(str(invoked_qualifier))}</strong></p>
    <p style="color:#555;">{escape(str(lambda_version_note))}</p>
    <p>Lambda Function Name: <strong>{escape(str(lambda_name))}</strong></p>
    <p>Invoked Function ARN: <strong>{escape(str(invoked_arn))}</strong></p>
    <p>Rendered at: <strong>{now}</strong></p>
    <p>Request ID: <strong>{request_id}</strong></p>
    <h2>Calculation</h2>
    <p>Formula: <strong>x + {BASE_VALUE}</strong></p>
    <p>Result: <strong id="calc-result">{calc_result}</strong></p>
    <p style="color:#555;">Pass a query parameter: <code>?x=5</code></p>
    <form method="get" style="margin-top: 12px;">
      <label for="x">x:</label>
      <input id="x" name="x" type="number" value="{escape(str(x_value))}" />
      <button type="submit">Recalculate</button>
      <span style="margin-left: 8px; color: #c00;">{calc_error}</span>
    </form>
    <p style="margin-top: 8px; color:#666;">
      Live preview (no request): <span id="live-result"></span>
    </p>
    <script>
      const input = document.getElementById('x');
      const live = document.getElementById('live-result');
      const base = {BASE_VALUE};
      function update() {{
        const val = parseInt(input.value, 10);
        if (Number.isFinite(val)) {{
          live.textContent = String(val + base);
        }} else {{
          live.textContent = 'n/a';
        }}
      }}
      input.addEventListener('input', update);
      update();
    </script>
  </body>
</html>
"""
    return {
        "statusCode": 200,
        "headers": {"Content-Type": "text/html"},
        "body": body,
    }
