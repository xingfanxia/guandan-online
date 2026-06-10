// GET /api/cron/dcCheck — Vercel cron route wrapper.
//
// vercel.json registers this path with a per-minute cron schedule (Vercel's
// minimum granularity). Vercel sends `Authorization: Bearer ${CRON_SECRET}`
// on cron-triggered invocations; we compare against ADMIN_TOKEN (same secret
// the sibling scorer + cleanup-rooms cron use).
//
// Two sweeps share this minute tick (Hobby plans cap cron jobs, so we
// piggyback rather than registering a third cron):
//   1. AI-4 disconnect takeover — promotes silent humans to bots.
//   2. Turn-timeout enforcement — forces a move (easy strategy, dispatched
//      through the REAL move pipeline with full SSE fanout) for humans who
//      are connected but have sat on their turn past the threshold.
//
// See lib/api/dcCheck.ts + lib/api/turnTimeout.ts for sweep logic and the
// blast-radius note (a leaked ADMIN_TOKEN lets a caller seize seats across
// all live games).

import { getSharedInfra, getSharedRateLimiter } from '../../lib/realtime/sharedInfra.js';
import { getSeenStore } from '../../lib/storage/sharedStores.js';
import { handleDcCheck, type DcCheckResponseBody } from '../../lib/api/dcCheck.js';
import {
  handleTurnTimeouts,
  type TurnTimeoutResponseBody,
} from '../../lib/api/turnTimeout.js';
import { handleMove } from '../../lib/api/move.js';

export async function GET(request: Request): Promise<Response> {
  const infra = getSharedInfra();
  const seenStore = getSeenStore();
  const adminToken = process.env['ADMIN_TOKEN'] ?? process.env['CRON_SECRET'];

  const dcRes = await handleDcCheck(request, {
    roomStore: infra.roomStore,
    roundStore: infra.roundStore,
    adminToken,
    getSeen: (code, playerId) => seenStore.getSeen(code, playerId),
  });
  // Auth / config failures apply identically to both sweeps — return as-is.
  if (dcRes.status !== 200) return dcRes;

  const rateLimiter = getSharedRateLimiter({
    prefix: 'rl:move',
    windowMs: 10_000,
    max: 30,
  });
  const timeoutRes = await handleTurnTimeouts(request, {
    roomStore: infra.roomStore,
    roundStore: infra.roundStore,
    adminToken,
    // Forced moves go through the canonical move handler — full validation,
    // idempotency, SSE fanout, and the post-move bot run-loop.
    dispatchMove: (code, joinToken, body) =>
      handleMove(
        new Request(`http://cron.internal/api/room/${code}/move`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${joinToken}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify(body),
        }),
        code,
        {
          roomStore: infra.roomStore,
          roundStore: infra.roundStore,
          sessionStore: infra.sessionStore,
          idempotency: infra.idempotency,
          rateLimiter,
          bus: infra.bus,
          log: infra.log,
        }
      ),
  });

  const dcBody = (await dcRes.json()) as DcCheckResponseBody;
  let timeoutBody: TurnTimeoutResponseBody | { error: string };
  try {
    timeoutBody = (await timeoutRes.json()) as TurnTimeoutResponseBody;
  } catch {
    timeoutBody = { error: `turn-timeout sweep failed (${timeoutRes.status})` };
  }
  return new Response(JSON.stringify({ dc: dcBody, turnTimeouts: timeoutBody }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}
