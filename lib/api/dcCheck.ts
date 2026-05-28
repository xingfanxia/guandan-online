// GET /api/cron/dcCheck — disconnect-takeover sweep (pure handler).
//
// AI-4: scans active rooms and, for each in-game room, finds connected humans
// who have gone silent past the disconnect threshold (default 60s). Each such
// seat is promoted to a bot via promoteToBot so the table keeps moving even
// after a player drops. If a promoted seat happens to be the current player,
// we advance the round through any contiguous bot turns via runBots and persist
// the advanced round, so the now-bot seat actually plays without waiting for
// the next human action.
//
// This handler does NOT emit SSE events — the events `runBots` derives are
// discarded here. Clients converge on the next /move's publish or on SSE
// reconnect/resync. (The CI leak gate forbids this file from touching the
// publish gateway; see CLAUDE.md "Single publish gateway".) The visible effect
// to other players is the bot's move surfacing through the regular move-handler
// fanout the next time anyone acts, plus the `代打` status badge once the room
// view reflects the new member status.
//
// Auth: Bearer ADMIN_TOKEN. Identical posture to handleCleanupRooms — Vercel
// cron sends `Authorization: Bearer ${CRON_SECRET}` automatically. Fail-closed
// (503) when no admin token is configured so a misconfigured deploy can't be
// triggered anonymously to seize seats.

import { extractBearerToken } from '../auth/ownershipToken.js';
import { findDisconnectedHumans } from '../room/dcDetection.js';
import { promoteToBot, type TakeoverTier } from '../room/botTakeover.js';
import { runBots } from '../ai/runBots.js';
import type { RoomStore } from '../storage/roomStore.js';
import type { RoundStore } from '../storage/roundStore.js';

export interface DcCheckDeps {
  roomStore: RoomStore;
  roundStore: RoundStore;
  /** Wall clock. Defaults to Date.now. */
  now?: () => number;
  /**
   * Bearer secret required to run the sweep. When unset, the handler refuses
   * with 503 — fail-closed.
   */
  adminToken?: string;
  /**
   * Silence threshold in milliseconds. A connected human is taken over when
   * `now - lastSeenAt >= thresholdMs` (lastSeenAt falls back to joinedAt).
   * Defaults to 60_000ms (60s) — long enough to ride out a tab refresh or a
   * brief network blip, short enough that the table doesn't stall for minutes.
   */
  thresholdMs?: number;
  /** Tier disconnected seats are taken over at. Defaults to 'medium'. */
  takeoverTier?: TakeoverTier;
  /**
   * Server-side turn timeout used to stamp the deadline into bot events
   * (discarded here, but runBots requires it). Defaults to 30s.
   */
  turnTimeoutSeconds?: number;
  /** RNG passthrough for bot tie-breaks. Defaults to Math.random. */
  rng?: () => number;
  /**
   * Per-player liveness reader (AI-4). Hydrates each member's last-seen
   * timestamp from the seen store (bumped by the SSE heartbeat) before the
   * disconnect check. CRITICAL: without it, findDisconnectedHumans falls back
   * to joinedAt for everyone, so every connected human older than the
   * threshold would be wrongly taken over. Optional only so tests can pass an
   * already-hydrated room.lastSeenAt directly; production MUST provide it.
   */
  getSeen?: (code: string, playerId: string) => Promise<number | null>;
}

export interface DcCheckResponseBody {
  /** Number of rooms enumerated from the active index. */
  scanned: number;
  /** Number of human seats flipped to bots across all rooms. */
  promoted: number;
  /** Number of rooms that errored mid-processing. */
  errors: number;
}

const DEFAULT_THRESHOLD_MS = 60_000;
const DEFAULT_TURN_TIMEOUT_SECONDS = 30;
const ROUND_TTL_SECONDS = 86_400;
const ROOM_TTL_SECONDS = 86_400;

export async function handleDcCheck(
  req: Request,
  deps: DcCheckDeps
): Promise<Response> {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return json({ error: 'method_not_allowed' }, 405);
  }

  // Fail-closed when no admin token is configured.
  if (!deps.adminToken || deps.adminToken.length === 0) {
    return json({ error: 'admin_token_not_configured' }, 503);
  }

  const bearer = extractBearerToken(req);
  if (!bearer) {
    return json({ error: 'unauthorized' }, 401);
  }
  if (!constantTimeEqual(bearer, deps.adminToken)) {
    return json({ error: 'unauthorized' }, 401);
  }

  const now = (deps.now ?? Date.now)();
  const thresholdMs = deps.thresholdMs ?? DEFAULT_THRESHOLD_MS;
  const takeoverTier = deps.takeoverTier ?? 'medium';
  const turnTimeoutSeconds =
    deps.turnTimeoutSeconds ?? DEFAULT_TURN_TIMEOUT_SECONDS;

  const codes = await deps.roomStore.listCodes();
  let promoted = 0;
  let errors = 0;

  for (const code of codes) {
    try {
      const room = await deps.roomStore.get(code);
      // Ghost index entry (TTL'd out) or lobby room → nothing to take over.
      // The cleanup cron reconciles ghost index entries; we just skip them.
      if (room === null || room.phase !== 'in_game') continue;

      // Hydrate per-player liveness from the seen store (SSE heartbeat feed)
      // before the disconnect check. The hydrated copy is transient — never
      // persisted back to the room hash.
      let scanRoom = room;
      if (deps.getSeen) {
        const lastSeenAt: Record<string, number> = { ...(room.lastSeenAt ?? {}) };
        for (const m of room.members) {
          const seen = await deps.getSeen(code, m.id);
          if (seen !== null) lastSeenAt[m.id] = seen;
        }
        scanRoom = { ...room, lastSeenAt };
      }

      const disconnected = findDisconnectedHumans(scanRoom, now, thresholdMs);
      if (disconnected.length === 0) continue;

      // Promote every silent human in this room. promoteToBot is a pure,
      // idempotent fold so we thread the state through the list.
      let nextRoom = room;
      for (const playerId of disconnected) {
        nextRoom = promoteToBot(nextRoom, playerId, takeoverTier);
      }
      promoted += disconnected.length;
      await deps.roomStore.put(nextRoom, ROOM_TTL_SECONDS);

      // If a newly-promoted seat is the current player, advance the round
      // through any contiguous bot turns so the table doesn't stall waiting
      // for a human who has gone. Events are discarded — no SSE fanout here.
      const envelope = await deps.roundStore.get(code);
      const currentPlayer = envelope?.round.currentTrick?.currentPlayer;
      if (
        envelope !== null &&
        envelope !== undefined &&
        currentPlayer !== undefined &&
        disconnected.includes(currentPlayer)
      ) {
        const turnDeadline = new Date(
          now + turnTimeoutSeconds * 1000
        ).toISOString();
        const runInput: Parameters<typeof runBots>[0] = {
          room: nextRoom,
          round: envelope.round,
          startVersion: envelope.version,
          turnDeadline,
        };
        if (deps.rng !== undefined) runInput.rng = deps.rng;
        const botResult = runBots(runInput);
        if (botResult.version !== envelope.version) {
          await deps.roundStore.put(
            code,
            {
              round: botResult.round,
              version: botResult.version,
              updatedAt: now,
            },
            ROUND_TTL_SECONDS
          );
          // Keep the room alive while bots play out the round — mirrors the
          // move handler's R-I1 activity bump.
          try {
            await deps.roomStore.touchActivity(code, now, ROOM_TTL_SECONDS);
          } catch (err) {
            console.error('[dc-check] activity refresh failed', code, err);
          }
        }
      }
    } catch (err) {
      console.error('[dc-check] error processing code', code, err);
      errors += 1;
    }
  }

  const body: DcCheckResponseBody = {
    scanned: codes.length,
    promoted,
    errors,
  };
  return json(body, 200);
}

/**
 * Constant-time string comparison — prevents timing-attack discovery of the
 * admin token. Returns true iff the two strings are byte-identical.
 */
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
