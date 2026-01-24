import time
import uuid
from typing import Dict, List, Optional
from datetime import datetime, timezone


class SpinnakerAdapter:
    def __init__(self, base_url: str = "", mode: str = "stub") -> None:
        self.base_url = base_url
        self.mode = mode
        self._executions: Dict[str, dict] = {}

    def trigger_deploy(self, intent: dict, idempotency_key: str) -> dict:
        if self.mode == "stub":
            return self._stub_create_execution("deploy", intent)
        return self._http_trigger("deploy", intent, idempotency_key)

    def trigger_rollback(self, deployment: dict, idempotency_key: str) -> dict:
        if self.mode == "stub":
            return self._stub_create_execution("rollback", deployment)
        return self._http_trigger("rollback", deployment, idempotency_key)

    def get_execution(self, execution_id: str) -> dict:
        if self.mode == "stub":
            return self._stub_get_execution(execution_id)
        return self._http_get_execution(execution_id)

    def _stub_create_execution(self, kind: str, payload: dict) -> dict:
        execution_id = str(uuid.uuid4())
        created_at = self._utc_now()
        execution_url = f"https://spinnaker.local/executions/{execution_id}"
        self._executions[execution_id] = {
            "id": execution_id,
            "kind": kind,
            "payload": payload,
            "state": "ACTIVE",
            "created_at": created_at,
            "execution_url": execution_url,
            "failures": [],
        }
        return {"executionId": execution_id, "executionUrl": execution_url}

    def _stub_get_execution(self, execution_id: str) -> dict:
        execution = self._executions.get(execution_id)
        if not execution:
            return {"state": "UNKNOWN", "failures": []}
        created_at = self._parse_time(execution["created_at"])
        if time.time() - created_at > 5:
            execution["state"] = "SUCCEEDED"
        return {
            "state": execution["state"],
            "failures": execution["failures"],
            "executionUrl": execution["execution_url"],
        }

    def _http_trigger(self, kind: str, payload: dict, idempotency_key: str) -> dict:
        raise NotImplementedError("HTTP mode is not implemented in the MVP")

    def _http_get_execution(self, execution_id: str) -> dict:
        raise NotImplementedError("HTTP mode is not implemented in the MVP")

    @staticmethod
    def _utc_now() -> str:
        return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

    @staticmethod
    def _parse_time(value: str) -> float:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()


def normalize_failures(raw_failures: Optional[List[dict]]) -> List[dict]:
    if not raw_failures:
        return []
    normalized = []
    for failure in raw_failures:
        normalized.append(
            {
                "category": failure.get("category", "UNKNOWN"),
                "summary": failure.get("summary", "Unknown failure"),
                "detail": failure.get("detail"),
                "actionHint": failure.get("actionHint"),
                "observedAt": failure.get("observedAt", SpinnakerAdapter._utc_now()),
            }
        )
    return normalized
