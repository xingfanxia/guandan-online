// Typed client for /api/room/* endpoints.
//
// Each function maps to one HTTP handler in `api/room/*`. Bodies and responses
// mirror the wire contracts in `lib/api/{createRoom,joinRoom,leaveRoom,startGame,getRoom}.ts`.
// Errors thrown here carry the server's `error` code + optional `details` for
// UI surfacing (toast / form-level validation).
//
// All requests are JSON; auth tokens travel as Authorization: Bearer headers.
// fetch impl is dependency-injectable via the `fetcher` param so tests can run
// without a real network.

export type GameMode = '4' | '6' | '8';
export type RoomPhase = 'lobby' | 'in_game';
export type PlayerStatus = 'connected' | 'disconnected' | 'bot';
export type BotDifficulty = 'easy' | 'medium' | 'hard';

export interface PublicMember {
  readonly id: string;
  readonly handle: string;
  readonly joinedAt: number;
  readonly status: string;
  readonly difficulty?: BotDifficulty;
}

export interface PublicRoomState {
  readonly code: string;
  readonly mode: GameMode;
  readonly phase: RoomPhase;
  readonly hostId: string;
  readonly members: readonly PublicMember[];
  readonly createdAt: number;
  readonly lastActiveAt: number;
}

export interface CreateRoomResponse {
  readonly code: string;
  readonly hostId: string;
  readonly hostToken: string;
  readonly hostJoinToken: string;
}

export interface JoinRoomResponse {
  readonly playerId: string;
  readonly joinToken: string;
}

export interface StartGameResponse {
  readonly ok: true;
  readonly version: number;
}

export interface LeaveRoomResponse {
  readonly ok: true;
  readonly dissolved?: true;
}

export class RoomApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: string;
  constructor(status: number, code: string, details?: string) {
    super(details ? `${code}: ${details}` : code);
    this.name = 'RoomApiError';
    this.status = status;
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

export type Fetcher = typeof fetch;

export interface RoomApiOptions {
  /** Override the global fetch impl (tests + SSR). */
  fetcher?: Fetcher;
  /** Base URL prefix. Defaults to '' (same-origin). */
  baseUrl?: string;
}

const defaultFetcher: Fetcher = (...args) => fetch(...args);

async function call<T>(
  url: string,
  init: RequestInit,
  fetcher: Fetcher
): Promise<T> {
  let res: Response;
  try {
    res = await fetcher(url, init);
  } catch (err) {
    throw new RoomApiError(0, 'network_error', (err as Error).message);
  }
  let body: unknown = null;
  const text = await res.text();
  if (text.length > 0) {
    try {
      body = JSON.parse(text);
    } catch {
      throw new RoomApiError(res.status, 'invalid_response', text.slice(0, 200));
    }
  }
  if (!res.ok) {
    const obj = (body as Record<string, unknown> | null) ?? {};
    const code = typeof obj['error'] === 'string' ? obj['error'] : `http_${res.status}`;
    const details = typeof obj['details'] === 'string' ? obj['details'] : undefined;
    throw new RoomApiError(res.status, code, details);
  }
  return body as T;
}

/** Bot seat config sent on createRoom. Omit field to create a humans-only room. */
export interface BotSeat {
  readonly tier: BotDifficulty;
}

export async function createRoom(
  input: { mode: GameMode; handle: string; bots?: readonly BotSeat[] },
  opts: RoomApiOptions = {}
): Promise<CreateRoomResponse> {
  const fetcher = opts.fetcher ?? defaultFetcher;
  const base = opts.baseUrl ?? '';
  const body: Record<string, unknown> = {
    mode: input.mode,
    host: { handle: input.handle },
  };
  if (input.bots && input.bots.length > 0) {
    body['bots'] = input.bots.map((b) => ({ tier: b.tier }));
  }
  return call<CreateRoomResponse>(
    `${base}/api/room/create`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
    fetcher
  );
}

export async function joinRoom(
  code: string,
  input: { handle: string },
  opts: RoomApiOptions = {}
): Promise<JoinRoomResponse> {
  const fetcher = opts.fetcher ?? defaultFetcher;
  const base = opts.baseUrl ?? '';
  return call<JoinRoomResponse>(
    `${base}/api/room/${encodeURIComponent(code)}/join`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ handle: input.handle }),
    },
    fetcher
  );
}

export async function leaveRoom(
  code: string,
  joinToken: string,
  opts: RoomApiOptions = {}
): Promise<LeaveRoomResponse> {
  const fetcher = opts.fetcher ?? defaultFetcher;
  const base = opts.baseUrl ?? '';
  return call<LeaveRoomResponse>(
    `${base}/api/room/${encodeURIComponent(code)}/leave`,
    {
      method: 'POST',
      headers: { authorization: `Bearer ${joinToken}` },
    },
    fetcher
  );
}

export async function startGame(
  code: string,
  hostToken: string,
  opts: RoomApiOptions = {}
): Promise<StartGameResponse> {
  const fetcher = opts.fetcher ?? defaultFetcher;
  const base = opts.baseUrl ?? '';
  return call<StartGameResponse>(
    `${base}/api/room/${encodeURIComponent(code)}/start`,
    {
      method: 'POST',
      headers: { authorization: `Bearer ${hostToken}` },
    },
    fetcher
  );
}

export async function getRoom(
  code: string,
  opts: RoomApiOptions = {}
): Promise<PublicRoomState> {
  const fetcher = opts.fetcher ?? defaultFetcher;
  const base = opts.baseUrl ?? '';
  return call<PublicRoomState>(
    `${base}/api/room/${encodeURIComponent(code)}`,
    { method: 'GET' },
    fetcher
  );
}

/** Expected seat count for a given mode — matches `lib/game/mode.ts positionCount`. */
export function seatCountForMode(mode: GameMode): 4 | 6 | 8 {
  switch (mode) {
    case '4':
      return 4;
    case '6':
      return 6;
    case '8':
      return 8;
  }
}
