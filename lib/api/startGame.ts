// POST /api/room/[code]/start — pure handler. Host-authenticated game start.
//
// Preconditions:
//   - room.phase === 'lobby'
//   - room.members.length === positionCount(mode)  (room is full)
//   - bearer matches room.hostToken (admin action — not joinToken)
//
// Effect:
//   - Seats assigned by alternating member position → team (t1/t2)
//   - Deck shuffled (caller-supplied rng for determinism in tests)
//   - dealRound() builds the initial GameRound; startTrick() begins trick 1
//   - RoundEnvelope persisted at version 0
//   - RoomState updated: phase='in_game', lastActiveAt=now()
//   - AuthorDealEvent fanned out (per-recipient filter happens in publishEvent)

import { extractBearerToken } from '../auth/ownershipToken.js';
import { isValidRoomCode } from '../room/code.js';
import { dealRound, startTrick } from '../game/round.js';
import type { PlayerSeat } from '../game/round.js';
import { buildDeck, shuffleDeck } from '../game/cards.js';
import { positionCount } from '../game/mode.js';
import type { TeamKey } from '../game/mode.js';
import type { LevelRank } from '../game/levels.js';
import { createSession } from '../game/session.js';
import type { RoomState } from '../room/lifecycle.js';
import type { RoomStore } from '../storage/roomStore.js';
import type { RoundStore } from '../storage/roundStore.js';
import type { SessionStore } from '../storage/sessionStore.js';
import type { EventBus } from '../realtime/eventBus.js';
import type { EventLog } from '../realtime/eventLog.js';
import type { IdempotencyCache } from '../realtime/idempotency.js';
import { publishEvent } from '../realtime/publish.js';
import { buildGameState } from '../realtime/buildGameState.js';
import { encodeCards } from '../realtime/cardCodec.js';
import type { AuthorDealEvent } from '../realtime/buildClientPayload.js';
import type { MoveResponse } from '../realtime/commands.js';
import type { RateLimiter } from '../security/rateLimit.js';
import { runBots } from '../ai/runBots.js';

export interface StartGameDeps {
  roomStore: RoomStore;
  roundStore: RoundStore;
  sessionStore: SessionStore;
  bus: EventBus;
  log: EventLog;
  /**
   * Optional idempotency cache. When provided, concurrent host-token POSTs
   * to /start dedupe through a `start-${code}` key — only one performs the
   * deal; the other(s) get the cached success response. Routes wired through
   * Vercel pass `infra.idempotency` so production gets CAS-style safety. Tests
   * may omit it and rely on the phase-guard fallback (also enforced below).
   */
  idempotency?: IdempotencyCache;
  /**
   * R-I5: Optional per-(room + IP) rate limiter. Caps start at 5/min —
   * enough for honest host retries, low enough to throttle abuse.
   */
  rateLimiter?: RateLimiter;
  /** R-I5: Identity extractor for rate-limit keying. */
  identify?: (req: Request) => string;
  /** RNG seed for deck shuffle. Defaults to Math.random. */
  rng?: () => number;
  now?: () => number;
}

const ROOM_TTL_SECONDS = 86_400;
const ROUND_TTL_SECONDS = 86_400;
const SESSION_TTL_SECONDS = 86_400;
const STARTING_LEVEL: LevelRank = '2';
const DEFAULT_TURN_TIMEOUT_SECONDS = 30;
/** Idempotency TTL for the start operation. 1h covers any plausible duplicate
 * POST window — the operation is one-shot per room lifecycle, not per game. */
const START_IDEMPOTENCY_TTL_SECONDS = 3_600;

export async function handleStartGame(
  req: Request,
  code: string,
  deps: StartGameDeps
): Promise<Response> {
  if (req.method !== 'POST') {
    return json({ error: 'method_not_allowed' }, 405);
  }
  if (!isValidRoomCode(code)) {
    return json({ error: 'invalid_room_code' }, 400);
  }

  // R-I5: per-(room + IP) rate limiting on start.
  if (deps.rateLimiter) {
    const ident = deps.identify ? deps.identify(req) : extractIdentity(req);
    const now = (deps.now ?? Date.now)();
    const rl = await deps.rateLimiter.check(`start:${code}:${ident}`, now);
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

  const bearer = extractBearerToken(req);
  if (!bearer) {
    return json({ error: 'unauthorized' }, 401);
  }

  const room = await deps.roomStore.get(code);
  if (!room) {
    return json({ error: 'room_not_found' }, 404);
  }
  if (bearer !== room.hostToken) {
    return json({ error: 'unauthorized' }, 401);
  }
  if (room.phase !== 'lobby') {
    return json(
      { error: 'conflict', details: `room is in "${room.phase}", cannot start` },
      409
    );
  }
  const expectedSeats = positionCount(room.mode);
  if (room.members.length !== expectedSeats) {
    return json(
      {
        error: 'conflict',
        details: `room needs ${expectedSeats} members, has ${room.members.length}`,
      },
      409
    );
  }

  // ── R-C3: start-idempotency reservation ─────────────────────────────────
  // Pre-fix, two concurrent host-token POSTs both passed the phase guard
  // (both read phase='lobby'), both dealt independent shuffles, both wrote
  // to roundStore/sessionStore (last-write wins), and both published `deal`
  // events at the same version with different hands. Clients received two
  // conflicting deals.
  //
  // Fix: reserve `start-${code}` via the same idempotency cache used for
  // /move. The first POST to win the reservation performs the deal and
  // commits the response. Concurrent / duplicate POSTs hit 'pending' (in
  // flight → 409) or 'done' (committed → cached response replayed). Both
  // outcomes prevent the double-deal.
  //
  // Reuse MoveResponse as the cached payload so the existing IdempotencyCache
  // contract works unchanged. The cached `appliedVersion` is the start's
  // final version; result='applied' on first success, 'replayed' on cache
  // hit.
  const idempotencyKey = `start-${code}`;
  if (deps.idempotency) {
    const reserve = await deps.idempotency.tryReserve(
      idempotencyKey,
      START_IDEMPOTENCY_TTL_SECONDS
    );
    if (reserve.status === 'pending') {
      return json({ error: 'start_in_flight' }, 409);
    }
    if (reserve.status === 'done') {
      // Cached response — extract version from the stashed MoveResponse.
      const cached = reserve.result;
      if (cached.ok) {
        return json({ ok: true, version: cached.appliedVersion }, 200);
      }
      // A previous attempt failed and got cached — surface the same error.
      return json({ ok: false, error: cached.error, details: cached.details }, 200);
    }
  }

  // ── Post-reservation try/catch envelope ─────────────────────────────────
  // CRITICAL fix: any throw between tryReserve and idempotency.commit
  // orphans the reservation for START_IDEMPOTENCY_TTL_SECONDS (1h). Concurrent
  // retries get 409 'start_in_flight' for that window — the handler is bricked
  // for the room. Wrap the entire downstream flow so a throw commits an
  // 'internal_error' MoveResponse (replayable by future tryReserves). The
  // catch returns the 500 response to the first caller; subsequent retries
  // of the same idempotency key get the cached error response replayed.
  const now = deps.now ?? Date.now;
  try {
    const seats = assignSeats(room);
    const rng = deps.rng ?? Math.random;
    const shuffled = shuffleDeck(buildDeck(), rng);

    const round = startTrick(
      dealRound({
        mode: room.mode,
        level: STARTING_LEVEL,
        owner: null,
        seats,
        leader: seats[0]!.id,
        shuffledDeck: shuffled,
      })
    );

    // Continue the per-recipient SSE event-version namespace established by
    // lobby-phase lifecycle events (room_joined). Lifecycle bumps room
    // eventVersion on every join/leave; the deal takes the next value so
    // clients can resume across the lobby→game boundary with one
    // Last-Event-ID.
    const dealVersion = room.eventVersion + 1;
    const updatedRoom: RoomState = {
      ...room,
      phase: 'in_game',
      lastActiveAt: now(),
      eventVersion: dealVersion,
    };

    // Persist the session that survives across rounds. Move handler reads this
    // on each round-end transition to derive round_end + game_end events.
    await deps.sessionStore.put(
      code,
      createSession({ mode: room.mode, rules: room.rules }),
      SESSION_TTL_SECONDS
    );

    // Fanout the deal. Per-recipient filtering in publishEvent → only your own
    // hand survives; everyone else's hand is replaced by a hand-count.
    const encodedHands: AuthorDealEvent['hands'] = {};
    for (const seat of seats) {
      encodedHands[seat.id] = encodeCards(round.hands[seat.id] ?? []);
    }
    const dealEvent: AuthorDealEvent = {
      type: 'deal',
      version: dealVersion,
      hands: encodedHands,
      roundOwner: round.seats[0]!.team,
    };
    try {
      const gameState = buildGameState(updatedRoom, round);
      await publishEvent(code, dealEvent, gameState, deps.bus, deps.log);
    } catch (err) {
      console.error('[start] publishEvent failed:', err);
    }

    // Bot run-loop on game-start. If the first player (the leader / seats[0])
    // is a bot, advance through any contiguous bot turns until landing on a
    // human. Without this, a fully-bot-fill room would deal and then stall
    // forever waiting for someone to make a move.
    //
    // R-C2 defense-in-depth: runBots already wraps the inner strategy call in
    // try/catch. This outer wrapper ensures a future code path that throws
    // outside the strategy call (e.g. from within startTrick or an iteration
    // helper) can't bring down the whole start handler — the deal already
    // committed durably to roundStore/sessionStore at this point would be lost
    // without persistence below.
    const turnDeadline = new Date(now() + DEFAULT_TURN_TIMEOUT_SECONDS * 1000).toISOString();
    let botResult: ReturnType<typeof runBots>;
    try {
      botResult = runBots({
        room: updatedRoom,
        round,
        startVersion: dealVersion,
        turnDeadline,
      });
    } catch (err) {
      console.error('[start] runBots threw (defense-in-depth):', err);
      botResult = { round, version: dealVersion, events: [] };
    }

    // Update the round-state to the post-bots round + final event version. If
    // no bots played, botResult.version === dealVersion and the round is
    // unchanged.
    const finalRound = botResult.round;
    const finalVersion = botResult.version;
    await deps.roundStore.put(
      code,
      { round: finalRound, version: finalVersion, updatedAt: now() },
      ROUND_TTL_SECONDS
    );

    // Room eventVersion tracks the LAST emitted event version so subsequent
    // lifecycle events (room_left during a game) and the move handler's
    // version checks stay aligned.
    const finalRoom: RoomState =
      finalVersion === dealVersion ? updatedRoom : { ...updatedRoom, eventVersion: finalVersion };
    await deps.roomStore.put(finalRoom, ROOM_TTL_SECONDS);

    // Fan out each bot event in sequence. publishEvent failures don't propagate
    // because the round state is durable and SSE clients catch up via the
    // EventLog backlog.
    if (botResult.events.length > 0) {
      try {
        const postBotsGameState = buildGameState(finalRoom, finalRound);
        for (const event of botResult.events) {
          await publishEvent(code, event, postBotsGameState, deps.bus, deps.log);
        }
      } catch (err) {
        console.error('[start] bot publishEvent failed:', err);
      }
    }

    // Commit the idempotency reservation so concurrent / replay POSTs return
    // the same response instead of re-dealing.
    if (deps.idempotency) {
      const cached: MoveResponse = {
        ok: true,
        appliedVersion: finalVersion,
        result: 'applied',
      };
      try {
        await deps.idempotency.commit(
          `start-${code}`,
          cached,
          START_IDEMPOTENCY_TTL_SECONDS
        );
      } catch (err) {
        // The cache contract throws if the key isn't reserved or was already
        // committed. Either is a benign race — the response we're about to
        // send still reflects the real deal. Log + continue.
        console.error('[start] idempotency.commit failed:', err);
      }
    }

    return json({ ok: true, version: finalVersion }, 200);
  } catch (err) {
    // Downstream operation threw after reservation was taken. Commit an
    // 'internal_error' response so the next retry sees a cached error
    // (status='done') instead of a stuck 'pending' (which would 409 for the
    // full TTL window). The error response replays as 500 — the client can
    // retry with a fresh idempotency window (or wait for TTL to expire and
    // get a fresh attempt).
    const message = err instanceof Error ? err.message : String(err);
    if (deps.idempotency) {
      const errorResp: MoveResponse = {
        ok: false,
        error: 'internal_error',
        details: message,
      };
      try {
        await deps.idempotency.commit(
          `start-${code}`,
          errorResp,
          START_IDEMPOTENCY_TTL_SECONDS
        );
      } catch (commitErr) {
        // Best-effort — log and continue to surface the original error.
        console.error('[start] idempotency.commit(error) failed:', commitErr);
      }
    }
    return json({ ok: false, error: 'internal_error', details: message }, 500);
  }
}

/**
 * Alternating team assignment: positions 0, 2, 4, ... → t1; 1, 3, 5, ... → t2.
 * This matches the natural guandan partnership (cross-table partners in 4P).
 * Member order in room.members IS the seat-position order (host at index 0,
 * subsequent joiners appended in arrival order — joinRoom enforces this).
 */
function assignSeats(room: RoomState): readonly PlayerSeat[] {
  const seats: PlayerSeat[] = [];
  for (let i = 0; i < room.members.length; i++) {
    const member = room.members[i]!;
    const team: TeamKey = i % 2 === 0 ? 't1' : 't2';
    seats.push({ id: member.id, team, position: i });
  }
  return seats;
}

/** R-I5: read X-Forwarded-For → X-Real-IP → 'anon' fallback. */
function extractIdentity(req: Request): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0]!.trim();
  const real = req.headers.get('x-real-ip');
  if (real) return real;
  return 'anon';
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
