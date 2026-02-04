import contextvars
import logging
from typing import Any

from spinnaker_adapter.redaction import redact_text


request_id_ctx = contextvars.ContextVar("request_id", default="")
_logger = logging.getLogger("dxcp.obs")


def get_request_id() -> str:
    return request_id_ctx.get() or ""


def log_event(event: str, **fields: Any) -> None:
    payload = {"event": event, "request_id": get_request_id()}
    for key, value in fields.items():
        if value is None:
            continue
        if isinstance(value, str):
            payload[key] = redact_text(value)
        else:
            payload[key] = value
    parts = [f"{key}={payload[key]}" for key in sorted(payload.keys())]
    _logger.info(" ".join(parts))
