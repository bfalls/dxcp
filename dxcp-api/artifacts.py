import re
from dataclasses import dataclass
from datetime import timezone
from typing import List, Optional

try:
    import boto3
except Exception:  # pragma: no cover - optional dependency for local mode
    boto3 = None


VERSION_PATTERN = re.compile(r"^[0-9]+\.[0-9]+\.[0-9]+(-[A-Za-z0-9.-]+)?$")


@dataclass
class BuildVersion:
    version: str
    artifact_ref: str
    size_bytes: Optional[int] = None
    last_modified: Optional[str] = None

    def to_dict(self) -> dict:
        return {
            "version": self.version,
            "artifactRef": self.artifact_ref,
            "sizeBytes": self.size_bytes,
            "lastModified": self.last_modified,
        }


class ArtifactSource:
    def list_versions(self, service: str) -> List[BuildVersion]:
        raise NotImplementedError


class S3ArtifactSource(ArtifactSource):
    def __init__(self, bucket: str) -> None:
        if not boto3:
            raise RuntimeError("boto3 is required for S3 artifact discovery")
        if not bucket:
            raise RuntimeError("Runtime artifact bucket is not configured")
        self.bucket = bucket
        self._client = boto3.client("s3")

    def list_versions(self, service: str) -> List[BuildVersion]:
        prefix = f"{service}/"
        paginator = self._client.get_paginator("list_objects_v2")
        versions: List[BuildVersion] = []
        for page in paginator.paginate(Bucket=self.bucket, Prefix=prefix):
            for obj in page.get("Contents", []):
                key = obj.get("Key", "")
                if not key.endswith(".zip"):
                    continue
                filename = key.split("/")[-1]
                expected_prefix = f"{service}-"
                if not filename.startswith(expected_prefix):
                    continue
                version = filename[len(expected_prefix) : -len(".zip")]
                if not VERSION_PATTERN.match(version):
                    continue
                last_modified = obj.get("LastModified")
                if last_modified is not None:
                    last_modified = last_modified.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
                versions.append(
                    BuildVersion(
                        version=version,
                        artifact_ref=f"s3://{self.bucket}/{key}",
                        size_bytes=obj.get("Size"),
                        last_modified=last_modified,
                    )
                )
        versions.sort(key=lambda item: semver_sort_key(item.version), reverse=True)
        return versions


def build_artifact_source(bucket: str) -> ArtifactSource:
    return S3ArtifactSource(bucket)


def semver_sort_key(version: str) -> tuple:
    parsed = _parse_semver(version)
    if not parsed:
        return (0, 0, 0, 0, [])
    major, minor, patch, prerelease = parsed
    if prerelease:
        prerelease_weight = 0
        prerelease_parts = [_semver_part_key(part) for part in prerelease.split(".")]
    else:
        prerelease_weight = 1
        prerelease_parts = []
    return (major, minor, patch, prerelease_weight, prerelease_parts)


def _parse_semver(version: str) -> Optional[tuple]:
    if not VERSION_PATTERN.match(version):
        return None
    if "-" in version:
        base, prerelease = version.split("-", 1)
    else:
        base, prerelease = version, ""
    parts = base.split(".")
    if len(parts) != 3:
        return None
    try:
        major, minor, patch = (int(part) for part in parts)
    except ValueError:
        return None
    return major, minor, patch, prerelease


def _semver_part_key(part: str) -> tuple:
    if part.isdigit():
        return (0, int(part))
    return (1, part)
