#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API_BUILD_DIR="$ROOT_DIR/cdk/build/api"
DXCP_CONFIG_PREFIX="${DXCP_CONFIG_PREFIX:-/dxcp/config}"
VALIDATE_AUTH=1
VALIDATE_ONLY=0
source "$ROOT_DIR/scripts/ssm_helpers.sh"

if ! command -v python >/dev/null 2>&1; then
  echo "python is required. Activate the Python 3.11 virtualenv and retry." >&2
  exit 1
fi
PY_VERSION=$(python - <<'PY'
import sys
print(f"{sys.version_info.major}.{sys.version_info.minor}")
PY
)
if [[ "$PY_VERSION" != "3.11" ]]; then
  echo "DXCP deploy requires Python 3.11. Activate the Python 3.11 virtualenv and retry." >&2
  echo "Detected python version: $PY_VERSION" >&2
  exit 1
fi

for arg in "$@"; do
  case "$arg" in
    --no-validate)
      VALIDATE_AUTH=0
      ;;
    --validate-only)
      VALIDATE_ONLY=1
      ;;
    -h|--help)
      cat <<'EOF'
Usage: deploy_aws.sh [--no-validate] [--validate-only]

Options:
  --no-validate     Skip Auth0 format and network checks.
  --validate-only   Validate required SSM parameters and Auth0 endpoints, then exit.
  -h, --help        Show this help message.
EOF
      exit 0
      ;;
  esac
done

ROOT_DIR_WIN=""
API_BUILD_DIR_WIN=""
IS_WINDOWS_SHELL=0
if command -v uname >/dev/null 2>&1; then
  case "$(uname -s)" in
    MINGW*|MSYS*|CYGWIN*)
      IS_WINDOWS_SHELL=1
      ;;
  esac
fi
if command -v cygpath >/dev/null 2>&1; then
  ROOT_DIR_WIN="$(cygpath -w "$ROOT_DIR")"
  API_BUILD_DIR_WIN="$(cygpath -w "$API_BUILD_DIR")"
  IS_WINDOWS_SHELL=1
fi

copy_dir_contents() {
  local src="$1"
  local dest="$2"
  mkdir -p "$dest"
  if command -v rsync >/dev/null 2>&1; then
    rsync -a "${src}/" "${dest}/"
  else
    cp -R "${src}/." "${dest}/"
  fi
}

trim() {
  echo "$1" | xargs
}

stack_output() {
  local stack_name="$1"
  local output_key="$2"
  aws cloudformation describe-stacks \
    --stack-name "$stack_name" \
    --query "Stacks[0].Outputs[?OutputKey=='${output_key}'].OutputValue | [0]" \
    --output text
}

ensure_ssm_auth_config() {
  local issuer_key="${DXCP_CONFIG_PREFIX}/oidc/issuer"
  local audience_key="${DXCP_CONFIG_PREFIX}/oidc/audience"
  local jwks_key="${DXCP_CONFIG_PREFIX}/oidc/jwks_url"
  local roles_key="${DXCP_CONFIG_PREFIX}/oidc/roles_claim"
  local client_id_key="${DXCP_CONFIG_PREFIX}/ui/auth0_client_id"
  local cors_key="${DXCP_CONFIG_PREFIX}/api/cors_origins"

  local issuer
  local audience
  local jwks_url
  local roles_claim
  local client_id
  local cors_origins

  issuer="$(get_ssm_param "$issuer_key")"
  audience="$(get_ssm_param "$audience_key")"
  jwks_url="$(get_ssm_param "$jwks_key")"
  roles_claim="$(get_ssm_param "$roles_key")"
  client_id="$(get_ssm_param "$client_id_key")"
  cors_origins="$(get_ssm_param "$cors_key")"
  issuer="$(echo "$issuer" | xargs)"
  audience="$(echo "$audience" | xargs)"
  jwks_url="$(echo "$jwks_url" | xargs)"
  roles_claim="$(echo "$roles_claim" | xargs)"
  client_id="$(echo "$client_id" | xargs)"
  cors_origins="$(echo "$cors_origins" | xargs)"

  if [[ "$VALIDATE_AUTH" -eq 1 ]]; then
    if ! command -v curl >/dev/null 2>&1; then
      echo "Missing curl. Install curl to validate Auth0 OIDC endpoints or pass --no-validate." >&2
      exit 1
    fi

    if [[ "$issuer" != https://* ]]; then
      echo "Issuer must start with https://. Provided: $issuer" >&2
      exit 1
    fi
    if [[ "$audience" != https://* ]]; then
      echo "Audience should be a URL (starts with https://). Provided: $audience" >&2
      exit 1
    fi
    if [[ "$roles_claim" != https://* ]]; then
      echo "Roles claim should be a URL-like namespace (starts with https://). Provided: $roles_claim" >&2
      exit 1
    fi
    if [[ "$jwks_url" != https://* ]]; then
      echo "JWKS URL must start with https://. Provided: $jwks_url" >&2
      exit 1
    fi

    IFS=',' read -ra origin_list <<<"$cors_origins"
    for origin in "${origin_list[@]}"; do
      origin="$(echo "$origin" | xargs)"
      if [[ -z "$origin" ]]; then
        echo "CORS origins must not include empty entries." >&2
        exit 1
      fi
      if [[ "$origin" != http://* && "$origin" != https://* ]]; then
        echo "CORS origin must start with http:// or https://. Provided: $origin" >&2
        exit 1
      fi
    done

    echo "Validating issuer metadata..."
    local oidc_config_url="${issuer%/}/.well-known/openid-configuration"
    local issuer_from_metadata
    local jwks_from_metadata
    local oidc_meta_lines
    if ! oidc_meta_lines=$(python - "$oidc_config_url" <<'PY'
import json
import sys
from urllib.request import urlopen
from urllib.error import HTTPError, URLError

url = sys.argv[1]
try:
    with urlopen(url) as resp:
        status = getattr(resp, "status", 200)
        payload = resp.read().decode("utf-8")
except HTTPError as exc:
    print(f"HTTP error fetching OIDC metadata: {exc.code}", file=sys.stderr)
    sys.exit(1)
except URLError as exc:
    print(f"Network error fetching OIDC metadata: {exc.reason}", file=sys.stderr)
    sys.exit(1)

if not payload:
    print("OIDC metadata response was empty.", file=sys.stderr)
    sys.exit(1)
try:
    data = json.loads(payload)
except json.JSONDecodeError:
    print("Failed to parse issuer metadata (invalid JSON).", file=sys.stderr)
    print(payload[:200], file=sys.stderr)
    sys.exit(1)

print(data.get("issuer", ""))
print(data.get("jwks_uri", ""))
PY
); then
      echo "Failed to fetch openid-configuration from $oidc_config_url" >&2
      echo "Provided issuer: $issuer" >&2
      echo "Check the issuer URL and your network connectivity." >&2
      exit 1
    fi
    mapfile -t oidc_meta_array < <(printf "%s\n" "$oidc_meta_lines")
    issuer_from_metadata="$(echo "${oidc_meta_array[0]:-}" | xargs)"
    jwks_from_metadata="$(echo "${oidc_meta_array[1]:-}" | xargs)"
    if [[ -z "$issuer_from_metadata" || -z "$jwks_from_metadata" ]]; then
      echo "OIDC metadata missing issuer or jwks_uri." >&2
      echo "Provided issuer: $issuer" >&2
      exit 1
    fi
    if [[ -n "$issuer_from_metadata" && "$issuer_from_metadata" != "$issuer" && "$issuer_from_metadata/" != "$issuer" ]]; then
      echo "Issuer mismatch. Metadata issuer=$issuer_from_metadata, provided=$issuer" >&2
      echo "Update the issuer value to match metadata." >&2
      exit 1
    fi

    if [[ -n "$jwks_from_metadata" && "$jwks_from_metadata" != "$jwks_url" ]]; then
      echo "JWKS URL mismatch. Metadata jwks_uri=$jwks_from_metadata, provided=$jwks_url" >&2
      echo "Consider using the metadata jwks_uri." >&2
      exit 1
    fi

    echo "Validating JWKS endpoint..."
    if ! curl -fsSL "$jwks_url" >/dev/null; then
      echo "Failed to fetch JWKS from $jwks_url" >&2
      echo "Issuer: $issuer" >&2
      echo "Verify the JWKS URL and ensure the tenant is reachable." >&2
      exit 1
    fi
  else
    echo "Skipping Auth0 validation (--no-validate)."
  fi
}

if ! "$ROOT_DIR/scripts/check_ssm_config.sh"; then
  exit 1
fi
ensure_ssm_auth_config
if [[ "$VALIDATE_ONLY" -eq 1 ]]; then
  echo "Validation completed. Exiting due to --validate-only."
  exit 0
fi

echo "Reading API settings from SSM..."
DXCP_CORS_ORIGINS="$(get_ssm_param "${DXCP_CONFIG_PREFIX}/api/cors_origins")"
: "${DXCP_CORS_ORIGINS:?Missing SSM ${DXCP_CONFIG_PREFIX}/api/cors_origins}"
export DXCP_CORS_ORIGINS

echo "Building API package..."
rm -rf "$API_BUILD_DIR"
mkdir -p "$API_BUILD_DIR"

REQ_FILE="$ROOT_DIR/dxcp-api/requirements.txt"
API_BUILD_DIR_PIP="$API_BUILD_DIR"
PIP_PLATFORM_ARGS=()
if [[ "$IS_WINDOWS_SHELL" -eq 1 ]]; then
  if [[ -n "$ROOT_DIR_WIN" && -n "$API_BUILD_DIR_WIN" ]]; then
  REQ_FILE="$ROOT_DIR_WIN\\dxcp-api\\requirements.txt"
  API_BUILD_DIR_PIP="$API_BUILD_DIR_WIN"
  fi
  PIP_PLATFORM_ARGS=(
    "--platform"
    "manylinux2014_x86_64"
    "--implementation"
    "cp"
    "--python-version"
    "311"
    "--only-binary"
    ":all:"
  )
fi
python -m pip install -r "$REQ_FILE" -t "$API_BUILD_DIR_PIP" "${PIP_PLATFORM_ARGS[@]}"
if command -v rsync >/dev/null 2>&1; then
  # shellcheck disable=SC2086
  rsync -a "$ROOT_DIR/dxcp-api/"*.py "$API_BUILD_DIR/"
else
  shopt -s nullglob
  for file in "$ROOT_DIR"/dxcp-api/*.py; do
    cp "$file" "$API_BUILD_DIR/"
  done
  shopt -u nullglob
fi
copy_dir_contents "$ROOT_DIR/dxcp-api/data" "$API_BUILD_DIR/data"
copy_dir_contents "$ROOT_DIR/spinnaker-adapter" "$API_BUILD_DIR/spinnaker-adapter"

echo "Deploying CDK stacks..."
pushd "$ROOT_DIR/cdk" >/dev/null
npm install
CDK_OUTPUTS_FILE="${CDK_OUTPUTS_FILE:-cdk-outputs.json}"
CDK_DEBUG_LOG="${CDK_DEBUG_LOG:-$ROOT_DIR/cdk/cdk-deploy-debug.log}"
DXCP_CDK_SINGLE_STACK="${DXCP_CDK_SINGLE_STACK:-}"
CDK_NOTICES_CACHE="${HOME}/.cdk/cache/notices.json"
if [[ -f "$CDK_NOTICES_CACHE" ]]; then
  rm -f "$CDK_NOTICES_CACHE"
fi
set +e
set -e

run_cdk_deploy() {
  local stack="$1"
  local verbose_flag="${2:-0}"
  # Deploy each stack explicitly; dependencies are already ordered in CDK_STACKS below.
  # Without --exclusively, CDK may re-process dependency stacks on later deploy calls.
  local cmd=(npx cdk deploy "$stack" --exclusively --require-approval never --progress events --outputs-file "$CDK_OUTPUTS_FILE" --no-notices)
  if [[ "$verbose_flag" -eq 1 ]]; then
    cmd+=(--verbose)
  fi
  if [[ "$verbose_flag" -eq 1 ]]; then
    echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] stack=$stack verbose=1 command=${cmd[*]}" | tee -a "$CDK_DEBUG_LOG"
    CDK_DISABLE_NOTICES=1 "${cmd[@]}" 2>&1 | tee -a "$CDK_DEBUG_LOG"
    local rc="${PIPESTATUS[0]}"
    echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] stack=$stack verbose=1 exit_code=$rc" | tee -a "$CDK_DEBUG_LOG"
    return "$rc"
  fi
  CDK_DISABLE_NOTICES=1 "${cmd[@]}"
}

set +e
CDK_DEPLOY_STATUS=0
CDK_STACKS=(DxcpDataStack DxcpDemoRuntimeStack DxcpApiStack DxcpUiStack)
if [[ -n "$DXCP_CDK_SINGLE_STACK" ]]; then
  CDK_STACKS=("$DXCP_CDK_SINGLE_STACK")
  echo "CDK single-stack mode enabled: ${DXCP_CDK_SINGLE_STACK}"
fi
for stack in "${CDK_STACKS[@]}"; do
  run_cdk_deploy "$stack" 0
  STACK_STATUS=$?
  if [[ "$STACK_STATUS" -ne 0 ]]; then
    CDK_DEPLOY_STATUS=$STACK_STATUS
    echo "WARNING: CDK deploy failed for stack=${stack}. Capturing verbose diagnostics to $CDK_DEBUG_LOG ..." >&2
    run_cdk_deploy "$stack" 1 >/dev/null 2>&1
    echo "WARNING: verbose diagnostics capture complete for stack=${stack}" >&2
    break
  fi
done
set -e
if [[ "$CDK_DEPLOY_STATUS" -ne 0 ]]; then
  echo "WARNING: CDK CLI exited non-zero. Verifying required stack outputs directly via CloudFormation..." >&2
  echo "WARNING: CDK diagnostics log: $CDK_DEBUG_LOG" >&2
fi
popd >/dev/null

API_BASE="$(trim "$(stack_output "DxcpApiStack" "ApiBaseUrl")")"
UI_BUCKET="$(trim "$(stack_output "DxcpUiStack" "UiBucketName")")"
UI_DIST_ID="$(trim "$(stack_output "DxcpUiStack" "UiDistributionId")")"
UI_URL="$(trim "$(stack_output "DxcpUiStack" "UiUrl")")"
DDB_TABLE="$(trim "$(stack_output "DxcpDataStack" "DxcpTableName")")"

if [[ -z "$API_BASE" || "$API_BASE" == "None" ]]; then
  echo "Could not resolve DxcpApiStack.ApiBaseUrl after deploy." >&2
  exit 1
fi
if [[ -z "$UI_BUCKET" || "$UI_BUCKET" == "None" ]]; then
  echo "Could not resolve DxcpUiStack.UiBucketName after deploy." >&2
  exit 1
fi
if [[ -z "$UI_DIST_ID" || "$UI_DIST_ID" == "None" ]]; then
  echo "Could not resolve DxcpUiStack.UiDistributionId after deploy." >&2
  exit 1
fi
if [[ -z "$DDB_TABLE" || "$DDB_TABLE" == "None" ]]; then
  echo "Could not resolve DxcpDataStack.DxcpTableName after deploy." >&2
  exit 1
fi

echo "Building UI..."
pushd "$ROOT_DIR/ui" >/dev/null
npm install
VITE_API_BASE="${DXCP_UI_API_BASE:-/v1}" npm run build
popd >/dev/null

UI_DIST_DIR="$ROOT_DIR/ui/dist"
if [[ -n "$ROOT_DIR_WIN" ]]; then
  UI_DIST_DIR="$ROOT_DIR_WIN\\ui\\dist"
fi

echo "Reading Auth0 settings from SSM..."
DXCP_OIDC_ISSUER="$(get_ssm_param "${DXCP_CONFIG_PREFIX}/oidc/issuer")"
DXCP_UI_AUTH0_CLIENT_ID="$(get_ssm_param "${DXCP_CONFIG_PREFIX}/ui/auth0_client_id")"
DXCP_UI_AUTH0_AUDIENCE="$(get_ssm_param "${DXCP_CONFIG_PREFIX}/oidc/audience")"
DXCP_UI_AUTH0_ROLES_CLAIM="$(get_ssm_param "${DXCP_CONFIG_PREFIX}/oidc/roles_claim")"

: "${DXCP_UI_AUTH0_CLIENT_ID:?Missing SSM ${DXCP_CONFIG_PREFIX}/ui/auth0_client_id}"
: "${DXCP_OIDC_ISSUER:?Missing SSM ${DXCP_CONFIG_PREFIX}/oidc/issuer}"
: "${DXCP_UI_AUTH0_AUDIENCE:?Missing SSM ${DXCP_CONFIG_PREFIX}/oidc/audience}"
: "${DXCP_UI_AUTH0_ROLES_CLAIM:?Missing SSM ${DXCP_CONFIG_PREFIX}/oidc/roles_claim}"

DXCP_UI_AUTH0_DOMAIN="${DXCP_OIDC_ISSUER#https://}"
DXCP_UI_AUTH0_DOMAIN="${DXCP_UI_AUTH0_DOMAIN%/}"
if [[ -z "$DXCP_UI_AUTH0_DOMAIN" ]]; then
  echo "Failed to derive Auth0 domain from issuer: $DXCP_OIDC_ISSUER" >&2
  exit 1
fi

echo "Writing UI runtime config.json..."
DXCP_UI_API_BASE="${DXCP_UI_API_BASE:-/v1}"
UI_DIST_DIR="$UI_DIST_DIR" API_BASE="$API_BASE" DXCP_UI_API_BASE="$DXCP_UI_API_BASE" DXCP_UI_AUTH0_DOMAIN="$DXCP_UI_AUTH0_DOMAIN" \
DXCP_UI_AUTH0_CLIENT_ID="$DXCP_UI_AUTH0_CLIENT_ID" DXCP_UI_AUTH0_AUDIENCE="$DXCP_UI_AUTH0_AUDIENCE" \
DXCP_UI_AUTH0_ROLES_CLAIM="$DXCP_UI_AUTH0_ROLES_CLAIM" python - <<'PY'
import json
import os
import sys

required = [
    "UI_DIST_DIR",
    "API_BASE",
    "DXCP_UI_API_BASE",
    "DXCP_UI_AUTH0_DOMAIN",
    "DXCP_UI_AUTH0_CLIENT_ID",
    "DXCP_UI_AUTH0_AUDIENCE",
    "DXCP_UI_AUTH0_ROLES_CLAIM",
]
missing = [key for key in required if not os.environ.get(key)]
if missing:
    print(f"Missing environment values for config.json: {', '.join(missing)}", file=sys.stderr)
    sys.exit(1)

path = os.path.join(os.environ["UI_DIST_DIR"], "config.json")
config = {
    "apiBase": os.environ["DXCP_UI_API_BASE"],
    "auth0": {
        "domain": os.environ["DXCP_UI_AUTH0_DOMAIN"],
        "clientId": os.environ["DXCP_UI_AUTH0_CLIENT_ID"],
        "audience": os.environ["DXCP_UI_AUTH0_AUDIENCE"],
        "rolesClaim": os.environ["DXCP_UI_AUTH0_ROLES_CLAIM"],
    },
    "debugDeployGates": False,
}
with open(path, "w", encoding="ascii") as handle:
    json.dump(config, handle, indent=2)
PY
aws s3 sync "$UI_DIST_DIR" "s3://$UI_BUCKET" --delete
aws cloudfront create-invalidation --distribution-id "$UI_DIST_ID" --paths "/*"

SEED_SCRIPT="$ROOT_DIR/scripts/seed_registry.py"
MIGRATION_SCRIPT="$ROOT_DIR/scripts/run_migrations.py"
PYTHONPATH_DIR="$API_BUILD_DIR"
if [[ -n "$ROOT_DIR_WIN" && -n "$API_BUILD_DIR_WIN" ]]; then
  SEED_SCRIPT="$ROOT_DIR_WIN\\scripts\\seed_registry.py"
  MIGRATION_SCRIPT="$ROOT_DIR_WIN\\scripts\\run_migrations.py"
  PYTHONPATH_DIR="$API_BUILD_DIR_WIN"
fi
PYTHONPATH="$PYTHONPATH_DIR" python "$SEED_SCRIPT" --table "$DDB_TABLE"
python "$MIGRATION_SCRIPT" --table "$DDB_TABLE"

cat <<EOF

DXCP AWS endpoints
- UI URL: $UI_URL
- API base: $API_BASE
- UI bucket: $UI_BUCKET
- CloudFront distribution: $UI_DIST_ID
- DynamoDB table: $DDB_TABLE
EOF
