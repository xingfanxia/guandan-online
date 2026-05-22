#!/usr/bin/env bash
# Full verification chain: typecheck → unit tests → security → build → e2e.
#
# Stops at the first failure. Used in CI (`.github/workflows/ci.yml`)
# and by `audit-fix-loop`'s Step 5 — Verify.
#
# Usage:
#   scripts/ops/verify-all.sh            # full chain
#   scripts/ops/verify-all.sh --no-e2e   # skip Playwright (faster local pass)

set -euo pipefail

NO_E2E=0
for arg in "$@"; do
  case "$arg" in
    --no-e2e) NO_E2E=1 ;;
    *) echo "unknown arg: $arg" >&2; exit 2 ;;
  esac
done

echo "▶ npm run typecheck"
npm run typecheck

echo "▶ npm test"
npm test

echo "▶ npm run security:no-leak"
npm run security:no-leak

echo "▶ npm run build"
npm run build

if [ "$NO_E2E" -eq 0 ]; then
  echo "▶ npm run test:e2e -- --project=chromium-desktop"
  npm run test:e2e -- --project=chromium-desktop
fi

echo "✔ all green"
