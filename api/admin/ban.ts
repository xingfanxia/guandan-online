// POST /api/admin/ban — Vercel route wrapper.
// Admin-token-gated (ADMIN_TOKEN env var). Logic in lib/api/adminBan.ts.

import { getProfileStore } from '../../lib/storage/sharedStores.js';
import { handleAdminBan } from '../../lib/api/adminBan.js';

export async function POST(request: Request): Promise<Response> {
  return handleAdminBan(request, {
    profileStore: getProfileStore(),
    adminToken: process.env['ADMIN_TOKEN'],
  });
}
