#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 <repo-slug>" >&2
  exit 1
fi

slug="$1"

mkdir -p out/repositories
cp -R "dist/${slug}" "out/repositories/${slug}"
cp -R dist/assets out/assets
cp dist/index.html out/index.html

python scripts/ci/extract_meta.py --repos-json dist/data/repos.json --output out/meta.json
