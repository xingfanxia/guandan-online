// Behavior tests for handleCreateRoom — pure HTTP handler exercised through
// synthetic Request objects + memory roomStore.

import { describe, expect, it } from 'vitest';
import {
  handleCreateRoom,
  ROOM_TTL_SECONDS,
  type CreateRoomResponseBody,
} from '@lib/api/createRoom';
import { createMemoryRoomStore } from '@lib/storage/roomStore';

function req(method: string, body: unknown): Request {
  return new Request('http://test/api/room/create', {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

// Deterministic generators for token/code/clock.
function counter(prefix: string): () => string {
  let n = 0;
  return () => `${prefix}-${++n}`;
}

const DEPS_OK = () => ({
  roomStore: createMemoryRoomStore(() => 1_700_000_000_000),
  tokenGen: counter('tok'),
  codeGen: counter('CODE'),
  now: () => 1_700_000_000_000,
});

describe('handleCreateRoom — happy path', () => {
  it('returns 201 with code + hostToken + hostJoinToken', async () => {
    const deps = DEPS_OK();
    const res = await handleCreateRoom(
      req('POST', { mode: '4', host: { handle: '@fufu' } }),
      deps
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as CreateRoomResponseBody;
    expect(body.code).toBe('CODE-1');
    expect(body.hostId).toBe('p0');
    expect(body.hostToken).toBe('tok-1');
    expect(body.hostJoinToken).toBe('tok-2');
  });

  it('persists the room so a subsequent get returns it', async () => {
    const deps = DEPS_OK();
    await handleCreateRoom(
      req('POST', { mode: '4', host: { handle: '@fufu' } }),
      deps
    );
    const persisted = await deps.roomStore.get('CODE-1');
    expect(persisted).not.toBeNull();
    expect(persisted?.mode).toBe('4');
    expect(persisted?.members[0]?.handle).toBe('fufu'); // normalized
  });

  it('accepts mode 4, 6, and 8', async () => {
    for (const mode of ['4', '6', '8']) {
      const deps = DEPS_OK();
      const res = await handleCreateRoom(
        req('POST', { mode, host: { handle: '@a' + mode.repeat(3) } }),
        deps
      );
      expect(res.status).toBe(201);
    }
  });
});

describe('handleCreateRoom — rejects invalid input', () => {
  it('rejects non-POST methods', async () => {
    const deps = DEPS_OK();
    const res = await handleCreateRoom(req('GET', undefined), deps);
    expect(res.status).toBe(405);
  });

  it('rejects invalid JSON', async () => {
    const deps = DEPS_OK();
    const r = new Request('http://test/api/room/create', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not-json',
    });
    const res = await handleCreateRoom(r, deps);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('invalid_json');
  });

  it('rejects an unsupported mode', async () => {
    const deps = DEPS_OK();
    const res = await handleCreateRoom(
      req('POST', { mode: '5', host: { handle: '@fufu' } }),
      deps
    );
    expect(res.status).toBe(400);
  });

  it('rejects missing host.handle', async () => {
    const deps = DEPS_OK();
    const res = await handleCreateRoom(
      req('POST', { mode: '4', host: {} }),
      deps
    );
    expect(res.status).toBe(400);
  });

  it('rejects too-short handle', async () => {
    const deps = DEPS_OK();
    const res = await handleCreateRoom(
      req('POST', { mode: '4', host: { handle: '@a' } }),
      deps
    );
    expect(res.status).toBe(400);
  });

  it('rejects handle with non-ASCII characters', async () => {
    const deps = DEPS_OK();
    const res = await handleCreateRoom(
      req('POST', { mode: '4', host: { handle: '@阿祥' } }),
      deps
    );
    expect(res.status).toBe(400);
  });
});

describe('handleCreateRoom — code collision retry', () => {
  it('retries on collision and succeeds with a different code', async () => {
    const roomStore = createMemoryRoomStore(() => 1_700_000_000_000);
    // Pre-populate "CODE-1" so the first attempt collides.
    await roomStore.create(
      // minimal valid RoomState
      {
        code: 'CODE-1',
        mode: '4',
        rules: (await import('@lib/game/mode')).DEFAULT_MODE_RULES,
        hostId: 'pX',
        hostToken: 'preset',
        members: [
          {
            id: 'pX',
            handle: 'preset',
            joinToken: 'preset-jt',
            joinedAt: 0,
            status: 'connected',
          },
        ],
        phase: 'lobby',
        createdAt: 0,
        lastActiveAt: 0,
        eventVersion: 0,
      },
      ROOM_TTL_SECONDS
    );
    const deps = {
      roomStore,
      tokenGen: counter('tok'),
      codeGen: counter('CODE'),
      now: () => 1_700_000_000_000,
    };
    const res = await handleCreateRoom(
      req('POST', { mode: '4', host: { handle: '@fufu' } }),
      deps
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as CreateRoomResponseBody;
    expect(body.code).toBe('CODE-2'); // first attempt was CODE-1 (collision), second was CODE-2
  });

  it('gives up after the retry cap with 503', async () => {
    const roomStore = createMemoryRoomStore(() => 1_700_000_000_000);
    // Always-collide: codeGen returns the same value, and we pre-seed it.
    const fixedCode = 'COLLIDE';
    await roomStore.create(
      {
        code: fixedCode,
        mode: '4',
        rules: (await import('@lib/game/mode')).DEFAULT_MODE_RULES,
        hostId: 'pX',
        hostToken: 'preset',
        members: [
          {
            id: 'pX',
            handle: 'preset',
            joinToken: 'preset-jt',
            joinedAt: 0,
            status: 'connected',
          },
        ],
        phase: 'lobby',
        createdAt: 0,
        lastActiveAt: 0,
        eventVersion: 0,
      },
      ROOM_TTL_SECONDS
    );
    const deps = {
      roomStore,
      tokenGen: counter('tok'),
      codeGen: () => fixedCode,
      now: () => 1_700_000_000_000,
    };
    const res = await handleCreateRoom(
      req('POST', { mode: '4', host: { handle: '@fufu' } }),
      deps
    );
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('code_generation_exhausted');
  });
});
