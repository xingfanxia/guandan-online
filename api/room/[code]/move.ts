// POST /api/room/[code]/move — Vercel route wrapper.

import { getSharedInfra, getSharedRateLimiter } from '../../../lib/realtime/sharedInfra.js';
import { handleMove } from '../../../lib/api/move.js';

// Cap per (room, player) at 30 moves per 10 seconds — enough headroom for
// fast-twitch play, low enough to throttle scripted clients.
//
// R-I2: getSharedRateLimiter selects the Upstash-backed impl when Redis is
// wired (production), falling back to the per-container memory limiter for
// local dev. The previous module-level createSlidingWindowLimiter was
// per-container only — useless under Vercel autoscaling.
export async function POST(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const segments = url.pathname.split('/').filter(Boolean);
  const code = segments[2] ?? '';
  const infra = getSharedInfra();
  const rateLimiter = getSharedRateLimiter({
    prefix: 'rl:move',
    windowMs: 10_000,
    max: 30,
  });
  return handleMove(request, code, {
    roomStore: infra.roomStore,
    roundStore: infra.roundStore,
    sessionStore: infra.sessionStore,
    idempotency: infra.idempotency,
    rateLimiter,
    bus: infra.bus,
    log: infra.log,
  });
}
