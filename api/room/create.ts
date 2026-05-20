// POST /api/room/create — Vercel route wrapper.
// All logic lives in lib/api/createRoom.ts so it stays unit-testable.

import { createRealtimeInfra } from '../../lib/realtime/infra';
import { handleCreateRoom } from '../../lib/api/createRoom';

let infraCache: ReturnType<typeof createRealtimeInfra> | null = null;
function getInfra() {
  if (!infraCache) {
    infraCache = createRealtimeInfra(process.env);
  }
  return infraCache;
}

export default async function handler(req: Request): Promise<Response> {
  const infra = getInfra();
  return handleCreateRoom(req, { roomStore: infra.roomStore });
}
