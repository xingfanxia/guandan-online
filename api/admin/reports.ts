// GET /api/admin/reports — Vercel route wrapper.
// Admin-token-gated (ADMIN_TOKEN env var). Logic in lib/api/adminReports.ts.

import { getReportStore } from '../../lib/storage/sharedStores.js';
import { handleAdminReports } from '../../lib/api/adminReports.js';

export async function GET(request: Request): Promise<Response> {
  return handleAdminReports(request, {
    reportStore: getReportStore(),
    adminToken: process.env['ADMIN_TOKEN'],
  });
}
