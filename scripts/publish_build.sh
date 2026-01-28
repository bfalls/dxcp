#!/usr/bin/env bash
set -euo pipefail

API_BASE=${DXCP_API_BASE:-http://127.0.0.1:8000/v1}
API_TOKEN=${DXCP_API_TOKEN:-demo-token}
SERVICE=${DXCP_SERVICE:-demo-service}
CONTENT_TYPE=application/zip

if [[ -n "${1-}" ]]; then
  VERSION="$1"
else
  VERSION="1.0.0-$(date +%Y%m%d%H%M%S)"
fi

WORKDIR=$(cd "$(dirname "$0")/.." && pwd)
SERVICE_DIR="$WORKDIR/$SERVICE"
BUILD_DIR="$SERVICE_DIR/build"
ARTIFACT="$BUILD_DIR/${SERVICE}-${VERSION}.zip"
ARTIFACT_S3_KEY="${SERVICE}/${SERVICE}-${VERSION}.zip"
SERVICE_DIR_PY="$SERVICE_DIR"
ARTIFACT_PY="$ARTIFACT"
ARTIFACT_AWS="$ARTIFACT"
if command -v cygpath >/dev/null 2>&1; then
  SERVICE_DIR_PY="$(cygpath -w "$SERVICE_DIR")"
  ARTIFACT_PY="$(cygpath -w "$ARTIFACT")"
  ARTIFACT_AWS="$ARTIFACT_PY"
fi

mkdir -p "$BUILD_DIR"

echo "$VERSION" > "$SERVICE_DIR/VERSION"

python3 - <<PY
import zipfile
from pathlib import Path

service_dir = Path(r"$SERVICE_DIR_PY")
artifact = Path(r"$ARTIFACT_PY")
artifact.parent.mkdir(parents=True, exist_ok=True)
if artifact.exists():
    artifact.unlink()

files = [
    service_dir / "app.py",
    service_dir / "lambda_handler.py",
    service_dir / "VERSION",
]
missing = [str(f) for f in files if not f.exists()]
if missing:
    raise FileNotFoundError(f"Missing required files: {', '.join(missing)}")
with zipfile.ZipFile(artifact, "w", compression=zipfile.ZIP_DEFLATED) as zf:
    for file in files:
        zf.write(file, arcname=file.name)
PY

SIZE_BYTES=$(wc -c < "$ARTIFACT" | tr -d ' ')
SHA256=$(shasum -a 256 "$ARTIFACT" | awk '{print $1}')

ARTIFACT_BUCKET="${DXCP_RUNTIME_ARTIFACT_BUCKET:-}"
if [[ -z "$ARTIFACT_BUCKET" && -n "${DXCP_CONFIG_PREFIX:-}" ]] && command -v aws >/dev/null 2>&1; then
  ARTIFACT_BUCKET=$(aws ssm get-parameter --name "${DXCP_CONFIG_PREFIX}/runtime/artifact_bucket" --query Parameter.Value --output text 2>/dev/null || true)
fi
if [[ -z "$ARTIFACT_BUCKET" && -z "${DXCP_CONFIG_PREFIX:-}" ]] && command -v aws >/dev/null 2>&1; then
  ARTIFACT_BUCKET=$(aws ssm get-parameter --name "/dxcp/config/runtime/artifact_bucket" --query Parameter.Value --output text 2>/dev/null || true)
fi

IDEMPOTENCY_SUFFIX=""
if [[ "${DXCP_IDEMPOTENCY_RANDOMIZE:-}" == "1" ]]; then
  IDEMPOTENCY_SUFFIX="-$(python3 - <<'PY'
import uuid
print(uuid.uuid4().hex[:8])
PY
)"
fi
UPLOAD_KEY="upload-${VERSION}${IDEMPOTENCY_SUFFIX}"
REGISTER_KEY="register-${VERSION}${IDEMPOTENCY_SUFFIX}"

UPLOAD_PAYLOAD=$(cat <<JSON
{
  "service": "${SERVICE}",
  "version": "${VERSION}",
  "expectedSizeBytes": ${SIZE_BYTES},
  "expectedSha256": "${SHA256}",
  "contentType": "${CONTENT_TYPE}"
}
JSON
)

UPLOAD_RESPONSE=$(curl -s -X POST "${API_BASE}/builds/upload-capability" \
  -H "Authorization: Bearer ${API_TOKEN}" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: ${UPLOAD_KEY}" \
  -d "${UPLOAD_PAYLOAD}")

echo "Upload capability: ${UPLOAD_RESPONSE}"

REGISTER_PAYLOAD=$(cat <<JSON
{
  "service": "${SERVICE}",
  "version": "${VERSION}",
  "artifactRef": "$(if [[ -n "$ARTIFACT_BUCKET" ]]; then echo "s3://${ARTIFACT_BUCKET}/${ARTIFACT_S3_KEY}"; else echo "local:${ARTIFACT}"; fi)",
  "sha256": "${SHA256}",
  "sizeBytes": ${SIZE_BYTES},
  "contentType": "${CONTENT_TYPE}"
}
JSON
)

REGISTER_RESPONSE=$(curl -s -X POST "${API_BASE}/builds" \
  -H "Authorization: Bearer ${API_TOKEN}" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: ${REGISTER_KEY}" \
  -d "${REGISTER_PAYLOAD}")

echo "Build registered: ${REGISTER_RESPONSE}"

if command -v aws >/dev/null 2>&1; then
  if [[ -n "$ARTIFACT_BUCKET" ]]; then
    aws s3 cp "$ARTIFACT_AWS" "s3://${ARTIFACT_BUCKET}/${ARTIFACT_S3_KEY}" --content-type "${CONTENT_TYPE}"
    echo "S3 artifact: s3://${ARTIFACT_BUCKET}/${ARTIFACT_S3_KEY}"
  else
    echo "Skipping S3 upload; set DXCP_RUNTIME_ARTIFACT_BUCKET or DXCP_CONFIG_PREFIX to upload."
  fi
else
  echo "Skipping S3 upload; aws CLI not found."
fi

echo "Build artifact: ${ARTIFACT}"
