// GET /api/cron/cleanup-rooms — pure handler.
//
// Periodic cleanup pass that removes abandoned rooms. The Redis TTL already
// expires inactive rooms after 24h; this pass catches:
//   1. Rooms whose TTL has expired but whose code is still in the active-
//      codes index (the data key is gone, the index entry leaks until we
//      delete it).
//   2. Rooms where `lastActiveAt` is older than the configured staleness
//      threshold, even though the TTL hasn't yet fired (e.g., a room with
//      a long base TTL but no activity for hours).
//
// Auth: Bearer ADMIN_TOKEN. Vercel cron triggers send this header
// automatically when CRON_SECRET / ADMIN_TOKEN is configured in env vars.
// Manual triggering for tests / ops uses the same header.

import { extractBearerToken } from '../auth/ownershipToken.js';
import { isStale } from '../room/lifecycle.js';
import type { RoomStore } from '../storage/roomStore.js';

export interface CleanupRoomsDeps {
  roomStore: RoomStore;
  /** Wall clock. Defaults to Date.now. */
  now?: () => number;
  /**
   * Bearer secret required to run cleanup. When unset, the handler refuses
   * with 503 — fail-closed so a misconfigured deploy can't be triggered
   * anonymously to delete rooms.
   */
  adminToken?: string;
  /**
   * Staleness threshold in milliseconds. A room is considered stale when
   * `now - lastActiveAt >= stalenessMs`. Defaults to 4 hours, which catches
   * abandoned-mid-game rooms but is well above worst-case AFK gameplay.
   */
  stalenessMs?: number;
}

export interface CleanupRoomsResponseBody {
  scanned: number;
  stale: number;
  ghost: number;
  deleted: number;
  errors: number;
}

const DEFAULT_STALENESS_MS = 4 * 60 * 60 * 1000; // 4 hours

export async function handleCleanupRooms(
  req: Request,
  deps: CleanupRoomsDeps
): Promise<Response> {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return json({ error: 'method_not_allowed' }, 405);
  }

  // Fail-closed when no admin token is configured. Same posture as the
  // sibling scorer's admin endpoints — see project memory `project_admin_token_deploy.md`.
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
  const stalenessMs = deps.stalenessMs ?? DEFAULT_STALENESS_MS;

  const codes = await deps.roomStore.listCodes();
  let stale = 0;
  let ghost = 0;
  let deleted = 0;
  let errors = 0;

  for (const code of codes) {
    try {
      const room = await deps.roomStore.get(code);
      if (room === null) {
        // TTL already expired the room but the index entry lingered.
        ghost += 1;
        await deps.roomStore.delete(code);
        deleted += 1;
        continue;
      }
      if (isStale(room, now, stalenessMs)) {
        stale += 1;
        await deps.roomStore.delete(code);
        deleted += 1;
      }
    } catch (err) {
      console.error('[cleanup-rooms] error processing code', code, err);
      errors += 1;
    }
  }

  const body: CleanupRoomsResponseBody = {
    scanned: codes.length,
    stale,
    ghost,
    deleted,
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
