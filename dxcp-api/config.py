import os
import json
from typing import Callable, Optional

from models import CiPublisher, CiPublisherProvider


class Settings:
    def __init__(self) -> None:
        self.ssm_prefix = os.getenv("DXCP_SSM_PREFIX", "")
        legacy_kill_switch = self._as_bool(self._get("kill_switch", "DXCP_KILL_SWITCH", "0", str))
        mutations_disabled_raw = self._get("mutations_disabled", "DXCP_MUTATIONS_DISABLED", None, str)
        if mutations_disabled_raw is None:
            self.mutations_disabled = legacy_kill_switch
        else:
            self.mutations_disabled = self._as_bool(mutations_disabled_raw)
        # Backward-compatible alias used by older call sites.
        self.kill_switch = self.mutations_disabled
        self.demo_mode = self._get("demo_mode", "DXCP_DEMO_MODE", "true", str) in ["1", "true", "TRUE", "True"]
        self.db_path = os.getenv("DXCP_DB_PATH", "./data/dxcp.db")

        self.read_rpm = self._get("read_rpm", "DXCP_READ_RPM", 60, int)
        self.mutate_rpm = self._get("mutate_rpm", "DXCP_MUTATE_RPM", 10, int)

        self.daily_quota_deploy = self._get("daily_quota_deploy", "DXCP_DAILY_QUOTA_DEPLOY", 25, int)
        self.daily_quota_rollback = self._get("daily_quota_rollback", "DXCP_DAILY_QUOTA_ROLLBACK", 10, int)
        self.daily_quota_build_register = self._get("daily_quota_build_register", "DXCP_DAILY_QUOTA_BUILD_REGISTER", 50, int)
        self.daily_quota_upload_capability = self._get(
            "daily_quota_upload_capability", "DXCP_DAILY_QUOTA_UPLOAD_CAPABILITY", 50, int
        )

        self.idempotency_ttl_seconds = self._get("idempotency_ttl_seconds", "DXCP_IDEMPOTENCY_TTL_SECONDS", 24 * 60 * 60, int)
        self.max_artifact_size_bytes = self._get(
            "max_artifact_size_bytes", "DXCP_MAX_ARTIFACT_SIZE_BYTES", 200 * 1024 * 1024, int
        )
        content_types = self._get("allowed_content_types", "DXCP_ALLOWED_CONTENT_TYPES", "application/zip,application/gzip", str)
        self.allowed_content_types = [c.strip() for c in content_types.split(",") if c.strip()]

        self.spinnaker_mode = os.getenv("DXCP_SPINNAKER_MODE", "http")
        self.spinnaker_base_url = self._get("spinnaker_gate_url", "DXCP_SPINNAKER_GATE_URL", "", str)
        self.spinnaker_application = self._get(
            "spinnaker_application",
            "DXCP_SPINNAKER_APPLICATION",
            "",
            str,
        )
        self.spinnaker_header_name = self._get("spinnaker_gate_header_name", "DXCP_SPINNAKER_GATE_HEADER_NAME", "", str)
        self.spinnaker_header_value = self._get(
            "spinnaker_gate_header_value", "DXCP_SPINNAKER_GATE_HEADER_VALUE", "", str
        )
        self.engine_lambda_url = self._get("engine/lambda/url", "DXCP_ENGINE_LAMBDA_URL", "", str)
        self.engine_lambda_token = self._resolve_secret(
            self._get("engine/lambda/token", "DXCP_ENGINE_LAMBDA_TOKEN", "", str)
        )
        self.oidc_issuer = self._get("oidc/issuer", "DXCP_OIDC_ISSUER", "", str)
        self.oidc_audience = self._get("oidc/audience", "DXCP_OIDC_AUDIENCE", "", str)
        self.oidc_jwks_url = self._get("oidc/jwks_url", "DXCP_OIDC_JWKS_URL", "", str)
        self.oidc_roles_claim = self._get(
            "oidc/roles_claim",
            "DXCP_OIDC_ROLES_CLAIM",
            "https://dxcp.example/claims/roles",
            str,
        )
        ci_publishers = self._get("ci_publishers", "DXCP_CI_PUBLISHERS", "", str)
        self.ci_publishers = self._parse_ci_publishers(ci_publishers)
        cors = os.getenv("DXCP_CORS_ORIGINS", "http://127.0.0.1:5173,http://localhost:5173")
        self.cors_origins = [o.strip() for o in cors.split(",") if o.strip()]
        self.ui_default_refresh_seconds = self._get(
            "ui_default_refresh_seconds",
            "DXCP_UI_DEFAULT_REFRESH_SECONDS",
            300,
            int,
        )
        self.ui_min_refresh_seconds = self._get(
            "ui_min_refresh_seconds",
            "DXCP_UI_MIN_REFRESH_SECONDS",
            60,
            int,
        )
        self.ui_max_refresh_seconds = self._get(
            "ui_max_refresh_seconds",
            "DXCP_UI_MAX_REFRESH_SECONDS",
            3600,
            int,
        )
        self.service_registry_path = os.getenv("DXCP_SERVICE_REGISTRY_PATH", "./data/services.json")
        self.runtime_artifact_bucket = os.getenv("DXCP_RUNTIME_ARTIFACT_BUCKET", "")
        if not self.runtime_artifact_bucket and self.ssm_prefix:
            value = self._read_ssm(f"{self.ssm_prefix}/runtime/artifact_bucket")
            if value:
                self.runtime_artifact_bucket = value
        artifact_schemes = self._get("artifact_ref_schemes", "DXCP_ARTIFACT_REF_SCHEMES", "s3", str)
        self.artifact_ref_schemes = [s.strip().lower() for s in artifact_schemes.split(",") if s.strip()]
        promotion_order = self._get(
            "promotion_environment_order",
            "DXCP_PROMOTION_ENVIRONMENT_ORDER",
            "sandbox,dev,staging,prod",
            str,
        )
        self.promotion_environment_order = [item.strip() for item in promotion_order.split(",") if item.strip()]
        self.promotion_allow_jumps = self._get(
            "promotion_allow_jumps",
            "DXCP_PROMOTION_ALLOW_JUMPS",
            "0",
            str,
        ) in ["1", "true", "TRUE", "True"]

    def _as_bool(self, value: object) -> bool:
        text = str(value or "").strip().lower()
        return text in {"1", "true", "yes", "on"}

    def _get(self, ssm_key: str, env_key: str, default, parser: Callable) -> Optional[object]:
        if env_key in os.environ:
            try:
                return parser(os.environ[env_key])
            except ValueError:
                return default
        if self.ssm_prefix:
            value = self._read_ssm(f"{self.ssm_prefix}/{ssm_key}")
            if value is not None:
                try:
                    return parser(value)
                except ValueError:
                    return default
        return default

    def _read_ssm(self, name: str) -> Optional[str]:
        try:
            import boto3
            from botocore.exceptions import ClientError
        except Exception:
            return None
        try:
            client = boto3.client("ssm")
            response = client.get_parameter(Name=name, WithDecryption=True)
            return response.get("Parameter", {}).get("Value")
        except ClientError:
            return None

    def _resolve_secret(self, value: Optional[str]) -> Optional[str]:
        if not isinstance(value, str):
            return value
        if not value.startswith("arn:aws:secretsmanager:"):
            return value
        try:
            import boto3
        except Exception:
            return value
        try:
            client = boto3.client("secretsmanager")
            response = client.get_secret_value(SecretId=value)
            return response.get("SecretString", value)
        except Exception:
            return value

    def _parse_ci_publishers(self, value: Optional[str]) -> list[CiPublisher]:
        raw = str(value or "").strip()
        if not raw:
            return []
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            parsed = []
        if not isinstance(parsed, list):
            return []
        publishers: list[CiPublisher] = []
        for item in parsed:
            if isinstance(item, CiPublisher):
                publishers.append(item)
                continue
            if isinstance(item, dict):
                payload = dict(item)
                if "provider" not in payload:
                    payload["provider"] = CiPublisherProvider.CUSTOM.value
                try:
                    publishers.append(CiPublisher(**payload))
                except Exception:
                    continue
                continue
            if isinstance(item, str):
                normalized = item.strip()
                if not normalized:
                    continue
                publishers.append(
                    CiPublisher(
                        name=normalized,
                        provider=CiPublisherProvider.CUSTOM,
                        subjects=[normalized],
                    )
                )
        return publishers


SETTINGS = Settings()
