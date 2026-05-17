#!/usr/bin/env bash
# NET-3 security gate — fails if any file outside lib/realtime/payload.ts
# calls redis.publish( or client.send( directly. Centralizing all outbound
# state through buildClientPayload is the discipline that replaces
# Colyseus's @view decorator in our hand-rolled SSE+POST stack.
#
# Wired in NET-3. Placeholder script until then so CI doesn't fail open.

set -euo pipefail

# Until NET-3 lands, no enforcement targets exist.
# When NET-3 ships, replace this body with:
#
#   if grep -rE 'redis\.publish\(|client\.send\(' lib api src \
#        --include='*.ts' \
#        --exclude-dir=node_modules \
#      | grep -v 'lib/realtime/payload.ts' \
#      | grep -v 'lib/realtime/upstash.ts'; then
#     echo "ERROR: outbound state path outside buildClientPayload" >&2
#     exit 1
#   fi

echo "grep-no-leak: no-op (NET-3 not yet shipped)"
exit 0
