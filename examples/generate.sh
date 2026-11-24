#!/usr/bin/env bash
# Regenerates the sample sheets in examples/sheets from examples/input.
#
#   DBD_ASSETS_ROOT=../dbd-assets examples/generate.sh
#
# DBD_ASSETS_ROOT should be a dbd-assets checkout at the commit in dbd-assets.ref.
set -euo pipefail

cd "$(dirname "$0")/.."
: "${DBD_ASSETS_ROOT:?set DBD_ASSETS_ROOT to a dbd-assets checkout (see dbd-assets.ref)}"

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
