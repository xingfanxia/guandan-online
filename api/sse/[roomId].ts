// GET /api/sse/[roomId] — Vercel route wrapper.

import { getSharedInfra } from '../../lib/realtime/sharedInfra.js';
import { getSeenStore } from '../../lib/storage/sharedStores.js';
import { handleSse } from '../../lib/api/sse.js';

// AI-4: liveness TTL. Players are taken over after ~60s of silence, so a
// generous multiple keeps the key alive across normal heartbeat gaps but lets
// it expire well after a real disconnect.
const SEEN_TTL_SECONDS = 600;

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
  const seenStore = getSeenStore();
  return handleSse(request, roomId, {
    roomStore: infra.roomStore,
    roundStore: infra.roundStore,
    sessionStore: infra.sessionStore,
    bus: infra.bus,
    log: infra.log,
    markSeen: (playerId) =>
      seenStore.markSeen(roomId, playerId, Date.now(), SEEN_TTL_SECONDS),
  });
}
