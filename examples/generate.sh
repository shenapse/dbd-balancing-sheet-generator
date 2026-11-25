#!/usr/bin/env bash
# Regenerates the sample sheets in examples/sheets from examples/input with the Docker image.
#
#   examples/generate.sh                      # pulls and runs the published :main image
#   BSG_IMAGE=bsg:dev examples/generate.sh    # runs a locally built image instead
#
# The sheets use the dbd-assets commit baked into the image (see `dbd-sheet version`).
set -euo pipefail

cd "$(dirname "$0")/.."

if [[ -n "${BSG_IMAGE:-}" ]]; then
  image="$BSG_IMAGE"
else
  image=ghcr.io/shenapse/dbd-balancing-sheet-generator:main
  docker pull --quiet "$image" >/dev/null
fi

in=examples/input
out=examples/sheets
rm -rf "$out"
mkdir -p "$out"

# The repo root is mounted at /work (the image's working directory), so repo-relative paths work
# unchanged, and the files are written as the calling user.
dbd_sheet() {
  docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/work" "$image" "$@"
}

run() { dbd_sheet "$@" --out "$out"; }

dbd_sheet version >&2
run perks  "$in/blight-allowlist.yaml" --icons-only
run addons "$in/blight-allowlist.yaml" --icons-only
run items  "$in/blight-allowlist.yaml" --icons-only
run builds "$in/blight-survivor-builds.yaml" --rules "$in/blight-allowlist.yaml"
run builds "$in/lich-killer-builds.yaml"     --rules "$in/lich-allowlist.yaml"
