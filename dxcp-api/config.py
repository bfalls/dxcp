import os
from typing import Callable, Optional


class Settings:
    def __init__(self) -> None:
        self.ssm_prefix = os.getenv("DXCP_SSM_PREFIX", "")
        self.api_token = self._get("api_token", "DXCP_API_TOKEN", "", str)
        self.role = self._get("role", "DXCP_ROLE", "PLATFORM_ADMIN", str)
        self.kill_switch = self._get("kill_switch", "DXCP_KILL_SWITCH", "0", str) in ["1", "true", "TRUE", "True"]
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
        cors = os.getenv("DXCP_CORS_ORIGINS", "http://127.0.0.1:5173,http://localhost:5173")
        self.cors_origins = [o.strip() for o in cors.split(",") if o.strip()]
        self.service_registry_path = os.getenv("DXCP_SERVICE_REGISTRY_PATH", "./data/services.json")
        self.runtime_artifact_bucket = os.getenv("DXCP_RUNTIME_ARTIFACT_BUCKET", "")
        if not self.runtime_artifact_bucket and self.ssm_prefix:
            value = self._read_ssm(f"{self.ssm_prefix}/runtime/artifact_bucket")
            if value:
                self.runtime_artifact_bucket = value

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


SETTINGS = Settings()
