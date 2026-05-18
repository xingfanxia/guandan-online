// Derive room_joined / room_left AuthorEvents from a RoomState transition.
// Pure function — takes pre + post state plus the room mode (for team
// derivation in the PlayerSummary) and returns the event(s) to publish.
//
// Used by handleJoinRoom + handleLeaveRoom after their pure lifecycle
// function returns the new RoomState. The events are then routed through
// the publishEvent gateway with a lobby-phase GameState builder.

import type { TeamKey } from '../game/mode';
import type { RoomState } from '../room/lifecycle';
import type { AuthorEvent } from './buildClientPayload';
import type { PlayerSummary } from './messages';

/**
 * Alternating-team derivation matching startGame.assignSeats: even index
 * → t1, odd → t2. The lobby phase has no real seat assignment yet — this
 * is just a placeholder so room_joined / room_left events carry a
 * deterministic team field, even before the game starts.
 */
function teamForIndex(index: number): TeamKey {
  return index % 2 === 0 ? 't1' : 't2';
}

export interface DeriveJoinInput {
  preState: RoomState;
  postState: RoomState;
}

export function deriveRoomJoined(input: DeriveJoinInput): AuthorEvent[] {
  const { preState, postState } = input;
  const preIds = new Set(preState.members.map((m) => m.id));
  const newMembers = postState.members.filter((m) => !preIds.has(m.id));
  if (newMembers.length === 0) return [];

  // joinRoom only adds one member per call; if there's somehow more than
  // one, emit one event per new member with sequential versions starting
  // from postState.eventVersion. Common path emits exactly 1.
  const events: AuthorEvent[] = [];
  for (let i = 0; i < newMembers.length; i++) {
    const member = newMembers[i]!;
    const indexInPost = postState.members.findIndex((m) => m.id === member.id);
    const player: PlayerSummary = {
      id: member.id,
      handle: member.handle,
      team: teamForIndex(indexInPost),
      handCount: 0,
      status: member.status,
      rank: null,
    };
    events.push({
      type: 'room_joined',
      version: postState.eventVersion - (newMembers.length - 1 - i),
      player,
    });
  }
  return events;
}

export interface DeriveLeaveInput {
  preState: RoomState;
  postState: RoomState;
  reason: 'leave' | 'disconnect' | 'kick';
}

export function deriveRoomLeft(input: DeriveLeaveInput): AuthorEvent[] {
  const { preState, postState, reason } = input;
  const postIds = new Set(postState.members.map((m) => m.id));
  const goneMembers = preState.members.filter((m) => !postIds.has(m.id));
  if (goneMembers.length === 0) return [];

  const events: AuthorEvent[] = [];
  for (let i = 0; i < goneMembers.length; i++) {
    const member = goneMembers[i]!;
    events.push({
      type: 'room_left',
      version: postState.eventVersion - (goneMembers.length - 1 - i),
      playerId: member.id,
      reason,
    });
  }
  return events;
}
