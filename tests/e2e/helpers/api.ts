// Thin REST client for e2e tests — talks directly to the in-memory backend
// via the Vite api-middleware plugin (same origin as the SPA). Used both
// to seed initial state from the test side AND to verify post-condition
// state without UI assertions.

const BASE = process.env['E2E_BASE_URL'] ?? 'http://localhost:5174';

export interface CreateRoomReply {
  code: string;
  hostId: string;
  hostToken: string;
  hostJoinToken: string;
}

export interface CreateRoomOpts {
  mode?: '4' | '6' | '8';
  handle?: string;
  bots?: Array<{ tier: 'easy' | 'medium' }>;
  strictA?: boolean;
}

export async function createRoom(
  opts: CreateRoomOpts = {}
): Promise<CreateRoomReply> {
  const mode = opts.mode ?? '4';
  const handle = opts.handle ?? '@alice';
  const seatCount = mode === '4' ? 4 : mode === '6' ? 6 : 8;
  const defaultBots = Array.from({ length: seatCount - 1 }, () => ({
    tier: 'easy' as const,
  }));
  const body: Record<string, unknown> = {
    mode,
    host: { handle },
    bots: opts.bots ?? defaultBots,
  };
  if (opts.strictA !== undefined) body['strictA'] = opts.strictA;
  const res = await fetch(`${BASE}/api/room/create`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`createRoom failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as CreateRoomReply;
}

export interface PublicMember {
  id: string;
  handle: string;
  status: 'connected' | 'disconnected' | 'bot';
  difficulty?: 'easy' | 'medium';
}

export interface PublicRoom {
  code: string;
  mode: '4' | '6' | '8';
  phase: 'lobby' | 'in_game' | 'ended';
  hostId: string;
  members: PublicMember[];
  createdAt: number;
  lastActiveAt: number;
}

export async function getRoom(code: string): Promise<PublicRoom> {
  const res = await fetch(`${BASE}/api/room/${code}`);
  if (!res.ok) {
    throw new Error(`getRoom failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as PublicRoom;
}

export async function startGame(
  code: string,
  hostToken: string
): Promise<{ ok: true; version: number }> {
  const res = await fetch(`${BASE}/api/room/${code}/start`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${hostToken}`,
      'content-type': 'application/json',
    },
    body: '{}',
  });
  if (!res.ok) {
    throw new Error(`startGame failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as { ok: true; version: number };
}

export async function health(): Promise<{ ok: boolean; service: string }> {
  const res = await fetch(`${BASE}/api/health`);
  return (await res.json()) as { ok: boolean; service: string };
}
