#!/usr/bin/env bash
set -euo pipefail

require_aws() {
  if ! aws sts get-caller-identity >/dev/null 2>&1; then
    echo "AWS auth not available. Run 'aws sts get-caller-identity' first." >&2
    exit 1
  fi
}

param_exists() {
  local name="$1"
  set +e
  aws ssm get-parameter --name "$name" --with-decryption --query "Parameter.Value" --output text >/dev/null 2>&1
  local status=$?
  set -e
  return $status
}

put_param() {
  local name="$1"
  local value="$2"
  aws ssm put-parameter --name "$name" --type "String" --value "$value" >/dev/null
}

ensure_param() {
  local name="$1"
  local value="$2"
  aws ssm put-parameter --name "$name" --type "String" --value "$value" --overwrite >/dev/null
}

get_ssm_param() {
  local name="$1"
  aws ssm get-parameter --name "$name" --with-decryption --query "Parameter.Value" --output text
}

get_ssm_param_type() {
  local name="$1"
  aws ssm get-parameter --name "$name" --query "Parameter.Type" --output text
}
