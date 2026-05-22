// GET /api/sse/[roomId] — Vercel route wrapper.

import { getSharedInfra } from '../../lib/realtime/sharedInfra.js';
import { handleSse } from '../../lib/api/sse.js';

// Allow the function to run nearly the full 300s ceiling so the 270s
// rotation has headroom. 300s is the platform default in 2026 but we keep
// it explicit here so the SSE rotation contract is self-documenting.
export const config = {
  maxDuration: 300,
};

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const segments = url.pathname.split('/').filter(Boolean);
  // /api/sse/<roomId> → segments = ['api', 'sse', '<roomId>']
  const roomId = segments[2] ?? '';
  const infra = getSharedInfra();
  return handleSse(request, roomId, {
    roomStore: infra.roomStore,
    bus: infra.bus,
    log: infra.log,
  });
}
