// POST /api/room/[code]/join — pure handler.
//
// The Vercel wrapper parses the room code from the URL path and forwards
// (req, code, deps) here. Same pure-handler pattern as createRoom for
// testability.

import { joinRoom } from '../room/lifecycle.js';
import { isValidRoomCode } from '../room/code.js';
import { normalizeHandle, validateHandle } from '../auth/handle.js';
import type { RoomStore } from '../storage/roomStore.js';
import type { EventBus } from '../realtime/eventBus.js';
import type { EventLog } from '../realtime/eventLog.js';
import { publishEvent } from '../realtime/publish.js';
import { deriveRoomJoined } from '../realtime/deriveLifecycleEvents.js';
import { buildLobbyGameState } from '../realtime/buildLobbyGameState.js';
import type { RateLimiter } from '../security/rateLimit.js';

export interface JoinRoomDeps {
  roomStore: RoomStore;
  tokenGen?: () => string;
  now?: () => number;
  /**
   * Optional event-fanout transport. When provided, room_joined is published
   * to all (post-join) members. Older callers without realtime infra wired
   * (some test fixtures) pass undefined and the handler skips the publish —
   * the lifecycle state still updates correctly.
   */
  bus?: EventBus;
  log?: EventLog;
  /**
   * R-I5: Optional per-IP rate limiter. Caps joins at 10/min to throttle
   * scripted scraping without affecting honest multi-room scenarios.
   */
  rateLimiter?: RateLimiter;
  /** R-I5: Identity extractor for rate-limit keying. */
  identify?: (req: Request) => string;
}

export interface JoinRoomResponseBody {
  playerId: string;
  joinToken: string;
}

const ROOM_TTL_SECONDS = 86_400;

export async function handleJoinRoom(
  req: Request,
  code: string,
  deps: JoinRoomDeps
): Promise<Response> {
  if (req.method !== 'POST') {
    return json({ error: 'method_not_allowed' }, 405);
  }
  if (!isValidRoomCode(code)) {
    return json({ error: 'invalid_room_code' }, 400);
  }

  // R-I5: per-IP rate limiting on join. Honest multi-room players hit a few
  // per minute; the cap throttles scripted scraping / brute-force-code
  // guessing.
  if (deps.rateLimiter) {
    const ident = deps.identify ? deps.identify(req) : extractIdentity(req);
    const now = (deps.now ?? Date.now)();
    const rl = await deps.rateLimiter.check(`join:${ident}`, now);
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

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }

  const handleRaw = (body as Record<string, unknown> | null)?.['handle'];
  const handle = normalizeHandle(handleRaw);
  const validation = validateHandle(handle);
  if (!validation.valid) {
    return json({ error: 'invalid_handle', details: validation.error }, 400);
  }

  const state = await deps.roomStore.get(code);
  if (!state) {
    return json({ error: 'room_not_found' }, 404);
  }

  // Next-available playerId is "p<members.length>" — dense and stable.
  const nextId = `p${state.members.length}`;
  const tokenGen = deps.tokenGen ?? defaultTokenGen;
  const now = deps.now ?? Date.now;

  let updated;
  try {
    updated = joinRoom(state, { id: nextId, handle }, now(), tokenGen);
  } catch (err) {
    // Lifecycle throws on "room full", "handle taken", "phase != lobby" —
    // all client conflicts, surfaced as 409.
    return json({ error: 'conflict', details: (err as Error).message }, 409);
  }

  await deps.roomStore.put(updated, ROOM_TTL_SECONDS);

  // Lifecycle fanout. The post-join state INCLUDES the new member, so they
  // receive room_joined on their own join (the SSE handshake comes next and
  // will replay this event via backlog). Failures here never propagate —
  // the state already committed.
  if (deps.bus && deps.log) {
    try {
      const events = deriveRoomJoined({ preState: state, postState: updated });
      const gameState = buildLobbyGameState(updated);
      for (const event of events) {
        await publishEvent(updated.code, event, gameState, deps.bus, deps.log);
      }
    } catch (err) {
      console.error('[joinRoom] publishEvent failed:', err);
    }
  }

  const newMember = updated.members[updated.members.length - 1]!;
  const responseBody: JoinRoomResponseBody = {
    playerId: newMember.id,
    joinToken: newMember.joinToken,
  };
  return json(responseBody, 200);
}

function defaultTokenGen(): string {
  return crypto.randomUUID();
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
