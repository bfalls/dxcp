#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT_DIR/scripts/ssm_helpers.sh"

prefix="${DXCP_CONFIG_PREFIX:-${DXCP_SSM_PREFIX:-/dxcp/config}}"
DELETE_OLD=0
FORCE=0

for arg in "$@"; do
  case "$arg" in
    --delete-old)
      DELETE_OLD=1
      ;;
    --force)
      FORCE=1
      ;;
    -h|--help)
      cat <<'EOF'
Usage: migrate_spinnaker_ssm_keys.sh [options]

One-time migration from legacy flat Spinnaker SSM keys to canonical nested keys.

Options:
  --delete-old   Delete legacy flat keys after successful copy.
  --force        Overwrite target nested key values if already set.
  -h, --help     Show this help message.

Environment:
  DXCP_CONFIG_PREFIX  SSM prefix to use (default: /dxcp/config)
  DXCP_SSM_PREFIX     Alternate prefix (used if DXCP_CONFIG_PREFIX is unset)

Examples:
  ./scripts/migrate_spinnaker_ssm_keys.sh
  ./scripts/migrate_spinnaker_ssm_keys.sh --delete-old
  ./scripts/migrate_spinnaker_ssm_keys.sh --force --delete-old
EOF
      exit 0
      ;;
  esac
done

require_aws

declare -a mappings=(
  "${prefix}/spinnaker_gate_url|${prefix}/spinnaker/gate_url"
  "${prefix}/spinnaker_gate_header_name|${prefix}/spinnaker/gate_header_name"
  "${prefix}/spinnaker_gate_header_value|${prefix}/spinnaker/gate_header_value"
  "${prefix}/spinnaker_auth0_domain|${prefix}/spinnaker/auth0_domain"
  "${prefix}/spinnaker_auth0_client_id|${prefix}/spinnaker/auth0_client_id"
  "${prefix}/spinnaker_auth0_client_secret|${prefix}/spinnaker/auth0_client_secret"
  "${prefix}/spinnaker_auth0_audience|${prefix}/spinnaker/auth0_audience"
  "${prefix}/spinnaker_auth0_scope|${prefix}/spinnaker/auth0_scope"
  "${prefix}/spinnaker_auth0_refresh_skew_seconds|${prefix}/spinnaker/auth0_refresh_skew_seconds"
)

copied=0
skipped=0
deleted=0
missing=0

for entry in "${mappings[@]}"; do
  IFS='|' read -r source target <<<"$entry"

  if ! param_exists "$source"; then
    echo "SKIP missing source: $source"
    missing=$((missing + 1))
    continue
  fi

  source_value="$(get_ssm_param "$source" 2>/dev/null || true)"
  source_trimmed="$(echo "$source_value" | xargs)"
  if [[ -z "$source_trimmed" ]]; then
    echo "SKIP empty source: $source"
    skipped=$((skipped + 1))
    continue
  fi

  target_has_value=0
  if param_exists "$target"; then
    target_value="$(get_ssm_param "$target" 2>/dev/null || true)"
    target_trimmed="$(echo "$target_value" | xargs)"
    if [[ -n "$target_trimmed" ]]; then
      target_has_value=1
    fi
  fi

  if [[ "$target_has_value" -eq 1 && "$FORCE" -ne 1 ]]; then
    echo "SKIP target already set: $target"
    skipped=$((skipped + 1))
    continue
  fi

  source_type="$(get_ssm_param_type "$source" 2>/dev/null || true)"
  if [[ "$source_type" != "SecureString" && "$source_type" != "String" ]]; then
    source_type="String"
  fi

  aws ssm put-parameter \
    --name "$target" \
    --type "$source_type" \
    --value "$source_value" \
    --overwrite >/dev/null
  echo "COPIED $source -> $target ($source_type)"
  copied=$((copied + 1))

  if [[ "$DELETE_OLD" -eq 1 ]]; then
    aws ssm delete-parameter --name "$source" >/dev/null
    echo "DELETED $source"
    deleted=$((deleted + 1))
  fi
done

echo "Migration complete:"
echo "  copied=${copied}"
echo "  skipped=${skipped}"
echo "  missing_source=${missing}"
echo "  deleted_old=${deleted}"
