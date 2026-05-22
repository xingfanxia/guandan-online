// POST /api/room/[code]/leave — pure handler.
//
// Auth: Authorization: Bearer <joinToken> identifies which member is leaving.
// Plaintext compare (joinTokens are 128-bit UUIDs) is fine here — these
// tokens are minted per-room and rotated when a member re-joins; there is no
// long-lived secret like AUTH-1's per-handle ownershipToken.

import { leaveRoom } from '../room/lifecycle.js';
import { isValidRoomCode } from '../room/code.js';
import { extractBearerToken } from '../auth/ownershipToken.js';
import type { RoomStore } from '../storage/roomStore.js';
import type { EventBus } from '../realtime/eventBus.js';
import type { EventLog } from '../realtime/eventLog.js';
import { publishEvent } from '../realtime/publish.js';
import { deriveRoomLeft } from '../realtime/deriveLifecycleEvents.js';
import { buildLobbyGameState } from '../realtime/buildLobbyGameState.js';
import type { RateLimiter } from '../security/rateLimit.js';

export interface LeaveRoomDeps {
  roomStore: RoomStore;
  now?: () => number;
  /**
   * Optional event-fanout transport. When provided, room_left is published
   * to all REMAINING members (the leaver doesn't receive it). When the host
   * leaves, the room is dissolved and no event fires — clients learn via
   * the next request returning 404.
   */
  bus?: EventBus;
  log?: EventLog;
  /**
   * R-I5: Optional per-IP rate limiter. Caps leave at 10/min — same as
   * join, since they're paired symmetric operations.
   */
  rateLimiter?: RateLimiter;
  /** R-I5: Identity extractor for rate-limit keying. */
  identify?: (req: Request) => string;
}

export interface LeaveRoomResponseBody {
  ok: true;
  dissolved?: true;
}

const ROOM_TTL_SECONDS = 86_400;

export async function handleLeaveRoom(
  req: Request,
  code: string,
  deps: LeaveRoomDeps
): Promise<Response> {
  if (req.method !== 'POST') {
    return json({ error: 'method_not_allowed' }, 405);
  }
  if (!isValidRoomCode(code)) {
    return json({ error: 'invalid_room_code' }, 400);
  }

  // R-I5: per-IP rate limiting on leave.
  if (deps.rateLimiter) {
    const ident = deps.identify ? deps.identify(req) : extractIdentity(req);
    const now = (deps.now ?? Date.now)();
    const rl = await deps.rateLimiter.check(`leave:${ident}`, now);
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

  const state = await deps.roomStore.get(code);
  if (!state) {
    return json({ error: 'room_not_found' }, 404);
  }

  const member = state.members.find((m) => m.joinToken === bearer);
  if (!member) {
    return json({ error: 'unauthorized' }, 401);
  }

  const now = deps.now ?? Date.now;
  const updated = leaveRoom(state, member.id, now());

  if (updated === null) {
    // Host left → dissolve the entire room.
    await deps.roomStore.delete(code);
    const responseBody: LeaveRoomResponseBody = { ok: true, dissolved: true };
    return json(responseBody, 200);
  }

  await deps.roomStore.put(updated, ROOM_TTL_SECONDS);

  // Lifecycle fanout. Post-leave state OMITS the leaving member, so the
  // gameState only enumerates remaining recipients — the leaver doesn't
  // get the event (clean by construction).
  if (deps.bus && deps.log) {
    try {
      const events = deriveRoomLeft({
        preState: state,
        postState: updated,
        reason: 'leave',
      });
      const gameState = buildLobbyGameState(updated);
      for (const event of events) {
        await publishEvent(updated.code, event, gameState, deps.bus, deps.log);
      }
    } catch (err) {
      console.error('[leaveRoom] publishEvent failed:', err);
    }
  }

  const responseBody: LeaveRoomResponseBody = { ok: true };
  return json(responseBody, 200);
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
