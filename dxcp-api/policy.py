import re
from typing import Optional
from config import SETTINGS


VERSION_PATTERN = re.compile(r"^[0-9]+\.[0-9]+\.[0-9]+(-[A-Za-z0-9.-]+)?$")
SHA256_PATTERN = re.compile(r"^[A-Fa-f0-9]{64}$")


class PolicyError(Exception):
    def __init__(self, status_code: int, code: str, message: str) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message


class Guardrails:
    def __init__(self, storage) -> None:
        self.storage = storage

    def require_mutations_enabled(self) -> None:
        if SETTINGS.kill_switch:
            raise PolicyError(503, "MUTATIONS_DISABLED", "Mutating operations are disabled")

    def require_idempotency_key(self, key: Optional[str]) -> None:
        if not key:
            raise PolicyError(400, "IDMP_KEY_REQUIRED", "Idempotency-Key is required")

    def validate_service(self, service: str) -> dict:
        entry = self.storage.get_service(service)
        if not entry:
            raise PolicyError(403, "SERVICE_NOT_ALLOWLISTED", "Service is not allowlisted")
        return entry

    def validate_environment(self, env: str, service_entry: dict) -> None:
        if env != "sandbox":
            raise PolicyError(400, "INVALID_ENVIRONMENT", "Only sandbox environment is supported")
        allowed = service_entry.get("allowed_environments", [])
        if env not in allowed:
            raise PolicyError(400, "INVALID_ENVIRONMENT", "Environment not allowed for service")

    def validate_version(self, version: str) -> None:
        if not VERSION_PATTERN.match(version):
            raise PolicyError(400, "INVALID_REQUEST", "Version format is invalid")

    def validate_artifact(self, size_bytes: int, sha256: str, content_type: str) -> None:
        if size_bytes > SETTINGS.max_artifact_size_bytes:
            raise PolicyError(400, "INVALID_ARTIFACT", "Artifact size exceeds limit")
        if not SHA256_PATTERN.match(sha256):
            raise PolicyError(400, "INVALID_ARTIFACT", "Artifact checksum must be sha256")
        if content_type not in SETTINGS.allowed_content_types:
            raise PolicyError(400, "INVALID_ARTIFACT", "Artifact content type not allowlisted")

    def validate_artifact_source(self, artifact_ref: str, service_entry: dict) -> None:
        if SETTINGS.runtime_artifact_bucket:
            bucket = SETTINGS.runtime_artifact_bucket
            prefixes = [f"s3://{bucket}", f"s3://{bucket}/"]
            if any(artifact_ref.startswith(prefix) for prefix in prefixes):
                return
            raise PolicyError(400, "INVALID_ARTIFACT", "Artifact source not allowlisted")

        allowed = service_entry.get("allowed_artifact_sources", [])
        if not allowed:
            return
        for prefix in allowed:
            if artifact_ref.startswith(prefix):
                return
        raise PolicyError(400, "INVALID_ARTIFACT", "Artifact source not allowlisted")

    def enforce_global_lock(self) -> None:
        if self.storage.has_active_deployment():
            raise PolicyError(409, "DEPLOYMENT_LOCKED", "Another deployment is active")

    def enforce_delivery_group_lock(self, group_id: str, max_concurrent: int) -> None:
        if max_concurrent < 1:
            max_concurrent = 1
        active = self.storage.count_active_deployments_for_group(group_id)
        if active >= max_concurrent:
            raise PolicyError(
                409,
                "DEPLOYMENT_LOCKED",
                f"Delivery group {group_id} has active deployments",
            )
