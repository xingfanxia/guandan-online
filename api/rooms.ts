// GET /api/rooms — Vercel route wrapper for the public room browse list
// (ROOM-3). Logic lives in lib/api/listRooms.ts.
//
// Unauthenticated by design (it's a public list); per-IP rate limit keeps
// scrapers from hammering the room index.

import {
  getSharedInfra,
  getSharedRateLimiter,
} from '../lib/realtime/sharedInfra.js';
import { handleListRooms } from '../lib/api/listRooms.js';

export async function GET(request: Request): Promise<Response> {
  const infra = getSharedInfra();
  const rateLimiter = getSharedRateLimiter({
    prefix: 'rl:rooms',
    windowMs: 10_000,
    max: 10,
  });
  return handleListRooms(request, {
    roomStore: infra.roomStore,
    rateLimiter,
  });
}
