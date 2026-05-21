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

export default async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const segments = url.pathname.split('/').filter(Boolean);
  const code = segments[2] ?? '';
  const infra = getInfra();
  return handleLeaveRoom(req, code, {
    roomStore: infra.roomStore,
    bus: infra.bus,
    log: infra.log,
  });
}
