#!/usr/bin/env bash
# Regenerates the sample sheets in examples/sheets from examples/input.
#
#   examples/generate.sh
#
# Uses the dbd-assets commit in dbd-assets.ref unless DBD_ASSETS_ROOT / DBD_ASSETS_REF are set.
set -euo pipefail

cd "$(dirname "$0")/.."
export DBD_ASSETS_ROOT="${DBD_ASSETS_ROOT:-https://github.com/shenapse/dbd-assets.git}"
export DBD_ASSETS_REF="${DBD_ASSETS_REF:-$(tr -d '[:space:]' < dbd-assets.ref)}"

in=examples/input
out=examples/sheets
rm -rf "$out"
mkdir -p "$out"

run() { npx tsx src/cli.ts "$@" --out "$out"; }

run perks  "$in/blight-allowlist.yaml" --icons-only
run addons "$in/blight-allowlist.yaml" --icons-only
run items  "$in/blight-allowlist.yaml" --icons-only
run builds "$in/blight-survivor-builds.yaml" --rules "$in/blight-allowlist.yaml"
run builds "$in/lich-killer-builds.yaml"     --rules "$in/lich-allowlist.yaml"
