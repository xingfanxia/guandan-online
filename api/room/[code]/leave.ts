// POST /api/room/[code]/leave — Vercel route wrapper.

import { createRealtimeInfra } from '../../../lib/realtime/infra.js';
import { handleLeaveRoom } from '../../../lib/api/leaveRoom.js';

let infraCache: ReturnType<typeof createRealtimeInfra> | null = null;
function getInfra() {
  if (!infraCache) {
    infraCache = createRealtimeInfra(process.env);
  }
  return infraCache;
}

export async function POST(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const segments = url.pathname.split('/').filter(Boolean);
  const code = segments[2] ?? '';
  const infra = getInfra();
  return handleLeaveRoom(request, code, {
    roomStore: infra.roomStore,
    bus: infra.bus,
    log: infra.log,
  });
}
