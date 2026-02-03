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

ensure_ssm_auth_config() {
  local missing=()
  local missing_issuer=0
  local missing_audience=0
  local missing_jwks=0
  local missing_roles=0
  local missing_client_id=0
  local missing_cors=0
  local issuer_key="${DXCP_CONFIG_PREFIX}/oidc/issuer"
  local audience_key="${DXCP_CONFIG_PREFIX}/oidc/audience"
  local jwks_key="${DXCP_CONFIG_PREFIX}/oidc/jwks_url"
  local roles_key="${DXCP_CONFIG_PREFIX}/oidc/roles_claim"
  local client_id_key="${DXCP_CONFIG_PREFIX}/ui/auth0_client_id"
  local cors_key="${DXCP_CONFIG_PREFIX}/api/cors_origins"

  echo "Checking required SSM parameters under ${DXCP_CONFIG_PREFIX}..."

  if ! param_exists "$issuer_key"; then
    missing+=("$issuer_key")
    missing_issuer=1
  fi
  if ! param_exists "$audience_key"; then
    missing+=("$audience_key")
    missing_audience=1
  fi
  if ! param_exists "$jwks_key"; then
    missing+=("$jwks_key")
    missing_jwks=1
  fi
  if ! param_exists "$roles_key"; then
    missing+=("$roles_key")
    missing_roles=1
  fi
  if ! param_exists "$client_id_key"; then
    missing+=("$client_id_key")
    missing_client_id=1
  fi
  if ! param_exists "$cors_key"; then
    missing+=("$cors_key")
    missing_cors=1
  fi

  if [[ ${#missing[@]} -eq 0 ]]; then
    echo "All required SSM parameters are present."
    return
  fi

  if [[ "$VALIDATE_AUTH" -eq 1 ]] && ! command -v curl >/dev/null 2>&1; then
    echo "Missing curl. Install curl to validate Auth0 OIDC endpoints or pass --no-validate." >&2
    exit 1
  fi

  echo "Missing SSM parameters. Enter values to create them now."
  local issuer=""
  local audience="https://dxcp-api"
  local jwks_url=""
  local roles_claim="https://dxcp.example/claims/roles"
  local client_id=""
  local cors_origins="http://127.0.0.1:5173,http://localhost:5173"

  if [[ "$missing_issuer" -eq 1 ]]; then
    read -r -p "Auth0 issuer (e.g. https://<tenant>.us.auth0.com/): " issuer
  else
    issuer="$(get_ssm_param "$issuer_key")"
  fi
  if [[ -z "$issuer" ]]; then
    echo "Issuer is required." >&2
    exit 1
  fi
  if [[ "$issuer" != */ ]]; then
    issuer="${issuer}/"
  fi

  if [[ "$missing_audience" -eq 1 ]]; then
    read -r -p "Auth0 audience [${audience}]: " input_audience
    if [[ -n "$input_audience" ]]; then
      audience="$input_audience"
    fi
  else
    audience="$(get_ssm_param "$audience_key")"
  fi

  if [[ "$missing_roles" -eq 1 ]]; then
    read -r -p "Roles claim namespace [${roles_claim}]: " input_roles
    if [[ -n "$input_roles" ]]; then
      roles_claim="$input_roles"
    fi
  else
    roles_claim="$(get_ssm_param "$roles_key")"
  fi

  if [[ "$missing_client_id" -eq 1 ]]; then
    read -r -p "Auth0 client ID: " client_id
  else
    client_id="$(get_ssm_param "$client_id_key")"
  fi
  if [[ -z "$client_id" ]]; then
    echo "Client ID is required." >&2
    exit 1
  fi

  local derived_jwks="${issuer%/}/.well-known/jwks.json"
  if [[ "$missing_jwks" -eq 1 ]]; then
    read -r -p "JWKS URL [${derived_jwks}]: " input_jwks
    if [[ -n "$input_jwks" ]]; then
      jwks_url="$input_jwks"
    else
      jwks_url="$derived_jwks"
    fi
  else
    jwks_url="$(get_ssm_param "$jwks_key")"
  fi

  if [[ "$missing_cors" -eq 1 ]]; then
    read -r -p "CORS origins (comma-separated) [${cors_origins}]: " input_cors
    if [[ -n "$input_cors" ]]; then
      cors_origins="$input_cors"
    fi
  else
    cors_origins="$(get_ssm_param "$cors_key")"
  fi

  if [[ "$VALIDATE_AUTH" -eq 1 ]]; then
    local validate_auth_fields=0
    if [[ "$missing_issuer" -eq 1 || "$missing_audience" -eq 1 || "$missing_jwks" -eq 1 || "$missing_roles" -eq 1 || "$missing_client_id" -eq 1 ]]; then
      validate_auth_fields=1
    fi

    if [[ "$validate_auth_fields" -eq 1 ]]; then
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
    fi

    if [[ "$missing_cors" -eq 1 ]]; then
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
    fi

    if [[ "$missing_issuer" -eq 1 ]]; then
      echo "Validating issuer metadata..."
      local oidc_config_url="${issuer%/}/.well-known/openid-configuration"
      local oidc_config
      if ! oidc_config=$(curl -fsSL "$oidc_config_url"); then
        echo "Failed to fetch openid-configuration from $oidc_config_url" >&2
        echo "Provided issuer: $issuer" >&2
        echo "Check the issuer URL and your network connectivity." >&2
        exit 1
      fi

      local issuer_from_metadata
      issuer_from_metadata=$(echo "$oidc_config" | python - <<'PY'
import json, sys
data = json.loads(sys.stdin.read())
print(data.get("issuer", ""))
PY
)
      if [[ -n "$issuer_from_metadata" && "$issuer_from_metadata" != "$issuer" && "$issuer_from_metadata/" != "$issuer" ]]; then
        echo "Issuer mismatch. Metadata issuer=$issuer_from_metadata, provided=$issuer" >&2
        echo "Update the issuer value to match metadata." >&2
        exit 1
      fi

      local jwks_from_metadata
      jwks_from_metadata=$(echo "$oidc_config" | python - <<'PY'
import json, sys
data = json.loads(sys.stdin.read())
print(data.get("jwks_uri", ""))
PY
)
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
    fi
  else
    echo "Skipping Auth0 validation (--no-validate)."
  fi

  if [[ "$missing_issuer" -eq 1 ]]; then
    ensure_param "$issuer_key" "$issuer"
  fi
  if [[ "$missing_audience" -eq 1 ]]; then
    ensure_param "$audience_key" "$audience"
  fi
  if [[ "$missing_jwks" -eq 1 ]]; then
    ensure_param "$jwks_key" "$jwks_url"
  fi
  if [[ "$missing_roles" -eq 1 ]]; then
    ensure_param "$roles_key" "$roles_claim"
  fi
  if [[ "$missing_client_id" -eq 1 ]]; then
    ensure_param "$client_id_key" "$client_id"
  fi
  if [[ "$missing_cors" -eq 1 ]]; then
    ensure_param "$cors_key" "$cors_origins"
  fi
}

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
set +e
npx cdk acknowledge 34892 >/dev/null 2>&1
npx cdk acknowledge 32775 >/dev/null 2>&1
set -e
CDK_DISABLE_NOTICES=1 npx cdk deploy --all --require-approval never --outputs-file cdk-outputs.json
set +e
npx cdk acknowledge 34892 >/dev/null 2>&1
npx cdk acknowledge 32775 >/dev/null 2>&1
set -e
OUTPUTS_JSON=$(cat cdk-outputs.json)
export OUTPUTS_JSON
popd >/dev/null

API_BASE=$(python - <<'PY'
import json, os
outputs = json.loads(os.environ['OUTPUTS_JSON'])
print(outputs['DxcpApiStack']['ApiBaseUrl'])
PY
)

UI_BUCKET=$(python - <<'PY'
import json, os
outputs = json.loads(os.environ['OUTPUTS_JSON'])
print(outputs['DxcpUiStack']['UiBucketName'])
PY
)

UI_DIST_ID=$(python - <<'PY'
import json, os
outputs = json.loads(os.environ['OUTPUTS_JSON'])
print(outputs['DxcpUiStack']['UiDistributionId'])
PY
)

UI_URL=$(python - <<'PY'
import json, os
outputs = json.loads(os.environ['OUTPUTS_JSON'])
print(outputs['DxcpUiStack']['UiUrl'])
PY
)

DDB_TABLE=$(python - <<'PY'
import json, os
outputs = json.loads(os.environ['OUTPUTS_JSON'])
print(outputs['DxcpDataStack']['DxcpTableName'])
PY
)

echo "Building UI..."
pushd "$ROOT_DIR/ui" >/dev/null
npm install
VITE_API_BASE="$API_BASE" npm run build
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
UI_DIST_DIR="$UI_DIST_DIR" API_BASE="$API_BASE" DXCP_UI_AUTH0_DOMAIN="$DXCP_UI_AUTH0_DOMAIN" \
DXCP_UI_AUTH0_CLIENT_ID="$DXCP_UI_AUTH0_CLIENT_ID" DXCP_UI_AUTH0_AUDIENCE="$DXCP_UI_AUTH0_AUDIENCE" \
DXCP_UI_AUTH0_ROLES_CLAIM="$DXCP_UI_AUTH0_ROLES_CLAIM" python - <<'PY'
import json
import os
import sys

required = [
    "UI_DIST_DIR",
    "API_BASE",
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
    "apiBase": os.environ["API_BASE"],
    "auth0": {
        "domain": os.environ["DXCP_UI_AUTH0_DOMAIN"],
        "clientId": os.environ["DXCP_UI_AUTH0_CLIENT_ID"],
        "audience": os.environ["DXCP_UI_AUTH0_AUDIENCE"],
        "rolesClaim": os.environ["DXCP_UI_AUTH0_ROLES_CLAIM"],
    },
}
with open(path, "w", encoding="ascii") as handle:
    json.dump(config, handle, indent=2)
PY
aws s3 sync "$UI_DIST_DIR" "s3://$UI_BUCKET" --delete
aws cloudfront create-invalidation --distribution-id "$UI_DIST_ID" --paths "/*"

SEED_SCRIPT="$ROOT_DIR/scripts/seed_registry.py"
PYTHONPATH_DIR="$API_BUILD_DIR"
if [[ -n "$ROOT_DIR_WIN" && -n "$API_BUILD_DIR_WIN" ]]; then
  SEED_SCRIPT="$ROOT_DIR_WIN\\scripts\\seed_registry.py"
  PYTHONPATH_DIR="$API_BUILD_DIR_WIN"
fi
PYTHONPATH="$PYTHONPATH_DIR" python "$SEED_SCRIPT" --table "$DDB_TABLE"

cat <<EOF

DXCP AWS endpoints
- UI URL: $UI_URL
- API base: $API_BASE
- UI bucket: $UI_BUCKET
- CloudFront distribution: $UI_DIST_ID
- DynamoDB table: $DDB_TABLE
EOF
