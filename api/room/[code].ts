// GET /api/room/[code] — Vercel route wrapper.

import { createRealtimeInfra } from '../../lib/realtime/infra.js';
import { handleGetRoom } from '../../lib/api/getRoom.js';

let infraCache: ReturnType<typeof createRealtimeInfra> | null = null;
function getInfra() {
  if (!infraCache) {
    infraCache = createRealtimeInfra(process.env);
  }
  return infraCache;
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const segments = url.pathname.split('/').filter(Boolean);
  // /api/room/<code> → segments[2] = <code>
  const code = segments[2] ?? '';
  const infra = getInfra();
  return handleGetRoom(request, code, { roomStore: infra.roomStore });
}
