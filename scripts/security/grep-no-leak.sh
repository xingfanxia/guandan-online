#!/usr/bin/env bash
# grep-no-leak — enforces the single-publish-site discipline.
#
# SECURITY-CRITICAL. Every server-to-client message must route through
# lib/realtime/publish.ts so the hidden-state filter (buildClientPayload) runs
# uniformly. This script fails CI if any other file under lib/, src/, or api/
# calls EventBus.publish, EventLog.append, redis.publish, or xadd directly.
#
# Exit 0: no leaks found.
# Exit 1: violation — see stdout for offending file:line.
#
# Allowed publishers / appenders (whitelisted via path-suffix match):
#   - lib/realtime/publish.ts  (the gateway itself)
#   - lib/realtime/eventBus.ts (in-memory bus impl)
#   - lib/realtime/eventLog.ts (in-memory log impl)

set -euo pipefail

cd "$(dirname "$0")/../.."

# Patterns that suggest direct publish / append calls.
# We deliberately don't match `.push(` (Array#push) — too broad.
PATTERNS='(\.publish\(|\.append\(|redis\.publish\(|xadd\()'

# Scan only product code (lib/, src/, api/). Skip tests.
SCAN_ROOTS=(lib src api)

# Build the find arguments — only existing dirs.
EXISTING=()
for d in "${SCAN_ROOTS[@]}"; do
  [ -d "$d" ] && EXISTING+=("$d")
done

if [ ${#EXISTING[@]} -eq 0 ]; then
  echo "grep-no-leak: no scan roots found (lib/ src/ api/ all missing) — skipping"
  exit 0
fi

# Grep for violations, then filter out allowed files + tests + comment lines.
# Lines that start with `//` (after the file:line: prefix) are documentation,
# not executable code — `grep -vE ':\s*//'` removes them.
matches="$(grep -rnE --include="*.ts" "$PATTERNS" "${EXISTING[@]}" 2>/dev/null \
  | grep -v ".test.ts" \
  | grep -v "lib/realtime/publish.ts" \
  | grep -v "lib/realtime/eventBus.ts" \
  | grep -v "lib/realtime/eventLog.ts" \
  | grep -vE ':[[:space:]]*//' \
  | grep -vE ':[[:space:]]*\*' \
  || true)"

if [ -n "$matches" ]; then
  echo "❌ grep-no-leak: prohibited direct publish/append/xadd calls found:"
  echo "$matches"
  echo ""
  echo "Route through publishEvent() in lib/realtime/publish.ts instead."
  exit 1
fi

echo "✅ grep-no-leak: no direct publish/append/xadd calls outside lib/realtime/publish.ts"
exit 0
