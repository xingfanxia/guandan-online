// POST /api/room/create — pure handler logic.
//
// Vercel route wrapper (api/room/create.ts) just wires `process.env` into
// createRealtimeInfra and forwards (Request, deps) here. Tests construct
// `deps` directly with deterministic codeGen / tokenGen / now to make the
// happy paths and collision-retry behavior easy to assert.

import { createRoom } from '../room/lifecycle';
import { generateRoomCode } from '../room/code';
import { normalizeHandle, validateHandle } from '../auth/handle';
import type { RoomStore } from '../storage/roomStore';
import type { GameMode } from '../game/mode';
import { DEFAULT_MODE_RULES } from '../game/mode';

export interface CreateRoomDeps {
  roomStore: RoomStore;
  /** ID generator for tokens. Defaults to crypto.randomUUID. */
  tokenGen?: () => string;
  /** 6-char room code generator. Defaults to generateRoomCode(Math.random). */
  codeGen?: () => string;
  /** Wall clock. Defaults to Date.now. */
  now?: () => number;
}

export interface CreateRoomResponseBody {
  code: string;
  hostId: string;
  hostToken: string;
  hostJoinToken: string;
}

/** Default room TTL in seconds — 24 hours, refreshed on every mutation. */
export const ROOM_TTL_SECONDS = 86_400;

/** Maximum room-code-collision retries before we give up. */
export const ROOM_CODE_RETRY_CAP = 8;

const VALID_MODES = new Set<GameMode>(['4', '6', '8']);

export async function handleCreateRoom(
  req: Request,
  deps: CreateRoomDeps
): Promise<Response> {
  if (req.method !== 'POST') {
    return json({ error: 'method_not_allowed' }, 405);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }

  const parsed = parseBody(body);
  if (!parsed.ok) {
    return json({ error: 'invalid_request', details: parsed.error }, 400);
  }

  const tokenGen = deps.tokenGen ?? defaultTokenGen;
  const codeGen = deps.codeGen ?? (() => generateRoomCode(Math.random));
  const now = deps.now ?? Date.now;

  // Collision-retry: room codes are 6.2M-cardinality and we SET NX. If the
  // first attempt lost the race, generate a new one. After RETRY_CAP misses
  // bail with 503 — that's a strong signal of upstream rate-limit issues
  // rather than genuine cardinality exhaustion.
  for (let attempt = 0; attempt < ROOM_CODE_RETRY_CAP; attempt++) {
    const code = codeGen();
    const state = createRoom({
      code,
      mode: parsed.value.mode,
      rules: DEFAULT_MODE_RULES,
      host: { id: 'p0', handle: parsed.value.handle },
      now: now(),
      tokenGen,
    });
    const ok = await deps.roomStore.create(state, ROOM_TTL_SECONDS);
    if (ok) {
      const hostMember = state.members[0]!;
      const responseBody: CreateRoomResponseBody = {
        code: state.code,
        hostId: state.hostId,
        hostToken: state.hostToken,
        hostJoinToken: hostMember.joinToken,
      };
      return json(responseBody, 201);
    }
  }
  return json({ error: 'code_generation_exhausted' }, 503);
}

interface ParsedBody {
  mode: GameMode;
  handle: string;
}

function parseBody(
  body: unknown
): { ok: true; value: ParsedBody } | { ok: false; error: string } {
  if (!body || typeof body !== 'object') {
    return { ok: false, error: 'body must be a JSON object' };
  }
  const obj = body as Record<string, unknown>;
  const mode = obj['mode'];
  if (typeof mode !== 'string' || !VALID_MODES.has(mode as GameMode)) {
    return { ok: false, error: "mode must be '4', '6', or '8'" };
  }
  const hostRaw = obj['host'];
  if (!hostRaw || typeof hostRaw !== 'object') {
    return { ok: false, error: 'host must be an object with handle' };
  }
  const handleRaw = (hostRaw as Record<string, unknown>)['handle'];
  const handle = normalizeHandle(handleRaw);
  const validation = validateHandle(handle);
  if (!validation.valid) {
    return { ok: false, error: validation.error ?? 'invalid handle' };
  }
  return { ok: true, value: { mode: mode as GameMode, handle } };
}

function defaultTokenGen(): string {
  return crypto.randomUUID();
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
