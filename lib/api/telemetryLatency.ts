// /api/telemetry/latency — pure handler logic. (DEPLOY-2)
//
//   POST  — ingest one latency beacon { region?, roundTripMs }. Region is
//           optional from the client; when absent the server tags it from a
//           geo header (`x-vercel-ip-country-region` / `x-vercel-ip-city`) or
//           falls back to 'unknown'. Unauthenticated + rate-limit-gated, like
//           /api/report (clients fire-and-forget a beacon per round).
//   GET   — admin-token-gated read of the p50/p95/p99 aggregate per region,
//           for the AdminDashboard latency panel. Auth mirrors cleanupRooms.ts.

import { authorizeAdmin, json } from './adminAuth.js';
import type { RateLimiter } from '../security/rateLimit.js';
import type { LatencyAggregate, LatencyStore } from '../telemetry/aggregate.js';

export interface TelemetryLatencyDeps {
  latencyStore: LatencyStore;
  /** Admin token gating the GET aggregate. POST never needs it. */
  adminToken?: string;
  /** Wall clock. Defaults to Date.now. */
  now?: () => number;
  /** Optional per-IP rate limiter for POST. */
  rateLimiter?: RateLimiter;
  /** How to derive the rate-limit identity. Defaults to X-Forwarded-For. */
  identify?: (req: Request) => string;
}

export interface IngestResponseBody {
  ok: true;
  region: string;
}

export interface AggregateResponseBody {
  regions: LatencyAggregate;
}

/** Largest accepted round-trip time (ms). Anything beyond this is almost
 * certainly a stuck timer / clock skew, not a real measurement — clamp it out
 * so one bogus 9e15 sample can't dominate the p99. */
const MAX_RTT_MS = 120_000;

export async function handleTelemetryLatency(
  req: Request,
  deps: TelemetryLatencyDeps
): Promise<Response> {
  if (req.method === 'POST') return ingest(req, deps);
  if (req.method === 'GET') return readAggregate(req, deps);
  return json({ error: 'method_not_allowed' }, 405);
}

async function ingest(req: Request, deps: TelemetryLatencyDeps): Promise<Response> {
  if (deps.rateLimiter) {
    const ident = deps.identify ? deps.identify(req) : extractIdentity(req);
    const now = (deps.now ?? Date.now)();
    const rl = await deps.rateLimiter.check(`latency:${ident}`, now);
    if (!rl.allowed) {
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (rl.retryAfterMs !== undefined) {
        headers['retry-after'] = Math.ceil(rl.retryAfterMs / 1000).toString();
      }
      return new Response(JSON.stringify({ error: 'rate_limited' }), {
        status: 429,
        headers,
      });
    }
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }

  const parsed = parseBeacon(body);
  if (!parsed.ok) {
    return json({ error: 'invalid_request', details: parsed.error }, 400);
  }

  // Region precedence: explicit client value → geo header → 'unknown'.
  const region = parsed.value.region ?? regionFromHeaders(req) ?? 'unknown';

  try {
    await deps.latencyStore.record({
      region,
      roundTripMs: parsed.value.roundTripMs,
      at: (deps.now ?? Date.now)(),
    });
    const responseBody: IngestResponseBody = { ok: true, region };
    return json(responseBody, 200);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[telemetry/latency] failed to record beacon', message);
    return json({ error: 'internal_error', details: message }, 500);
  }
}

async function readAggregate(
  req: Request,
  deps: TelemetryLatencyDeps
): Promise<Response> {
  const auth = authorizeAdmin(req, deps.adminToken);
  if (auth.reject) return auth.reject;
  try {
    const regions = await deps.latencyStore.aggregate();
    const body: AggregateResponseBody = { regions };
    return json(body, 200);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[telemetry/latency] failed to aggregate', message);
    return json({ error: 'internal_error', details: message }, 500);
  }
}

function parseBeacon(
  body: unknown
): { ok: true; value: { region?: string; roundTripMs: number } } | { ok: false; error: string } {
  if (!body || typeof body !== 'object') {
    return { ok: false, error: 'body must be a JSON object' };
  }
  const obj = body as Record<string, unknown>;
  const rtt = obj['roundTripMs'];
  if (typeof rtt !== 'number' || !Number.isFinite(rtt) || rtt < 0) {
    return { ok: false, error: 'roundTripMs must be a non-negative number' };
  }
  const clamped = Math.min(rtt, MAX_RTT_MS);
  const regionRaw = obj['region'];
  if (regionRaw !== undefined && typeof regionRaw !== 'string') {
    return { ok: false, error: 'region must be a string when present' };
  }
  const region =
    typeof regionRaw === 'string' && regionRaw.trim().length > 0
      ? regionRaw.trim()
      : undefined;
  const value: { region?: string; roundTripMs: number } = { roundTripMs: clamped };
  if (region !== undefined) value.region = region;
  return { ok: true, value };
}

/** Derive a coarse region from Vercel's geo headers, if present. */
function regionFromHeaders(req: Request): string | null {
  const region = req.headers.get('x-vercel-ip-country-region');
  const country = req.headers.get('x-vercel-ip-country');
  if (region && country) return `${country}-${region}`;
  if (country) return country;
  return null;
}

function extractIdentity(req: Request): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0]!.trim();
  const real = req.headers.get('x-real-ip');
  if (real) return real;
  return 'anon';
}
