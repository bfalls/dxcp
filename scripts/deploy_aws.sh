#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIG_CACHE="$ROOT_DIR/.dxcp_aws_config"
AWS_REGION_DEFAULT="${AWS_REGION:-${DXCP_AWS_REGION:-us-east-1}}"

API_BUILD_DIR="$ROOT_DIR/cdk/build/api"
AWS_REGION_DEFAULT="${AWS_REGION:-${DXCP_AWS_REGION:-us-east-1}}"

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
DXCP_SPINNAKER_KEY_NAME=${DXCP_SPINNAKER_KEY_NAME:-}
DXCP_SPINNAKER_ADMIN_CIDR=${DXCP_SPINNAKER_ADMIN_CIDR:-}
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

prompt_for_key_name() {
  read -r -p "Enter EC2 key pair name for SSH (optional): " DXCP_SPINNAKER_KEY_NAME_INPUT
  if [[ -n "${DXCP_SPINNAKER_KEY_NAME_INPUT}" ]]; then
    export DXCP_SPINNAKER_KEY_NAME="${DXCP_SPINNAKER_KEY_NAME_INPUT}"
  fi
}

prompt_for_admin_cidr() {
  local current_ip=""
  current_ip="$(curl -s https://checkip.amazonaws.com | tr -d '\n' || true)"
  if [[ -n "${current_ip}" ]]; then
    echo "Current public IP: ${current_ip}"
    echo "Tip: use ${current_ip}/32 to restrict access to your IP."
  fi
  read -r -p "Admin public IP for SSH/Gate access (e.g., 1.2.3.4/32) (optional): " DXCP_SPINNAKER_ADMIN_CIDR_INPUT
  if [[ -n "${DXCP_SPINNAKER_ADMIN_CIDR_INPUT}" ]]; then
    export DXCP_SPINNAKER_ADMIN_CIDR="${DXCP_SPINNAKER_ADMIN_CIDR_INPUT}"
  fi
}

ensure_key_pair() {
  if [[ -z "${DXCP_SPINNAKER_KEY_NAME:-}" ]]; then
    read -r -p "Configure an EC2 key pair for SSH? (Y/n): " CONFIGURE_KEY
    if [[ "${CONFIGURE_KEY}" =~ ^[Nn]$ ]]; then
      return
    fi
    prompt_for_key_name
  fi

  if [[ -z "${DXCP_SPINNAKER_KEY_NAME:-}" ]]; then
    return
  fi

  if aws ec2 describe-key-pairs --region "$AWS_REGION_DEFAULT" --key-names "${DXCP_SPINNAKER_KEY_NAME}" >/dev/null 2>&1; then
    return
  fi

  echo "Key pair '${DXCP_SPINNAKER_KEY_NAME}' not found in ${AWS_REGION_DEFAULT}."
  read -r -p "Create new key pair (c) or import public key (i)? [i]: " KEY_ACTION
  if [[ "${KEY_ACTION}" =~ ^[Cc]$ ]]; then
    read -r -p "Save private key to path (default: ${ROOT_DIR}/${DXCP_SPINNAKER_KEY_NAME}.pem): " KEY_PATH_INPUT
    KEY_PATH="${KEY_PATH_INPUT:-${ROOT_DIR}/${DXCP_SPINNAKER_KEY_NAME}.pem}"
    aws ec2 create-key-pair \
      --region "$AWS_REGION_DEFAULT" \
      --key-name "${DXCP_SPINNAKER_KEY_NAME}" \
      --query 'KeyMaterial' \
      --output text > "$KEY_PATH"
    chmod 600 "$KEY_PATH"
    echo "Created key pair and saved private key to ${KEY_PATH}"
  else
    read -r -p "Public key path (e.g., ~/.ssh/id_rsa.pub): " PUBLIC_KEY_PATH
    if [[ -z "${PUBLIC_KEY_PATH}" ]]; then
      echo "Public key path is required to import a key."
      exit 1
    fi
    aws ec2 import-key-pair \
      --region "$AWS_REGION_DEFAULT" \
      --key-name "${DXCP_SPINNAKER_KEY_NAME}" \
      --public-key-material "fileb://${PUBLIC_KEY_PATH}"
    echo "Imported key pair '${DXCP_SPINNAKER_KEY_NAME}' from ${PUBLIC_KEY_PATH}"
  fi
}

load_cached_config

if [[ -n "${DXCP_SPINNAKER_IP_MODE:-}" ]]; then
  echo "Using cached Spinnaker IP mode: ${DXCP_SPINNAKER_IP_MODE}"
  if [[ "${DXCP_SPINNAKER_IP_MODE}" == "ddns" && -n "${DXCP_DYNU_HOSTNAME:-}" ]]; then
    echo "Using cached Dynu hostname: ${DXCP_DYNU_HOSTNAME}"
  fi
  if [[ -n "${DXCP_SPINNAKER_KEY_NAME:-}" ]]; then
    echo "Using cached Spinnaker key name: ${DXCP_SPINNAKER_KEY_NAME}"
  fi
  if [[ -n "${DXCP_SPINNAKER_ADMIN_CIDR:-}" ]]; then
    echo "Using cached Spinnaker admin CIDR: ${DXCP_SPINNAKER_ADMIN_CIDR}"
  fi
  CURRENT_PUBLIC_IP="$(curl -s https://checkip.amazonaws.com | tr -d '\n' || true)"
  if [[ -n "${CURRENT_PUBLIC_IP}" ]]; then
    echo "                Current public IP: ${CURRENT_PUBLIC_IP}"
    if [[ -n "${DXCP_SPINNAKER_ADMIN_CIDR:-}" && "${DXCP_SPINNAKER_ADMIN_CIDR}" != "${CURRENT_PUBLIC_IP}/32" ]]; then
      echo "Note: cached admin CIDR differs from ${CURRENT_PUBLIC_IP}/32"
    fi
  fi
  read -r -p "Use cached settings? (Y/n): " USE_CACHED
  if [[ "${USE_CACHED}" =~ ^[Nn]$ ]]; then
    unset DXCP_SPINNAKER_IP_MODE
    unset DXCP_DYNU_HOSTNAME
    unset DXCP_SPINNAKER_KEY_NAME
    unset DXCP_SPINNAKER_ADMIN_CIDR
  fi
fi

if [[ -z "${DXCP_SPINNAKER_IP_MODE:-}" ]]; then
  prompt_for_mode
  if [[ "${DXCP_SPINNAKER_IP_MODE}" == "ddns" ]]; then
    prompt_for_dynu_hostname
  fi
  ensure_key_pair
  prompt_for_admin_cidr
  write_cached_config
else
  if [[ "${DXCP_SPINNAKER_IP_MODE}" == "ddns" && -z "${DXCP_DYNU_HOSTNAME:-}" ]]; then
    prompt_for_dynu_hostname
  fi
  if [[ -z "${DXCP_SPINNAKER_KEY_NAME:-}" ]]; then
    ensure_key_pair
    write_cached_config
  fi
  if [[ -z "${DXCP_SPINNAKER_ADMIN_CIDR:-}" ]]; then
    prompt_for_admin_cidr
    write_cached_config
  fi
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

if [[ -n "${DXCP_SPINNAKER_KEY_NAME:-}" ]]; then
  export DXCP_SPINNAKER_KEY_NAME
fi
if [[ -n "${DXCP_SPINNAKER_ADMIN_CIDR:-}" ]]; then
  export DXCP_SPINNAKER_ADMIN_CIDR
fi

wait_for_ssm_instance() {
  local instance_id="$1"
  local attempts=60
  for ((i=1; i<=attempts; i++)); do
    if aws ssm describe-instance-information \
      --region "$AWS_REGION_DEFAULT" \
      --filters "Key=InstanceIds,Values=${instance_id}" \
      --query "InstanceInformationList[0].InstanceId" \
      --output text 2>/dev/null | grep -q "${instance_id}"; then
      return 0
    fi
    sleep 5
  done
  return 1
}

bootstrap_spinnaker_instance() {
  local instance_id="$1"
  local ip_mode="$2"
  local dynu_hostname="$3"
  echo "Bootstrapping Spinnaker instance via SSM (may take a few minutes)..."
  if ! wait_for_ssm_instance "$instance_id"; then
    echo "SSM not ready for instance ${instance_id}; skipping bootstrap." >&2
    return 0
  fi

  local commands_json
  commands_json="$(IP_MODE="$ip_mode" DYNU_HOSTNAME="$dynu_hostname" GATE_IMAGE="${DXCP_SPINNAKER_GATE_IMAGE:-}" python3 - <<'PY'
import base64
import json
import os

ip_mode = os.environ.get("IP_MODE", "")
dynu_hostname = os.environ.get("DYNU_HOSTNAME", "")
gate_image = os.environ.get("GATE_IMAGE", "") or "wwbgo/spinnaker:gate-1.20.0"

compose_base = """version: '3.8'
services:
  redis:
    image: redis:7
    restart: unless-stopped
  gate:
    image: __GATE_IMAGE__
    restart: unless-stopped
    ports:
      - '8084:8084'
    environment:
      JAVA_OPTS: '-Xms512m -Xmx1024m'
      SPRING_APPLICATION_JSON: '{"services":{"orca":{"baseUrl":"http://localhost:8083"},"clouddriver":{"baseUrl":"http://localhost:7002"},"front50":{"baseUrl":"http://localhost:8080"},"echo":{"baseUrl":"http://localhost:8089"},"fiat":{"baseUrl":"http://localhost:7003"}}}'
    depends_on:
      - redis
"""
compose_base = compose_base.replace("__GATE_IMAGE__", gate_image)

caddy_service = """  caddy:
    image: caddy:2
    restart: unless-stopped
    ports:
      - '80:80'
      - '443:443'
    volumes:
      - /opt/spinnaker/caddy/Caddyfile:/etc/caddy/Caddyfile:ro
      - /opt/spinnaker/caddy/data:/data
      - /opt/spinnaker/caddy/config:/config
    depends_on:
      - gate
"""

service_unit = """[Unit]
Description=Spinnaker Gate (docker compose)
After=network-online.target docker.service
Wants=network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=/opt/spinnaker
ExecStart=/usr/bin/docker compose -f /opt/spinnaker/docker-compose.yml up -d
ExecStop=/usr/bin/docker compose -f /opt/spinnaker/docker-compose.yml down

[Install]
WantedBy=multi-user.target
"""

dynu_update_script = """#!/usr/bin/env bash
set -euo pipefail
TOKEN=$(curl -sS -X PUT 'http://169.254.169.254/latest/api/token' -H 'X-aws-ec2-metadata-token-ttl-seconds: 21600')
PUBLIC_IP=""
for i in $(seq 1 24); do
  PUBLIC_IP=$(curl -sS -H "X-aws-ec2-metadata-token: ${TOKEN}" http://169.254.169.254/latest/meta-data/public-ipv4 || true)
  if [[ -n "${PUBLIC_IP}" ]]; then
    break
  fi
  sleep 5
done
if [[ -z "${PUBLIC_IP}" ]]; then
  echo "Public IP not available" >&2
  exit 1
fi
DYNU_USERNAME=$(aws ssm get-parameter --name DYNU_USERNAME --with-decryption --query 'Parameter.Value' --output text)
DYNU_PASSWORD=$(aws ssm get-parameter --name DYNU_PASSWORD --with-decryption --query 'Parameter.Value' --output text)
DYNU_API_KEY=$(aws ssm get-parameter --name DYNU_API_KEY --with-decryption --query 'Parameter.Value' --output text)
HOSTNAME="__DYNU_HOSTNAME__"
curl -sS -u "${DYNU_USERNAME}:${DYNU_PASSWORD}" -H "API-Key: ${DYNU_API_KEY}" "https://api.dynu.com/nic/update?hostname=${HOSTNAME}&myip=${PUBLIC_IP}" >/var/log/dynu-update.log
"""

dynu_service_unit = """[Unit]
Description=Update Dynu DDNS
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=/opt/spinnaker/bin/dynu-update.sh

[Install]
WantedBy=multi-user.target
"""

def b64(s: str) -> str:
  return base64.b64encode(s.encode()).decode()

commands = [
  "set -euo pipefail",
  "dnf install -y docker awscli ec2-instance-connect",
  "mkdir -p /usr/libexec/docker/cli-plugins",
  "if ! docker compose version >/dev/null 2>&1; then curl -fsSL https://github.com/docker/compose/releases/download/v2.24.6/docker-compose-linux-x86_64 -o /usr/libexec/docker/cli-plugins/docker-compose; chmod +x /usr/libexec/docker/cli-plugins/docker-compose; fi",
  "systemctl enable --now docker",
  "mkdir -p /opt/spinnaker/bin /opt/spinnaker/caddy",
  f"printf '%s' '{b64(compose_base)}' | base64 -d > /opt/spinnaker/docker-compose.yml",
]

if ip_mode == "ddns" and dynu_hostname:
  commands.append(f"printf '%s' '{b64(caddy_service)}' | base64 -d >> /opt/spinnaker/docker-compose.yml")
  caddyfile = f"{dynu_hostname} {{\n  reverse_proxy gate:8084\n}}\n"
  commands.append(f"printf '%s' '{b64(caddyfile)}' | base64 -d > /opt/spinnaker/caddy/Caddyfile")
  commands.append("dnf install -y bind-utils || true")
  commands.append("mkdir -p /opt/spinnaker/bin")
  commands.append(f"printf '%s' '{b64(dynu_update_script.replace('__DYNU_HOSTNAME__', dynu_hostname))}' | base64 -d > /opt/spinnaker/bin/dynu-update.sh")
  commands.append("chmod +x /opt/spinnaker/bin/dynu-update.sh")
  commands.append(f"printf '%s' '{b64(dynu_service_unit)}' | base64 -d > /etc/systemd/system/dynu-update.service")
  commands.append("systemctl daemon-reload")
  commands.append("systemctl enable --now dynu-update.service")

commands.extend([
  f"printf '%s' '{b64(service_unit)}' | base64 -d > /etc/systemd/system/spinnaker-compose.service",
  "systemctl daemon-reload",
  "systemctl enable spinnaker-compose.service",
  "systemctl restart spinnaker-compose.service",
  "systemctl status spinnaker-compose.service --no-pager || true",
])

print(json.dumps(commands))
PY
)"

  local command_id
  command_id="$(aws ssm send-command \
    --region "$AWS_REGION_DEFAULT" \
    --instance-ids "$instance_id" \
    --document-name "AWS-RunShellScript" \
    --comment "DXCP bootstrap spinnaker" \
    --parameters "commands=${commands_json}" \
    --query "Command.CommandId" \
    --output text)"

  local status="Pending"
  for _ in $(seq 1 60); do
    status="$(aws ssm get-command-invocation \
      --region "$AWS_REGION_DEFAULT" \
      --command-id "$command_id" \
      --instance-id "$instance_id" \
      --query "Status" \
      --output text 2>/dev/null || echo "Pending")"
    if [[ "${status}" == "Success" ]]; then
      echo "Spinnaker bootstrap complete."
      return 0
    fi
    if [[ "${status}" =~ ^(Cancelled|TimedOut|Failed|Undeliverable|Terminated)$ ]]; then
      echo "Spinnaker bootstrap failed with status: ${status}" >&2
      aws ssm get-command-invocation \
        --region "$AWS_REGION_DEFAULT" \
        --command-id "$command_id" \
        --instance-id "$instance_id" \
        --query "StandardErrorContent" \
        --output text || true
      return 1
    fi
    sleep 5
  done

  echo "Spinnaker bootstrap still running; check SSM command ${command_id} for details." >&2
  return 1
}

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
print(outputs['DxcpSpinnakerStack']['SpinnakerGateUrlOutput'])
PY
)

SPINNAKER_INSTANCE_ID=$(python3 - <<'PY'
import json, os
outputs = json.loads(os.environ['OUTPUTS_JSON'])
print(outputs['DxcpSpinnakerStack']['SpinnakerInstanceId'])
PY
)

bootstrap_spinnaker_instance "$SPINNAKER_INSTANCE_ID" "${DXCP_SPINNAKER_IP_MODE}" "${DXCP_DYNU_HOSTNAME:-}"

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
