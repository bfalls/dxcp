import json
import logging
import ssl
import time
import uuid
import base64
from http.client import HTTPSConnection
from contextlib import contextmanager
from contextvars import ContextVar
from datetime import datetime, timezone
from typing import Callable, Dict, List, Optional
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin, urlparse
from urllib.request import HTTPRedirectHandler, HTTPSHandler, Request, build_opener, urlopen

from spinnaker_adapter.redaction import redact_text, redact_url
from spinnaker_adapter.artifact_ref import parse_s3_artifact_ref


_ALLOWED_ARTIFACT_SCHEMES = ["s3"]


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
        auth0_domain: str = "",
        auth0_client_id: str = "",
        auth0_client_secret: str = "",
        auth0_audience: str = "",
        auth0_scope: str = "",
        auth0_refresh_skew_seconds: int = 60,
        mtls_cert_path: str = "",
        mtls_key_path: str = "",
        mtls_ca_path: str = "",
        mtls_server_name: str = "",
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
        self.auth0_domain = (auth0_domain or "").strip()
        self.auth0_client_id = (auth0_client_id or "").strip()
        self.auth0_client_secret = auth0_client_secret or ""
        self.auth0_audience = (auth0_audience or "").strip()
        self.auth0_scope = (auth0_scope or "").strip()
        self.auth0_refresh_skew_seconds = max(0, int(auth0_refresh_skew_seconds or 0))
        self.mtls_cert_path = (mtls_cert_path or "").strip()
        self.mtls_key_path = (mtls_key_path or "").strip()
        self.mtls_ca_path = (mtls_ca_path or "").strip()
        self.mtls_server_name = (mtls_server_name or "").strip()
        self._cached_access_token = ""
        self._cached_access_token_exp_epoch = 0
        self._auth_header_override: ContextVar[Optional[tuple[str, str]]] = ContextVar(
            "spinnaker_auth_header_override",
            default=None,
        )
        self.request_id_provider = request_id_provider
        self._executions: Dict[str, dict] = {}
        self._logger = logging.getLogger("dxcp.spinnaker")
        self._obs_logger = logging.getLogger("dxcp.obs")
        self._gate_ssl_context = self._build_gate_ssl_context()
        self._logger.info("spinnaker.auth mode=%s", self._auth_mode_label())

    def trigger_deploy(
        self,
        intent: dict,
        idempotency_key: str,
        user_bearer_token: Optional[str] = None,
        user_principal: Optional[str] = None,
    ) -> dict:
        if self.mode == "stub":
            raise RuntimeError("Spinnaker stub mode disabled; set DXCP_SPINNAKER_MODE=http")
        return self._http_trigger(
            "deploy",
            intent,
            idempotency_key,
            user_bearer_token=user_bearer_token,
            user_principal=user_principal,
        )

    def trigger_rollback(
        self,
        deployment: dict,
        idempotency_key: str,
        user_bearer_token: Optional[str] = None,
        user_principal: Optional[str] = None,
    ) -> dict:
        if self.mode == "stub":
            raise RuntimeError("Spinnaker stub mode disabled; set DXCP_SPINNAKER_MODE=http")
        return self._http_trigger(
            "rollback",
            deployment,
            idempotency_key,
            user_bearer_token=user_bearer_token,
            user_principal=user_principal,
        )

    def get_execution(
        self,
        execution_id: str,
        user_bearer_token: Optional[str] = None,
        user_principal: Optional[str] = None,
    ) -> dict:
        if self.mode == "stub":
            raise RuntimeError("Spinnaker stub mode disabled; set DXCP_SPINNAKER_MODE=http")
        return self._http_get_execution(
            execution_id,
            user_bearer_token=user_bearer_token,
            user_principal=user_principal,
        )

    def check_health(
        self,
        timeout_seconds: Optional[float] = None,
        user_bearer_token: Optional[str] = None,
        user_principal: Optional[str] = None,
    ) -> dict:
        if self.mode == "stub":
            raise RuntimeError("Spinnaker stub mode disabled; set DXCP_SPINNAKER_MODE=http")
        if not self.base_url:
            raise RuntimeError("Spinnaker base URL is required for HTTP mode")
        url = f"{self.base_url.rstrip('/')}/health"
        response, status_code, _ = self._request_json(
            "GET",
            url,
            operation="check_health",
            timeout_seconds=timeout_seconds,
            user_bearer_token=user_bearer_token,
            user_principal=user_principal,
        )
        return {"status": "UP" if 200 <= status_code < 300 else "DOWN", "details": response}

    def list_applications(
        self,
        user_bearer_token: Optional[str] = None,
        user_principal: Optional[str] = None,
    ) -> List[dict]:
        if self.mode == "stub":
            raise RuntimeError("Spinnaker stub mode disabled; set DXCP_SPINNAKER_MODE=http")
        if not self.base_url:
            raise RuntimeError("Spinnaker base URL is required for HTTP mode")
        # Expand application details so tag metadata is included for filtering.
        url = f"{self.base_url.rstrip('/')}/applications?expand=true"
        payload, _, _ = self._request_json(
            "GET",
            url,
            operation="list_applications",
            user_bearer_token=user_bearer_token,
            user_principal=user_principal,
        )
        if isinstance(payload, list):
            return payload
        return []

    def list_pipeline_configs(
        self,
        application: str,
        user_bearer_token: Optional[str] = None,
        user_principal: Optional[str] = None,
    ) -> List[dict]:
        if self.mode == "stub":
            raise RuntimeError("Spinnaker stub mode disabled; set DXCP_SPINNAKER_MODE=http")
        if not self.base_url:
            raise RuntimeError("Spinnaker base URL is required for HTTP mode")
        url = f"{self.base_url.rstrip('/')}/applications/{application}/pipelineConfigs"
        payload, _, _ = self._request_json(
            "GET",
            url,
            operation="list_pipeline_configs",
            user_bearer_token=user_bearer_token,
            user_principal=user_principal,
        )
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

    def _http_trigger(
        self,
        kind: str,
        payload: dict,
        idempotency_key: str,
        user_bearer_token: Optional[str] = None,
        user_principal: Optional[str] = None,
    ) -> dict:
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
            "user": self._resolve_trigger_user(
                user_bearer_token=user_bearer_token,
                user_principal=user_principal,
            ),
            "parameters": params,
        }
        if idempotency_key:
            trigger["idempotencyKey"] = idempotency_key

        url = f"{self.base_url.rstrip('/')}/pipelines/{application}/{pipeline}"
        response, status_code, headers = self._request_json(
            "POST",
            url,
            trigger,
            operation=f"trigger_{kind}",
            user_bearer_token=user_bearer_token,
            user_principal=user_principal,
        )
        execution_id = self._extract_execution_id(response)
        if not execution_id:
            correlation_id = self._extract_correlation_id(response, headers)
            response_snippet = ""
            if isinstance(response, dict):
                try:
                    response_snippet = self._safe_snippet(json.dumps(response, separators=(",", ":"), default=str))
                except Exception:
                    response_snippet = self._safe_snippet(str(response))
            self._logger.warning(
                "spinnaker.trigger_missing_execution_id kind=%s status=%s app=%s pipeline=%s correlation_id=%s response=%s",
                kind,
                status_code,
                application,
                pipeline,
                correlation_id or "none",
                redact_text(response_snippet) if response_snippet else "none",
            )
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

    def _http_get_execution(
        self,
        execution_id: str,
        user_bearer_token: Optional[str] = None,
        user_principal: Optional[str] = None,
    ) -> dict:
        if not self.base_url:
            raise RuntimeError("Spinnaker base URL is required for HTTP mode")
        url = f"{self.base_url.rstrip('/')}/pipelines/{execution_id}"
        try:
            execution, _, _ = self._request_json(
                "GET",
                url,
                operation="get_execution",
                user_bearer_token=user_bearer_token,
                user_principal=user_principal,
            )
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
            bucket, key = parse_s3_artifact_ref(artifact_ref, _ALLOWED_ARTIFACT_SCHEMES)
            params["s3Bucket"] = bucket
            params["s3Key"] = key
        return params

    def _request_json(
        self,
        method: str,
        url: str,
        body: Optional[dict] = None,
        operation: str = "request",
        timeout_seconds: Optional[float] = None,
        user_bearer_token: Optional[str] = None,
        user_principal: Optional[str] = None,
    ) -> tuple[dict, int, dict]:
        data = None
        headers = {"Content-Type": "application/json"}
        auth_header = self._auth_header_override.get() or self._spinnaker_auth_header()
        auth_header_name = "none"
        if auth_header:
            auth_header_name, auth_header_value = auth_header
            headers[auth_header_name] = auth_header_value
        token = (user_bearer_token or "").strip()
        # Trust boundary:
        # - mTLS authenticates DXCP (machine identity) to machine Gate.
        # - X-Spinnaker-User carries end-user attribution for governance/audit.
        # End-user Authorization bearer tokens are not forwarded to machine Gate.
        if token and not auth_header and self._gate_ssl_context is None:
            headers["Authorization"] = f"Bearer {token}"
        principal_override = (user_principal or "").strip()
        if self._gate_ssl_context is not None and not principal_override:
            raise RuntimeError(
                "Spinnaker user attribution missing for machine Gate call: X-Spinnaker-User is required"
            )
        if principal_override:
            spinnaker_user = principal_override
        elif token:
            spinnaker_user = self._principal_from_auth_header("Authorization", f"Bearer {token}")
        else:
            principal_header_name = "Authorization" if headers.get("Authorization") else auth_header_name
            principal_header_value = headers.get("Authorization") or (auth_header[1] if auth_header else "")
            spinnaker_user = self._principal_from_auth_header(principal_header_name, principal_header_value)
        if spinnaker_user:
            headers.setdefault("X-Spinnaker-User", spinnaker_user)
        parsed_url = urlparse(url)
        self._logger.info(
            "spinnaker.request_context gate_base_url=%s method=%s path=%s principal=%s",
            redact_url(self.base_url),
            method,
            parsed_url.path or "/",
            redact_text(spinnaker_user),
        )
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
            effective_timeout = self.request_timeout_seconds if timeout_seconds is None else timeout_seconds
            response_ctx = self._open_url(
                request,
                timeout_seconds=effective_timeout,
                follow_redirects=False,
                use_gate_tls=True,
            )
            with response_ctx as response:
                status_code = response.status
                response_headers = dict(response.headers.items())
                payload = response.read().decode("utf-8")
        except HTTPError as exc:
            latency_ms = (time.monotonic() - start) * 1000
            detail = exc.read().decode("utf-8") if exc.fp else ""
            response_headers = dict(exc.headers.items()) if exc.headers else {}
            correlation_id = self._extract_correlation_id({}, response_headers)
            if 300 <= exc.code < 400:
                location = str(response_headers.get("Location") or "").strip()
                redirect_class = self._redirect_location_classification(url, location)
                message = f"Spinnaker redirect blocked (HTTP {exc.code})"
                request_path = parsed_url.path or "/"
                message = (
                    f"{message}; gate_base_url={redact_url(self.base_url)}; request_path={request_path}"
                )
                if location:
                    if location.lower().startswith("http://") or location.lower().startswith("https://"):
                        message = f"{message}; location={redact_url(location)}"
                    else:
                        message = f"{message}; location={location}"
                    if redirect_class:
                        message = f"{message}; redirect_class={redirect_class}"
            else:
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
                auth_header_name,
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
                auth_header_name,
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
            auth_header_name,
        )
        if not payload:
            return {}, status_code, response_headers
        try:
            return json.loads(payload), status_code, response_headers
        except json.JSONDecodeError:
            return {}, status_code, response_headers

    @contextmanager
    def request_auth_header(self, header_name: str, header_value: str):
        token = self._auth_header_override.set((header_name, header_value))
        try:
            yield
        finally:
            self._auth_header_override.reset(token)

    def _spinnaker_auth_header(self) -> Optional[tuple[str, str]]:
        has_explicit_header = bool(self.header_name and self.header_value)
        has_any_auth0 = any(
            [
                self.auth0_domain,
                self.auth0_client_id,
                self.auth0_client_secret,
                self.auth0_audience,
            ]
        )
        # mTLS machine endpoints should rely on cert-based trust plus explicit user context,
        # not bearer authorization forwarding.
        if self._gate_ssl_context is not None:
            if has_explicit_header and self.header_name.lower() != "authorization":
                return self.header_name, self.header_value
            return None
        # Prefer managed Auth0 token minting when configured.
        # This avoids stale/manual header values silently overriding rotation config.
        if has_any_auth0:
            if not all(
                [
                    self.auth0_domain,
                    self.auth0_client_id,
                    self.auth0_client_secret,
                    self.auth0_audience,
                ]
            ):
                raise RuntimeError("Spinnaker auth config incomplete: set all auth0 fields or none")
            token = self._get_or_mint_gate_access_token()
            header_name = self.header_name or "Authorization"
            if header_name.lower() == "authorization":
                return header_name, f"Bearer {token}"
            # Some deployments terminate/authenticate upstream with a non-standard header.
            # Preserve that contract when explicitly configured.
            return header_name, token
        if has_explicit_header:
            return self.header_name, self.header_value
        if not has_any_auth0:
            return None
        return None

    def _auth_mode_label(self) -> str:
        has_explicit_header = bool(self.header_name and self.header_value)
        has_any_auth0 = any(
            [
                self.auth0_domain,
                self.auth0_client_id,
                self.auth0_client_secret,
                self.auth0_audience,
            ]
        )
        if has_any_auth0:
            return "auth0"
        if has_explicit_header:
            return "static_header"
        return "none"

    def _resolve_trigger_user(
        self,
        user_bearer_token: Optional[str] = None,
        user_principal: Optional[str] = None,
    ) -> str:
        explicit_principal = (user_principal or "").strip()
        if explicit_principal:
            return explicit_principal
        token = (user_bearer_token or "").strip()
        if token:
            principal = self._principal_from_auth_header("Authorization", f"Bearer {token}")
            if principal:
                return principal
        auth_header = self._auth_header_override.get() or self._spinnaker_auth_header()
        if auth_header:
            header_name, header_value = auth_header
            if header_name.lower() == "x-spinnaker-user":
                explicit_user = (header_value or "").strip()
                if explicit_user:
                    return explicit_user
            principal = self._principal_from_auth_header(header_name, header_value)
            if principal:
                return principal
        return "dxcp"

    def _principal_from_auth_header(self, header_name: str, header_value: str) -> str:
        if not header_name or header_name.lower() != "authorization":
            return ""
        if not header_value:
            return ""
        raw = header_value.strip()
        if not raw.lower().startswith("bearer "):
            return ""
        token = raw[len("bearer "):].strip()
        if not token:
            return ""
        payload = _decode_jwt_payload(token)
        if not payload:
            return ""
        principal = str(payload.get("email") or payload.get("sub") or "").strip()
        return principal

    def _get_or_mint_gate_access_token(self) -> str:
        now = int(time.time())
        if self._cached_access_token and now < max(0, self._cached_access_token_exp_epoch - self.auth0_refresh_skew_seconds):
            return self._cached_access_token
        token, expires_in = self._mint_gate_access_token()
        if not token:
            raise RuntimeError("Spinnaker auth token mint failed: empty access_token")
        exp_epoch = now + max(60, expires_in)
        jwt_exp = _jwt_exp_epoch(token)
        if jwt_exp is not None:
            exp_epoch = jwt_exp
        self._cached_access_token = token
        self._cached_access_token_exp_epoch = exp_epoch
        self._logger.info(
            "spinnaker.auth token_refreshed expires_at=%s",
            datetime.fromtimestamp(exp_epoch, tz=timezone.utc).isoformat().replace("+00:00", "Z"),
        )
        return token

    def _mint_gate_access_token(self) -> tuple[str, int]:
        if not self.auth0_domain:
            raise RuntimeError("Spinnaker auth token mint failed: auth0_domain is required")
        if not self.auth0_client_id:
            raise RuntimeError("Spinnaker auth token mint failed: auth0_client_id is required")
        if not self.auth0_client_secret:
            raise RuntimeError("Spinnaker auth token mint failed: auth0_client_secret is required")
        if not self.auth0_audience:
            raise RuntimeError("Spinnaker auth token mint failed: auth0_audience is required")

        domain = self.auth0_domain.replace("https://", "").replace("http://", "").strip().rstrip("/")
        token_url = f"https://{domain}/oauth/token"
        payload = {
            "grant_type": "client_credentials",
            "client_id": self.auth0_client_id,
            "client_secret": self.auth0_client_secret,
            "audience": self.auth0_audience,
        }
        if self.auth0_scope:
            payload["scope"] = self.auth0_scope
        response, _, _ = self._request_json_no_auth("POST", token_url, payload, operation="mint_gate_token")
        token = str(response.get("access_token") or "").strip() if isinstance(response, dict) else ""
        expires_in_raw = response.get("expires_in") if isinstance(response, dict) else None
        try:
            expires_in = int(expires_in_raw)
        except (TypeError, ValueError):
            expires_in = 3600
        return token, expires_in

    def _request_json_no_auth(
        self,
        method: str,
        url: str,
        body: Optional[dict] = None,
        operation: str = "request_no_auth",
        timeout_seconds: Optional[float] = None,
    ) -> tuple[dict, int, dict]:
        data = None
        headers = {"Content-Type": "application/json"}
        if body is not None:
            data = json.dumps(body).encode("utf-8")
        request = Request(url, data=data, headers=headers, method=method)
        start = time.monotonic()
        try:
            effective_timeout = self.request_timeout_seconds if timeout_seconds is None else timeout_seconds
            response_ctx = self._open_url(
                request,
                timeout_seconds=effective_timeout,
                follow_redirects=True,
                use_gate_tls=False,
            )
            with response_ctx as response:
                status_code = response.status
                response_headers = dict(response.headers.items())
                payload = response.read().decode("utf-8")
        except HTTPError as exc:
            latency_ms = (time.monotonic() - start) * 1000
            detail = exc.read().decode("utf-8") if exc.fp else ""
            snippet = self._safe_snippet(detail)
            message = f"Auth0 token HTTP {exc.code}: {snippet}" if snippet else f"Auth0 token HTTP {exc.code}"
            self._logger.warning(
                "spinnaker.auth token_request_failed status=%s latency_ms=%.1f error=%s",
                exc.code,
                latency_ms,
                redact_text(message),
            )
            raise RuntimeError(redact_text(message)) from exc
        except URLError as exc:
            latency_ms = (time.monotonic() - start) * 1000
            self._logger.warning(
                "spinnaker.auth token_request_failed status=error latency_ms=%.1f error=%s",
                latency_ms,
                redact_text(str(exc.reason)),
            )
            raise RuntimeError(redact_text(f"Auth0 token connection failed: {exc.reason}")) from exc
        if not payload:
            return {}, status_code, response_headers
        try:
            return json.loads(payload), status_code, response_headers
        except json.JSONDecodeError:
            return {}, status_code, response_headers

    def _build_gate_ssl_context(self) -> Optional[ssl.SSLContext]:
        cert = self.mtls_cert_path
        key = self.mtls_key_path
        ca = self.mtls_ca_path
        uses_https = self.base_url.strip().lower().startswith("https://")
        has_mtls_config = bool(cert or key or ca or self.mtls_server_name)
        if not uses_https or not has_mtls_config:
            return None
        if bool(cert) != bool(key):
            raise RuntimeError("Spinnaker mTLS config invalid: cert and key must both be set")
        try:
            context = ssl.create_default_context()
            context.check_hostname = True
            context.verify_mode = ssl.CERT_REQUIRED
            if ca:
                context.load_verify_locations(cafile=ca)
            if cert and key:
                context.load_cert_chain(certfile=cert, keyfile=key)
        except Exception as exc:
            raise RuntimeError(f"Spinnaker mTLS context initialization failed: {exc}") from exc
        return context

    def _open_url(
        self,
        request: Request,
        timeout_seconds: Optional[float],
        follow_redirects: bool,
        use_gate_tls: bool,
    ):
        handlers = []
        if not follow_redirects:
            handlers.append(_NoRedirectHandler())
        if use_gate_tls and self._gate_ssl_context is not None:
            if self.mtls_server_name:
                handlers.append(
                    _ServerNameHTTPSHandler(
                        context=self._gate_ssl_context,
                        server_name=self.mtls_server_name,
                    )
                )
            else:
                handlers.append(HTTPSHandler(context=self._gate_ssl_context))
        if handlers:
            opener = build_opener(*handlers)
            if timeout_seconds is None:
                return opener.open(request)
            return opener.open(request, timeout=timeout_seconds)
        if timeout_seconds is None:
            return urlopen(request)
        return urlopen(request, timeout=timeout_seconds)

    def _should_retry_without_user_token_on_redirect(self, request_url: str, location: str) -> bool:
        if not location:
            return False
        if self._gate_ssl_context is None:
            return False
        try:
            src = urlparse(request_url)
            target = urlparse(location)
        except Exception:
            return False
        if target.scheme.lower() != "https":
            return False
        src_host = (src.hostname or "").lower()
        target_host = (target.hostname or "").lower()
        src_port = src.port or (443 if src.scheme.lower() == "https" else 80)
        target_port = target.port or (443 if target.scheme.lower() == "https" else 80)
        return bool(src_host and target_host and src_host == target_host and src_port == target_port)

    def _canonical_redirect_target(self, request_url: str, location: str) -> Optional[str]:
        if not location:
            return None
        try:
            src = urlparse(request_url)
            target = urlparse(urljoin(request_url, location))
        except Exception:
            return None
        if src.scheme.lower() != "https" or target.scheme.lower() != "https":
            return None
        src_host = (src.hostname or "").lower()
        target_host = (target.hostname or "").lower()
        if not src_host or src_host != target_host:
            return None
        target_path = target.path or "/"
        lowered_path = target_path.lower()
        # Never follow browser auth redirects on machine-to-machine Gate calls.
        if lowered_path.startswith("/oauth2/") or lowered_path.startswith("/login") or lowered_path.startswith("/auth"):
            return None
        # Only follow redirects that stay in known Gate API path families.
        allowed_prefixes = (
            "/health",
            "/applications",
            "/pipelineconfigs",
            "/pipelines",
            "/gate/health",
            "/gate/applications",
            "/gate/pipelineconfigs",
            "/gate/pipelines",
        )
        if not lowered_path.startswith(allowed_prefixes):
            return None
        src_port = src.port or 443
        target_port = target.port or 443
        if src_port == target_port and (src.path or "/") == target_path and (src.query or "") == (target.query or ""):
            return None
        return target.geturl()

    def _redirect_location_classification(self, request_url: str, location: str) -> str:
        try:
            target = urlparse(urljoin(request_url, location))
        except Exception:
            return "other"
        path = (target.path or "/").lower()
        if path.startswith("/oauth2/") or path.startswith("/login") or path.startswith("/auth"):
            return "oauth_login"
        if path.startswith("/gate/") or path.startswith("/pipelines") or path.startswith("/applications") or path.startswith("/health"):
            return "gate_api"
        return "other"

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


def _jwt_exp_epoch(token: str) -> Optional[int]:
    parsed = _decode_jwt_payload(token)
    if not parsed:
        return None
    exp = parsed.get("exp")
    if isinstance(exp, int):
        return exp
    try:
        return int(exp)
    except (TypeError, ValueError):
        return None


def _decode_jwt_payload(token: str) -> Optional[dict]:
    if not token or token.count(".") < 2:
        return None
    parts = token.split(".")
    if len(parts) < 2:
        return None
    payload = parts[1]
    payload += "=" * (-len(payload) % 4)
    try:
        decoded = base64.urlsafe_b64decode(payload.encode("ascii")).decode("utf-8")
        parsed = json.loads(decoded)
    except Exception:
        return None
    if not isinstance(parsed, dict):
        return None
    return parsed


class _NoRedirectHandler(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class _ServerNameHTTPSConnection(HTTPSConnection):
    def __init__(self, *args, server_name: str, **kwargs):
        self._server_name_override = server_name
        super().__init__(*args, **kwargs)

    def connect(self):
        self.sock = self._create_connection(
            (self.host, self.port),
            self.timeout,
            self.source_address,
        )
        if self._tunnel_host:
            self._tunnel()
        server_hostname = self._server_name_override if self._context.check_hostname else None
        self.sock = self._context.wrap_socket(self.sock, server_hostname=server_hostname)


class _ServerNameHTTPSHandler(HTTPSHandler):
    def __init__(self, context: ssl.SSLContext, server_name: str):
        super().__init__(context=context)
        self._context = context
        self._server_name = server_name

    def https_open(self, req):
        return self.do_open(
            lambda host, **kwargs: _ServerNameHTTPSConnection(
                host,
                context=self._context,
                server_name=self._server_name,
                **kwargs,
            ),
            req,
        )


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
