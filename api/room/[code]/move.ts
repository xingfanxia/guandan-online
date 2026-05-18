// POST /api/room/[code]/move — Vercel route wrapper.

import { createRealtimeInfra } from '../../../lib/realtime/infra';
import { handleMove } from '../../../lib/api/move';
import { createSlidingWindowLimiter } from '../../../lib/security/rateLimit';

export const config = {
  runtime: 'nodejs22.x',
};

// Cap per (room, player) at 30 moves per 10 seconds — enough headroom for
// fast-twitch play, low enough to throttle scripted clients.
const rateLimiter = createSlidingWindowLimiter({ windowMs: 10_000, max: 30 });

let infraCache: ReturnType<typeof createRealtimeInfra> | null = null;
function getInfra() {
  if (!infraCache) {
    infraCache = createRealtimeInfra(process.env);
  }
  return infraCache;
}

export default async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const segments = url.pathname.split('/').filter(Boolean);
  const code = segments[2] ?? '';
  const infra = getInfra();
  return handleMove(req, code, {
    roomStore: infra.roomStore,
    roundStore: infra.roundStore,
    idempotency: infra.idempotency,
    rateLimiter,
    bus: infra.bus,
    log: infra.log,
  });
}
