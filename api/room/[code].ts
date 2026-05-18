// GET /api/room/[code] — Vercel route wrapper.

import { createRealtimeInfra } from '../../lib/realtime/infra';
import { handleGetRoom } from '../../lib/api/getRoom';

export const config = {
  runtime: 'nodejs22.x',
};

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
  // /api/room/<code> → segments[2] = <code>
  const code = segments[2] ?? '';
  const infra = getInfra();
  return handleGetRoom(req, code, { roomStore: infra.roomStore });
}
