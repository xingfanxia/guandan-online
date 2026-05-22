// POST /api/room/[code]/leave — Vercel route wrapper.
//
// R-I5: per-IP rate limit (10/min).

import {
  getSharedInfra,
  getSharedRateLimiter,
} from '../../../lib/realtime/sharedInfra.js';
import { handleLeaveRoom } from '../../../lib/api/leaveRoom.js';

export async function POST(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const segments = url.pathname.split('/').filter(Boolean);
  const code = segments[2] ?? '';
  const infra = getSharedInfra();
  const rateLimiter = getSharedRateLimiter({
    prefix: 'rl:leave',
    windowMs: 60_000,
    max: 10,
  });
  return handleLeaveRoom(request, code, {
    roomStore: infra.roomStore,
    bus: infra.bus,
    log: infra.log,
    rateLimiter,
  });
}
