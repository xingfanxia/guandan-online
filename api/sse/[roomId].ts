// GET /api/sse/[roomId] — Vercel route wrapper.

import { createRealtimeInfra } from '../../lib/realtime/infra';
import { handleSse } from '../../lib/api/sse';

// Allow the function to run nearly the full 300s ceiling so the 270s
// rotation has headroom. 300s is the platform default in 2026 but we keep
// it explicit here so the SSE rotation contract is self-documenting.
export const config = {
  maxDuration: 300,
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
  // /api/sse/<roomId> → segments = ['api', 'sse', '<roomId>']
  const roomId = segments[2] ?? '';
  const infra = getInfra();
  return handleSse(req, roomId, {
    roomStore: infra.roomStore,
    bus: infra.bus,
    log: infra.log,
  });
}
