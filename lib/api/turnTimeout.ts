// Turn-timeout sweep — forces a move for stalled HUMAN turns (pure handler).
//
// The wire's turnDeadline was advisory-only until 2026-06-09: nothing
// enforced it, so an idle-but-connected human stalled the table forever
// (the AI-4 dc sweep only covers DISCONNECTED players — its threshold keys
// off SSE liveness, not turn inactivity). This sweep closes that gap:
//
//   For each in-game room whose current trick actor is a human and whose
//   round envelope hasn't mutated for >= thresholdMs, pick a move with the
//   EASY bot strategy and dispatch it THROUGH the real move pipeline
//   (handleMove, injected as `dispatchMove`) using that player's joinToken.
//
// Routing through handleMove (instead of applying directly like dcCheck's
// silent advance) buys, for free:
//   - full SSE event fanout — every client sees the forced move live;
//   - version safety — fromVersion is the envelope version read during the
//     scan, so if the player acts between scan and dispatch the move handler
//     rejects with version_conflict and the sweep harmlessly skips;
//   - idempotency — moveId is deterministic (`turn-timeout-<code>-<ver>`),
//     so overlapping cron fires replay instead of double-applying;
//   - the bot run-loop — bots after the forced move play out normally.
//
// Out of scope (documented): stalls in manual-tribute / card-exchange phases
// (currentTrick is null there). Those flows need their own timeout semantics
// (e.g., auto-select highest tribute card) — tracked separately.
//
// Auth: Bearer ADMIN_TOKEN, same posture as handleDcCheck / cleanup.

import { extractBearerToken } from '../auth/ownershipToken.js';
import { computeBotMove } from '../ai/dispatch.js';
import { buildBotContext } from '../ai/runBots.js';
import { encodeCards } from '../realtime/cardCodec.js';
import type { MoveCommand } from '../realtime/commands.js';
import type { RoomStore } from '../storage/roomStore.js';
import type { RoundStore } from '../storage/roundStore.js';

export interface TurnTimeoutDeps {
  roomStore: RoomStore;
  roundStore: RoundStore;
  /**
   * Dispatches the forced move through the REAL move pipeline. The cron
   * route wires this to handleMove with production deps; tests inject a
   * recorder. Returning the Response lets the sweep count rejections.
   */
  dispatchMove: (
    code: string,
    joinToken: string,
    body: { moveId: string; command: MoveCommand }
  ) => Promise<Response>;
  /** Wall clock. Defaults to Date.now. */
  now?: () => number;
  /** Bearer secret; fail-closed 503 when unset. */
  adminToken?: string;
  /**
   * Idle threshold in ms before the server moves for the player, measured
   * against the round envelope's updatedAt (last round mutation). Default
   * 60s — matches the wire turnDeadline so the client countdown is honest.
   * Effective enforcement lag is threshold + cron period (per-minute).
   */
  thresholdMs?: number;
  /** RNG passthrough for the easy-strategy tie-breaks. */
  rng?: () => number;
}

export interface TurnTimeoutResponseBody {
  scanned: number;
  /** Stalled human turns a forced move was dispatched for. */
  forced: number;
  /** Dispatches rejected by the move pipeline (e.g., version_conflict race). */
  rejected: number;
  errors: number;
}

const DEFAULT_THRESHOLD_MS = 60_000;

export async function handleTurnTimeouts(
  req: Request,
  deps: TurnTimeoutDeps
): Promise<Response> {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return json({ error: 'method_not_allowed' }, 405);
  }
  if (!deps.adminToken || deps.adminToken.length === 0) {
    return json({ error: 'admin_token_not_configured' }, 503);
  }
  const bearer = extractBearerToken(req);
  if (!bearer || !constantTimeEqual(bearer, deps.adminToken)) {
    return json({ error: 'unauthorized' }, 401);
  }

  const now = (deps.now ?? Date.now)();
  const thresholdMs = deps.thresholdMs ?? DEFAULT_THRESHOLD_MS;

  const codes = await deps.roomStore.listCodes();
  let forced = 0;
  let rejected = 0;
  let errors = 0;

  for (const code of codes) {
    try {
      const room = await deps.roomStore.get(code);
      if (room === null || room.phase !== 'in_game') continue;

      const envelope = await deps.roundStore.get(code);
      if (!envelope) continue;
      const round = envelope.round;
      // Tribute / exchange phases & finished rounds have no current trick —
      // out of scope here (see module docblock).
      const trick = round.currentTrick;
      if (round.phase !== 'playing' || trick === null) continue;

      const actor = trick.currentPlayer;
      const member = room.members.find((m) => m.id === actor);
      // Bots act synchronously inside move requests; a stalled BOT turn means
      // a bug upstream, not a timeout — leave it to logs.
      if (!member || member.status === 'bot') continue;

      if (now - envelope.updatedAt < thresholdMs) continue;

      // Pick the forced move with the easy strategy (legal by construction
      // against the current trick target).
      const ctx = buildBotContext(round, actor, 'easy', deps.rng);
      const decision = computeBotMove(ctx);
      const command: MoveCommand =
        decision.kind === 'play'
          ? {
              kind: 'play',
              cards: encodeCards(decision.pattern.cards),
              fromVersion: envelope.version,
            }
          : { kind: 'pass', fromVersion: envelope.version };

      const res = await deps.dispatchMove(code, member.joinToken, {
        moveId: `turn-timeout-${code}-${envelope.version}`,
        command,
      });
      let ok = false;
      try {
        const body = (await res.json()) as { ok?: boolean };
        ok = res.status === 200 && body.ok === true;
      } catch {
        ok = false;
      }
      if (ok) forced += 1;
      else rejected += 1;
    } catch (err) {
      console.error('[turn-timeout] error processing code', code, err);
      errors += 1;
    }
  }

  const body: TurnTimeoutResponseBody = {
    scanned: codes.length,
    forced,
    rejected,
    errors,
  };
  return json(body, 200);
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
