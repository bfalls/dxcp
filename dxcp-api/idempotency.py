import time
from typing import Optional
from config import SETTINGS


class IdempotencyStore:
    def __init__(self) -> None:
        self._store = {}

    def _cleanup(self) -> None:
        now = time.time()
        expired = [k for k, v in self._store.items() if v["expires_at"] <= now]
        for k in expired:
            del self._store[k]

    def get(self, key: str) -> Optional[dict]:
        self._cleanup()
        return self._store.get(key)

    def set(self, key: str, response: dict, status_code: int) -> None:
        self._cleanup()
        self._store[key] = {
            "response": response,
            "status_code": status_code,
            "expires_at": time.time() + SETTINGS.idempotency_ttl_seconds,
        }
