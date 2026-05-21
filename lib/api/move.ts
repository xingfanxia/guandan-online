// POST /api/room/[code]/move — pure handler.
//
// Flow (matches docs/research/realtime-sync-deep-dive.md §7.3):
//   1. Method + code validation, bearer-token auth against room.members
//   2. JSON body parse + shape check (moveId + command discriminator)
//   3. Sliding-window rate limit per (member, room) keyed pair
//   4. Idempotency.tryReserve(moveId)
//        reserved → proceed
//        pending  → 409 retry
//        done     → return cached response (with 'applied' → 'replayed' tag)
//   5. roundStore.get(code) — must exist or it's invalid_move
//   6. handleMoveCommand(round, playerId, command, version)
//   7. On success: roundStore.put(code, { round, version+1 })
//      Always:     idempotency.commit(moveId, response)
//   8. Return the MoveResponse as JSON
//
// Event fanout (publishEvent + SSE) lands in API-4 part B alongside SSE; this
// part A delivers the durable game-logic dispatch + idempotency contract.

import { extractBearerToken } from '../auth/ownershipToken.js';
import { isValidRoomCode } from '../room/code.js';
import { handleMoveCommand } from '../realtime/handleMove.js';
import { moveCommandKind } from '../realtime/commands.js';
import type { MoveCommand, MoveResponse } from '../realtime/commands.js';
import type { IdempotencyCache } from '../realtime/idempotency.js';
import type { RateLimiter } from '../security/rateLimit.js';
import type { RoomStore } from '../storage/roomStore.js';
import type { RoundStore } from '../storage/roundStore.js';
import type { SessionStore } from '../storage/sessionStore.js';
import type { EventBus } from '../realtime/eventBus.js';
import type { EventLog } from '../realtime/eventLog.js';
import { publishEvent } from '../realtime/publish.js';
import { buildGameState } from '../realtime/buildGameState.js';
import { deriveMoveEvent } from '../realtime/deriveMoveEvent.js';
import { deriveRoundEndEvents } from '../realtime/deriveRoundEndEvents.js';
import type { AuthorEvent } from '../realtime/buildClientPayload.js';
import { applyRoundResult } from '../game/session.js';
import { resolveRound } from '../game/resolveRound.js';
import { runBots } from '../ai/runBots.js';
import { dealNextRound } from '../game/nextRound.js';
import { deriveTributeEvents } from '../realtime/deriveTributeEvents.js';
import { encodeCards } from '../realtime/cardCodec.js';
import type { AuthorDealEvent } from '../realtime/buildClientPayload.js';

export interface MoveDeps {
  roomStore: RoomStore;
  roundStore: RoundStore;
  sessionStore: SessionStore;
  idempotency: IdempotencyCache;
  rateLimiter: RateLimiter;
  bus: EventBus;
  log: EventLog;
  now?: () => number;
  /** Server-side turn timeout. Defaults to 30s. */
  turnTimeoutSeconds?: number;
  /** RNG for next-round deck shuffle. Defaults to Math.random. */
  rng?: () => number;
}

export const IDEMPOTENCY_TTL_SECONDS = 600;
export const ROUND_TTL_SECONDS = 86_400;
export const SESSION_TTL_SECONDS = 86_400;
const DEFAULT_TURN_TIMEOUT_SECONDS = 30;

export async function handleMove(
  req: Request,
  code: string,
  deps: MoveDeps
): Promise<Response> {
  if (req.method !== 'POST') {
    return json({ error: 'method_not_allowed' }, 405);
  }
  if (!isValidRoomCode(code)) {
    return json({ error: 'invalid_room_code' }, 400);
  }

  const bearer = extractBearerToken(req);
  if (!bearer) {
    return moveError('auth_failed', 'missing bearer token');
  }

  const room = await deps.roomStore.get(code);
  if (!room) {
    return json({ error: 'room_not_found' }, 404);
  }

  const member = room.members.find((m) => m.joinToken === bearer);
  if (!member) {
    return moveError('auth_failed', 'invalid bearer token');
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }
  const parsed = parseMoveBody(body);
  if (!parsed.ok) {
    return moveError('invalid_move', parsed.error);
  }

  const now = deps.now ?? Date.now;
  const rl = deps.rateLimiter.check(`move:${code}:${member.id}`, now());
  if (!rl.allowed) {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (rl.retryAfterMs !== undefined) {
      headers['retry-after'] = Math.ceil(rl.retryAfterMs / 1000).toString();
    }
    const respBody: MoveResponse = { ok: false, error: 'rate_limited' };
    return new Response(JSON.stringify(respBody), { status: 429, headers });
  }

  // ── Idempotency reserve ─────────────────────────────────────────────────
  const reserve = await deps.idempotency.tryReserve(
    parsed.value.moveId,
    IDEMPOTENCY_TTL_SECONDS
  );
  if (reserve.status === 'pending') {
    // Another worker is currently executing this same moveId. Surface as
    // 409 so the client retries after a short delay (idempotent retry-safe).
    return new Response(
      JSON.stringify({ error: 'move_in_flight' }),
      { status: 409, headers: { 'content-type': 'application/json' } }
    );
  }
  if (reserve.status === 'done') {
    return json(toReplayed(reserve.result), 200);
  }

  // ── Load round ──────────────────────────────────────────────────────────
  const envelope = await deps.roundStore.get(code);
  if (!envelope) {
    const resp: MoveResponse = {
      ok: false,
      error: 'invalid_move',
      details: 'no active round for this room',
    };
    await deps.idempotency.commit(
      parsed.value.moveId,
      resp,
      IDEMPOTENCY_TTL_SECONDS
    );
    return json(resp, 200);
  }

  // ── Dispatch ────────────────────────────────────────────────────────────
  const dispatch = handleMoveCommand(
    envelope.round,
    member.id,
    parsed.value.command,
    envelope.version
  );
  const newRound = dispatch.newRound;
  let response: MoveResponse = dispatch.response;

  // ── Persist + publish + commit ──────────────────────────────────────────
  if (response.ok) {
    const turnTimeoutSeconds =
      deps.turnTimeoutSeconds ?? DEFAULT_TURN_TIMEOUT_SECONDS;
    const turnDeadline = new Date(
      now() + turnTimeoutSeconds * 1000
    ).toISOString();

    // A single move can emit multiple events (move_played + trick_won, plus
    // round_end + game_end when the round/game finishes). deriveMoveEvent
    // assigns sequential versions starting from response.appliedVersion;
    // session-driven events (round_end / game_end) get the next sequential
    // versions after the move-derived ones. The final round.version is the
    // LAST event's version — so the next move's fromVersion check stays
    // aligned with the per-recipient log seq used for SSE Last-Event-ID
    // resume.
    const events: AuthorEvent[] = deriveMoveEvent(
      member.id,
      parsed.value.command,
      envelope.round,
      newRound,
      response.appliedVersion,
      turnDeadline
    );

    // Manual-tribute finalization — when a tribute_select or anti_tribute
    // closed the pending state, emit a tribute_resolved event so clients
    // can dismiss the tribute modal and refresh their hands.
    //
    // The dispatch sets tributeExchanges only on finalization (intermediate
    // selections waiting for more players return `undefined`). For resist the
    // array is empty; for single/double it contains the card movements.
    // deriveMoveEvent returned [] for tribute commands so the version slot
    // at response.appliedVersion is free.
    if (dispatch.tributeExchanges !== undefined) {
      const resolvedExchanged = dispatch.tributeExchanges.flatMap((ex) => {
        const out: { from: string; to: string; card: string }[] = [
          { from: ex.from, to: ex.to, card: encodeCards([ex.tribute])[0]! },
        ];
        if (ex.return !== null) {
          out.push({ from: ex.to, to: ex.from, card: encodeCards([ex.return])[0]! });
        }
        return out;
      });
      events.push({
        type: 'tribute_resolved',
        version: response.appliedVersion,
        exchanged: resolvedExchanged,
      });
    }

    // ── Bot run-loop ──────────────────────────────────────────────────────
    // If the next player is a bot, computeBotMove + apply + derive events
    // until we land on a human (or the round finishes). The round-end fanout
    // below still runs once at the end based on the FINAL round after bots.
    let advancedRound = newRound;
    if (advancedRound.phase === 'playing') {
      const lastEventVersion =
        events.length > 0
          ? Math.max(...events.map((e) => e.version))
          : response.appliedVersion;
      const botResult = runBots({
        room,
        round: advancedRound,
        startVersion: lastEventVersion,
        turnDeadline,
      });
      advancedRound = botResult.round;
      for (const e of botResult.events) events.push(e);
    }

    // ── Round / game end fanout ───────────────────────────────────────────
    // When this move (human + any subsequent bots) closed the round, resolve
    // the session and emit the round_end (and game_end if the session also
    // finished) events. Append them AFTER all move/trick events so per-
    // recipient versions stay monotonic.
    //
    // When the session continues (round ended but game NOT over), also deal
    // the next round + apply tribute (4P) + emit tribute_pending / resolved
    // / deal events. The new round replaces the finished one in roundStore;
    // bot leaders trigger an immediate runBots pass on the new round.
    // Cross-round publish bookkeeping (see publish-loop comment below).
    let nextRoundForBots: typeof advancedRound | null = null;
    let preNextRound: typeof advancedRound | null = null;
    let newRoundEventStart = -1;
    if (advancedRound.phase === 'finished') {
      const session = await deps.sessionStore.get(code);
      if (session === null) {
        // Defensive: startGame always creates a session. Log and skip the
        // session-driven events rather than crash — the round still
        // completed durably; clients will catch up via state_resync.
        console.error(
          '[move] sessionStore missing for finished round; skipping round_end/game_end',
          code
        );
      } else {
        try {
          const result = resolveRound(advancedRound, session.rules);
          const newSession = applyRoundResult(session, advancedRound);
          await deps.sessionStore.put(code, newSession, SESSION_TTL_SECONDS);
          const baseVersion =
            events.length > 0
              ? Math.max(...events.map((e) => e.version)) + 1
              : response.appliedVersion + 1;
          const roundEvents = deriveRoundEndEvents({
            preSession: session,
            postSession: newSession,
            result,
            baseVersion,
          });
          for (const e of roundEvents) events.push(e);

          // Next-round transition. Only when the session continues — game-end
          // skips dealing the next round (no game left to play).
          //
          // CROSS-ROUND GAMESTATE: events emitted BEFORE the new-round deal
          // must be filtered against the OLD round's hands (the play-the-round-
          // closed state). Events emitted AFTER the deal use the NEW round's
          // hands. Otherwise the hidden-state leak detector flags played cards
          // that the new shuffle happens to redeal to a different player.
          if (newSession.phase === 'in_progress') {
            try {
              // The boundary marker — events[0..newRoundEventStart-1] use the
              // pre-next-round gameState; events[newRoundEventStart..] use the
              // post-next-round state.
              newRoundEventStart = events.length;

              const rng = deps.rng ?? Math.random;
              const next = dealNextRound({
                prevRound: advancedRound,
                session: newSession,
                rng,
              });

              // Tribute + deal version ordering:
              //   - tribute_pending  at tributeBase
              //   - tribute_resolved at tributeBase + 1 (single/double only)
              //   - deal             after the last tribute event
              const tributeBase =
                events.length > 0
                  ? Math.max(...events.map((e) => e.version)) + 1
                  : response.appliedVersion + 1;
              const tributeEvents =
                next.tributeMode !== null
                  ? deriveTributeEvents({
                      tributeMode: next.tributeMode,
                      exchanges: next.exchanges,
                      baseVersion: tributeBase,
                    })
                  : [];
              for (const e of tributeEvents) events.push(e);

              const dealVersion =
                tributeEvents.length > 0
                  ? Math.max(...tributeEvents.map((e) => e.version)) + 1
                  : tributeBase;
              const encodedHands: AuthorDealEvent['hands'] = {};
              for (const seat of next.round.seats) {
                encodedHands[seat.id] = encodeCards(next.round.hands[seat.id] ?? []);
              }
              const dealEvent: AuthorDealEvent = {
                type: 'deal',
                version: dealVersion,
                hands: encodedHands,
                // roundOwner for the new round = winning team (now updated in
                // session.roundOwner). The new GameRound carries the same value
                // in its `owner` field — prefer the session value to be explicit.
                roundOwner: newSession.roundOwner!,
              };
              events.push(dealEvent);

              // Snapshot the OLD round before we swap so the publish loop can
              // still build the correct gameState for pre-next-round events.
              preNextRound = advancedRound;
              advancedRound = next.round;
              nextRoundForBots = next.round;
            } catch (err) {
              // Reset the boundary marker on failure so the publish loop
              // doesn't try to split events with a stale partial round.
              newRoundEventStart = -1;
              console.error('[move] dealNextRound failed:', err);
            }
          }
        } catch (err) {
          console.error('[move] round-end derivation failed:', err);
        }
      }
    }

    // ── Bot run-loop on the freshly-dealt round ───────────────────────────
    // If the new round's leader is a bot, advance through any contiguous bot
    // turns. Uses the same runBots helper that fires after a human move; the
    // only difference here is the starting version (post-deal vs post-move).
    if (nextRoundForBots !== null && nextRoundForBots.phase === 'playing') {
      const startVersionForBots =
        events.length > 0
          ? Math.max(...events.map((e) => e.version))
          : response.appliedVersion;
      const newRoundBots = runBots({
        room,
        round: nextRoundForBots,
        startVersion: startVersionForBots,
        turnDeadline,
      });
      advancedRound = newRoundBots.round;
      for (const e of newRoundBots.events) events.push(e);
    }

    const finalVersion =
      events.length > 0
        ? Math.max(...events.map((e) => e.version))
        : response.appliedVersion;
    if (finalVersion !== response.appliedVersion) {
      // Update the response so the client sees the LAST event version as
      // their fromVersion baseline for the next move.
      response = {
        ok: true,
        appliedVersion: finalVersion,
        result: response.result,
      };
    }

    await deps.roundStore.put(
      code,
      {
        round: advancedRound,
        version: finalVersion,
        updatedAt: now(),
      },
      ROUND_TTL_SECONDS
    );

    // Event fanout. Failures here are logged but never propagated — the
    // move already applied to the durable round state, and SSE replay via
    // EventLog will catch any clients that miss the live broadcast.
    //
    // Cross-round split: pre-next-round events use the OLD round's gameState
    // so the leak detector doesn't false-positive on cards that the new
    // shuffle happens to redeal to a different player.
    if (events.length > 0) {
      try {
        const postGameState = buildGameState(room, advancedRound);
        const preGameState =
          newRoundEventStart >= 0 && preNextRound !== null
            ? buildGameState(room, preNextRound)
            : postGameState;
        for (let i = 0; i < events.length; i++) {
          const event = events[i]!;
          const gameState =
            newRoundEventStart >= 0 && i < newRoundEventStart ? preGameState : postGameState;
          await publishEvent(code, event, gameState, deps.bus, deps.log);
        }
      } catch (err) {
        console.error('[move] publishEvent failed:', err);
      }
    }
  }
  await deps.idempotency.commit(
    parsed.value.moveId,
    response,
    IDEMPOTENCY_TTL_SECONDS
  );

  return json(response, 200);
}

// ─── helpers ──────────────────────────────────────────────────────────────────

interface ParsedMoveBody {
  moveId: string;
  command: MoveCommand;
}

function parseMoveBody(
  body: unknown
): { ok: true; value: ParsedMoveBody } | { ok: false; error: string } {
  if (!body || typeof body !== 'object') {
    return { ok: false, error: 'body must be a JSON object' };
  }
  const obj = body as Record<string, unknown>;
  const moveId = obj['moveId'];
  if (typeof moveId !== 'string' || moveId.length === 0) {
    return { ok: false, error: 'moveId must be a non-empty string' };
  }
  const command = obj['command'];
  if (!command || typeof command !== 'object') {
    return { ok: false, error: 'command must be an object' };
  }
  const cmdObj = command as Record<string, unknown>;
  const kind = cmdObj['kind'];
  if (typeof kind !== 'string') {
    return { ok: false, error: 'command.kind must be a string' };
  }
  const fromVersion = cmdObj['fromVersion'];
  if (typeof fromVersion !== 'number' || !Number.isInteger(fromVersion)) {
    return { ok: false, error: 'command.fromVersion must be an integer' };
  }
  // Round-trip through moveCommandKind to enforce the discriminator set.
  try {
    moveCommandKind(command as MoveCommand);
  } catch {
    return { ok: false, error: `unknown command kind: ${kind}` };
  }
  return { ok: true, value: { moveId, command: command as MoveCommand } };
}

function toReplayed(resp: MoveResponse): MoveResponse {
  if (resp.ok && resp.result === 'applied') {
    return { ok: true, appliedVersion: resp.appliedVersion, result: 'replayed' };
  }
  return resp;
}

function moveError(
  error: Exclude<MoveResponse, { ok: true }>['error'],
  details: string
): Response {
  const body: MoveResponse = { ok: false, error, details };
  return json(body, 200);
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
