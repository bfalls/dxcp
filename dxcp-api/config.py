import os


class Settings:
    def __init__(self) -> None:
        self.api_token = os.getenv("DXCP_API_TOKEN", "")
        allowlist = os.getenv("DXCP_ALLOWLIST", "demo-service")
        self.allowlisted_services = [s.strip() for s in allowlist.split(",") if s.strip()]
        self.kill_switch = os.getenv("DXCP_KILL_SWITCH", "0") == "1"
        self.db_path = os.getenv("DXCP_DB_PATH", "./data/dxcp.db")

        self.read_rpm = 60
        self.mutate_rpm = 10

        self.daily_quota_deploy = 25
        self.daily_quota_rollback = 10
        self.daily_quota_build_register = 50
        self.daily_quota_upload_capability = 50

        self.idempotency_ttl_seconds = 24 * 60 * 60
        self.max_artifact_size_bytes = 200 * 1024 * 1024
        self.allowed_content_types = ["application/zip", "application/gzip"]

        self.spinnaker_mode = os.getenv("DXCP_SPINNAKER_MODE", "stub")
        self.spinnaker_base_url = os.getenv("DXCP_SPINNAKER_BASE_URL", "")


SETTINGS = Settings()
