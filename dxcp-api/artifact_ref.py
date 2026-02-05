import re
from dataclasses import dataclass
from typing import Iterable


_URI_PATTERN = re.compile(r"^(?P<scheme>[a-z][a-z0-9+.-]*):\/\/(?P<opaque>.+)$", re.IGNORECASE)


@dataclass(frozen=True)
class ArtifactRef:
    scheme: str
    opaque: str


def parse_artifact_ref(value: str) -> ArtifactRef:
    if not isinstance(value, str) or not value.strip():
        raise ValueError("artifactRef must be a non-empty string")
    match = _URI_PATTERN.match(value.strip())
    if not match:
        raise ValueError("artifactRef must be a URI with scheme")
    scheme = match.group("scheme").lower()
    opaque = match.group("opaque")
    if not opaque:
        raise ValueError("artifactRef must include an opaque reference")
    return ArtifactRef(scheme=scheme, opaque=opaque)


def validate_artifact_ref_scheme(value: str, allowed_schemes: Iterable[str]) -> ArtifactRef:
    parsed = parse_artifact_ref(value)
    allowed = {scheme.strip().lower() for scheme in allowed_schemes if isinstance(scheme, str) and scheme.strip()}
    if parsed.scheme not in allowed:
        allowed_list = ", ".join(sorted(allowed)) or "none"
        raise ValueError(f"artifactRef scheme must be one of: {allowed_list}")
    return parsed


def parse_s3_artifact_ref(value: str, allowed_schemes: Iterable[str]) -> tuple[str, str]:
    parsed = validate_artifact_ref_scheme(value, allowed_schemes)
    if parsed.scheme != "s3":
        raise ValueError("artifactRef scheme must be s3")
    if "/" not in parsed.opaque:
        raise ValueError("artifactRef must include bucket and key")
    bucket, key = parsed.opaque.split("/", 1)
    if not bucket or not key:
        raise ValueError("artifactRef must include bucket and key")
    return bucket, key
