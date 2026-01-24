#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIG_CACHE="$ROOT_DIR/.dxcp_aws_config"

API_BUILD_DIR="$ROOT_DIR/cdk/build/api"

load_cached_config() {
  if [[ -f "$CONFIG_CACHE" ]]; then
    # shellcheck disable=SC1090
    source "$CONFIG_CACHE"
  fi
}

write_cached_config() {
  cat > "$CONFIG_CACHE" <<EOF
DXCP_SPINNAKER_IP_MODE=${DXCP_SPINNAKER_IP_MODE}
DXCP_DYNU_HOSTNAME=${DXCP_DYNU_HOSTNAME:-}
EOF
}

prompt_for_mode() {
  echo "Select Spinnaker Gate IP mode:"
  echo "  1) Elastic IP (recommended)"
  echo "  2) Dynu DDNS"
  read -r -p "Enter 1 or 2: " DXCP_SPINNAKER_IP_MODE_SELECTION
  case "${DXCP_SPINNAKER_IP_MODE_SELECTION}" in
    1) export DXCP_SPINNAKER_IP_MODE="eip" ;;
    2) export DXCP_SPINNAKER_IP_MODE="ddns" ;;
    *) echo "Invalid selection. Set DXCP_SPINNAKER_IP_MODE to eip or ddns."; exit 1 ;;
  esac
}

prompt_for_dynu_hostname() {
  read -r -p "Enter Dynu hostname (e.g., dxcp.ddnsfree.com): " DXCP_DYNU_HOSTNAME_INPUT
  if [[ -z "${DXCP_DYNU_HOSTNAME_INPUT}" ]]; then
    echo "Dynu hostname is required for ddns mode."
    exit 1
  fi
  export DXCP_DYNU_HOSTNAME="${DXCP_DYNU_HOSTNAME_INPUT}"
}

load_cached_config

if [[ -n "${DXCP_SPINNAKER_IP_MODE:-}" ]]; then
  echo "Using cached Spinnaker IP mode: ${DXCP_SPINNAKER_IP_MODE}"
  if [[ "${DXCP_SPINNAKER_IP_MODE}" == "ddns" && -n "${DXCP_DYNU_HOSTNAME:-}" ]]; then
    echo "Using cached Dynu hostname: ${DXCP_DYNU_HOSTNAME}"
  fi
  read -r -p "Use cached settings? (Y/n): " USE_CACHED
  if [[ "${USE_CACHED}" =~ ^[Nn]$ ]]; then
    unset DXCP_SPINNAKER_IP_MODE
    unset DXCP_DYNU_HOSTNAME
  fi
fi

if [[ -z "${DXCP_SPINNAKER_IP_MODE:-}" ]]; then
  prompt_for_mode
  if [[ "${DXCP_SPINNAKER_IP_MODE}" == "ddns" ]]; then
    prompt_for_dynu_hostname
  fi
  write_cached_config
fi

export DXCP_SPINNAKER_IP_MODE
if [[ "${DXCP_SPINNAKER_IP_MODE}" == "ddns" ]]; then
  if [[ -z "${DXCP_DYNU_HOSTNAME:-}" ]]; then
    prompt_for_dynu_hostname
  fi
  export DXCP_DYNU_HOSTNAME
else
  echo "Note: EIP mode exposes Gate over HTTP (no TLS)."
  echo "Options for TLS: use DDNS with Caddy, or add your own DNS and reverse proxy."
fi

rm -rf "$API_BUILD_DIR"
mkdir -p "$API_BUILD_DIR"

python3 -m pip install -r "$ROOT_DIR/dxcp-api/requirements.txt" -t "$API_BUILD_DIR"
rsync -a "$ROOT_DIR/dxcp-api/"*.py "$API_BUILD_DIR/"
rsync -a "$ROOT_DIR/dxcp-api/data" "$API_BUILD_DIR/data"
rsync -a "$ROOT_DIR/spinnaker-adapter/" "$API_BUILD_DIR/spinnaker-adapter/"

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

API_BASE=$(python3 - <<'PY'
import json, os
outputs = json.loads(os.environ['OUTPUTS_JSON'])
print(outputs['DxcpApiStack']['ApiBaseUrl'])
PY
)

UI_BUCKET=$(python3 - <<'PY'
import json, os
outputs = json.loads(os.environ['OUTPUTS_JSON'])
print(outputs['DxcpUiStack']['UiBucketName'])
PY
)

UI_DIST_ID=$(python3 - <<'PY'
import json, os
outputs = json.loads(os.environ['OUTPUTS_JSON'])
print(outputs['DxcpUiStack']['UiDistributionId'])
PY
)

UI_URL=$(python3 - <<'PY'
import json, os
outputs = json.loads(os.environ['OUTPUTS_JSON'])
print(outputs['DxcpUiStack']['UiUrl'])
PY
)

SPINNAKER_GATE_URL=$(python3 - <<'PY'
import json, os
outputs = json.loads(os.environ['OUTPUTS_JSON'])
print(outputs['DxcpSpinnakerStack']['SpinnakerGateUrl'])
PY
)

SPINNAKER_INSTANCE_ID=$(python3 - <<'PY'
import json, os
outputs = json.loads(os.environ['OUTPUTS_JSON'])
print(outputs['DxcpSpinnakerStack']['SpinnakerInstanceId'])
PY
)

DDB_TABLE=$(python3 - <<'PY'
import json, os
outputs = json.loads(os.environ['OUTPUTS_JSON'])
print(outputs['DxcpDataStack']['DxcpTableName'])
PY
)

pushd "$ROOT_DIR/ui" >/dev/null
npm install
VITE_API_BASE="$API_BASE" VITE_API_TOKEN="${DXCP_API_TOKEN:-}" npm run build
popd >/dev/null

aws s3 sync "$ROOT_DIR/ui/dist" "s3://$UI_BUCKET" --delete
aws cloudfront create-invalidation --distribution-id "$UI_DIST_ID" --paths "/*"

python3 "$ROOT_DIR/scripts/seed_registry.py" --table "$DDB_TABLE"

cat <<EOF

DXCP AWS endpoints
- UI URL: $UI_URL
- API base: $API_BASE
- Spinnaker Gate URL: $SPINNAKER_GATE_URL
- Spinnaker instance: $SPINNAKER_INSTANCE_ID
- UI bucket: $UI_BUCKET
- CloudFront distribution: $UI_DIST_ID
- DynamoDB table: $DDB_TABLE
EOF
