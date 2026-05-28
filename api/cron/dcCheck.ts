// GET /api/cron/dcCheck — Vercel cron route wrapper.
//
// vercel.json registers this path with a per-minute cron schedule (Vercel's
// minimum granularity). Vercel sends `Authorization: Bearer ${CRON_SECRET}`
// on cron-triggered invocations; we compare against ADMIN_TOKEN (same secret
// the sibling scorer + cleanup-rooms cron use).
//
// AI-4: promotes disconnected humans to bots in in-game rooms so abandoned
// tables keep moving. See lib/api/dcCheck.ts for the sweep logic + blast-radius
// note (a leaked ADMIN_TOKEN lets a caller seize seats across all live games).

import { getSharedInfra } from '../../lib/realtime/sharedInfra.js';
import { getSeenStore } from '../../lib/storage/sharedStores.js';
import { handleDcCheck } from '../../lib/api/dcCheck.js';

export async function GET(request: Request): Promise<Response> {
  const infra = getSharedInfra();
  const seenStore = getSeenStore();
  return handleDcCheck(request, {
    roomStore: infra.roomStore,
    roundStore: infra.roundStore,
    adminToken: process.env['ADMIN_TOKEN'] ?? process.env['CRON_SECRET'],
    getSeen: (code, playerId) => seenStore.getSeen(code, playerId),
  });
}
