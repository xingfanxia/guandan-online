// POST /api/room/create — pure handler logic.
//
// Vercel route wrapper (api/room/create.ts) just wires `process.env` into
// createRealtimeInfra and forwards (Request, deps) here. Tests construct
// `deps` directly with deterministic codeGen / tokenGen / now to make the
// happy paths and collision-retry behavior easy to assert.

import { createRoom, addBotToRoom } from '../room/lifecycle.js';
import { generateRoomCode } from '../room/code.js';
import { normalizeHandle, validateHandle } from '../auth/handle.js';
import type { RoomStore } from '../storage/roomStore.js';
import type { GameMode, ModeRules } from '../game/mode.js';
import { DEFAULT_MODE_RULES, positionCount } from '../game/mode.js';
import { generateBotName } from '../ai/names.js';
import type { RateLimiter } from '../security/rateLimit.js';
import type { IdempotencyCache } from '../realtime/idempotency.js';
import type { MoveResponse } from '../realtime/commands.js';

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
  /**
   * R-I5: Optional per-IP rate limiter. When provided, the handler throttles
   * create-room requests; without it, behavior is identical to the v1 path.
   * Tests omit it for clarity unless verifying the throttle path.
   */
  rateLimiter?: RateLimiter;
  /**
   * R-I5: Optional idempotency cache keyed by `Idempotency-Key` header. When
   * a client retries a create after a network blip, an in-flight request
   * returns 409; a previously-committed one returns the same response with
   * `result: 'replayed'`. Without this, duplicate POSTs created duplicate
   * rooms.
   */
  idempotency?: IdempotencyCache;
  /**
   * R-I5: How to extract the rate-limit / abuse-tracking identity. Defaults
   * to parsing X-Forwarded-For or X-Real-IP; tests can inject a stub.
   */
  identify?: (req: Request) => string;
}

/** Bot seat config submitted by the host at create-time. */
export interface BotSeatConfig {
  tier: 'easy' | 'medium';
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

/** R-I5: idempotency TTL for create — 1h. Duplicate POSTs typically arrive
 * within seconds; 1h covers retried-after-blackhole scenarios without
 * keeping cache entries longer than the room itself. */
const CREATE_IDEMPOTENCY_TTL_SECONDS = 3_600;

export async function handleCreateRoom(
  req: Request,
  deps: CreateRoomDeps
): Promise<Response> {
  if (req.method !== 'POST') {
    return json({ error: 'method_not_allowed' }, 405);
  }

  // R-I5: per-IP rate limiting. Caps create at 5/min — enough for honest
  // host workflows (multi-room hosts, retries), low enough to block trivial
  // spam. The Vercel wrapper passes Upstash-backed limiter for production.
  if (deps.rateLimiter) {
    const ident = deps.identify ? deps.identify(req) : extractIdentity(req);
    const now = (deps.now ?? Date.now)();
    const rl = await deps.rateLimiter.check(`create:${ident}`, now);
    if (!rl.allowed) {
      const headers: Record<string, string> = {
        'content-type': 'application/json',
      };
      if (rl.retryAfterMs !== undefined) {
        headers['retry-after'] = Math.ceil(rl.retryAfterMs / 1000).toString();
      }
      return new Response(JSON.stringify({ error: 'rate_limited' }), {
        status: 429,
        headers,
      });
    }
  }

  // R-I5: client-supplied Idempotency-Key dedupes retries. Optional —
  // absent header → no dedup (same as v1 behavior).
  const idempotencyKey = req.headers.get('idempotency-key');
  if (deps.idempotency && idempotencyKey) {
    const reserve = await deps.idempotency.tryReserve(
      `create:${idempotencyKey}`,
      CREATE_IDEMPOTENCY_TTL_SECONDS
    );
    if (reserve.status === 'pending') {
      return json({ error: 'create_in_flight' }, 409);
    }
    if (reserve.status === 'done') {
      // Cached response — we stashed the CreateRoomResponseBody inside a
      // MoveResponse-shaped envelope (so the existing IdempotencyCache
      // contract works unchanged). The `details` field carries the JSON
      // string. Unpack and replay.
      const cached = reserve.result;
      if (cached.ok === false) {
        // Two flavors:
        //  (a) Success replay — encoded as `error: 'invalid_move'` with the
        //      JSON-stringified CreateRoomResponseBody in `details`. Decode
        //      and return 201.
        //  (b) Error replay — encoded as `error: 'internal_error'` with the
        //      underlying error message in `details`. Surface 500.
        if (cached.error === 'internal_error') {
          return json(
            { error: 'internal_error', details: cached.details ?? 'unknown' },
            500
          );
        }
        // IMPORTANT-3 fix: a 'done' cache hit without `details` for the
        // success-replay flavor is structurally corrupt (we always stash the
        // body when committing success). Don't fall through to a fresh
        // create — that would silently duplicate the room. Log + 500 so the
        // cache corruption surfaces loudly.
        if (!cached.details) {
          console.error(
            '[createRoom] cache corruption: done status without details',
            { key: idempotencyKey, cached }
          );
          return json(
            { error: 'internal_error', details: 'cache corruption: replay payload missing' },
            500
          );
        }
        try {
          const body = JSON.parse(cached.details);
          return json(body, 201);
        } catch {
          // Malformed JSON in details is also a structural error. Don't
          // fall through to fresh create.
          console.error(
            '[createRoom] cache corruption: details not valid JSON',
            { key: idempotencyKey, details: cached.details }
          );
          return json(
            { error: 'internal_error', details: 'cache corruption: replay payload malformed' },
            500
          );
        }
      }
    }
  }

  // ── Post-reservation try/catch envelope ─────────────────────────────────
  // CRITICAL fix: any throw between tryReserve and idempotency.commit
  // orphans the reservation for CREATE_IDEMPOTENCY_TTL_SECONDS (1h).
  // Concurrent retries with the same Idempotency-Key get 409 'create_in_flight'
  // for that window. Wrap downstream operations so a throw commits an
  // 'internal_error' MoveResponse; the catch returns 500 to the first caller,
  // and the cached error response replays on subsequent retries of the same
  // Idempotency-Key.
  try {
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
    // Merge body-supplied rule overrides onto the defaults. All 7 boolean rule
    // axes are accepted from the wire (ROOM-2, 2026-05-19). Each field defaults
    // to DEFAULT_MODE_RULES when omitted; non-boolean values are rejected during
    // parsing. wildcardHeart / lastCallDeclare / steelPlate / triPair /
    // straightFlushAboveBomb5 are persisted to RoomState but the v1 game engine
    // doesn't yet branch on them — they're display-only until a future engine
    // pass wires them through.
    const effectiveRules: ModeRules = {
      ...DEFAULT_MODE_RULES,
      ...parsed.value.rules,
    };

    for (let attempt = 0; attempt < ROOM_CODE_RETRY_CAP; attempt++) {
      const code = codeGen();
      const ts = now();
      let state = createRoom({
        code,
        mode: parsed.value.mode,
        rules: effectiveRules,
        host: { id: 'p0', handle: parsed.value.handle },
        now: ts,
        tokenGen,
        visibility: parsed.value.visibility,
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
        // R-I5: stash the response in the idempotency cache so retries with
        // the same key replay it. We piggyback on the MoveResponse contract
        // by encoding the body as JSON in the `details` field of an ok:false
        // error sentinel — the existing cache only knows about MoveResponse.
        if (deps.idempotency && idempotencyKey) {
          try {
            const cached: MoveResponse = {
              ok: false,
              error: 'invalid_move', // sentinel — never surfaced; consumer reads details
              details: JSON.stringify(responseBody),
            };
            await deps.idempotency.commit(
              `create:${idempotencyKey}`,
              cached,
              CREATE_IDEMPOTENCY_TTL_SECONDS
            );
          } catch (err) {
            // Benign race or duplicate-commit — the response is still going
            // out below. Log and continue.
            console.error('[createRoom] idempotency.commit failed:', err);
          }
        }
        return json(responseBody, 201);
      }
    }
    return json({ error: 'code_generation_exhausted' }, 503);
  } catch (err) {
    // Downstream operation (parseBody, roomStore.create, addBotToRoom)
    // threw after the idempotency reservation was taken. Commit an
    // 'internal_error' response so the next retry sees a cached error
    // (status='done') instead of a stuck 'pending' (which would 409 for
    // the full TTL window).
    const message = err instanceof Error ? err.message : String(err);
    if (deps.idempotency && idempotencyKey) {
      const errorResp: MoveResponse = {
        ok: false,
        error: 'internal_error',
        details: message,
      };
      try {
        await deps.idempotency.commit(
          `create:${idempotencyKey}`,
          errorResp,
          CREATE_IDEMPOTENCY_TTL_SECONDS
        );
      } catch (commitErr) {
        // Best-effort — log and continue to surface the original error.
        console.error('[createRoom] idempotency.commit(error) failed:', commitErr);
      }
    }
    return json({ error: 'internal_error', details: message }, 500);
  }
}

/**
 * Extract a stable identity for rate-limit / idempotency tracking. Reads
 * X-Forwarded-For (Vercel's edge sets this) then X-Real-IP, falling back to
 * 'anon' so the limiter still buckets unknown sources together rather than
 * silently bypassing the throttle.
 */
function extractIdentity(req: Request): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) {
    // XFF can be a comma-separated chain; the leftmost is the client.
    return xff.split(',')[0]!.trim();
  }
  const real = req.headers.get('x-real-ip');
  if (real) return real;
  return 'anon';
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
  tier: 'easy' | 'medium',
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
  /** Subset of ModeRules to overlay on DEFAULT_MODE_RULES. */
  rules: Partial<ModeRules>;
  /** ROOM-3: opt-in to the public browse list. Defaults to 'private'. */
  visibility: 'public' | 'private';
}

/** Boolean rule axes accepted from the wire. Other ModeRules fields (numeric
 * tables c4/t6/p6/t8/p8) are server-only and cannot be overridden per-room. */
const BOOLEAN_RULE_KEYS = [
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
type BooleanRuleKey = (typeof BOOLEAN_RULE_KEYS)[number];

const VALID_TIERS = new Set<BotSeatConfig['tier']>(['easy', 'medium']);

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
        return { ok: false, error: `bots[${i}].tier must be 'easy' or 'medium'` };
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

  // Rule-axis overrides (ROOM-2, 2026-05-19). Each boolean rule axis is
  // accepted individually; omitted keys inherit DEFAULT_MODE_RULES. Non-boolean
  // values reject. The numeric ModeRules tables (c4/t6/p6/t8/p8) are NOT
  // accepted from the wire — they're tournament-locked at the engine layer.
  const rules: Partial<ModeRules> = {};
  for (const key of BOOLEAN_RULE_KEYS) {
    const raw = obj[key];
    if (raw === undefined) continue;
    if (typeof raw !== 'boolean') {
      return { ok: false, error: `${key} must be a boolean` };
    }
    rules[key as BooleanRuleKey] = raw;
  }

  // ROOM-3: optional visibility flag. Only the literal 'public' opts in;
  // anything else (including omission) stays private.
  const visibilityRaw = obj['visibility'];
  if (
    visibilityRaw !== undefined &&
    visibilityRaw !== 'public' &&
    visibilityRaw !== 'private'
  ) {
    return { ok: false, error: "visibility must be 'public' or 'private'" };
  }
  const visibility = visibilityRaw === 'public' ? 'public' : 'private';

  return { ok: true, value: { mode: mode as GameMode, handle, bots, rules, visibility } };
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
