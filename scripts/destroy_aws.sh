#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

pushd "$ROOT_DIR/cdk" >/dev/null
npm install
CDK_DISABLE_NOTICES=1 npx cdk destroy --all --force
popd >/dev/null
