#!/bin/bash
set -euo pipefail

# BASE_PATH — URL base for the deployed site.
# Defaults to "/" for a root deployment.
# Set to the sub-directory path for GitHub Pages sub-directory deployments.
#
# Example (GitHub Pages at https://nshcr.github.io/git-commits-threadline/):
#   BASE_PATH=/git-commits-threadline/ ./scripts/export.sh
BASE_PATH="${BASE_PATH:-/}"
export BASE_PATH

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

echo "Building frontend (BASE_PATH=${BASE_PATH})..."
cd "$PROJECT_ROOT/frontend" && pnpm run build

echo "Building graph data and assembling site..."
cd "$PROJECT_ROOT/backend" && cargo run --release

echo "Done! Static site is in dist/"
