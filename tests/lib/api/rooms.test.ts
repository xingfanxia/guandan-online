import { describe, it, expect, vi } from 'vitest';
import {
  createRoom,
  joinRoom,
  leaveRoom,
  startGame,
  getRoom,
  seatCountForMode,
  RoomApiError,
} from '@/lib/api/rooms';

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

describe('rooms API client', () => {
  describe('createRoom', () => {
    it('posts JSON body with mode + handle and returns response', async () => {
      const fetcher = vi.fn().mockResolvedValue(
        mockResponse(
          { code: 'A1B2C3', hostId: 'p0', hostToken: 'ht', hostJoinToken: 'jt' },
          { status: 201 }
        )
      );
      const result = await createRoom({ mode: '4', handle: '@阿祥' }, { fetcher });
      expect(result.code).toBe('A1B2C3');
      expect(fetcher).toHaveBeenCalledTimes(1);
      const [url, init] = fetcher.mock.calls[0]!;
      expect(url).toBe('/api/room/create');
      expect(init).toMatchObject({
        method: 'POST',
        headers: { 'content-type': 'application/json' },
      });
      expect(JSON.parse(init.body as string)).toEqual({
        mode: '4',
        host: { handle: '@阿祥' },
      });
    });

    it('throws RoomApiError with parsed server error code', async () => {
      const fetcher = vi.fn().mockResolvedValue(
        mockResponse({ error: 'invalid_request', details: 'handle too short' }, { status: 400 })
      );
      await expect(createRoom({ mode: '4', handle: '@x' }, { fetcher })).rejects.toMatchObject({
        name: 'RoomApiError',
        status: 400,
        code: 'invalid_request',
        details: 'handle too short',
      });
    });

    it('wraps network failures as code "network_error"', async () => {
      const fetcher = vi.fn().mockRejectedValue(new Error('connection refused'));
      const err = await createRoom({ mode: '4', handle: '@x' }, { fetcher }).catch((e) => e);
      expect(err).toBeInstanceOf(RoomApiError);
      expect((err as RoomApiError).code).toBe('network_error');
      expect((err as RoomApiError).status).toBe(0);
    });

    it('respects baseUrl override', async () => {
      const fetcher = vi.fn().mockResolvedValue(
        mockResponse(
          { code: 'X', hostId: 'p0', hostToken: 't', hostJoinToken: 'j' },
          { status: 201 }
        )
      );
      await createRoom(
        { mode: '4', handle: '@x' },
        { fetcher, baseUrl: 'https://gdo.ax0x.ai' }
      );
      expect(fetcher.mock.calls[0]?.[0]).toBe('https://gdo.ax0x.ai/api/room/create');
    });
  });

  describe('joinRoom', () => {
    it('posts handle to /api/room/:code/join', async () => {
      const fetcher = vi.fn().mockResolvedValue(
        mockResponse({ playerId: 'p1', joinToken: 'tok' }, { status: 200 })
      );
      const result = await joinRoom('A1B2C3', { handle: '@饭团' }, { fetcher });
      expect(result).toEqual({ playerId: 'p1', joinToken: 'tok' });
      const [url, init] = fetcher.mock.calls[0]!;
      expect(url).toBe('/api/room/A1B2C3/join');
      expect(JSON.parse(init.body as string)).toEqual({ handle: '@饭团' });
    });

    it('encodes room code', async () => {
      const fetcher = vi.fn().mockResolvedValue(
        mockResponse({ playerId: 'p1', joinToken: 'tok' }, { status: 200 })
      );
      await joinRoom('A B/C', { handle: '@x' }, { fetcher });
      expect(fetcher.mock.calls[0]?.[0]).toBe('/api/room/A%20B%2FC/join');
    });

    it('surfaces 404 room_not_found', async () => {
      const fetcher = vi.fn().mockResolvedValue(
        mockResponse({ error: 'room_not_found' }, { status: 404 })
      );
      await expect(joinRoom('ZZZZZZ', { handle: '@x' }, { fetcher })).rejects.toMatchObject({
        code: 'room_not_found',
        status: 404,
      });
    });
  });

  describe('leaveRoom', () => {
    it('sends Bearer joinToken', async () => {
      const fetcher = vi.fn().mockResolvedValue(mockResponse({ ok: true }));
      const result = await leaveRoom('A1B2C3', 'my-token', { fetcher });
      expect(result).toEqual({ ok: true });
      const init = fetcher.mock.calls[0]?.[1] as RequestInit;
      expect(init.method).toBe('POST');
      expect((init.headers as Record<string, string>).authorization).toBe('Bearer my-token');
    });

    it('surfaces dissolved flag when host leaves', async () => {
      const fetcher = vi.fn().mockResolvedValue(mockResponse({ ok: true, dissolved: true }));
      const result = await leaveRoom('A1B2C3', 'host-tok', { fetcher });
      expect(result).toEqual({ ok: true, dissolved: true });
    });
  });

  describe('startGame', () => {
    it('sends Bearer hostToken', async () => {
      const fetcher = vi.fn().mockResolvedValue(mockResponse({ ok: true, version: 1 }));
      const result = await startGame('A1B2C3', 'host-tok', { fetcher });
      expect(result).toEqual({ ok: true, version: 1 });
      const init = fetcher.mock.calls[0]?.[1] as RequestInit;
      expect((init.headers as Record<string, string>).authorization).toBe('Bearer host-tok');
    });

    it('surfaces 409 when room not full', async () => {
      const fetcher = vi.fn().mockResolvedValue(
        mockResponse(
          { error: 'conflict', details: 'room needs 4 members, has 2' },
          { status: 409 }
        )
      );
      await expect(startGame('A1B2C3', 'tok', { fetcher })).rejects.toMatchObject({
        code: 'conflict',
        status: 409,
        details: 'room needs 4 members, has 2',
      });
    });
  });

  describe('getRoom', () => {
    it('GETs public room view', async () => {
      const publicRoom = {
        code: 'A1B2C3',
        mode: '4',
        phase: 'lobby',
        hostId: 'p0',
        members: [{ id: 'p0', handle: '@a', joinedAt: 0, status: 'connected' }],
        createdAt: 0,
        lastActiveAt: 0,
      };
      const fetcher = vi.fn().mockResolvedValue(mockResponse(publicRoom));
      const result = await getRoom('A1B2C3', { fetcher });
      expect(result.code).toBe('A1B2C3');
      expect(result.members).toHaveLength(1);
      const [url, init] = fetcher.mock.calls[0]!;
      expect(url).toBe('/api/room/A1B2C3');
      expect(init.method).toBe('GET');
    });
  });

  describe('seatCountForMode', () => {
    it('maps mode → seat count', () => {
      expect(seatCountForMode('4')).toBe(4);
      expect(seatCountForMode('6')).toBe(6);
      expect(seatCountForMode('8')).toBe(8);
    });
  });

  describe('error response edge cases', () => {
    it('falls back to http_<status> when error body has no error field', async () => {
      const fetcher = vi.fn().mockResolvedValue(mockResponse({}, { status: 500 }));
      const err = await createRoom({ mode: '4', handle: '@x' }, { fetcher }).catch((e) => e);
      expect((err as RoomApiError).code).toBe('http_500');
    });

    it('rejects with invalid_response on non-JSON body', async () => {
      const fetcher = vi.fn().mockResolvedValue({
        ok: false,
        status: 502,
        async text() {
          return '<html>bad gateway</html>';
        },
      } as unknown as Response);
      const err = await createRoom({ mode: '4', handle: '@x' }, { fetcher }).catch((e) => e);
      expect((err as RoomApiError).code).toBe('invalid_response');
    });
  });
});
