// POST /api/room/[code]/start — Vercel route wrapper.
//
// R-I5: per-(room + IP) rate limit (5/min).

import {
  getSharedInfra,
  getSharedRateLimiter,
} from '../../../lib/realtime/sharedInfra.js';
import { handleStartGame } from '../../../lib/api/startGame.js';

export async function POST(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const segments = url.pathname.split('/').filter(Boolean);
  const code = segments[2] ?? '';
  const infra = getSharedInfra();
  const rateLimiter = getSharedRateLimiter({
    prefix: 'rl:start',
    windowMs: 60_000,
    max: 5,
  });
  return handleStartGame(request, code, {
    roomStore: infra.roomStore,
    roundStore: infra.roundStore,
    sessionStore: infra.sessionStore,
    bus: infra.bus,
    log: infra.log,
    idempotency: infra.idempotency,
    rateLimiter,
  });
}
