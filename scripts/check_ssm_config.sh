#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT_DIR/scripts/ssm_helpers.sh"

prefix="${DXCP_CONFIG_PREFIX:-${DXCP_SSM_PREFIX:-/dxcp/config}}"

required_param_groups=(
  "${prefix}/oidc/issuer"
  "${prefix}/oidc/audience"
  "${prefix}/oidc/jwks_url"
  "${prefix}/oidc/roles_claim"
  "${prefix}/ui/auth0_client_id"
  "${prefix}/api/cors_origins"
  "${prefix}/spinnaker/gate_url"
  "${prefix}/spinnaker/mtls_cert_path"
  "${prefix}/spinnaker/mtls_key_path"
)

missing=()
for name in "${required_param_groups[@]}"; do
  if ! param_exists "$name"; then
    missing+=("$name")
    continue
  fi
  value="$(get_ssm_param "$name" 2>/dev/null || true)"
  value="$(echo "$value" | xargs)"
  if [[ -z "$value" ]]; then
    missing+=("$name")
  fi
done

if [[ ${#missing[@]} -gt 0 ]]; then
  echo "Missing SSM config. Run scripts/bootstrap_config.sh first."
  echo "Missing parameters:"
  for name in "${missing[@]}"; do
    echo "- ${name}"
  done
  exit 1
fi

echo "SSM config present under ${prefix}."
