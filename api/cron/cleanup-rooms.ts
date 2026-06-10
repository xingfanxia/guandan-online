// GET /api/cron/cleanup-rooms — Vercel cron route wrapper.
//
// vercel.json registers this path with an hourly cron schedule. Vercel sends
// `Authorization: Bearer ${CRON_SECRET}` on cron-triggered invocations
// (https://vercel.com/docs/cron-jobs/manage-cron-jobs#securing-cron-jobs).
// We compare against ADMIN_TOKEN, set in the project env vars — the same
// secret the sibling scorer uses for its admin endpoints.
//
// SECURITY — BLAST RADIUS (see .env.example for rotation guidance)
// This route is reachable on the public Internet; the ONLY gate is the bearer
// token check inside handleCleanupRooms. There is no rate limit and no
// per-call delete cap. A leaked ADMIN_TOKEN lets any caller enumerate every
// active room code and drop the corresponding state (every in-flight game
// vanishes within seconds). Treat ADMIN_TOKEN as a project-killing secret;
// rotate immediately on any suspected leak.

import { getSharedInfra } from '../../lib/realtime/sharedInfra.js';
import { handleCleanupRooms } from '../../lib/api/cleanupRooms.js';
import { createStreamPurge } from '../../lib/realtime/streamPurge.js';

export async function GET(request: Request): Promise<Response> {
  const infra = getSharedInfra();
  return handleCleanupRooms(request, {
    roomStore: infra.roomStore,
    // Reclaims the room's event/bus streams alongside the room record —
    // stream TTL refresh is best-effort, so the cron is the backstop.
    purgeStreams: createStreamPurge(infra.redis),
    adminToken: process.env['ADMIN_TOKEN'] ?? process.env['CRON_SECRET'],
  });
}
