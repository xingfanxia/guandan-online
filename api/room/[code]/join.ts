// POST /api/room/[code]/join — Vercel route wrapper.
// Vercel routes the [code] path segment automatically. We re-parse the URL
// here so the handler stays free of Vercel framework types.
//
// R-I5: per-IP rate limit (10/min).

import {
  getSharedInfra,
  getSharedRateLimiter,
} from '../../../lib/realtime/sharedInfra.js';
import { handleJoinRoom } from '../../../lib/api/joinRoom.js';
import { botGateResponse } from '../../../lib/api/botGate.js';

export async function POST(request: Request): Promise<Response> {
  const denied = botGateResponse(request);
  if (denied) return denied;
  const url = new URL(request.url);
  // Path: /api/room/<code>/join — pull <code> from index 3 of the segments.
  const segments = url.pathname.split('/').filter(Boolean);
  const code = segments[2] ?? '';
  const infra = getSharedInfra();
  const rateLimiter = getSharedRateLimiter({
    prefix: 'rl:join',
    windowMs: 60_000,
    max: 10,
  });
  return handleJoinRoom(request, code, {
    roomStore: infra.roomStore,
    bus: infra.bus,
    log: infra.log,
    rateLimiter,
    ipHashSalt: process.env['IP_HASH_SALT'] ?? 'dev-salt',
  });
}
