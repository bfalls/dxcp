import time
from collections import defaultdict
from config import SETTINGS
from policy import PolicyError


class RateLimiter:
    def __init__(self) -> None:
        self._minute_counters = defaultdict(lambda: {"start": 0.0, "count": 0, "limit": 0})
        self._daily_counts = defaultdict(lambda: defaultdict(int))

    def _check_minute(self, client_id: str, limit: int) -> None:
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
        daily_key = f"{day}:{key}"
        count = self._daily_counts[client_id][daily_key]
        if count >= limit:
            raise PolicyError(429, "RATE_LIMITED", "Daily quota exceeded")
        self._daily_counts[client_id][daily_key] += 1

    def check_read(self, client_id: str) -> None:
        self._check_minute(client_id, SETTINGS.read_rpm)

    def check_mutate(self, client_id: str, quota_key: str) -> None:
        self._check_minute(client_id, SETTINGS.mutate_rpm)
        if quota_key == "deploy":
            self._check_daily(client_id, "deploy", SETTINGS.daily_quota_deploy)
        elif quota_key == "rollback":
            self._check_daily(client_id, "rollback", SETTINGS.daily_quota_rollback)
        elif quota_key == "build_register":
            self._check_daily(client_id, "build_register", SETTINGS.daily_quota_build_register)
        elif quota_key == "upload_capability":
            self._check_daily(client_id, "upload_capability", SETTINGS.daily_quota_upload_capability)
