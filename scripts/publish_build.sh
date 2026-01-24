#!/usr/bin/env bash
set -euo pipefail

API_BASE=${DXCP_API_BASE:-http://127.0.0.1:8000/v1}
API_TOKEN=${DXCP_API_TOKEN:-demo-token}
SERVICE=${DXCP_SERVICE:-demo-service}
CONTENT_TYPE=application/gzip

if [[ -n "${1-}" ]]; then
  VERSION="$1"
else
  VERSION="1.0.0-$(date +%Y%m%d%H%M%S)"
fi

WORKDIR=$(cd "$(dirname "$0")/.." && pwd)
SERVICE_DIR="$WORKDIR/demo-service"
BUILD_DIR="$WORKDIR/demo-service/build"
ARTIFACT="$BUILD_DIR/${SERVICE}-${VERSION}.tar.gz"

mkdir -p "$BUILD_DIR"

echo "$VERSION" > "$SERVICE_DIR/VERSION"

tar -czf "$ARTIFACT" -C "$SERVICE_DIR" app.py VERSION

SIZE_BYTES=$(wc -c < "$ARTIFACT" | tr -d ' ')
SHA256=$(shasum -a 256 "$ARTIFACT" | awk '{print $1}')

UPLOAD_KEY="upload-${VERSION}"
REGISTER_KEY="register-${VERSION}"

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
  "artifactRef": "local:${ARTIFACT}",
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

echo "Build artifact: ${ARTIFACT}"
