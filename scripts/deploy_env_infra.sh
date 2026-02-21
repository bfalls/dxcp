#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CDK_DIR="$ROOT_DIR/cdk"
REGISTRY_PATH="$ROOT_DIR/docs/generated/env_vpc_registry.json"
REGISTRY_PATH_PY="$REGISTRY_PATH"

export AWS_REGION="us-east-1"
export AWS_DEFAULT_REGION="us-east-1"
export JSII_SILENCE_WARNING_UNTESTED_NODE_VERSION="1"

if command -v cygpath >/dev/null 2>&1; then
  REGISTRY_PATH_PY="$(cygpath -w "$REGISTRY_PATH")"
fi

ENVIRONMENTS=("dev" "staging" "prod")
CIDRS=("10.10.0.0/16" "10.20.0.0/16" "10.30.0.0/16")
STACKS=(
  "dxcp-env-vpc-dev"
  "dxcp-env-vpc-staging"
  "dxcp-env-vpc-prod"
)

if [[ "${#STACKS[@]}" -eq 0 ]]; then
  echo "ERROR: stack list is empty; refusing to deploy." >&2
  exit 1
fi

echo "Infra-only (VPC environments). Not deploying DXCP."
echo "AWS region: $AWS_REGION"
echo "Deploying stacks:"
for stack in "${STACKS[@]}"; do
  echo "- $stack"
done

if [[ "${#ENVIRONMENTS[@]}" -ne "${#STACKS[@]}" || "${#CIDRS[@]}" -ne "${#STACKS[@]}" ]]; then
  echo "ERROR: environment contract arrays are inconsistent." >&2
  exit 1
fi

ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"

pushd "$CDK_DIR" >/dev/null
CDK_STACK_LIST="$(npx cdk ls --no-notices)"

MISSING_STACKS=()
for stack in "${STACKS[@]}"; do
  if ! grep -Fxq "$stack" <<<"$CDK_STACK_LIST"; then
    MISSING_STACKS+=("$stack")
  fi
done

if [[ "${#MISSING_STACKS[@]}" -gt 0 ]]; then
  echo "ERROR: expected CDK stack IDs are missing from this app:" >&2
  for stack in "${MISSING_STACKS[@]}"; do
    echo "- $stack" >&2
  done
  echo "Found CDK stacks:" >&2
  while IFS= read -r stack; do
    echo "- $stack" >&2
  done <<<"$CDK_STACK_LIST"
  exit 1
fi

CDK_DISABLE_NOTICES=1 npx cdk bootstrap "aws://${ACCOUNT_ID}/${AWS_REGION}" --no-notices >/dev/null
CDK_DISABLE_NOTICES=1 npx cdk deploy "${STACKS[@]}" --require-approval never --no-notices
popd >/dev/null

stack_output() {
  local stack_name="$1"
  local output_key="$2"
  aws cloudformation describe-stacks \
    --stack-name "$stack_name" \
    --query "Stacks[0].Outputs[?OutputKey=='${output_key}'].OutputValue | [0]" \
    --output text
}

declare -a REGISTRY_ROWS=()
declare -a SUMMARY_ROWS=()

for i in "${!STACKS[@]}"; do
  env_name="${ENVIRONMENTS[$i]}"
  expected_cidr="${CIDRS[$i]}"
  stack_name="${STACKS[$i]}"

  vpc_id="$(stack_output "$stack_name" "VpcId")"
  public_subnet_ids_csv="$(stack_output "$stack_name" "PublicSubnetIds")"
  output_cidr="$(stack_output "$stack_name" "VpcCidr")"

  if [[ -z "$vpc_id" || "$vpc_id" == "None" ]]; then
    echo "ERROR: missing VpcId output on stack $stack_name." >&2
    exit 1
  fi
  if [[ -z "$public_subnet_ids_csv" || "$public_subnet_ids_csv" == "None" ]]; then
    echo "ERROR: missing PublicSubnetIds output on stack $stack_name." >&2
    exit 1
  fi
  if [[ -z "$output_cidr" || "$output_cidr" == "None" ]]; then
    echo "ERROR: missing VpcCidr output on stack $stack_name." >&2
    exit 1
  fi
  if [[ "$output_cidr" != "$expected_cidr" ]]; then
    echo "ERROR: CIDR mismatch for $env_name. Expected $expected_cidr, got $output_cidr." >&2
    exit 1
  fi

  nat_count="$(aws ec2 describe-nat-gateways \
    --filter "Name=vpc-id,Values=$vpc_id" "Name=state,Values=available,pending" \
    --query "length(NatGateways)" \
    --output text)"
  if [[ "$nat_count" != "0" ]]; then
    nat_ids="$(aws ec2 describe-nat-gateways \
      --filter "Name=vpc-id,Values=$vpc_id" "Name=state,Values=available,pending" \
      --query "NatGateways[].NatGatewayId" \
      --output text)"
    echo "ERROR: NAT gateways detected in $env_name VPC ($vpc_id): $nat_ids" >&2
    exit 1
  fi

  REGISTRY_ROWS+=("${env_name}|${expected_cidr}|${vpc_id}|${public_subnet_ids_csv}")
  SUMMARY_ROWS+=("${env_name}|${vpc_id}|${public_subnet_ids_csv}")
done

mkdir -p "$(dirname "$REGISTRY_PATH")"
REGISTRY_ROWS_TEXT="$(printf '%s\n' "${REGISTRY_ROWS[@]}")"
REGISTRY_PATH="$REGISTRY_PATH_PY" REGISTRY_ROWS_TEXT="$REGISTRY_ROWS_TEXT" python - <<'PY'
import json
import os

rows = [line.strip() for line in os.environ["REGISTRY_ROWS_TEXT"].splitlines() if line.strip()]
order = ["dev", "staging", "prod"]
environments = {}

for env_name in order:
    found = False
    for row in rows:
        name, cidr, vpc_id, subnet_csv = row.split("|", 3)
        if name != env_name:
            continue
        subnet_ids = [item.strip() for item in subnet_csv.split(",") if item.strip()]
        subnet_ids.sort()
        environments[name] = {
            "cidr": cidr,
            "vpcId": vpc_id,
            "publicSubnetIds": subnet_ids,
        }
        found = True
        break
    if not found:
        raise SystemExit(f"Missing registry row for environment: {env_name}")

payload = {"region": "us-east-1", "environments": environments}
registry_path = os.environ["REGISTRY_PATH"]
os.makedirs(os.path.dirname(registry_path), exist_ok=True)
with open(registry_path, "w", encoding="ascii") as handle:
    json.dump(payload, handle, indent=2)
    handle.write("\n")
PY

echo "Environment VPC summary:"
for row in "${SUMMARY_ROWS[@]}"; do
  IFS="|" read -r env_name vpc_id subnet_ids_csv <<<"$row"
  echo "- ${env_name}: vpcId=${vpc_id} publicSubnetIds=${subnet_ids_csv}"
done
echo "Wrote registry: $REGISTRY_PATH"

exit 0
