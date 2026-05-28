// POST /api/admin/reset-stats — Vercel route wrapper.
// Admin-token-gated (ADMIN_TOKEN env var). Logic in lib/api/adminResetStats.ts.

import { getProfileStore } from '../../lib/storage/sharedStores.js';
import { handleAdminResetStats } from '../../lib/api/adminResetStats.js';

export async function POST(request: Request): Promise<Response> {
  return handleAdminResetStats(request, {
    profileStore: getProfileStore(),
    adminToken: process.env['ADMIN_TOKEN'],
  });
}
