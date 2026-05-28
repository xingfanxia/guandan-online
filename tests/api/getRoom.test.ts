// Behavior tests for handleGetRoom. Confirms public projection strips
// tokens + that the standard error codes fire.

import { describe, expect, it } from 'vitest';
import {
  handleGetRoom,
  type PublicRoomState,
} from '@lib/api/getRoom';
import {
  handleCreateRoom,
  type CreateRoomResponseBody,
} from '@lib/api/createRoom';
import { handleJoinRoom } from '@lib/api/joinRoom';
import { createMemoryRoomStore } from '@lib/storage/roomStore';

const CODE = 'A2B3C4';

function req(method: string): Request {
  return new Request('http://test/', { method });
}

function counter(prefix: string): () => string {
  let n = 0;
  return () => `${prefix}-${++n}`;
}

async function seed(): Promise<ReturnType<typeof createMemoryRoomStore>> {
  const roomStore = createMemoryRoomStore(() => 1_700_000_000_000);
  await handleCreateRoom(
    new Request('http://test/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: '4', host: { handle: '@host' } }),
    }),
    {
      roomStore,
      tokenGen: counter('tok'),
      codeGen: () => CODE,
      now: () => 1_700_000_000_000,
    }
  );
  await handleJoinRoom(
    new Request('http://test/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ handle: '@joiner' }),
    }),
    CODE,
    {
      roomStore,
      tokenGen: counter('jt'),
      now: () => 1_700_000_000_000,
    }
  );
  return roomStore;
}

describe('handleGetRoom — happy path', () => {
  it('returns 200 with the public room view', async () => {
    const roomStore = await seed();
    const res = await handleGetRoom(req('GET'), CODE, { roomStore });
    expect(res.status).toBe(200);
    const body = (await res.json()) as PublicRoomState;
    expect(body.code).toBe(CODE);
    expect(body.mode).toBe('4');
    expect(body.phase).toBe('lobby');
    expect(body.hostId).toBe('p0');
    expect(body.members).toHaveLength(2);
    expect(body.members.map((m) => m.handle)).toEqual(['host', 'joiner']);
  });

  it('omits hostToken and per-member joinToken from the public view', async () => {
    const roomStore = await seed();
    const res = await handleGetRoom(req('GET'), CODE, { roomStore });
    const text = await res.text();
    expect(text).not.toContain('hostToken');
    expect(text).not.toContain('joinToken');
    // Sanity: the underlying state DOES have them — we just don't expose.
    const raw = await roomStore.get(CODE);
    expect(raw?.hostToken).toBeDefined();
    expect(raw?.members[0]?.joinToken).toBeDefined();
  });
});

describe('handleGetRoom — errors', () => {
  it('rejects non-GET methods', async () => {
    const roomStore = await seed();
    const res = await handleGetRoom(req('POST'), CODE, { roomStore });
    expect(res.status).toBe(405);
  });

  it('rejects malformed room codes', async () => {
    const roomStore = await seed();
    const res = await handleGetRoom(req('GET'), 'BAD', { roomStore });
    expect(res.status).toBe(400);
  });

  it('returns 404 for unknown room', async () => {
    const roomStore = createMemoryRoomStore();
    const res = await handleGetRoom(req('GET'), 'D5E6F7', { roomStore });
    expect(res.status).toBe(404);
  });
});

describe('handleGetRoom — SEC-2 host-only sharedIpGroups', () => {
  // Build a room where two members share an ipHash.
  async function seedSharedIp(): Promise<{
    roomStore: ReturnType<typeof createMemoryRoomStore>;
    hostToken: string;
  }> {
    const roomStore = await seed();
    const state = (await roomStore.get(CODE))!;
    const members = state.members.map((m) => ({ ...m, ipHash: 'SAMEHASH' }));
    await roomStore.put({ ...state, members }, 86_400);
    return { roomStore, hostToken: state.hostToken };
  }

  it('omits sharedIpGroups for a non-host (no token)', async () => {
    const { roomStore } = await seedSharedIp();
    const res = await handleGetRoom(req('GET'), CODE, { roomStore });
    const body = (await res.json()) as PublicRoomState;
    expect(body.sharedIpGroups).toBeUndefined();
  });

  it('omits sharedIpGroups for a wrong token', async () => {
    const { roomStore } = await seedSharedIp();
    const res = await handleGetRoom(
      new Request(`http://test/?hostToken=WRONG`, { method: 'GET' }),
      CODE,
      { roomStore }
    );
    const body = (await res.json()) as PublicRoomState;
    expect(body.sharedIpGroups).toBeUndefined();
  });

  it('includes sharedIpGroups for the verified host', async () => {
    const { roomStore, hostToken } = await seedSharedIp();
    const res = await handleGetRoom(
      new Request(`http://test/?hostToken=${encodeURIComponent(hostToken)}`, {
        method: 'GET',
      }),
      CODE,
      { roomStore }
    );
    const body = (await res.json()) as PublicRoomState;
    expect(body.sharedIpGroups).toHaveLength(1);
    expect(body.sharedIpGroups![0]!.handles.length).toBe(2);
    // The ipHash itself must NOT leak the raw value beyond the opaque hash;
    // and per-member ipHash is never in the member projection.
    const text = JSON.stringify(body.members);
    expect(text).not.toContain('SAMEHASH');
  });
});

describe('handleGetRoom — confirms response structure for clients', () => {
  it('contains createdAt + lastActiveAt timestamps as numbers', async () => {
    const roomStore = await seed();
    const res = await handleGetRoom(req('GET'), CODE, { roomStore });
    const body = (await res.json()) as PublicRoomState;
    expect(typeof body.createdAt).toBe('number');
    expect(typeof body.lastActiveAt).toBe('number');
    expect(body.createdAt).toBe(1_700_000_000_000);
  });
});

// Touch the export so the import isn't tree-shaken in test runs.
const _ref: CreateRoomResponseBody | null = null;
expect(_ref).toBeNull();
