// Build a placeholder GameState for publishing lobby-phase events
// (room_joined / room_left) before seats are assigned and hands dealt.
//
// publishEvent enumerates recipients via Object.keys(state.hands), so the
// hands map must include an entry for every member that should receive the
// event. The values are empty arrays because there's no hidden state yet;
// the leak detector trivially passes since there are no opponent cards to
// leak.
//
// Lobby-phase events are all pass-through in buildClientPayload, so the
// other fields (handles / teams / partners / statuses / ranks) only need
// to satisfy the type — they don't get read for the wire payload. We still
// fill them with sensible defaults so a future event kind that consumes
// them won't crash.

import type { CardId, PlayerHandle, PlayerStatus } from './messages.js';
import type { PlayerId } from '../game/round.js';
import type { RoomState } from '../room/lifecycle.js';
import type { TeamKey } from '../game/mode.js';
import type { GameState } from './buildClientPayload.js';

/**
 * Choose a team for a lobby member by position parity (even → t1, odd → t2).
 * This is purely for type-completeness on the lobby GameState; startGame
 * will reassign teams when the game actually starts.
 */
function lobbyTeam(index: number): TeamKey {
  return index % 2 === 0 ? 't1' : 't2';
}

export function buildLobbyGameState(room: RoomState): GameState {
  const hands: Record<PlayerId, CardId[]> = {};
  const handles: Record<PlayerId, PlayerHandle> = {};
  const statuses: Record<PlayerId, PlayerStatus> = {};
  const teams: Record<PlayerId, TeamKey> = {};
  const partners: Record<PlayerId, PlayerId> = {};
  const ranks: Record<PlayerId, number | null> = {};

  for (let i = 0; i < room.members.length; i++) {
    const m = room.members[i]!;
    hands[m.id] = [];
    handles[m.id] = m.handle;
    statuses[m.id] = m.status;
    teams[m.id] = lobbyTeam(i);
    partners[m.id] = m.id; // self; reassigned at game-start
    ranks[m.id] = null;
  }

  return { hands, handles, teams, partners, statuses, ranks };
}
