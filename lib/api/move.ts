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

export interface MoveDeps {
  roomStore: RoomStore;
  roundStore: RoundStore;
  idempotency: IdempotencyCache;
  rateLimiter: RateLimiter;
  now?: () => number;
}

export const IDEMPOTENCY_TTL_SECONDS = 600;
export const ROUND_TTL_SECONDS = 86_400;

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
  const { newRound, response } = handleMoveCommand(
    envelope.round,
    member.id,
    parsed.value.command,
    envelope.version
  );

  // ── Persist + commit ────────────────────────────────────────────────────
  if (response.ok) {
    await deps.roundStore.put(
      code,
      {
        round: newRound,
        version: response.appliedVersion,
        updatedAt: now(),
      },
      ROUND_TTL_SECONDS
    );
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
