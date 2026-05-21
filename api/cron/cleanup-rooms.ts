// GET /api/cron/cleanup-rooms — Vercel cron route wrapper.
//
// vercel.json registers this path with an hourly cron schedule. Vercel sends
// `Authorization: Bearer ${CRON_SECRET}` on cron-triggered invocations
// (https://vercel.com/docs/cron-jobs/manage-cron-jobs#securing-cron-jobs).
// We compare against ADMIN_TOKEN, set in the project env vars — the same
// secret the sibling scorer uses for its admin endpoints.

import { createRealtimeInfra } from '../../lib/realtime/infra.js';
import { handleCleanupRooms } from '../../lib/api/cleanupRooms.js';

let infraCache: ReturnType<typeof createRealtimeInfra> | null = null;
function getInfra() {
  if (!infraCache) {
    infraCache = createRealtimeInfra(process.env);
  }
  return infraCache;
}

export default async function handler(req: Request): Promise<Response> {
  const infra = getInfra();
  return handleCleanupRooms(req, {
    roomStore: infra.roomStore,
    adminToken: process.env['ADMIN_TOKEN'] ?? process.env['CRON_SECRET'],
  });
}
