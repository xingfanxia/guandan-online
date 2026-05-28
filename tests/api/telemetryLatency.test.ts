// Behavior tests for handleTelemetryLatency — POST ingest + GET aggregate.

import { describe, expect, it } from 'vitest';
import {
  handleTelemetryLatency,
  type IngestResponseBody,
  type AggregateResponseBody,
} from '@lib/api/telemetryLatency';
import { createMemoryLatencyStore } from '@lib/telemetry/aggregate';
import type { RateLimiter } from '@lib/security/rateLimit';

const TOKEN = 'admin-secret-xyz';

function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('http://test/api/telemetry/latency', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

function get(bearer?: string): Request {
  const headers: Record<string, string> = {};
  if (bearer) headers['authorization'] = `Bearer ${bearer}`;
  return new Request('http://test/api/telemetry/latency', { method: 'GET', headers });
}

describe('handleTelemetryLatency — POST ingest', () => {
  it('records a beacon with an explicit region (200)', async () => {
    const store = createMemoryLatencyStore();
    const res = await handleTelemetryLatency(post({ region: 'iad1', roundTripMs: 42 }), {
      latencyStore: store,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as IngestResponseBody;
    expect(body).toEqual({ ok: true, region: 'iad1' });
    const agg = await store.aggregate();
    expect(agg['iad1']!.count).toBe(1);
  });

  it('falls back to "unknown" region when none supplied + no geo header', async () => {
    const store = createMemoryLatencyStore();
    const res = await handleTelemetryLatency(post({ roundTripMs: 10 }), { latencyStore: store });
    const body = (await res.json()) as IngestResponseBody;
    expect(body.region).toBe('unknown');
  });

  it('tags region from Vercel geo headers when client omits it', async () => {
    const store = createMemoryLatencyStore();
    const res = await handleTelemetryLatency(
      post({ roundTripMs: 10 }, {
        'x-vercel-ip-country': 'US',
        'x-vercel-ip-country-region': 'CA',
      }),
      { latencyStore: store }
    );
    const body = (await res.json()) as IngestResponseBody;
    expect(body.region).toBe('US-CA');
  });

  it('rejects a negative roundTripMs', async () => {
    const store = createMemoryLatencyStore();
    const res = await handleTelemetryLatency(post({ roundTripMs: -5 }), { latencyStore: store });
    expect(res.status).toBe(400);
  });

  it('rejects a non-numeric roundTripMs', async () => {
    const store = createMemoryLatencyStore();
    const res = await handleTelemetryLatency(post({ roundTripMs: 'fast' }), { latencyStore: store });
    expect(res.status).toBe(400);
  });

  it('clamps an absurdly large sample so it cannot dominate p99', async () => {
    const store = createMemoryLatencyStore();
    await handleTelemetryLatency(post({ region: 'r', roundTripMs: 9e15 }), { latencyStore: store });
    const agg = await store.aggregate();
    // Clamped to MAX_RTT_MS (120_000), not the raw 9e15.
    expect(agg['r']!.p99).toBe(120_000);
  });

  it('honors the rate limiter on POST (429)', async () => {
    const denying: RateLimiter = { check: () => ({ allowed: false, retryAfterMs: 2000 }) };
    const res = await handleTelemetryLatency(post({ roundTripMs: 1 }), {
      latencyStore: createMemoryLatencyStore(),
      rateLimiter: denying,
    });
    expect(res.status).toBe(429);
  });
});

describe('handleTelemetryLatency — GET aggregate (admin-gated)', () => {
  it('503 when admin token unset', async () => {
    const res = await handleTelemetryLatency(get('x'), {
      latencyStore: createMemoryLatencyStore(),
    });
    expect(res.status).toBe(503);
  });

  it('401 on a bad bearer', async () => {
    const res = await handleTelemetryLatency(get('wrong'), {
      latencyStore: createMemoryLatencyStore(),
      adminToken: TOKEN,
    });
    expect(res.status).toBe(401);
  });

  it('200 + aggregate on a good bearer', async () => {
    const store = createMemoryLatencyStore();
    for (let i = 1; i <= 100; i++) await store.record({ region: 'iad1', roundTripMs: i, at: i });
    const res = await handleTelemetryLatency(get(TOKEN), { latencyStore: store, adminToken: TOKEN });
    expect(res.status).toBe(200);
    const body = (await res.json()) as AggregateResponseBody;
    expect(body.regions['iad1']).toEqual({ p50: 50, p95: 95, p99: 99, count: 100 });
  });

  it('rejects unsupported methods (PUT)', async () => {
    const res = await handleTelemetryLatency(
      new Request('http://test/api/telemetry/latency', { method: 'PUT' }),
      { latencyStore: createMemoryLatencyStore(), adminToken: TOKEN }
    );
    expect(res.status).toBe(405);
  });
});
