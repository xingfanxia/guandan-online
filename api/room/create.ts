// POST /api/room/create — Vercel route wrapper.
// All logic lives in lib/api/createRoom.ts so it stays unit-testable.
//
// R-I5: per-IP rate limit (5/min) + optional Idempotency-Key dedup wired in
// from sharedInfra. Without the rate limit, an unauthenticated POST surface
// is a trivial spam vector; without idempotency, duplicate POSTs create
// duplicate rooms (e.g., flaky mobile networks retrying after timeout).

import {
  getSharedInfra,
  getSharedRateLimiter,
} from '../../lib/realtime/sharedInfra.js';
import { handleCreateRoom } from '../../lib/api/createRoom.js';
import { botGateResponse } from '../../lib/api/botGate.js';

export async function POST(request: Request): Promise<Response> {
  // SEC-4: block disallowed bots before doing any work. Fail-open on the
  // 'unknown' verdict (no platform header) so dev / e2e / pre-challenge
  // clients are unaffected.
  const denied = botGateResponse(request);
  if (denied) return denied;

  const infra = getSharedInfra();
  const rateLimiter = getSharedRateLimiter({
    prefix: 'rl:create',
    windowMs: 60_000,
    max: 5,
  });
  return handleCreateRoom(request, {
    roomStore: infra.roomStore,
    rateLimiter,
    idempotency: infra.idempotency,
  });
}
