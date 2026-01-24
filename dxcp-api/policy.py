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

    def validate_service(self, service: str) -> None:
        if service not in SETTINGS.allowlisted_services:
            raise PolicyError(403, "SERVICE_NOT_ALLOWLISTED", "Service is not allowlisted")

    def validate_environment(self, env: str) -> None:
        if env != "sandbox":
            raise PolicyError(400, "INVALID_ENVIRONMENT", "Only sandbox environment is supported")

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

    def enforce_global_lock(self) -> None:
        if self.storage.has_active_deployment():
            raise PolicyError(409, "DEPLOYMENT_LOCKED", "Another deployment is active")
