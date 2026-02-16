import os
import time
from collections import defaultdict
from decimal import Decimal

from config import SETTINGS
from policy import PolicyError

try:
    import boto3
    from botocore.exceptions import ClientError
    from botocore.config import Config
except Exception:  # pragma: no cover - optional dependency for local mode
    boto3 = None
    ClientError = None
    Config = None


class RateLimiter:
    RATE_LIMIT_EXCEEDED_MESSAGE = "Rate limit exceeded. Try again shortly or contact a platform admin."

    def __init__(self) -> None:
        self._table_name = os.getenv("DXCP_DDB_TABLE", "")
        self._refresh_seconds = int(os.getenv("DXCP_RATE_LIMIT_REFRESH_SECONDS", "30"))
        live_refresh_env = os.getenv("DXCP_RATE_LIMIT_LIVE_SSM")
        if live_refresh_env is None:
            self._live_refresh_enabled = os.getenv("DXCP_LAMBDA", "") == "1"
        else:
            self._live_refresh_enabled = live_refresh_env.lower() in {"1", "true", "yes", "on"}
        self._runtime_limit_overrides: dict[str, int] = {}
        self._live_limits = {
            "read_rpm": int(SETTINGS.read_rpm),
            "mutate_rpm": int(SETTINGS.mutate_rpm),
        }
        self._live_limits_refreshed_at = 0.0
        if self._table_name:
            if not boto3:
                raise RuntimeError("boto3 is required for DynamoDB rate limiting")
            self._ddb = boto3.resource("dynamodb").Table(self._table_name)
        else:
            self._ddb = None
            self._minute_counters = defaultdict(lambda: {"start": 0.0, "count": 0, "limit": 0})
            self._daily_counts = defaultdict(lambda: defaultdict(int))

    def _ssm_client(self):
        if not boto3:
            return None
        if Config:
            cfg = Config(connect_timeout=1, read_timeout=1, retries={"max_attempts": 1, "mode": "standard"})
            try:
                return boto3.client("ssm", config=cfg)
            except TypeError:
                # Test doubles may not accept boto3 kwargs.
                return boto3.client("ssm")
        return boto3.client("ssm")

    def _refresh_live_limits_if_due(self) -> None:
        if not self._live_refresh_enabled:
            return
        now = time.time()
        if now - self._live_limits_refreshed_at < max(self._refresh_seconds, 1):
            return
        prefix = (SETTINGS.ssm_prefix or "").strip().rstrip("/")
        if not prefix:
            self._live_limits_refreshed_at = now
            return
        client = self._ssm_client()
        if client is None:
            self._live_limits_refreshed_at = now
            return
        try:
            response = client.get_parameters(
                Names=[f"{prefix}/read_rpm", f"{prefix}/mutate_rpm"],
                WithDecryption=True,
            )
            found = {item.get("Name"): item.get("Value") for item in response.get("Parameters", [])}
            for key in ("read_rpm", "mutate_rpm"):
                raw = found.get(f"{prefix}/{key}")
                if raw is None:
                    continue
                parsed = int(raw)
                if 1 <= parsed <= 5000:
                    self._live_limits[key] = parsed
        except Exception:
            pass
        self._live_limits_refreshed_at = now

    def _get_live_minute_limit(self, key: str, fallback: int) -> int:
        if key in self._runtime_limit_overrides:
            return int(self._runtime_limit_overrides[key])
        if not self._live_refresh_enabled:
            return int(fallback)
        self._refresh_live_limits_if_due()
        value = self._live_limits.get(key, fallback)
        try:
            return int(value)
        except Exception:
            return int(fallback)

    def set_runtime_limits(self, read_rpm: int, mutate_rpm: int) -> None:
        self._runtime_limit_overrides["read_rpm"] = int(read_rpm)
        self._runtime_limit_overrides["mutate_rpm"] = int(mutate_rpm)
        self._live_limits["read_rpm"] = int(read_rpm)
        self._live_limits["mutate_rpm"] = int(mutate_rpm)
        self._live_limits_refreshed_at = time.time()

    def _check_minute(self, client_id: str, limit: int) -> None:
        if self._ddb:
            self._check_ddb_rate(
                client_id,
                "MINUTE",
                int(time.time() // 60),
                limit,
                120,
                "RATE_LIMITED",
                self.RATE_LIMIT_EXCEEDED_MESSAGE,
            )
            return
        now = time.time()
        bucket = self._minute_counters[(client_id, limit)]
        if now - bucket["start"] >= 60:
            bucket["start"] = now
            bucket["count"] = 0
            bucket["limit"] = limit
        if bucket["count"] >= limit:
            raise PolicyError(429, "RATE_LIMITED", self.RATE_LIMIT_EXCEEDED_MESSAGE)
        bucket["count"] += 1

    def _check_daily(self, client_id: str, key: str, limit: int) -> None:
        day = time.strftime("%Y-%m-%d", time.gmtime())
        if self._ddb:
            ttl_seconds = 48 * 60 * 60
            self._check_ddb_rate(
                client_id,
                f"DAY#{key}",
                day,
                limit,
                ttl_seconds,
                "QUOTA_EXCEEDED",
                "Daily quota exceeded",
            )
            return
        daily_key = f"{day}:{key}"
        count = self._daily_counts[client_id][daily_key]
        if count >= limit:
            raise PolicyError(429, "QUOTA_EXCEEDED", "Daily quota exceeded")
        self._daily_counts[client_id][daily_key] += 1

    def _check_ddb_rate(
        self,
        client_id: str,
        scope: str,
        bucket: object,
        limit: int,
        ttl_seconds: int,
        error_code: str,
        message: str,
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
            ddb_code = exc.response.get("Error", {}).get("Code")
            if ddb_code == "ConditionalCheckFailedException":
                raise PolicyError(429, error_code, message)
            raise

    def check_read(self, client_id: str) -> None:
        limit = self._get_live_minute_limit("read_rpm", SETTINGS.read_rpm)
        self._check_minute(client_id, limit)

    def check_mutate(
        self,
        client_id: str,
        quota_key: str,
        quota_scope: str | None = None,
        quota_limit: int | None = None,
    ) -> None:
        minute_limit = self._get_live_minute_limit("mutate_rpm", SETTINGS.mutate_rpm)
        self._check_minute(client_id, minute_limit)
        scope_id = quota_scope or client_id
        if quota_key == "deploy":
            self._check_daily(scope_id, "deploy", quota_limit or SETTINGS.daily_quota_deploy)
        elif quota_key == "rollback":
            self._check_daily(scope_id, "rollback", quota_limit or SETTINGS.daily_quota_rollback)
        elif quota_key == "build_register":
            self._check_daily(scope_id, "build_register", SETTINGS.daily_quota_build_register)
        elif quota_key == "upload_capability":
            self._check_daily(scope_id, "upload_capability", SETTINGS.daily_quota_upload_capability)

    def get_daily_remaining(self, scope_id: str, key: str, limit: int) -> dict:
        day = time.strftime("%Y-%m-%d", time.gmtime())
        if limit < 0:
            limit = 0
        if self._ddb:
            count = self._get_ddb_daily_count(scope_id, key, day)
        else:
            daily_key = f"{day}:{key}"
            count = self._daily_counts[scope_id].get(daily_key, 0)
        used = int(count)
        remaining = max(limit - used, 0)
        return {"used": used, "remaining": remaining, "limit": int(limit)}

    def _get_ddb_daily_count(self, scope_id: str, key: str, day: str) -> int:
        if not self._ddb:
            return 0
        sk = f"DAY#{key}#{day}"
        response = self._ddb.get_item(Key={"pk": f"RATE#{scope_id}", "sk": sk})
        item = response.get("Item") or {}
        count = item.get("count", 0)
        try:
            return int(count)
        except (TypeError, ValueError):
            return 0
