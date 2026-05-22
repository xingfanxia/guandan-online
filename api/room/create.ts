// POST /api/room/create — Vercel route wrapper.
// All logic lives in lib/api/createRoom.ts so it stays unit-testable.

import { createRealtimeInfra } from '../../lib/realtime/infra.js';
import { handleCreateRoom } from '../../lib/api/createRoom.js';

let infraCache: ReturnType<typeof createRealtimeInfra> | null = null;
function getInfra() {
  if (!infraCache) {
    infraCache = createRealtimeInfra(process.env);
  }
  return infraCache;
}

export async function POST(request: Request): Promise<Response> {
  const infra = getInfra();
  return handleCreateRoom(request, { roomStore: infra.roomStore });
}
