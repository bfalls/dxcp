#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  generate_spinnaker_preconfigured.sh --region <region> --bucket <bucket> --file <path> --key <yaml_key> [--namespace <ns>] [--out <file>]

Example:
  ./scripts/generate_spinnaker_preconfigured.sh \
    --region us-east-1 \
    --bucket dxcp-secrets-<account>-us-east-1 \
    --file dxcp/secrets.yml \
    --key controller_token \
    --out orca-preconfigured.yml

Notes:
  - This prints the Orca preconfigured webhook stanza for dxcpDeploy/dxcpRollback.
  - You still need to merge it into Orca's spinnaker.yml and restart Orca.
EOF
}

REGION=""
BUCKET=""
FILE_PATH=""
YAML_KEY=""
NAMESPACE="spinnaker"
OUT_FILE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --region)
      REGION="${2-}"; shift 2;;
    --bucket)
      BUCKET="${2-}"; shift 2;;
    --file)
      FILE_PATH="${2-}"; shift 2;;
    --key)
      YAML_KEY="${2-}"; shift 2;;
    --namespace)
      NAMESPACE="${2-}"; shift 2;;
    --out)
      OUT_FILE="${2-}"; shift 2;;
    -h|--help)
      usage; exit 0;;
    *)
      echo "Unknown arg: $1" >&2
      usage
      exit 1;;
  esac
done

if [[ -z "$REGION" || -z "$BUCKET" || -z "$FILE_PATH" || -z "$YAML_KEY" ]]; then
  usage
  exit 1
fi

SECRET_REF="encrypted:s3!r:${REGION}!b:${BUCKET}!f:${FILE_PATH}!k:${YAML_KEY}"

read -r -d '' STANZA <<EOF
webhook:
  preconfigured:
    - label: DXCP Deploy
      type: dxcpDeploy
      enabled: true
      method: POST
      url: \${parameters.engineUrl}deploy
      customHeaders:
        X-DXCP-Controller-Token:
          - ${SECRET_REF}
      payload:
        service: \${parameters.service}
        version: \${parameters.version}
        artifactRef: \${parameters.artifactRef}
    - label: DXCP Rollback
      type: dxcpRollback
      enabled: true
      method: POST
      url: \${parameters.engineUrl}rollback
      customHeaders:
        X-DXCP-Controller-Token:
          - ${SECRET_REF}
      payload:
        service: \${parameters.service}
        version: \${parameters.version}

secrets:
  enabled: true
  s3:
    enabled: true
    endpointUrl: https://s3.${REGION}.amazonaws.com
EOF

if [[ -n "$OUT_FILE" ]]; then
  echo "$STANZA" > "$OUT_FILE"
  echo "Wrote: $OUT_FILE"
else
  echo "$STANZA"
fi

cat <<EOF

Next steps (example for Kubernetes):
  1) Merge the above into your Orca spinnaker.yml.
  2) Restart Orca:
     kubectl -n ${NAMESPACE} rollout restart deploy/spin-orca
EOF
