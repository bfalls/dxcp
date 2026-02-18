#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DXCP_CONFIG_PREFIX="${DXCP_CONFIG_PREFIX:-/dxcp/config}"
DXCP_UI_STACK_NAME="${DXCP_UI_STACK_NAME:-DxcpUiStack}"
DXCP_UI_API_BASE="${DXCP_UI_API_BASE:-/v1}"
VALIDATE_AUTH=1
VALIDATE_ONLY=0

source "$ROOT_DIR/scripts/ssm_helpers.sh"

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
Usage: deploy_aws_ui.sh [--no-validate] [--validate-only]

Environment variables:
  DXCP_UI_STACK_NAME   CloudFormation stack name (default: DxcpUiStack)
  DXCP_CONFIG_PREFIX   SSM prefix (default: /dxcp/config)
  DXCP_UI_API_BASE     API base embedded in ui/dist/config.json (default: /v1)
  DXCP_UI_NPM_INSTALL  Run npm install step (default: 1; set 0 to skip)

Options:
  --no-validate     Skip Auth0 format and network checks.
  --validate-only   Validate SSM/Auth0 settings and stack outputs, then exit.
  -h, --help        Show this help message.
EOF
      exit 0
      ;;
  esac
done

if ! command -v python >/dev/null 2>&1; then
  echo "python is required." >&2
  exit 1
fi

require_aws

stack_output() {
  local stack_name="$1"
  local output_key="$2"
  aws cloudformation describe-stacks \
    --stack-name "$stack_name" \
    --query "Stacks[0].Outputs[?OutputKey=='${output_key}'].OutputValue | [0]" \
    --output text
}

trim() {
  echo "$1" | xargs
}

echo "UI-only deploy mode"
echo "- Includes: ui build, ui/dist/config.json generation, S3 sync, CloudFront invalidation."
echo "- Omits: CDK deploy, API packaging, migrations, and registry seed steps."
echo

ensure_ssm_auth_config() {
  local issuer_key="${DXCP_CONFIG_PREFIX}/oidc/issuer"
  local audience_key="${DXCP_CONFIG_PREFIX}/oidc/audience"
  local jwks_key="${DXCP_CONFIG_PREFIX}/oidc/jwks_url"
  local roles_key="${DXCP_CONFIG_PREFIX}/oidc/roles_claim"
  local client_id_key="${DXCP_CONFIG_PREFIX}/ui/auth0_client_id"

  local issuer
  local audience
  local jwks_url
  local roles_claim
  local client_id

  issuer="$(trim "$(get_ssm_param "$issuer_key")")"
  audience="$(trim "$(get_ssm_param "$audience_key")")"
  jwks_url="$(trim "$(get_ssm_param "$jwks_key")")"
  roles_claim="$(trim "$(get_ssm_param "$roles_key")")"
  client_id="$(trim "$(get_ssm_param "$client_id_key")")"

  : "${issuer:?Missing SSM ${issuer_key}}"
  : "${audience:?Missing SSM ${audience_key}}"
  : "${jwks_url:?Missing SSM ${jwks_key}}"
  : "${roles_claim:?Missing SSM ${roles_key}}"
  : "${client_id:?Missing SSM ${client_id_key}}"

  if [[ "$VALIDATE_AUTH" -ne 1 ]]; then
    echo "Skipping Auth0 validation (--no-validate)."
    return 0
  fi

  if ! command -v curl >/dev/null 2>&1; then
    echo "Missing curl. Install curl to validate Auth0 endpoints or pass --no-validate." >&2
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
    echo "Roles claim should be URL-like (starts with https://). Provided: $roles_claim" >&2
    exit 1
  fi
  if [[ "$jwks_url" != https://* ]]; then
    echo "JWKS URL must start with https://. Provided: $jwks_url" >&2
    exit 1
  fi

  echo "Validating issuer metadata..."
  local oidc_config_url="${issuer%/}/.well-known/openid-configuration"
  local oidc_meta_lines
  if ! oidc_meta_lines=$(python - "$oidc_config_url" <<'PY'
import json
import sys
from urllib.request import urlopen
from urllib.error import HTTPError, URLError

url = sys.argv[1]
try:
    with urlopen(url) as resp:
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
    print("Failed to parse OIDC metadata JSON.", file=sys.stderr)
    sys.exit(1)

print(data.get("issuer", ""))
print(data.get("jwks_uri", ""))
PY
); then
    echo "Failed to fetch openid-configuration from $oidc_config_url" >&2
    exit 1
  fi

  mapfile -t oidc_meta_array < <(printf "%s\n" "$oidc_meta_lines")
  local issuer_from_metadata
  local jwks_from_metadata
  issuer_from_metadata="$(trim "${oidc_meta_array[0]:-}")"
  jwks_from_metadata="$(trim "${oidc_meta_array[1]:-}")"
  if [[ -z "$issuer_from_metadata" || -z "$jwks_from_metadata" ]]; then
    echo "OIDC metadata missing issuer or jwks_uri." >&2
    exit 1
  fi
  if [[ "$issuer_from_metadata" != "$issuer" && "$issuer_from_metadata/" != "$issuer" ]]; then
    echo "Issuer mismatch. Metadata issuer=$issuer_from_metadata, configured=$issuer" >&2
    exit 1
  fi
  if [[ "$jwks_from_metadata" != "$jwks_url" ]]; then
    echo "JWKS URL mismatch. Metadata jwks_uri=$jwks_from_metadata, configured=$jwks_url" >&2
    exit 1
  fi

  echo "Validating JWKS endpoint..."
  if ! curl -fsSL "$jwks_url" >/dev/null; then
    echo "Failed to fetch JWKS from $jwks_url" >&2
    exit 1
  fi
}

echo "Resolving UI stack outputs from CloudFormation (${DXCP_UI_STACK_NAME})..."
UI_BUCKET="$(trim "$(stack_output "$DXCP_UI_STACK_NAME" "UiBucketName")")"
UI_DIST_ID="$(trim "$(stack_output "$DXCP_UI_STACK_NAME" "UiDistributionId")")"
UI_URL="$(trim "$(stack_output "$DXCP_UI_STACK_NAME" "UiUrl")")"

if [[ -z "$UI_BUCKET" || "$UI_BUCKET" == "None" ]]; then
  echo "Could not resolve UiBucketName from stack ${DXCP_UI_STACK_NAME}." >&2
  exit 1
fi
if [[ -z "$UI_DIST_ID" || "$UI_DIST_ID" == "None" ]]; then
  echo "Could not resolve UiDistributionId from stack ${DXCP_UI_STACK_NAME}." >&2
  exit 1
fi

ensure_ssm_auth_config
if [[ "$VALIDATE_ONLY" -eq 1 ]]; then
  echo "Validation completed. Exiting due to --validate-only."
  exit 0
fi

echo "Building UI..."
pushd "$ROOT_DIR/ui" >/dev/null
if [[ "${DXCP_UI_NPM_INSTALL:-1}" == "1" ]]; then
  npm install --ignore-scripts
fi
VITE_API_BASE="$DXCP_UI_API_BASE" npm run build
popd >/dev/null

echo "Reading Auth0 settings from SSM..."
DXCP_OIDC_ISSUER="$(trim "$(get_ssm_param "${DXCP_CONFIG_PREFIX}/oidc/issuer")")"
DXCP_UI_AUTH0_CLIENT_ID="$(trim "$(get_ssm_param "${DXCP_CONFIG_PREFIX}/ui/auth0_client_id")")"
DXCP_UI_AUTH0_AUDIENCE="$(trim "$(get_ssm_param "${DXCP_CONFIG_PREFIX}/oidc/audience")")"
DXCP_UI_AUTH0_ROLES_CLAIM="$(trim "$(get_ssm_param "${DXCP_CONFIG_PREFIX}/oidc/roles_claim")")"

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

UI_DIST_DIR="$ROOT_DIR/ui/dist"
UI_DIST_DIR_PY="$UI_DIST_DIR"
UI_DIST_DIR_AWS="$UI_DIST_DIR"
if command -v cygpath >/dev/null 2>&1; then
  UI_DIST_DIR_PY="$(cygpath -w "$UI_DIST_DIR")"
  UI_DIST_DIR_AWS="$(cygpath -w "$UI_DIST_DIR")"
fi

echo "Writing UI runtime config.json..."
UI_DIST_DIR="$UI_DIST_DIR_PY" DXCP_UI_API_BASE="$DXCP_UI_API_BASE" DXCP_UI_AUTH0_DOMAIN="$DXCP_UI_AUTH0_DOMAIN" \
DXCP_UI_AUTH0_CLIENT_ID="$DXCP_UI_AUTH0_CLIENT_ID" DXCP_UI_AUTH0_AUDIENCE="$DXCP_UI_AUTH0_AUDIENCE" \
DXCP_UI_AUTH0_ROLES_CLAIM="$DXCP_UI_AUTH0_ROLES_CLAIM" python - <<'PY'
import json
import os
import sys

required = [
    "UI_DIST_DIR",
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

echo "Publishing UI artifacts..."
aws s3 sync "$UI_DIST_DIR_AWS" "s3://$UI_BUCKET" --delete
aws cloudfront create-invalidation --distribution-id "$UI_DIST_ID" --paths "/*"

cat <<EOF

DXCP UI deployment complete
- UI URL: ${UI_URL:-unknown}
- UI bucket: $UI_BUCKET
- CloudFront distribution: $UI_DIST_ID
- apiBase in config.json: $DXCP_UI_API_BASE
EOF
