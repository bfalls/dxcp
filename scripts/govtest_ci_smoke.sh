#!/usr/bin/env bash
set -euo pipefail

required_vars=(
  DXCP_API_BASE
  GOV_AUTH0_DOMAIN
  GOV_AUTH0_AUDIENCE
  GOV_CI_CLIENT_ID
  GOV_CI_CLIENT_SECRET
  GOV_SMOKE_ARTIFACT_REF
)

for key in "${required_vars[@]}"; do
  if [[ -z "${!key:-}" ]]; then
    echo "Missing required env var: ${key}" >&2
    exit 1
  fi
done

api_base="${DXCP_API_BASE%/}"
if [[ "${api_base}" != */v1 ]]; then
  api_base="${api_base}/v1"
fi

timestamp="$(date -u +%s)"
run_suffix="$(printf "%06d" "$((timestamp % 1000000))")"
version="0.250.${run_suffix}"
idempotency_key="gov-ci-smoke-${timestamp}"
built_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
git_sha="${GOV_SMOKE_GIT_SHA:-0000000000000000000000000000000000000000}"
git_branch="${GOV_SMOKE_GIT_BRANCH:-main}"
ci_provider="${GOV_SMOKE_CI_PROVIDER:-github}"
ci_run_id="${GOV_SMOKE_CI_RUN_ID:-local-smoke-${timestamp}}"

echo "[INFO] Minting CI token from Auth0..."
token_response="$(curl -sS --fail --show-error -X POST "https://${GOV_AUTH0_DOMAIN}/oauth/token" \
  -H "Content-Type: application/json" \
  -d "{\"grant_type\":\"client_credentials\",\"audience\":\"${GOV_AUTH0_AUDIENCE}\",\"client_id\":\"${GOV_CI_CLIENT_ID}\",\"client_secret\":\"${GOV_CI_CLIENT_SECRET}\"}")"

ci_token="$(python3 - <<'PY' "${token_response}"
import json
import sys
payload = json.loads(sys.argv[1])
token = payload.get("access_token", "")
if not token:
    raise SystemExit("Auth0 token response missing access_token")
print(token)
PY
)"

echo "[INFO] Verifying CI identity via /v1/whoami..."
whoami="$(curl -sS --fail --show-error \
  -H "Authorization: Bearer ${ci_token}" \
  "${api_base}/whoami")"
echo "[INFO] whoami: ${whoami}"

payload="$(printf '{"service":"demo-service","version":"%s","artifactRef":"%s","git_sha":"%s","git_branch":"%s","ci_provider":"%s","ci_run_id":"%s","built_at":"%s"}' \
  "${version}" "${GOV_SMOKE_ARTIFACT_REF}" "${git_sha}" "${git_branch}" "${ci_provider}" "${ci_run_id}" "${built_at}")"

body_file="$(mktemp)"
headers_file="$(mktemp)"
trap 'rm -f "${body_file}" "${headers_file}"' EXIT

echo "[INFO] Registering build version=${version}..."
status="$(curl -sS --show-error -X POST "${api_base}/builds/register" \
  -H "Authorization: Bearer ${ci_token}" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: ${idempotency_key}" \
  -d "${payload}" \
  -D "${headers_file}" \
  -o "${body_file}" \
  -w "%{http_code}")"

if [[ "${status}" != "201" ]]; then
  echo "[ERROR] Expected HTTP 201, got ${status}" >&2
  cat "${body_file}" >&2
  exit 1
fi

ci_publisher="$(python3 - <<'PY' "${body_file}"
import json
import sys
with open(sys.argv[1], "r", encoding="utf-8") as fh:
    body = json.load(fh)
publisher = body.get("ci_publisher")
if not publisher:
    raise SystemExit("Response missing ci_publisher")
print(publisher)
PY
)"

replayed="$(awk -F': ' 'tolower($1)=="idempotency-replayed" {print $2}' "${headers_file}" | tr -d '\r' | tail -n1)"
echo "[INFO] ci_publisher=${ci_publisher} idempotency_replayed=${replayed:-missing}"
echo "[INFO] CI smoke registration succeeded."
