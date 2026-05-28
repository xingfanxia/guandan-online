// /api/telemetry/latency — Vercel route wrapper. (DEPLOY-2)
//   POST ingests a latency beacon (rate-limited, unauthenticated).
//   GET  returns the p50/p95/p99 aggregate (admin-token-gated).
// Logic in lib/api/telemetryLatency.ts; shared store from sharedStores.ts.

import { getSharedRateLimiter } from '../../lib/realtime/sharedInfra.js';
import { getLatencyStore } from '../../lib/storage/sharedStores.js';
import { handleTelemetryLatency } from '../../lib/api/telemetryLatency.js';

export async function POST(request: Request): Promise<Response> {
  // Beacons fire roughly once per game round per client; 30/min is generous
  // headroom while still blocking a flood.
  const rateLimiter = getSharedRateLimiter({
    prefix: 'rl:latency',
    windowMs: 60_000,
    max: 30,
  });
  return handleTelemetryLatency(request, {
    latencyStore: getLatencyStore(),
    rateLimiter,
  });
}

export async function GET(request: Request): Promise<Response> {
  return handleTelemetryLatency(request, {
    latencyStore: getLatencyStore(),
    adminToken: process.env['ADMIN_TOKEN'],
  });
}
