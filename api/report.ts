// POST /api/report — Vercel route wrapper.
// Logic lives in lib/api/report.ts. Per-IP rate limit (10/min) gates the
// unauthenticated report surface against spam; shared report store comes from
// sharedStores.ts (Redis in prod, memory in dev).

import { getSharedRateLimiter } from '../lib/realtime/sharedInfra.js';
import { getReportStore } from '../lib/storage/sharedStores.js';
import { handleReport } from '../lib/api/report.js';

export async function POST(request: Request): Promise<Response> {
  const rateLimiter = getSharedRateLimiter({
    prefix: 'rl:report',
    windowMs: 60_000,
    max: 10,
  });
  return handleReport(request, {
    reportStore: getReportStore(),
    rateLimiter,
  });
}
