// POST /api/room/create — pure handler logic.
//
// Vercel route wrapper (api/room/create.ts) just wires `process.env` into
// createRealtimeInfra and forwards (Request, deps) here. Tests construct
// `deps` directly with deterministic codeGen / tokenGen / now to make the
// happy paths and collision-retry behavior easy to assert.

import { createRoom, addBotToRoom } from '../room/lifecycle';
import { generateRoomCode } from '../room/code';
import { normalizeHandle, validateHandle } from '../auth/handle';
import type { RoomStore } from '../storage/roomStore';
import type { GameMode } from '../game/mode';
import { DEFAULT_MODE_RULES, positionCount } from '../game/mode';
import { generateBotName } from '../ai/names';

export interface CreateRoomDeps {
  roomStore: RoomStore;
  /** ID generator for tokens. Defaults to crypto.randomUUID. */
  tokenGen?: () => string;
  /** 6-char room code generator. Defaults to generateRoomCode(Math.random). */
  codeGen?: () => string;
  /** Wall clock. Defaults to Date.now. */
  now?: () => number;
  /** RNG for bot-handle picking. Defaults to Math.random. */
  botNameRng?: () => number;
}

/** Bot seat config submitted by the host at create-time. */
export interface BotSeatConfig {
  tier: 'easy' | 'medium' | 'hard';
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
  const botNameRng = deps.botNameRng ?? Math.random;

  // Collision-retry: room codes are 6.2M-cardinality and we SET NX. If the
  // first attempt lost the race, generate a new one. After RETRY_CAP misses
  // bail with 503 — that's a strong signal of upstream rate-limit issues
  // rather than genuine cardinality exhaustion.
  for (let attempt = 0; attempt < ROOM_CODE_RETRY_CAP; attempt++) {
    const code = codeGen();
    const ts = now();
    let state = createRoom({
      code,
      mode: parsed.value.mode,
      rules: DEFAULT_MODE_RULES,
      host: { id: 'p0', handle: parsed.value.handle },
      now: ts,
      tokenGen,
    });

    // Seat bots before persistence — at create-time the host has already
    // declared which seats are bot-filled. Bot member IDs follow the same
    // dense p<n> scheme that joinRoom would assign. Handles come from the
    // shared pool with per-room uniqueness retry against already-seated
    // members.
    for (let i = 0; i < parsed.value.bots.length; i++) {
      const tier = parsed.value.bots[i]!.tier;
      const handle = pickUniqueBotHandle(state, tier, botNameRng);
      state = addBotToRoom({
        state,
        id: `p${i + 1}`,
        handle,
        difficulty: tier,
        now: ts,
        tokenGen,
      });
    }

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

/**
 * Pull a bot handle out of the shared pool that isn't already used by an
 * existing member of `state`. With 30 names in the pool and at most 7 bots
 * seated per room, collision-retry settles within a handful of attempts.
 * Falls back to a numeric-suffixed handle if 32 attempts all collide (which
 * should be statistically near-impossible).
 */
function pickUniqueBotHandle(
  state: { members: ReadonlyArray<{ handle: string }> },
  tier: 'easy' | 'medium' | 'hard',
  rng: () => number
): string {
  const used = new Set(state.members.map((m) => m.handle));
  for (let attempt = 0; attempt < 32; attempt++) {
    const { handle } = generateBotName(tier, rng);
    if (!used.has(handle)) return handle;
  }
  // Pathological fallback — append a counter until unique.
  let n = 1;
  while (true) {
    const { handle } = generateBotName(tier, rng);
    const candidate = `${handle}${n}`;
    if (!used.has(candidate)) return candidate;
    n++;
  }
}

interface ParsedBody {
  mode: GameMode;
  handle: string;
  bots: BotSeatConfig[];
}

const VALID_TIERS = new Set<BotSeatConfig['tier']>(['easy', 'medium', 'hard']);

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

  // bots is optional; default to []. Each entry must have a known tier.
  const botsRaw = obj['bots'];
  const bots: BotSeatConfig[] = [];
  if (botsRaw !== undefined) {
    if (!Array.isArray(botsRaw)) {
      return { ok: false, error: 'bots must be an array' };
    }
    for (const [i, entry] of botsRaw.entries()) {
      if (!entry || typeof entry !== 'object') {
        return { ok: false, error: `bots[${i}] must be an object` };
      }
      const tier = (entry as Record<string, unknown>)['tier'];
      if (typeof tier !== 'string' || !VALID_TIERS.has(tier as BotSeatConfig['tier'])) {
        return { ok: false, error: `bots[${i}].tier must be 'easy', 'medium', or 'hard'` };
      }
      bots.push({ tier: tier as BotSeatConfig['tier'] });
    }
    // Room capacity check: 1 host + N bots ≤ positionCount(mode).
    const cap = positionCount(mode as GameMode);
    if (bots.length > cap - 1) {
      return {
        ok: false,
        error: `mode '${mode}' fits ${cap} seats; got 1 host + ${bots.length} bots`,
      };
    }
  }

  return { ok: true, value: { mode: mode as GameMode, handle, bots } };
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
