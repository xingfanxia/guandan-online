// POST /api/room/[code]/start — Vercel route wrapper.

import { createRealtimeInfra } from '../../../lib/realtime/infra.js';
import { handleStartGame } from '../../../lib/api/startGame.js';

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
  return handleStartGame(req, code, {
    roomStore: infra.roomStore,
    roundStore: infra.roundStore,
    sessionStore: infra.sessionStore,
    bus: infra.bus,
    log: infra.log,
  });
}
