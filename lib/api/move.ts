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

import { extractBearerToken } from '../auth/ownershipToken';
import { isValidRoomCode } from '../room/code';
import { handleMoveCommand } from '../realtime/handleMove';
import { moveCommandKind } from '../realtime/commands';
import type { MoveCommand, MoveResponse } from '../realtime/commands';
import type { IdempotencyCache } from '../realtime/idempotency';
import type { RateLimiter } from '../security/rateLimit';
import type { RoomStore } from '../storage/roomStore';
import type { RoundStore } from '../storage/roundStore';
import type { SessionStore } from '../storage/sessionStore';
import type { EventBus } from '../realtime/eventBus';
import type { EventLog } from '../realtime/eventLog';
import { publishEvent } from '../realtime/publish';
import { buildGameState } from '../realtime/buildGameState';
import { deriveMoveEvent } from '../realtime/deriveMoveEvent';
import { deriveRoundEndEvents } from '../realtime/deriveRoundEndEvents';
import type { AuthorEvent } from '../realtime/buildClientPayload';
import { applyRoundResult } from '../game/session';
import { resolveRound } from '../game/resolveRound';

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

    // ── Round / game end fanout ───────────────────────────────────────────
    // When this move closed the round, resolve the session and emit the
    // round_end (and game_end if the session also finished) events. Append
    // them AFTER any move/trick events so per-recipient versions stay
    // monotonic.
    if (newRound.phase === 'finished') {
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
          const result = resolveRound(newRound, session.rules);
          const newSession = applyRoundResult(session, newRound);
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
        } catch (err) {
          console.error('[move] round-end derivation failed:', err);
        }
      }
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
        round: newRound,
        version: finalVersion,
        updatedAt: now(),
      },
      ROUND_TTL_SECONDS
    );

    // Event fanout. Failures here are logged but never propagated — the
    // move already applied to the durable round state, and SSE replay via
    // EventLog will catch any clients that miss the live broadcast.
    if (events.length > 0) {
      try {
        const gameState = buildGameState(room, newRound);
        for (const event of events) {
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
