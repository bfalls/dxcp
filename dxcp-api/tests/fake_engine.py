from __future__ import annotations


class FakeEngineAdapter:
    def __init__(self, mode: str = "lambda") -> None:
        self.mode = mode
        self.executions: dict[str, dict] = {}
        self.triggered: list[dict] = []
        self._fail_next = False

    def fail_next(self) -> None:
        self._fail_next = True

    def trigger_deploy(self, payload: dict, idempotency_key: str) -> dict:
        if payload.get("simulate_failure") or self._fail_next:
            self._fail_next = False
            raise RuntimeError("Simulated engine failure")
        execution_id = f"exec-{len(self.executions) + 1}"
        self.executions[execution_id] = {"state": "IN_PROGRESS", "failures": []}
        self.triggered.append({"kind": "deploy", "payload": payload, "idempotency_key": idempotency_key})
        return {"executionId": execution_id, "executionUrl": f"http://engine.local/pipelines/{execution_id}"}

    def trigger_rollback(self, payload: dict, idempotency_key: str) -> dict:
        if payload.get("simulate_failure") or self._fail_next:
            self._fail_next = False
            raise RuntimeError("Simulated engine failure")
        execution_id = f"exec-{len(self.executions) + 1}"
        self.executions[execution_id] = {"state": "IN_PROGRESS", "failures": []}
        self.triggered.append({"kind": "rollback", "payload": payload, "idempotency_key": idempotency_key})
        return {"executionId": execution_id, "executionUrl": f"http://engine.local/pipelines/{execution_id}"}

    def get_execution(self, execution_id: str) -> dict:
        execution = self.executions.get(execution_id, {"state": "UNKNOWN", "failures": []})
        return {
            "state": execution["state"],
            "failures": execution["failures"],
            "executionUrl": f"http://engine.local/pipelines/{execution_id}",
        }
