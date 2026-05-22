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

export async function POST(request: Request): Promise<Response> {
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
