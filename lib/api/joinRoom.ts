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

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
