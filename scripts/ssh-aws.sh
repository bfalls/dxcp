#!/usr/bin/env bash
set -euo pipefail

NAME_TAG="${DXCP_EC2_NAME_TAG:-dxcp-spinnaker}"
REGION="${AWS_REGION:-${DXCP_AWS_REGION:-us-east-1}}"
KEY_PATH="${DXCP_EC2_KEY_PATH:-dxcp.pem}"
USER="${DXCP_EC2_USER:-ec2-user}"

HOST=$(aws ec2 describe-instances \
  --region "$REGION" \
  --filters "Name=tag:Name,Values=$NAME_TAG" "Name=instance-state-name,Values=running" \
  --query "Reservations[0].Instances[0].PublicDnsName" \
  --output text)

if [ -z "$HOST" ] || [ "$HOST" = "None" ]; then
  echo "No running instance found with Name=$NAME_TAG in $REGION" >&2
  exit 1
fi

if [[ $# -gt 0 ]]; then
  ssh -i "$KEY_PATH" -o StrictHostKeyChecking=no "$USER@$HOST" "$@"
else
  ssh -i "$KEY_PATH" -o StrictHostKeyChecking=no "${USER}@${HOST}"
fi
