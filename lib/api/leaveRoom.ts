// POST /api/room/[code]/leave — pure handler.
//
// Auth: Authorization: Bearer <joinToken> identifies which member is leaving.
// Plaintext compare (joinTokens are 128-bit UUIDs) is fine here — these
// tokens are minted per-room and rotated when a member re-joins; there is no
// long-lived secret like AUTH-1's per-handle ownershipToken.

import { leaveRoom } from '../room/lifecycle';
import { isValidRoomCode } from '../room/code';
import { extractBearerToken } from '../auth/ownershipToken';
import type { RoomStore } from '../storage/roomStore';

export interface LeaveRoomDeps {
  roomStore: RoomStore;
  now?: () => number;
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
  const responseBody: LeaveRoomResponseBody = { ok: true };
  return json(responseBody, 200);
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
