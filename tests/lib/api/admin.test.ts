import { describe, it, expect, vi } from 'vitest';
import {
  fetchReports,
  setBan,
  resetStats,
  fetchLatency,
} from '@/lib/api/admin';
import { RoomApiError } from '@/lib/api/rooms';

function mockResponse(body: unknown, init: { status?: number; ok?: boolean } = {}): Response {
  const status = init.status ?? 200;
  const ok = init.ok ?? (status >= 200 && status < 300);
  return {
    ok,
    status,
    async text() {
      return body === undefined ? '' : JSON.stringify(body);
    },
  } as unknown as Response;
}

describe('admin API client', () => {
  describe('fetchReports', () => {
    it('GETs with bearer + limit and unwraps the reports array', async () => {
      const reports = [
        { reporterHandle: '@a', targetHandle: '@b', gameId: 'G1', reason: 'cheating', createdAt: 1 },
      ];
      const fetcher = vi.fn().mockResolvedValue(mockResponse({ reports }));
      const result = await fetchReports('tok', 25, { fetcher });
      expect(result).toEqual(reports);
      const [url, init] = fetcher.mock.calls[0]!;
      expect(url).toBe('/api/admin/reports?limit=25');
      expect(init).toMatchObject({ method: 'GET', headers: { authorization: 'Bearer tok' } });
    });

    it('throws RoomApiError on 401', async () => {
      const fetcher = vi.fn().mockResolvedValue(mockResponse({ error: 'unauthorized' }, { status: 401 }));
      await expect(fetchReports('bad', 50, { fetcher })).rejects.toMatchObject({
        name: 'RoomApiError',
        status: 401,
        code: 'unauthorized',
      });
    });
  });

  describe('setBan', () => {
    it('POSTs handle + banned with bearer', async () => {
      const fetcher = vi.fn().mockResolvedValue(
        mockResponse({ ok: true, handle: '@x', banned: true })
      );
      const result = await setBan('tok', '@x', true, { fetcher });
      expect(result).toMatchObject({ handle: '@x', banned: true });
      const [url, init] = fetcher.mock.calls[0]!;
      expect(url).toBe('/api/admin/ban');
      expect(init.method).toBe('POST');
      expect(JSON.parse(init.body as string)).toEqual({ handle: '@x', banned: true });
      expect((init.headers as Record<string, string>)['authorization']).toBe('Bearer tok');
    });
  });

  describe('resetStats', () => {
    it('POSTs the handle and returns gamesPlayed', async () => {
      const fetcher = vi.fn().mockResolvedValue(
        mockResponse({ ok: true, handle: '@x', gamesPlayed: 0 })
      );
      const result = await resetStats('tok', '@x', { fetcher });
      expect(result.gamesPlayed).toBe(0);
      const [url, init] = fetcher.mock.calls[0]!;
      expect(url).toBe('/api/admin/reset-stats');
      expect(JSON.parse(init.body as string)).toEqual({ handle: '@x' });
    });

    it('surfaces a 404 as RoomApiError', async () => {
      const fetcher = vi.fn().mockResolvedValue(mockResponse({ error: 'not_found' }, { status: 404 }));
      await expect(resetStats('tok', '@ghost', { fetcher })).rejects.toMatchObject({
        status: 404,
        code: 'not_found',
      });
    });
  });

  describe('fetchLatency', () => {
    it('GETs the aggregate and unwraps regions', async () => {
      const regions = { iad1: { p50: 50, p95: 95, p99: 99, count: 100 } };
      const fetcher = vi.fn().mockResolvedValue(mockResponse({ regions }));
      const result = await fetchLatency('tok', { fetcher });
      expect(result).toEqual(regions);
      const [url, init] = fetcher.mock.calls[0]!;
      expect(url).toBe('/api/telemetry/latency');
      expect((init.headers as Record<string, string>)['authorization']).toBe('Bearer tok');
    });

    it('wraps network failures as network_error', async () => {
      const fetcher = vi.fn().mockRejectedValue(new Error('offline'));
      const err = await fetchLatency('tok', { fetcher }).catch((e) => e);
      expect(err).toBeInstanceOf(RoomApiError);
      expect((err as RoomApiError).code).toBe('network_error');
    });
  });
});
