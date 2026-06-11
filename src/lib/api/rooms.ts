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
export type BotDifficulty = 'easy' | 'medium';

export interface PublicMember {
  readonly id: string;
  readonly handle: string;
  readonly joinedAt: number;
  readonly status: string;
  readonly difficulty?: BotDifficulty;
}

/**
 * Subset of ModeRules surfaced to the lobby/waiting screen. Server may or
 * may not populate this depending on the API version. UI must tolerate
 * absent fields and fall back to generic copy ("A 级" without strict/loose
 * qualifier) when not present.
 */
export interface PublicModeRules {
  readonly strictA?: boolean;
  readonly must1?: boolean;
  readonly manualTribute?: boolean;
  readonly wildcardHeart?: boolean;
  readonly lastCallDeclare?: boolean;
  readonly steelPlate?: boolean;
  readonly triPair?: boolean;
  readonly straightFlushAboveBomb5?: boolean;
}

export interface PublicRoomState {
  readonly code: string;
  readonly mode: GameMode;
  readonly phase: RoomPhase;
  readonly hostId: string;
  readonly members: readonly PublicMember[];
  readonly createdAt: number;
  readonly lastActiveAt: number;
  /**
   * Server-side rule overrides for this room. Optional — older servers (and
   * servers that don't yet expose this field) omit it; client falls back to
   * a generic "A 级" chip. When present, the strictA axis drives the
   * "严格 A" / "宽松 A" chip in the Waiting screen.
   */
  readonly rules?: PublicModeRules;
  /**
   * SEC-2: groups of members that appear to share an IP. Present ONLY when the
   * room was fetched with the host token (`?hostToken=`). Drives the host's
   * HostIPWarning chip. Absent for non-host fetches.
   */
  readonly sharedIpGroups?: ReadonlyArray<{ ipHash: string; handles: readonly string[] }>;
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

/**
 * Boolean rule axes accepted by `POST /api/room/create`. Mirrors the
 * BOOLEAN_RULE_KEYS list in `lib/api/createRoom.ts`. Omitted fields inherit
 * `DEFAULT_MODE_RULES`. wildcardHeart / lastCallDeclare / steelPlate / triPair
 * / straightFlushAboveBomb5 are persisted to room state but the v1 game engine
 * doesn't yet branch on them — display-only until a future engine pass.
 */
export interface RoomRuleOverrides {
  /** Strict A-mode (must win during own A-level round). */
  readonly strictA?: boolean;
  /** Require 1st-place on winning team to upgrade (6P / 8P). */
  readonly must1?: boolean;
  /** 4P manual tribute (server waits for tribute_select / anti_tribute). */
  readonly manualTribute?: boolean;
  /** Heart card of current level acts as wildcard. */
  readonly wildcardHeart?: boolean;
  /** Allow declaring "last call" on the last card. */
  readonly lastCallDeclare?: boolean;
  /** Allow steel-plate pattern. */
  readonly steelPlate?: boolean;
  /** Allow tri-pair pattern. */
  readonly triPair?: boolean;
  /** Straight-flush outranks 5-bomb. */
  readonly straightFlushAboveBomb5?: boolean;
  /** Optional card exchange (换牌) after tribute. */
  readonly cardExchange?: boolean;
}

export async function createRoom(
  input: {
    mode: GameMode;
    handle: string;
    bots?: readonly BotSeat[];
    /** ROOM-3: list the room on the public browse list. Default private. */
    visibility?: 'public' | 'private';
  } & RoomRuleOverrides,
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
  if (input.visibility !== undefined) {
    body['visibility'] = input.visibility;
  }
  // Thread each rule override only when explicitly set. Omitting a key tells
  // the server to use DEFAULT_MODE_RULES. Keeps the wire payload minimal
  // (and preserves backward-compat with the original {mode, host} shape).
  const RULE_KEYS = [
    'strictA',
    'must1',
    'manualTribute',
    'wildcardHeart',
    'lastCallDeclare',
    'steelPlate',
    'triPair',
    'straightFlushAboveBomb5',
    'cardExchange',
  ] as const;
  for (const key of RULE_KEYS) {
    const v = input[key];
    if (v !== undefined) body[key] = v;
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

/** One entry in the public browse list (ROOM-3). Mirrors lib/api/listRooms. */
export interface PublicRoomListing {
  readonly code: string;
  readonly mode: GameMode;
  readonly seatsFilled: number;
  readonly seatsTotal: number;
  readonly hostHandle: string;
  readonly createdAt: number;
  readonly strictA: boolean;
}

/** GET /api/rooms — public lobby rooms with open seats, newest first. */
export async function listPublicRooms(
  opts: RoomApiOptions = {}
): Promise<readonly PublicRoomListing[]> {
  const fetcher = opts.fetcher ?? defaultFetcher;
  const base = opts.baseUrl ?? '';
  const res = await call<{ rooms: PublicRoomListing[] }>(
    `${base}/api/rooms`,
    { method: 'GET' },
    fetcher
  );
  return res.rooms;
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
  opts: RoomApiOptions & { hostToken?: string } = {}
): Promise<PublicRoomState> {
  const fetcher = opts.fetcher ?? defaultFetcher;
  const base = opts.baseUrl ?? '';
  // SEC-2: a host passes its hostToken so the server includes sharedIpGroups
  // (the same-room IP-collision warning). Non-host polls omit it.
  const query = opts.hostToken
    ? `?hostToken=${encodeURIComponent(opts.hostToken)}`
    : '';
  return call<PublicRoomState>(
    `${base}/api/room/${encodeURIComponent(code)}${query}`,
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
