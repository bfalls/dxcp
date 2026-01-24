#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

pushd "$ROOT_DIR/cdk" >/dev/null
npm install
npx cdk destroy --all --force
popd >/dev/null
