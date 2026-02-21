import json
import os
import time
from decimal import Decimal
from typing import Optional

from config import SETTINGS

try:
    import boto3
except Exception:  # pragma: no cover - optional dependency for local mode
    boto3 = None


class IdempotencyStore:
    def __init__(self) -> None:
        self._table_name = os.getenv("DXCP_DDB_TABLE", "")
        if self._table_name:
            if not boto3:
                raise RuntimeError("boto3 is required for DynamoDB idempotency")
            self._ddb = boto3.resource("dynamodb").Table(self._table_name)
            self._store = None
        else:
            self._store = {}
            self._ddb = None

    def _cleanup(self) -> None:
        if self._ddb:
            return
        now = time.time()
        expired = [k for k, v in self._store.items() if v["expires_at"] <= now]
        for k in expired:
            del self._store[k]

    def get(self, key: str) -> Optional[dict]:
        if self._ddb:
            response = self._ddb.get_item(Key={"pk": "IDEMPOTENCY", "sk": key})
            item = response.get("Item")
            if not item:
                return None
            ttl = int(item.get("ttl", 0))
            if ttl and ttl <= int(time.time()):
                self._ddb.delete_item(Key={"pk": "IDEMPOTENCY", "sk": key})
                return None
            return {
                "response": json.loads(item.get("response", "{}")),
                "status_code": int(item.get("statusCode", 0)),
                "request_fingerprint": item.get("requestFingerprint"),
            }
        self._cleanup()
        return self._store.get(key)

    def set(
        self,
        key: str,
        response: dict,
        status_code: int,
        request_fingerprint: Optional[str] = None,
    ) -> None:
        expires_at = int(time.time() + SETTINGS.idempotency_ttl_seconds)
        if self._ddb:
            def _json_default(value):
                if isinstance(value, Decimal):
                    return int(value) if value == value.to_integral_value() else float(value)
                raise TypeError(f"Object of type {value.__class__.__name__} is not JSON serializable")

            item = {
                "pk": "IDEMPOTENCY",
                "sk": key,
                "response": json.dumps(response, default=_json_default),
                "statusCode": Decimal(status_code),
                "expiresAt": str(expires_at),
                "ttl": Decimal(expires_at),
            }
            if request_fingerprint is not None:
                item["requestFingerprint"] = request_fingerprint
            self._ddb.put_item(
                Item=item
            )
            return
        self._cleanup()
        self._store[key] = {
            "response": response,
            "status_code": status_code,
            "request_fingerprint": request_fingerprint,
            "expires_at": expires_at,
        }
