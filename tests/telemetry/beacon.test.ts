// Behavior tests for the client latency beacon helper.

import { describe, expect, it, vi } from 'vitest';
import {
  sendLatencyBeacon,
  measureRoundTrip,
  measureAndBeacon,
} from '@/lib/telemetry/beacon';

function okFetch(): typeof fetch {
  return vi.fn().mockResolvedValue(new Response('{}', { status: 200 })) as unknown as typeof fetch;
}

describe('sendLatencyBeacon', () => {
  it('POSTs roundTripMs to the telemetry endpoint and returns true on 2xx', async () => {
    const fetcher = okFetch();
    const ok = await sendLatencyBeacon(37, { fetcher });
    expect(ok).toBe(true);
    const [url, init] = (fetcher as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toBe('/api/telemetry/latency');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ roundTripMs: 37 });
  });

  it('includes region when provided', async () => {
    const fetcher = okFetch();
    await sendLatencyBeacon(10, { fetcher, region: 'iad1' });
    const [, init] = (fetcher as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(JSON.parse(init.body)).toEqual({ roundTripMs: 10, region: 'iad1' });
  });

  it('honors a base url', async () => {
    const fetcher = okFetch();
    await sendLatencyBeacon(5, { fetcher, baseUrl: 'https://api.example' });
    const [url] = (fetcher as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toBe('https://api.example/api/telemetry/latency');
  });

  it('returns false (never throws) when fetch rejects', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error('offline')) as unknown as typeof fetch;
    await expect(sendLatencyBeacon(10, { fetcher })).resolves.toBe(false);
  });

  it('returns false on a non-2xx response', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('', { status: 500 })) as unknown as typeof fetch;
    expect(await sendLatencyBeacon(10, { fetcher })).toBe(false);
  });

  it('drops negative / non-finite samples without calling fetch', async () => {
    const fetcher = okFetch();
    expect(await sendLatencyBeacon(-1, { fetcher })).toBe(false);
    expect(await sendLatencyBeacon(Number.NaN, { fetcher })).toBe(false);
    expect((fetcher as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
  });
});

describe('measureRoundTrip', () => {
  it('returns the wrapped result plus a non-negative elapsed ms', async () => {
    const { result, roundTripMs } = await measureRoundTrip(async () => 'value');
    expect(result).toBe('value');
    expect(roundTripMs).toBeGreaterThanOrEqual(0);
  });

  it('re-throws the wrapped error', async () => {
    await expect(
      measureRoundTrip(async () => {
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');
  });
});

describe('measureAndBeacon', () => {
  it('returns the call result and fires a beacon', async () => {
    const fetcher = okFetch();
    const result = await measureAndBeacon(async () => 99, { fetcher });
    expect(result).toBe(99);
    // Beacon is fire-and-forget; allow the microtask to flush.
    await Promise.resolve();
    expect((fetcher as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThanOrEqual(1);
  });

  it('does not beacon when the wrapped call throws', async () => {
    const fetcher = okFetch();
    await expect(
      measureAndBeacon(async () => {
        throw new Error('fail');
      }, { fetcher })
    ).rejects.toThrow('fail');
    expect((fetcher as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
  });
});
