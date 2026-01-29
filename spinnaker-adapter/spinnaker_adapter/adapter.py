import json
import logging
import time
import uuid
from datetime import datetime, timezone
from typing import Dict, List, Optional
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


class SpinnakerAdapter:
    def __init__(
        self,
        base_url: str = "",
        mode: str = "stub",
        engine_url: str = "",
        engine_token: str = "",
        application: str = "dxcp-demo",
        request_timeout_seconds: Optional[float] = None,
        header_name: str = "",
        header_value: str = "",
    ) -> None:
        self.base_url = base_url
        self.mode = mode
        self.engine_url = engine_url
        self.engine_token = engine_token
        self.application = application
        self.request_timeout_seconds = request_timeout_seconds
        self.header_name = header_name.strip() if header_name else ""
        self.header_value = header_value
        self._executions: Dict[str, dict] = {}
        self._logger = logging.getLogger("dxcp.spinnaker")

    def trigger_deploy(self, intent: dict, idempotency_key: str) -> dict:
        if self.mode == "stub":
            raise RuntimeError("Spinnaker stub mode disabled; set DXCP_SPINNAKER_MODE=http")
        return self._http_trigger("deploy", intent, idempotency_key)

    def trigger_rollback(self, deployment: dict, idempotency_key: str) -> dict:
        if self.mode == "stub":
            raise RuntimeError("Spinnaker stub mode disabled; set DXCP_SPINNAKER_MODE=http")
        return self._http_trigger("rollback", deployment, idempotency_key)

    def get_execution(self, execution_id: str) -> dict:
        if self.mode == "stub":
            raise RuntimeError("Spinnaker stub mode disabled; set DXCP_SPINNAKER_MODE=http")
        return self._http_get_execution(execution_id)

    def check_health(self) -> dict:
        if self.mode == "stub":
            raise RuntimeError("Spinnaker stub mode disabled; set DXCP_SPINNAKER_MODE=http")
        if not self.base_url:
            raise RuntimeError("Spinnaker base URL is required for HTTP mode")
        url = f"{self.base_url.rstrip('/')}/health"
        response, status_code, _ = self._request_json("GET", url)
        return {"status": "UP" if 200 <= status_code < 300 else "DOWN", "details": response}

    def list_applications(self) -> List[dict]:
        if self.mode == "stub":
            raise RuntimeError("Spinnaker stub mode disabled; set DXCP_SPINNAKER_MODE=http")
        if not self.base_url:
            raise RuntimeError("Spinnaker base URL is required for HTTP mode")
        # Expand application details so tag metadata is included for filtering.
        url = f"{self.base_url.rstrip('/')}/applications?expand=true"
        payload, _, _ = self._request_json("GET", url)
        if isinstance(payload, list):
            return payload
        return []

    def list_pipeline_configs(self, application: str) -> List[dict]:
        if self.mode == "stub":
            raise RuntimeError("Spinnaker stub mode disabled; set DXCP_SPINNAKER_MODE=http")
        if not self.base_url:
            raise RuntimeError("Spinnaker base URL is required for HTTP mode")
        url = f"{self.base_url.rstrip('/')}/applications/{application}/pipelineConfigs"
        payload, _, _ = self._request_json("GET", url)
        if isinstance(payload, list):
            return payload
        return []

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
        if not self.base_url:
            raise RuntimeError("Spinnaker base URL is required for HTTP mode")
        application = payload.get("spinnakerApplication") or self.application
        pipeline = payload.get("spinnakerPipeline") or self._pipeline_name(kind)
        params = self._build_parameters(payload)
        if self.engine_url:
            params["engineUrl"] = self.engine_url
        if self.engine_token:
            params["engineToken"] = self.engine_token

        trigger = {
            "type": "manual",
            "user": "dxcp",
            "parameters": params,
        }
        if idempotency_key:
            trigger["idempotencyKey"] = idempotency_key

        url = f"{self.base_url.rstrip('/')}/pipelines/{application}/{pipeline}"
        response, status_code, headers = self._request_json("POST", url, trigger)
        execution_id = self._extract_execution_id(response)
        if not execution_id:
            correlation_id = self._extract_correlation_id(response, headers)
            detail = f"Spinnaker trigger failed: missing execution id (HTTP {status_code})"
            if correlation_id:
                detail = f"{detail}; requestId={correlation_id}"
            raise RuntimeError(detail)
        execution_url = self._execution_url(execution_id)
        self._logger.info(
            "spinnaker.trigger kind=%s execution_id=%s service=%s version=%s idempotency_key=%s",
            kind,
            execution_id,
            payload.get("service"),
            payload.get("version"),
            idempotency_key,
        )
        return {"executionId": execution_id, "executionUrl": execution_url}

    def _http_get_execution(self, execution_id: str) -> dict:
        if not self.base_url:
            raise RuntimeError("Spinnaker base URL is required for HTTP mode")
        url = f"{self.base_url.rstrip('/')}/pipelines/{execution_id}"
        try:
            execution, _, _ = self._request_json("GET", url)
        except RuntimeError as exc:
            if "404" in str(exc):
                return {"state": "UNKNOWN", "failures": [], "executionUrl": self._execution_url(execution_id)}
            raise

        status = (execution.get("status") or execution.get("state") or "").upper()
        state = self._map_status(status, execution)
        failures = self._extract_failures(execution, state)
        self._logger.info(
            "spinnaker.execution execution_id=%s status=%s state=%s",
            execution.get("id", execution_id),
            status,
            state,
        )
        return {
            "state": state,
            "failures": failures,
            "executionUrl": self._execution_url(execution.get("id", execution_id)),
        }

    def _pipeline_name(self, kind: str) -> str:
        if kind == "deploy":
            return "demo-deploy"
        if kind == "rollback":
            return "rollback-demo-service"
        raise ValueError(f"Unsupported pipeline kind: {kind}")

    def _build_parameters(self, payload: dict) -> dict:
        params = {
            "service": payload.get("service"),
            "version": payload.get("version"),
        }
        if not params["service"] or not params["version"]:
            raise ValueError("service and version are required to trigger a pipeline")
        artifact_ref = payload.get("artifactRef")
        if artifact_ref:
            params["artifactRef"] = artifact_ref
        return params

    def _request_json(self, method: str, url: str, body: Optional[dict] = None) -> tuple[dict, int, dict]:
        data = None
        headers = {"Content-Type": "application/json", "ngrok-skip-browser-warning": "1"}
        header_configured = bool(self.header_name and self.header_value)
        if header_configured:
            headers[self.header_name] = self.header_value
        if body is not None:
            data = json.dumps(body).encode("utf-8")
        request = Request(url, data=data, headers=headers, method=method)
        start = time.monotonic()
        try:
            if self.request_timeout_seconds is None:
                response_ctx = urlopen(request)
            else:
                response_ctx = urlopen(request, timeout=self.request_timeout_seconds)
            with response_ctx as response:
                status_code = response.status
                response_headers = dict(response.headers.items())
                payload = response.read().decode("utf-8")
        except HTTPError as exc:
            latency_ms = (time.monotonic() - start) * 1000
            detail = exc.read().decode("utf-8") if exc.fp else ""
            response_headers = dict(exc.headers.items()) if exc.headers else {}
            correlation_id = self._extract_correlation_id({}, response_headers)
            snippet = self._safe_snippet(detail)
            message = f"Spinnaker HTTP {exc.code}: {snippet}" if snippet else f"Spinnaker HTTP {exc.code}"
            if correlation_id:
                message = f"{message}; requestId={correlation_id}"
            self._logger.warning(
                "spinnaker.request method=%s url=%s status=%s latency_ms=%.1f custom_header=%s error=%s",
                method,
                url,
                exc.code,
                latency_ms,
                "configured" if header_configured else "none",
                message,
            )
            raise RuntimeError(message) from exc
        except URLError as exc:
            latency_ms = (time.monotonic() - start) * 1000
            self._logger.warning(
                "spinnaker.request method=%s url=%s status=error latency_ms=%.1f custom_header=%s error=%s",
                method,
                url,
                latency_ms,
                "configured" if header_configured else "none",
                exc.reason,
            )
            raise RuntimeError(f"Spinnaker connection failed: {exc.reason}") from exc
        latency_ms = (time.monotonic() - start) * 1000
        self._logger.info(
            "spinnaker.request method=%s url=%s status=%s latency_ms=%.1f custom_header=%s",
            method,
            url,
            status_code,
            latency_ms,
            "configured" if header_configured else "none",
        )
        if not payload:
            return {}, status_code, response_headers
        try:
            return json.loads(payload), status_code, response_headers
        except json.JSONDecodeError:
            return {}, status_code, response_headers

    @staticmethod
    def _safe_snippet(value: str, limit: int = 240) -> str:
        if not value:
            return ""
        text = value.replace("\n", " ").replace("\r", " ")
        if len(text) <= limit:
            return text
        return text[:limit].rstrip() + "..."

    @staticmethod
    def _extract_correlation_id(payload: dict, headers: dict) -> Optional[str]:
        for key in ["X-Request-Id", "X-Request-ID", "X-Spinnaker-Request-Id"]:
            value = headers.get(key)
            if value:
                return str(value)
        for key in ["requestId", "correlationId"]:
            value = payload.get(key)
            if value:
                return str(value)
        return None

    def _extract_execution_id(self, response: dict) -> Optional[str]:
        if not isinstance(response, dict):
            return None
        for key in ["executionId", "id"]:
            value = response.get(key)
            if value:
                return str(value)
        ref = response.get("ref") or response.get("resource") or response.get("url")
        if isinstance(ref, str):
            parts = ref.strip("/").split("/")
            if parts:
                return parts[-1]
        return None

    def _execution_url(self, execution_id: str) -> str:
        return f"{self.base_url.rstrip('/')}/pipelines/{execution_id}"

    def _map_status(self, status: str, execution: dict) -> str:
        running = {"RUNNING", "NOT_STARTED", "STARTED", "BUFFERED", "PAUSED", "SUSPENDED"}
        failed = {"TERMINAL", "FAILED"}
        canceled = {"CANCELED", "STOPPED"}
        if status in running:
            return "IN_PROGRESS"
        if status == "SUCCEEDED":
            name = (execution.get("name") or "").lower()
            if "rollback" in name:
                return "ROLLED_BACK"
            return "SUCCEEDED"
        if status in failed:
            return "FAILED"
        if status in canceled:
            return "CANCELED"
        return "PENDING"

    def _extract_failures(self, execution: dict, state: str) -> List[dict]:
        if state != "FAILED":
            return []
        detail = execution.get("statusMessage") or execution.get("message") or execution.get("error")
        if isinstance(detail, (dict, list)):
            detail = json.dumps(detail)
        return [
            {
                "category": "ENGINE",
                "summary": "Spinnaker execution failed",
                "detail": detail,
                "actionHint": "Check the Spinnaker execution for stage errors.",
                "observedAt": self._utc_now(),
            }
        ]

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
