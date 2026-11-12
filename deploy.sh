#!/usr/bin/env bash
# Lint, test, build. Output goes to dist/ (see DEPLOY.md).
set -euo pipefail
cd "$(dirname "$0")"
npm ci
npm run lint
npm run test
npm run build
echo "Built: dist/"
