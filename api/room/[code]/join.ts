// POST /api/room/[code]/join — Vercel route wrapper.
// Vercel routes the [code] path segment automatically. We re-parse the URL
// here so the handler stays free of Vercel framework types.

import { createRealtimeInfra } from '../../../lib/realtime/infra.js';
import { handleJoinRoom } from '../../../lib/api/joinRoom.js';

let infraCache: ReturnType<typeof createRealtimeInfra> | null = null;
function getInfra() {
  if (!infraCache) {
    infraCache = createRealtimeInfra(process.env);
  }
  return infraCache;
}

export async function POST(request: Request): Promise<Response> {
  const url = new URL(request.url);
  // Path: /api/room/<code>/join — pull <code> from index 3 of the segments.
  const segments = url.pathname.split('/').filter(Boolean);
  const code = segments[2] ?? '';
  const infra = getInfra();
  return handleJoinRoom(request, code, {
    roomStore: infra.roomStore,
    bus: infra.bus,
    log: infra.log,
  });
}
