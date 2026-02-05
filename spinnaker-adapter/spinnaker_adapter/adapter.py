import json
import logging
import time
import uuid
from datetime import datetime, timezone
from typing import Callable, Dict, List, Optional
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from spinnaker_adapter.redaction import redact_text, redact_url


class SpinnakerAdapter:
    def __init__(
        self,
        base_url: str = "",
        mode: str = "stub",
        engine_url: str = "",
        engine_token: str = "",
        application: str = "",
        request_timeout_seconds: Optional[float] = None,
        header_name: str = "",
        header_value: str = "",
        request_id_provider: Optional[Callable[[], str]] = None,
    ) -> None:
        self.base_url = base_url
        self.mode = mode
        self.engine_url = engine_url
        self.engine_token = engine_token
        self.application = application
        self.request_timeout_seconds = request_timeout_seconds
        self.header_name = header_name.strip() if header_name else ""
        self.header_value = header_value
        self.request_id_provider = request_id_provider
        self._executions: Dict[str, dict] = {}
        self._logger = logging.getLogger("dxcp.spinnaker")
        self._obs_logger = logging.getLogger("dxcp.obs")

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
        response, status_code, _ = self._request_json("GET", url, operation="check_health")
        return {"status": "UP" if 200 <= status_code < 300 else "DOWN", "details": response}

    def list_applications(self) -> List[dict]:
        if self.mode == "stub":
            raise RuntimeError("Spinnaker stub mode disabled; set DXCP_SPINNAKER_MODE=http")
        if not self.base_url:
            raise RuntimeError("Spinnaker base URL is required for HTTP mode")
        # Expand application details so tag metadata is included for filtering.
        url = f"{self.base_url.rstrip('/')}/applications?expand=true"
        payload, _, _ = self._request_json("GET", url, operation="list_applications")
        if isinstance(payload, list):
            return payload
        return []

    def list_pipeline_configs(self, application: str) -> List[dict]:
        if self.mode == "stub":
            raise RuntimeError("Spinnaker stub mode disabled; set DXCP_SPINNAKER_MODE=http")
        if not self.base_url:
            raise RuntimeError("Spinnaker base URL is required for HTTP mode")
        url = f"{self.base_url.rstrip('/')}/applications/{application}/pipelineConfigs"
        payload, _, _ = self._request_json("GET", url, operation="list_pipeline_configs")
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
        if not application:
            raise RuntimeError("spinnakerApplication is required to trigger a pipeline")
        pipeline = payload.get("spinnakerPipeline") or self._pipeline_name(kind)
        params = self._build_parameters(payload)
        if self.engine_url:
            params["engineUrl"] = self.engine_url

        trigger = {
            "type": "manual",
            "user": "dxcp",
            "parameters": params,
        }
        if idempotency_key:
            trigger["idempotencyKey"] = idempotency_key

        url = f"{self.base_url.rstrip('/')}/pipelines/{application}/{pipeline}"
        response, status_code, headers = self._request_json("POST", url, trigger, operation=f"trigger_{kind}")
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
            execution, _, _ = self._request_json("GET", url, operation="get_execution")
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
        target_version = payload.get("targetVersion")
        if target_version:
            params["targetVersion"] = target_version
        artifact_ref = payload.get("artifactRef")
        if artifact_ref:
            params["artifactRef"] = artifact_ref
            bucket_key = self._parse_s3_artifact_ref(artifact_ref)
            if bucket_key:
                params["s3Bucket"] = bucket_key[0]
                params["s3Key"] = bucket_key[1]
        return params

    @staticmethod
    def _parse_s3_artifact_ref(artifact_ref: str) -> Optional[tuple]:
        if not isinstance(artifact_ref, str):
            return None
        if not artifact_ref.startswith("s3://"):
            return None
        without_scheme = artifact_ref[len("s3://") :]
        if "/" not in without_scheme:
            return None
        bucket, key = without_scheme.split("/", 1)
        if not bucket or not key:
            return None
        return bucket, key

    def _request_json(
        self,
        method: str,
        url: str,
        body: Optional[dict] = None,
        operation: str = "request",
    ) -> tuple[dict, int, dict]:
        data = None
        headers = {"Content-Type": "application/json", "ngrok-skip-browser-warning": "1"}
        header_configured = bool(self.header_name and self.header_value)
        if header_configured:
            headers[self.header_name] = self.header_value
        request_id = self.request_id_provider() if self.request_id_provider else ""
        if request_id:
            headers["X-Request-Id"] = request_id
        if body is not None:
            data = json.dumps(body).encode("utf-8")
        request = Request(url, data=data, headers=headers, method=method)
        start = time.monotonic()
        self._log_spinnaker_event(
            "spinnaker_call_started",
            request_id,
            operation,
            url,
        )
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
            redacted_message = redact_text(message)
            self._log_spinnaker_event(
                "spinnaker_call_failed",
                request_id,
                operation,
                url,
                outcome="FAILED",
                duration_ms=round(latency_ms, 1),
                error=redacted_message,
                status_code=exc.code,
            )
            self._logger.warning(
                "spinnaker.request method=%s url=%s status=%s latency_ms=%.1f custom_header=%s error=%s",
                method,
                redact_url(url),
                exc.code,
                latency_ms,
                "configured" if header_configured else "none",
                redacted_message,
            )
            raise RuntimeError(redacted_message) from exc
        except URLError as exc:
            latency_ms = (time.monotonic() - start) * 1000
            self._log_spinnaker_event(
                "spinnaker_call_failed",
                request_id,
                operation,
                url,
                outcome="FAILED",
                duration_ms=round(latency_ms, 1),
                error=redact_text(str(exc.reason)),
            )
            self._logger.warning(
                "spinnaker.request method=%s url=%s status=error latency_ms=%.1f custom_header=%s error=%s",
                method,
                redact_url(url),
                latency_ms,
                "configured" if header_configured else "none",
                redact_text(str(exc.reason)),
            )
            raise RuntimeError(redact_text(f"Spinnaker connection failed: {exc.reason}")) from exc
        latency_ms = (time.monotonic() - start) * 1000
        self._log_spinnaker_event(
            "spinnaker_call_succeeded",
            request_id,
            operation,
            url,
            outcome="SUCCESS",
            duration_ms=round(latency_ms, 1),
            status_code=status_code,
        )
        self._logger.info(
            "spinnaker.request method=%s url=%s status=%s latency_ms=%.1f custom_header=%s",
            method,
            redact_url(url),
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

    def _log_spinnaker_event(
        self,
        event: str,
        request_id: str,
        operation: str,
        url: str,
        outcome: Optional[str] = None,
        duration_ms: Optional[float] = None,
        error: Optional[str] = None,
        status_code: Optional[int] = None,
    ) -> None:
        fields = {
            "event": event,
            "request_id": request_id or "",
            "engine": "spinnaker",
            "operation": operation,
            "target": redact_url(url),
        }
        if outcome:
            fields["outcome"] = outcome
        if duration_ms is not None:
            fields["duration_ms"] = duration_ms
        if status_code is not None:
            fields["status_code"] = status_code
        if error:
            fields["error"] = redact_text(error)
        parts = [f"{key}={fields[key]}" for key in sorted(fields.keys())]
        self._obs_logger.info(" ".join(parts))

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
            return "SUCCEEDED"
        if status == "ROLLED_BACK":
            return "ROLLED_BACK"
        if status in failed:
            return "FAILED"
        if status in canceled:
            return "CANCELED"
        return "PENDING"

    def _extract_failures(self, execution: dict, state: str) -> List[dict]:
        if state != "FAILED":
            return []
        failures = _classify_execution_failures(execution)
        if failures:
            return failures
        return [
            {
                "category": "UNKNOWN",
                "summary": "Deployment failed for an unknown reason.",
                "detail": None,
                "actionHint": "Retry the deployment or contact the platform team.",
                "observedAt": self._utc_now(),
            }
        ]

    @staticmethod
    def _utc_now() -> str:
        return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

    @staticmethod
    def _parse_time(value: str) -> float:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()


def _normalize_failure_category(value: Optional[str]) -> str:
    if not value:
        return "UNKNOWN"
    category = str(value).strip().upper()
    mapping = {
        "INFRA": "INFRASTRUCTURE",
        "INFRASTRUCTURE": "INFRASTRUCTURE",
        "CONFIG": "CONFIG",
        "APP": "APP",
        "POLICY": "POLICY",
        "VALIDATION": "VALIDATION",
        "ARTIFACT": "ARTIFACT",
        "TIMEOUT": "TIMEOUT",
        "ROLLBACK": "ROLLBACK",
        "UNKNOWN": "UNKNOWN",
    }
    return mapping.get(category, "UNKNOWN")


def normalize_failures(raw_failures: Optional[List[dict]]) -> List[dict]:
    if not raw_failures:
        return []
    normalized = []
    for failure in raw_failures:
        summary = failure.get("summary")
        if not isinstance(summary, str) or not summary.strip():
            summary = "Deployment failed."
        action_hint = failure.get("actionHint")
        if not isinstance(action_hint, str) or not action_hint.strip():
            action_hint = "Retry the deployment or contact the platform team."
        normalized.append(
            {
                "category": _normalize_failure_category(failure.get("category")),
                "summary": summary,
                "detail": failure.get("detail"),
                "actionHint": action_hint,
                "observedAt": failure.get("observedAt", SpinnakerAdapter._utc_now()),
            }
        )
    return normalized


_ERROR_CODE_MAP = {
    "missing_service": {
        "category": "VALIDATION",
        "summary": "Service is not registered for delivery.",
        "action": "Select an allowlisted service and try again.",
        "detail": "Service was missing from the request.",
    },
    "unknown_service": {
        "category": "VALIDATION",
        "summary": "Service is not registered for delivery.",
        "action": "Select an allowlisted service and try again.",
        "detail": "Service was not recognized by the delivery system.",
    },
    "artifact_bucket_mismatch": {
        "category": "ARTIFACT",
        "summary": "Build artifact could not be validated.",
        "action": "Register the build in the approved artifact store and retry.",
        "detail": "Artifact storage location did not match expected storage.",
    },
    "no_previous_artifact": {
        "category": "ROLLBACK",
        "summary": "No prior version is available to roll back.",
        "action": "Deploy a prior version first or choose a different target.",
        "detail": "No previous artifact was recorded for rollback.",
    },
    "invalid_previous_artifact": {
        "category": "ROLLBACK",
        "summary": "Prior version metadata is invalid for rollback.",
        "action": "Choose a different rollback target or register the build.",
        "detail": "Previous artifact metadata could not be validated.",
    },
    "unauthorized": {
        "category": "POLICY",
        "summary": "Deployment was blocked by permissions.",
        "action": "Confirm your permissions or contact the platform team.",
        "detail": "Delivery system rejected the request.",
    },
    "method_not_allowed": {
        "category": "VALIDATION",
        "summary": "Deployment request was not accepted.",
        "action": "Retry the deployment from DXCP.",
        "detail": "Delivery system rejected the request method.",
    },
    "not_found": {
        "category": "INFRASTRUCTURE",
        "summary": "Delivery system is unavailable.",
        "action": "Retry later or contact the platform team.",
        "detail": "Delivery system endpoint was not found.",
    },
}

_PATTERN_MAP = [
    {
        "pattern": "timeout",
        "category": "TIMEOUT",
        "summary": "Deployment timed out.",
        "action": "Retry the deployment or contact the platform team.",
        "detail": None,
    },
    {
        "pattern": "timed out",
        "category": "TIMEOUT",
        "summary": "Deployment timed out.",
        "action": "Retry the deployment or contact the platform team.",
        "detail": None,
    },
    {
        "pattern": "connection",
        "category": "INFRASTRUCTURE",
        "summary": "Delivery system is unavailable.",
        "action": "Retry later or contact the platform team.",
        "detail": None,
    },
    {
        "pattern": "unavailable",
        "category": "INFRASTRUCTURE",
        "summary": "Delivery system is unavailable.",
        "action": "Retry later or contact the platform team.",
        "detail": None,
    },
    {
        "pattern": "http 5",
        "category": "INFRASTRUCTURE",
        "summary": "Delivery system is unavailable.",
        "action": "Retry later or contact the platform team.",
        "detail": None,
    },
    {
        "pattern": "internal error",
        "category": "INFRASTRUCTURE",
        "summary": "Delivery system encountered an internal error.",
        "action": "Retry later or contact the platform team.",
        "detail": None,
    },
    {
        "pattern": "artifact",
        "category": "ARTIFACT",
        "summary": "Build artifact could not be validated.",
        "action": "Register a valid build and retry.",
        "detail": None,
    },
    {
        "pattern": "checksum",
        "category": "ARTIFACT",
        "summary": "Build artifact could not be validated.",
        "action": "Register a valid build and retry.",
        "detail": None,
    },
    {
        "pattern": "forbidden",
        "category": "POLICY",
        "summary": "Deployment was blocked by policy.",
        "action": "Review delivery group policy or contact the platform team.",
        "detail": None,
    },
    {
        "pattern": "not allowed",
        "category": "POLICY",
        "summary": "Deployment was blocked by policy.",
        "action": "Review delivery group policy or contact the platform team.",
        "detail": None,
    },
    {
        "pattern": "config",
        "category": "CONFIG",
        "summary": "Delivery configuration is missing or invalid.",
        "action": "Contact the platform team to fix the configuration.",
        "detail": None,
    },
    {
        "pattern": "pipeline",
        "category": "CONFIG",
        "summary": "Delivery configuration is missing or invalid.",
        "action": "Contact the platform team to fix the configuration.",
        "detail": None,
    },
    {
        "pattern": "validation",
        "category": "VALIDATION",
        "summary": "Deployment request failed validation.",
        "action": "Verify the service, version, and recipe, then try again.",
        "detail": None,
    },
]


def _classify_execution_failures(execution: dict) -> List[dict]:
    signals = _collect_failure_signals(execution)
    is_rollback = _is_rollback_execution(execution)
    for signal in signals:
        failure = _classify_failure_signal(signal, is_rollback)
        if failure:
            return [failure]
    if is_rollback:
        return [
            _build_failure(
                "ROLLBACK",
                "Rollback could not be completed.",
                "Retry the rollback or deploy a known good version.",
                None,
            )
        ]
    return [
        _build_failure(
            "UNKNOWN",
            "Deployment failed for an unknown reason.",
            "Retry the deployment or contact the platform team.",
            None,
        )
    ]


def _collect_failure_signals(execution: dict) -> List[dict]:
    signals: List[dict] = []
    for key in ("statusMessage", "message", "error", "exception"):
        text = _coerce_text(execution.get(key))
        if text:
            signals.append({"text": text})
    failures = execution.get("failures") or []
    if isinstance(failures, list):
        for failure in failures:
            signals.append(_signal_from_failure(failure))
    stages = execution.get("stages") or []
    if isinstance(stages, list):
        for stage in stages:
            signal = _signal_from_stage(stage)
            if signal:
                signals.append(signal)
    return [signal for signal in signals if signal]


def _signal_from_failure(failure: object) -> dict:
    if isinstance(failure, dict):
        text = _coerce_text(
            failure.get("message")
            or failure.get("error")
            or failure.get("detail")
            or failure.get("exception")
        )
        error_code = _extract_error_code(failure)
        if not text and not error_code:
            return {}
        return {"text": text, "error_code": error_code}
    if failure is None:
        return {}
    return {"text": _coerce_text(failure)}


def _signal_from_stage(stage: object) -> Optional[dict]:
    if not isinstance(stage, dict):
        return None
    context = stage.get("context") or {}
    text = _coerce_text(
        stage.get("statusMessage")
        or stage.get("message")
        or stage.get("error")
        or context.get("error")
        or context.get("exception")
        or context.get("details")
    )
    error_code = _extract_error_code(context) or _extract_error_code(stage)
    if not text and not error_code:
        return None
    return {
        "text": text,
        "error_code": error_code,
        "stage_type": stage.get("type"),
        "stage_name": stage.get("name"),
    }


def _coerce_text(value: object) -> Optional[str]:
    if value is None:
        return None
    if isinstance(value, str):
        return value.strip() or None
    if isinstance(value, (dict, list)):
        try:
            return json.dumps(value)
        except (TypeError, ValueError):
            return None
    return str(value).strip() or None


def _extract_error_code(payload: object) -> Optional[str]:
    if isinstance(payload, str):
        return payload.strip().lower() or None
    if not isinstance(payload, dict):
        return None
    for key in ("error", "error_code", "errorCode", "code"):
        value = payload.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip().lower()
    return None


def _classify_failure_signal(signal: dict, is_rollback: bool) -> Optional[dict]:
    error_code = (signal.get("error_code") or "").strip().lower()
    if error_code in _ERROR_CODE_MAP:
        entry = _ERROR_CODE_MAP[error_code]
        return _build_failure(
            entry["category"],
            entry["summary"],
            entry["action"],
            entry.get("detail"),
        )
    text = (signal.get("text") or "").lower()
    if text:
        for entry in _PATTERN_MAP:
            if entry["pattern"] in text:
                return _build_failure(
                    entry["category"],
                    entry["summary"],
                    entry["action"],
                    entry.get("detail"),
                )
    if is_rollback and text:
        return _build_failure(
            "ROLLBACK",
            "Rollback could not be completed.",
            "Retry the rollback or deploy a known good version.",
            None,
        )
    return None


def _is_rollback_execution(execution: dict) -> bool:
    for key in ("name", "pipelineName", "pipelineConfigId", "type", "kind"):
        value = execution.get(key)
        if isinstance(value, str) and "rollback" in value.lower():
            return True
    stages = execution.get("stages") or []
    if isinstance(stages, list):
        for stage in stages:
            if not isinstance(stage, dict):
                continue
            for key in ("type", "name"):
                value = stage.get(key)
                if isinstance(value, str) and "rollback" in value.lower():
                    return True
    return False


def _build_failure(category: str, summary: str, action_hint: str, detail: Optional[str]) -> dict:
    return {
        "category": category,
        "summary": summary,
        "detail": detail,
        "actionHint": action_hint,
        "observedAt": SpinnakerAdapter._utc_now(),
    }
