#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API_BUILD_DIR="$ROOT_DIR/cdk/build/api"

copy_dir_contents() {
  local src="$1"
  local dest="$2"
  mkdir -p "$dest"
  if command -v rsync >/dev/null 2>&1; then
    rsync -a "${src}/" "${dest}/"
  else
    cp -R "${src}/." "${dest}/"
  fi
}

rm -rf "$API_BUILD_DIR"
mkdir -p "$API_BUILD_DIR"

python3 -m pip install -r "$ROOT_DIR/dxcp-api/requirements.txt" -t "$API_BUILD_DIR"
if command -v rsync >/dev/null 2>&1; then
  # shellcheck disable=SC2086
  rsync -a "$ROOT_DIR/dxcp-api/"*.py "$API_BUILD_DIR/"
else
  shopt -s nullglob
  for file in "$ROOT_DIR"/dxcp-api/*.py; do
    cp "$file" "$API_BUILD_DIR/"
  done
  shopt -u nullglob
fi
copy_dir_contents "$ROOT_DIR/dxcp-api/data" "$API_BUILD_DIR/data"
copy_dir_contents "$ROOT_DIR/spinnaker-adapter" "$API_BUILD_DIR/spinnaker-adapter"

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

PYTHONPATH="$API_BUILD_DIR" python3 "$ROOT_DIR/scripts/seed_registry.py" --table "$DDB_TABLE"

cat <<EOF

DXCP AWS endpoints
- UI URL: $UI_URL
- API base: $API_BASE
- UI bucket: $UI_BUCKET
- CloudFront distribution: $UI_DIST_ID
- DynamoDB table: $DDB_TABLE
EOF
