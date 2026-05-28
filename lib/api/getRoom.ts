// GET /api/room/[code] — read-only public room view.
//
// Anyone holding the code can read the room — same access model as a
// meeting-room number. Tokens (hostToken, joinTokens) are stripped so a
// stolen code cannot escalate to admin or impersonate a member; tokens
// remain on the host's create-room response and joiners' join responses.

import { isValidRoomCode } from '../room/code.js';
import type { RoomState } from '../room/lifecycle.js';
import type { RoomStore } from '../storage/roomStore.js';
import { findSharedIpGroups, type SharedIpGroup } from '../room/ipWarning.js';
import { extractBearerToken } from '../auth/ownershipToken.js';

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
  /**
   * SEC-2: groups of members that appear to share an IP. Present ONLY when the
   * requester proves host identity (hostToken via `?hostToken=` or Bearer).
   * Never sent to non-hosts — it is a moderation signal. The per-member ipHash
   * itself is never exposed.
   */
  sharedIpGroups?: SharedIpGroup[];
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

  // SEC-2: surface the same-room IP warning only to the verified host.
  const url = new URL(req.url);
  const presentedHostToken =
    url.searchParams.get('hostToken') ?? extractBearerToken(req);
  const isHost =
    presentedHostToken !== null &&
    constantTimeEqual(presentedHostToken, state.hostToken);

  return json(redact(state, isHost), 200);
}

/**
 * Strip secrets from the room view before serialization. hostToken authorizes
 * admin actions; joinTokens authorize SSE reconnect + leave; both are leaked
 * if exposed here. Keep the response shape narrow + explicit so we never
 * accidentally include a new sensitive field added to RoomState later.
 */
function redact(state: RoomState, isHost: boolean): PublicRoomState {
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
  // Host-only same-room IP warning. findSharedIpGroups returns only groups of
  // ≥2 members sharing a hash; empty → omit the field entirely.
  if (isHost) {
    const groups = findSharedIpGroups(state.members);
    if (groups.length > 0) out.sharedIpGroups = groups;
  }
  return out;
}

/** Constant-time string comparison — avoids timing-leak of the host token. */
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
