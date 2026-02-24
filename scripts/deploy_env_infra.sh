#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CDK_DIR="$ROOT_DIR/cdk"
REGISTRY_PATH="$ROOT_DIR/docs/generated/env_vpc_registry.json"
SPINNAKER_ACCOUNTS_YAML_PATH="$ROOT_DIR/docs/generated/spinnaker_accounts.aws.yml"
SPINNAKER_ACCOUNTS_README_PATH="$ROOT_DIR/docs/generated/spinnaker_accounts.README.md"
SPINNAKER_LAMBDA_TARGETS_YAML_PATH="$ROOT_DIR/docs/generated/spinnaker_lambda_targets.aws.yml"
SPINNAKER_LAMBDA_TARGETS_README_PATH="$ROOT_DIR/docs/generated/spinnaker_lambda_targets.README.md"
REGISTRY_PATH_PY="$REGISTRY_PATH"
SPINNAKER_ACCOUNTS_YAML_PATH_PY="$SPINNAKER_ACCOUNTS_YAML_PATH"
SPINNAKER_ACCOUNTS_README_PATH_PY="$SPINNAKER_ACCOUNTS_README_PATH"
SPINNAKER_LAMBDA_TARGETS_YAML_PATH_PY="$SPINNAKER_LAMBDA_TARGETS_YAML_PATH"
SPINNAKER_LAMBDA_TARGETS_README_PATH_PY="$SPINNAKER_LAMBDA_TARGETS_README_PATH"

export AWS_REGION="us-east-1"
export AWS_DEFAULT_REGION="us-east-1"
export AWS_PAGER=""
export JSII_SILENCE_WARNING_UNTESTED_NODE_VERSION="1"

if command -v cygpath >/dev/null 2>&1; then
  REGISTRY_PATH_PY="$(cygpath -w "$REGISTRY_PATH")"
  SPINNAKER_ACCOUNTS_YAML_PATH_PY="$(cygpath -w "$SPINNAKER_ACCOUNTS_YAML_PATH")"
  SPINNAKER_ACCOUNTS_README_PATH_PY="$(cygpath -w "$SPINNAKER_ACCOUNTS_README_PATH")"
  SPINNAKER_LAMBDA_TARGETS_YAML_PATH_PY="$(cygpath -w "$SPINNAKER_LAMBDA_TARGETS_YAML_PATH")"
  SPINNAKER_LAMBDA_TARGETS_README_PATH_PY="$(cygpath -w "$SPINNAKER_LAMBDA_TARGETS_README_PATH")"
fi

ENVIRONMENTS=("dev" "staging" "prod")
CIDRS=("10.10.0.0/16" "10.20.0.0/16" "10.30.0.0/16")
VPC_STACKS=(
  "dxcp-env-vpc-dev"
  "dxcp-env-vpc-staging"
  "dxcp-env-vpc-prod"
)
IAM_STACKS=(
  "dxcp-env-iam-dev"
  "dxcp-env-iam-staging"
  "dxcp-env-iam-prod"
)
DEMO_RUNTIME_STACKS=(
  "dxcp-env-demo-runtime-dev"
  "dxcp-env-demo-runtime-staging"
  "dxcp-env-demo-runtime-prod"
)
ASSUMER_STACK="dxcp-env-iam-assumer"
STACKS=("${VPC_STACKS[@]}" "${IAM_STACKS[@]}" "${DEMO_RUNTIME_STACKS[@]}" "$ASSUMER_STACK")

if [[ "${#STACKS[@]}" -eq 0 ]]; then
  echo "ERROR: stack list is empty; refusing to deploy." >&2
  exit 1
fi

echo "Infra-only (VPC environments). Not deploying DXCP."
echo "AWS region: $AWS_REGION"
echo "Deploying stacks:"
for stack in "${STACKS[@]}"; do
  if [[ "$stack" != dxcp-env-* ]]; then
    echo "ERROR: stack '$stack' is outside allowed infra namespace dxcp-env-*." >&2
    exit 1
  fi
  echo "- $stack"
done

if [[ "${#ENVIRONMENTS[@]}" -ne "${#VPC_STACKS[@]}" || "${#CIDRS[@]}" -ne "${#VPC_STACKS[@]}" ]]; then
  echo "ERROR: environment contract arrays are inconsistent." >&2
  exit 1
fi
if [[ "${#IAM_STACKS[@]}" -ne "${#VPC_STACKS[@]}" ]]; then
  echo "ERROR: IAM and VPC stack arrays are inconsistent." >&2
  exit 1
fi
if [[ "${#DEMO_RUNTIME_STACKS[@]}" -ne "${#VPC_STACKS[@]}" ]]; then
  echo "ERROR: demo runtime and VPC stack arrays are inconsistent." >&2
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

for i in "${!VPC_STACKS[@]}"; do
  env_name="${ENVIRONMENTS[$i]}"
  expected_cidr="${CIDRS[$i]}"
  vpc_stack_name="${VPC_STACKS[$i]}"
  iam_stack_name="${IAM_STACKS[$i]}"

  vpc_id="$(stack_output "$vpc_stack_name" "VpcId")"
  public_subnet_ids_csv="$(stack_output "$vpc_stack_name" "PublicSubnetIds")"
  output_cidr="$(stack_output "$vpc_stack_name" "VpcCidr")"
  spinnaker_role_arn="$(stack_output "$iam_stack_name" "SpinnakerRoleArn")"

  if [[ -z "$vpc_id" || "$vpc_id" == "None" ]]; then
    echo "ERROR: missing VpcId output on stack $vpc_stack_name." >&2
    exit 1
  fi
  if [[ -z "$public_subnet_ids_csv" || "$public_subnet_ids_csv" == "None" ]]; then
    echo "ERROR: missing PublicSubnetIds output on stack $vpc_stack_name." >&2
    exit 1
  fi
  if [[ -z "$output_cidr" || "$output_cidr" == "None" ]]; then
    echo "ERROR: missing VpcCidr output on stack $vpc_stack_name." >&2
    exit 1
  fi
  if [[ -z "$spinnaker_role_arn" || "$spinnaker_role_arn" == "None" ]]; then
    echo "ERROR: missing SpinnakerRoleArn output on stack $iam_stack_name." >&2
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

  REGISTRY_ROWS+=("${env_name}|${expected_cidr}|${vpc_id}|${public_subnet_ids_csv}|${spinnaker_role_arn}")
SUMMARY_ROWS+=("${env_name}|${vpc_id}|${public_subnet_ids_csv}|${spinnaker_role_arn}")
done

spinnaker_assumer_role_arn="$(stack_output "$ASSUMER_STACK" "SpinnakerAssumerRoleArn")"
if [[ -z "$spinnaker_assumer_role_arn" || "$spinnaker_assumer_role_arn" == "None" ]]; then
  echo "ERROR: missing SpinnakerAssumerRoleArn output on stack $ASSUMER_STACK." >&2
  exit 1
fi

ensure_public_function_url() {
  local function_name="$1"
  local url_output

  if ! aws lambda get-function --function-name "$function_name" >/dev/null 2>&1; then
    echo "WARN: Lambda function '$function_name' not found; skipping Function URL setup." >&2
    return 0
  fi

  url_output="$(aws lambda get-function-url-config \
    --function-name "$function_name" \
    --query FunctionUrl \
    --output text 2>/dev/null || true)"

  if [[ -z "$url_output" || "$url_output" == "None" ]]; then
    echo "Creating Function URL for $function_name..." >&2
    url_output="$(aws lambda create-function-url-config \
      --function-name "$function_name" \
      --auth-type NONE \
      --query FunctionUrl \
      --output text)"
  else
    echo "Function URL already exists for $function_name." >&2
  fi

  # Add/refresh anonymous invoke permission for Function URL (idempotent).
  if ! aws lambda add-permission \
    --function-name "$function_name" \
    --statement-id "AllowPublicFunctionUrlInvoke" \
    --action lambda:InvokeFunctionUrl \
    --principal "*" \
    --function-url-auth-type NONE >/dev/null 2>&1; then
    if ! aws lambda get-policy --function-name "$function_name" \
      --query 'Policy' --output text 2>/dev/null | grep -q "AllowPublicFunctionUrlInvoke"; then
      echo "WARN: Could not ensure Function URL public permission for '$function_name'." >&2
    fi
  fi

  echo "$url_output"
}

declare -a LAMBDA_URL_ROWS=()
echo "Ensuring env demo Lambda Function URLs..."
for env_name in "${ENVIRONMENTS[@]}"; do
  for service_base in demo-service demo-service-2; do
    function_name="${service_base}-${env_name}"
    function_url="$(ensure_public_function_url "$function_name")"
    if [[ -n "$function_url" ]]; then
      LAMBDA_URL_ROWS+=("${env_name}|${service_base}|${function_name}|${function_url}")
    fi
  done
done

mkdir -p "$(dirname "$REGISTRY_PATH")"
echo "Generating registry and Spinnaker handoff docs..."
REGISTRY_ROWS_TEXT="$(printf '%s\n' "${REGISTRY_ROWS[@]}")"
LAMBDA_URL_ROWS_TEXT="$(printf '%s\n' "${LAMBDA_URL_ROWS[@]:-}")"
REGISTRY_PATH="$REGISTRY_PATH_PY" \
SPINNAKER_ACCOUNTS_YAML_PATH="$SPINNAKER_ACCOUNTS_YAML_PATH_PY" \
SPINNAKER_ACCOUNTS_README_PATH="$SPINNAKER_ACCOUNTS_README_PATH_PY" \
SPINNAKER_LAMBDA_TARGETS_YAML_PATH="$SPINNAKER_LAMBDA_TARGETS_YAML_PATH_PY" \
SPINNAKER_LAMBDA_TARGETS_README_PATH="$SPINNAKER_LAMBDA_TARGETS_README_PATH_PY" \
REGISTRY_ROWS_TEXT="$REGISTRY_ROWS_TEXT" \
LAMBDA_URL_ROWS_TEXT="$LAMBDA_URL_ROWS_TEXT" \
SPINNAKER_ASSUMER_ROLE_ARN="$spinnaker_assumer_role_arn" \
python - <<'PY'
import json
import os
from pathlib import Path

rows = [line.strip() for line in os.environ["REGISTRY_ROWS_TEXT"].splitlines() if line.strip()]
lambda_url_rows = [
    line.strip() for line in os.environ.get("LAMBDA_URL_ROWS_TEXT", "").splitlines() if line.strip()
]
order = ["dev", "staging", "prod"]
environments = {}
function_urls = {env_name: {} for env_name in order}

for env_name in order:
    found = False
    for row in rows:
        name, cidr, vpc_id, subnet_csv, role_arn = row.split("|", 4)
        if name != env_name:
            continue
        subnet_ids = [item.strip() for item in subnet_csv.split(",") if item.strip()]
        subnet_ids.sort()
        environments[name] = {
            "cidr": cidr,
            "vpcId": vpc_id,
            "publicSubnetIds": subnet_ids,
            "spinnakerRoleArn": role_arn,
        }
        found = True
        break
    if not found:
        raise SystemExit(f"Missing registry row for environment: {env_name}")

for row in lambda_url_rows:
    env_name, service_base, function_name, function_url = row.split("|", 3)
    function_urls.setdefault(env_name, {})
    function_urls[env_name][service_base] = {
        "functionName": function_name,
        "functionUrl": function_url,
    }

payload = {
    "region": "us-east-1",
    "spinnakerAssumerRoleArn": os.environ["SPINNAKER_ASSUMER_ROLE_ARN"],
    "environments": environments,
    "lambdaFunctionUrls": function_urls,
}
registry_path = Path(os.environ["REGISTRY_PATH"])
accounts_yaml_path = Path(os.environ["SPINNAKER_ACCOUNTS_YAML_PATH"])
accounts_readme_path = Path(os.environ["SPINNAKER_ACCOUNTS_README_PATH"])
lambda_targets_yaml_path = Path(os.environ["SPINNAKER_LAMBDA_TARGETS_YAML_PATH"])
lambda_targets_readme_path = Path(os.environ["SPINNAKER_LAMBDA_TARGETS_README_PATH"])

registry_path.parent.mkdir(parents=True, exist_ok=True)
with registry_path.open("w", encoding="ascii") as handle:
    json.dump(payload, handle, indent=2)
    handle.write("\n")

region = payload["region"]
dev = payload["environments"]["dev"]
staging = payload["environments"]["staging"]
prod = payload["environments"]["prod"]

yaml_text = f"""# Generated by scripts/deploy_env_infra.sh
# Source of truth: docs/generated/env_vpc_registry.json
# Deterministic order: dev, staging, prod

spinnakerAwsAccounts:
  - name: dev-aws
    assumeRole: {dev["spinnakerRoleArn"]}
    regions:
      - {region}
  - name: staging-aws
    assumeRole: {staging["spinnakerRoleArn"]}
    regions:
      - {region}
  - name: prod-aws
    assumeRole: {prod["spinnakerRoleArn"]}
    regions:
      - {region}

defaultVpcSubnetHints:
  dev:
    vpcId: {dev["vpcId"]}
    publicSubnetIds: [{", ".join(dev["publicSubnetIds"])}]
  staging:
    vpcId: {staging["vpcId"]}
    publicSubnetIds: [{", ".join(staging["publicSubnetIds"])}]
  prod:
    vpcId: {prod["vpcId"]}
    publicSubnetIds: [{", ".join(prod["publicSubnetIds"])}]
"""
accounts_yaml_path.parent.mkdir(parents=True, exist_ok=True)
accounts_yaml_path.write_text(yaml_text, encoding="ascii")

readme_text = f"""# Spinnaker AWS Accounts Handoff

Generated by: `./scripts/deploy_env_infra.sh`  
Registry source: `docs/generated/env_vpc_registry.json`

## Generated files

- `docs/generated/spinnaker_accounts.aws.yml`
- `docs/generated/spinnaker_accounts.README.md`

## Account mapping

- `dev-aws` -> `{dev["spinnakerRoleArn"]}`
- `staging-aws` -> `{staging["spinnakerRoleArn"]}`
- `prod-aws` -> `{prod["spinnakerRoleArn"]}`

Assumer role reference:
- `{payload["spinnakerAssumerRoleArn"]}`

Region:
- `{region}`

## Manual apply checklist (installation-neutral)

1. Open `docs/generated/spinnaker_accounts.aws.yml`.
2. Copy the three account entries into your Spinnaker AWS account config.
3. Ensure each account uses the listed `assumeRole` ARN and `{region}`.
4. Apply using your local installation path:
   - Halyard: merge into your provider AWS accounts config and run your normal apply command.
   - Operator: merge into your SpinnakerService spec and apply with kubectl.
   - Docker Compose or custom: merge into your mounted config and restart services manually.
5. Verify accounts appear in Spinnaker UI/API as `dev-aws`, `staging-aws`, and `prod-aws`.

## VPC/subnet hints for defaults

- dev: `{dev["vpcId"]}` | [{", ".join(dev["publicSubnetIds"])}]
- staging: `{staging["vpcId"]}` | [{", ".join(staging["publicSubnetIds"])}]
- prod: `{prod["vpcId"]}` | [{", ".join(prod["publicSubnetIds"])}]
"""
accounts_readme_path.write_text(readme_text, encoding="ascii")

lambda_targets_yaml_text = f"""# Generated by scripts/deploy_env_infra.sh
# Single-AWS-account demo target mapping for Spinnaker Lambda stages.
# Purpose: simulate dev/staging/prod separation using distinct IAM roles + function names.

spinnakerLambdaTargets:
  dev:
    account: dev-aws
    region: {region}
    functionNames:
      demo-service: demo-service-dev
      demo-service-2: demo-service-2-dev
    functionUrls:
      demo-service: {function_urls.get("dev", {}).get("demo-service", {}).get("functionUrl", "")}
      demo-service-2: {function_urls.get("dev", {}).get("demo-service-2", {}).get("functionUrl", "")}
    alias: live
  staging:
    account: staging-aws
    region: {region}
    functionNames:
      demo-service: demo-service-staging
      demo-service-2: demo-service-2-staging
    functionUrls:
      demo-service: {function_urls.get("staging", {}).get("demo-service", {}).get("functionUrl", "")}
      demo-service-2: {function_urls.get("staging", {}).get("demo-service-2", {}).get("functionUrl", "")}
    alias: live
  prod:
    account: prod-aws
    region: {region}
    functionNames:
      demo-service: demo-service-prod
      demo-service-2: demo-service-2-prod
    functionUrls:
      demo-service: {function_urls.get("prod", {}).get("demo-service", {}).get("functionUrl", "")}
      demo-service-2: {function_urls.get("prod", {}).get("demo-service-2", {}).get("functionUrl", "")}
    alias: live

spinnakerPipelineGuidance:
  updateCodeStage:
    publish: true
  routeStage:
    enabled: true
    notes:
      - Route alias `live` to the newly published version after update code.
      - This avoids `$LATEST` drift and makes rollback/demo behavior explicit.
"""
lambda_targets_yaml_path.parent.mkdir(parents=True, exist_ok=True)
lambda_targets_yaml_path.write_text(lambda_targets_yaml_text, encoding="ascii")

lambda_targets_readme_text = f"""# Spinnaker Lambda Targets Handoff (Single Account Demo)

Generated by: `./scripts/deploy_env_infra.sh`  
Region: `{region}`  
AWS account ID (all Spinnaker env accounts currently map here): `{dev["spinnakerRoleArn"].split(":")[4]}`

## Why this file exists

This repo currently demonstrates environment separation using:

- distinct Spinnaker AWS accounts (`dev-aws`, `staging-aws`, `prod-aws`)
- distinct IAM roles (`spinnaker-dev-role`, `spinnaker-staging-role`, `spinnaker-prod-role`)
- one AWS account only (for low cost / local demo constraints)

To make Lambda behavior look like real dev/staging/prod, use **different Lambda function names per environment**.

## Recommended Lambda function naming

- dev
  - `demo-service-dev`
  - `demo-service-2-dev`
- staging
  - `demo-service-staging`
  - `demo-service-2-staging`
- prod
  - `demo-service-prod`
  - `demo-service-2-prod`

## Function URL setup (created by this script when functions exist)

- The script now attempts to create public Function URLs (`AuthType=NONE`) for all six env-specific demo functions.
- If a function does not exist yet, the script prints a warning and skips it.
- Generated URLs are written into `docs/generated/spinnaker_lambda_targets.aws.yml` under `functionUrls`.

## Recommended Spinnaker pipeline pattern

1. `AWS Lambda Update Code`
   - Account: environment-specific (`dev-aws`, `staging-aws`, `prod-aws`)
   - Function Name: env-specific function (for example `demo-service-dev`)
   - `Publish`: `true`
2. `AWS Lambda Route` (or alias update)
   - Alias: `live`
   - Route `live` to the newly published version

Why:
- `Update Code` alone may only update `$LATEST`
- Function URLs often point to aliases/versions in real deployments
- Alias routing makes demos and rollbacks deterministic

## Important note about Function URLs

Function URLs are tied to a Lambda function (or alias qualifier), not to the Spinnaker account label.
Selecting `dev-aws` changes which IAM role performs the action, but not the URL unless you deploy to a different function/alias.

## Generated file

- `docs/generated/spinnaker_lambda_targets.aws.yml`
"""
lambda_targets_readme_path.write_text(lambda_targets_readme_text, encoding="ascii")
PY

echo "Environment infra summary:"
for row in "${SUMMARY_ROWS[@]}"; do
  IFS="|" read -r env_name vpc_id subnet_ids_csv spinnaker_role_arn <<<"$row"
  echo "- ${env_name}: vpcId=${vpc_id} publicSubnetIds=${subnet_ids_csv} spinnakerRoleArn=${spinnaker_role_arn}"
done
echo "- spinnakerAssumerRoleArn=${spinnaker_assumer_role_arn}"
echo "Wrote registry: $REGISTRY_PATH"
echo "Wrote Spinnaker accounts: $SPINNAKER_ACCOUNTS_YAML_PATH"
echo "Wrote Spinnaker apply guide: $SPINNAKER_ACCOUNTS_README_PATH"
echo "Wrote Spinnaker Lambda target map: $SPINNAKER_LAMBDA_TARGETS_YAML_PATH"
echo "Wrote Spinnaker Lambda target guide: $SPINNAKER_LAMBDA_TARGETS_README_PATH"
if [[ "${#LAMBDA_URL_ROWS[@]}" -gt 0 ]]; then
  echo "Demo service Function URLs (runtime endpoints):"
  for row in "${LAMBDA_URL_ROWS[@]}"; do
    IFS="|" read -r env_name service_base function_name function_url <<<"$row"
    echo "- ${env_name}/${service_base}: ${function_name} -> ${function_url}"
  done
else
  echo "Demo service Function URLs (runtime endpoints): none discovered (functions may not exist yet)."
fi
echo
echo "Next manual step:"
echo "1. Open docs/generated/spinnaker_accounts.aws.yml."
echo "2. Merge dev-aws, staging-aws, and prod-aws into your local Spinnaker AWS provider config."
echo "3. Open docs/generated/spinnaker_lambda_targets.aws.yml for env-specific Lambda naming guidance."
echo "4. Apply config using your installation method (Halyard, Operator, or Docker Compose/custom)."
echo "5. Restart/redeploy Spinnaker manually if required by your installation."

exit 0
