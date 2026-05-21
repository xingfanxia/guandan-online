// GET /api/room/[code] — read-only public room view.
//
// Anyone holding the code can read the room — same access model as a
// meeting-room number. Tokens (hostToken, joinTokens) are stripped so a
// stolen code cannot escalate to admin or impersonate a member; tokens
// remain on the host's create-room response and joiners' join responses.

import { isValidRoomCode } from '../room/code.js';
import type { RoomState } from '../room/lifecycle.js';
import type { RoomStore } from '../storage/roomStore.js';

export interface GetRoomDeps {
  roomStore: RoomStore;
}

export interface PublicMember {
  id: string;
  handle: string;
  joinedAt: number;
  status: string;
  difficulty?: 'easy' | 'medium';
}

export interface PublicRoomState {
  code: string;
  mode: '4' | '6' | '8';
  phase: 'lobby' | 'in_game';
  hostId: string;
  members: PublicMember[];
  createdAt: number;
  lastActiveAt: number;
}

export async function handleGetRoom(
  req: Request,
  code: string,
  deps: GetRoomDeps
): Promise<Response> {
  if (req.method !== 'GET') {
    return json({ error: 'method_not_allowed' }, 405);
  }
  if (!isValidRoomCode(code)) {
    return json({ error: 'invalid_room_code' }, 400);
  }

  const state = await deps.roomStore.get(code);
  if (!state) {
    return json({ error: 'room_not_found' }, 404);
  }

  return json(redact(state), 200);
}

/**
 * Strip secrets from the room view before serialization. hostToken authorizes
 * admin actions; joinTokens authorize SSE reconnect + leave; both are leaked
 * if exposed here. Keep the response shape narrow + explicit so we never
 * accidentally include a new sensitive field added to RoomState later.
 */
function redact(state: RoomState): PublicRoomState {
  const out: PublicRoomState = {
    code: state.code,
    mode: state.mode,
    phase: state.phase,
    hostId: state.hostId,
    members: state.members.map((m) => {
      const member: PublicMember = {
        id: m.id,
        handle: m.handle,
        joinedAt: m.joinedAt,
        status: m.status,
      };
      if (m.difficulty !== undefined) member.difficulty = m.difficulty;
      return member;
    }),
    createdAt: state.createdAt,
    lastActiveAt: state.lastActiveAt,
  };
  return out;
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
