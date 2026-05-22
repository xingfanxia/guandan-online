// GET /api/room/[code] — Vercel route wrapper.

import { getSharedInfra } from '../../lib/realtime/sharedInfra.js';
import { handleGetRoom } from '../../lib/api/getRoom.js';

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const segments = url.pathname.split('/').filter(Boolean);
  // /api/room/<code> → segments[2] = <code>
  const code = segments[2] ?? '';
  const infra = getSharedInfra();
  return handleGetRoom(request, code, { roomStore: infra.roomStore });
}
