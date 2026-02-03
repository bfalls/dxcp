#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT_DIR/scripts/ssm_helpers.sh"

prefix="${DXCP_CONFIG_PREFIX:-${DXCP_SSM_PREFIX:-/dxcp/config}}"

prompt_required() {
  local name="$1"
  local value=""
  while [[ -z "$value" ]]; do
    read -r -p "Enter value for ${name}: " value
  done
  put_param "$name" "$value"
}

prompt_optional() {
  local name="$1"
  local default_value="$2"
  local reply=""
  read -r -p "Set optional parameter ${name}? [y/N]: " reply
  reply="${reply:-N}"
  if [[ ! "$reply" =~ ^[Yy]$ ]]; then
    return
  fi
  local value=""
  read -r -p "Enter value for ${name} (default ${default_value}): " value
  if [[ -z "$value" ]]; then
    value="$default_value"
  fi
  put_param "$name" "$value"
}

maybe_overwrite() {
  local name="$1"
  local value=""
  local reply=""
  read -r -p "Parameter ${name} exists. Overwrite? [y/N]: " reply
  reply="${reply:-N}"
  if [[ ! "$reply" =~ ^[Yy]$ ]]; then
    return
  fi
  read -r -p "Enter new value for ${name}: " value
  if [[ -z "$value" ]]; then
    echo "Value required to overwrite ${name}."
    exit 1
  fi
  ensure_param "$name" "$value"
}

main() {
  require_aws
  echo "DXCP SSM bootstrap"
  echo "Prefix: ${prefix}"

  required_params=(
    "${prefix}/oidc/issuer"
    "${prefix}/oidc/audience"
    "${prefix}/oidc/roles_claim"
    "${prefix}/spinnaker/gate_url"
  )

  optional_params=(
    "${prefix}/oidc/jwks_url"
    "${prefix}/ui_default_refresh_seconds"
    "${prefix}/ui_min_refresh_seconds"
    "${prefix}/ui_max_refresh_seconds"
    "${prefix}/runtime/artifact_bucket"
  )

  optional_defaults=(
    ""
    "300"
    "60"
    "3600"
    ""
  )

  for name in "${required_params[@]}"; do
    if param_exists "$name"; then
      echo "Exists: ${name}"
      maybe_overwrite "$name"
    else
      echo "Missing: ${name}"
      prompt_required "$name"
      echo "Wrote: ${name}"
    fi
  done

  for i in "${!optional_params[@]}"; do
    name="${optional_params[$i]}"
    default_value="${optional_defaults[$i]}"
    if param_exists "$name"; then
      echo "Exists: ${name}"
      maybe_overwrite "$name"
    else
      prompt_optional "$name" "$default_value"
      if param_exists "$name"; then
        echo "Wrote: ${name}"
      else
        echo "Skipped: ${name}"
      fi
    fi
  done

  echo "SSM bootstrap complete."
}

main "$@"
