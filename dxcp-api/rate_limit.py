import os
import time
from collections import defaultdict
from decimal import Decimal

from config import SETTINGS
from policy import PolicyError

try:
    import boto3
    from botocore.exceptions import ClientError
except Exception:  # pragma: no cover - optional dependency for local mode
    boto3 = None
    ClientError = None


class RateLimiter:
    def __init__(self) -> None:
        self._table_name = os.getenv("DXCP_DDB_TABLE", "")
        if self._table_name:
            if not boto3:
                raise RuntimeError("boto3 is required for DynamoDB rate limiting")
            self._ddb = boto3.resource("dynamodb").Table(self._table_name)
        else:
            self._ddb = None
            self._minute_counters = defaultdict(lambda: {"start": 0.0, "count": 0, "limit": 0})
            self._daily_counts = defaultdict(lambda: defaultdict(int))

    def _check_minute(self, client_id: str, limit: int) -> None:
        if self._ddb:
            self._check_ddb_rate(client_id, "MINUTE", int(time.time() // 60), limit, 120, "Rate limit exceeded")
            return
        now = time.time()
        bucket = self._minute_counters[(client_id, limit)]
        if now - bucket["start"] >= 60:
            bucket["start"] = now
            bucket["count"] = 0
            bucket["limit"] = limit
        if bucket["count"] >= limit:
            raise PolicyError(429, "RATE_LIMITED", "Rate limit exceeded")
        bucket["count"] += 1

    def _check_daily(self, client_id: str, key: str, limit: int) -> None:
        day = time.strftime("%Y-%m-%d", time.gmtime())
        if self._ddb:
            ttl_seconds = 48 * 60 * 60
            self._check_ddb_rate(client_id, f"DAY#{key}", day, limit, ttl_seconds, "Daily quota exceeded")
            return
        daily_key = f"{day}:{key}"
        count = self._daily_counts[client_id][daily_key]
        if count >= limit:
            raise PolicyError(429, "RATE_LIMITED", "Daily quota exceeded")
        self._daily_counts[client_id][daily_key] += 1

    def _check_ddb_rate(
        self, client_id: str, scope: str, bucket: object, limit: int, ttl_seconds: int, message: str
    ) -> None:
        now = int(time.time())
        ttl = now + ttl_seconds
        key = {"pk": f"RATE#{client_id}", "sk": f"{scope}#{bucket}"}
        try:
            self._ddb.update_item(
                Key=key,
                UpdateExpression="SET #count = if_not_exists(#count, :zero) + :one, #ttl = :ttl",
                ConditionExpression="attribute_not_exists(#count) OR #count < :limit",
                ExpressionAttributeNames={"#count": "count", "#ttl": "ttl"},
                ExpressionAttributeValues={
                    ":zero": Decimal(0),
                    ":one": Decimal(1),
                    ":limit": Decimal(limit),
                    ":ttl": Decimal(ttl),
                },
            )
        except ClientError as exc:
            code = exc.response.get("Error", {}).get("Code")
            if code == "ConditionalCheckFailedException":
                raise PolicyError(429, "RATE_LIMITED", message)
            raise

    def check_read(self, client_id: str) -> None:
        self._check_minute(client_id, SETTINGS.read_rpm)

    def check_mutate(
        self,
        client_id: str,
        quota_key: str,
        quota_scope: str | None = None,
        quota_limit: int | None = None,
    ) -> None:
        self._check_minute(client_id, SETTINGS.mutate_rpm)
        scope_id = quota_scope or client_id
        if quota_key == "deploy":
            self._check_daily(scope_id, "deploy", quota_limit or SETTINGS.daily_quota_deploy)
        elif quota_key == "rollback":
            self._check_daily(scope_id, "rollback", quota_limit or SETTINGS.daily_quota_rollback)
        elif quota_key == "build_register":
            self._check_daily(scope_id, "build_register", SETTINGS.daily_quota_build_register)
        elif quota_key == "upload_capability":
            self._check_daily(scope_id, "upload_capability", SETTINGS.daily_quota_upload_capability)
