// Build the authoritative server-side GameState from the two stored shapes
// (RoomState + GameRound). Drives publishEvent's recipient enumeration and
// per-recipient filtering in buildClientPayload.
//
// This is the only spot that bridges:
//   - room.members[*].handle/status     → state.handles / state.statuses
//   - round.seats[*].team               → state.teams
//   - round.hands (Card[])              → state.hands (CardId[])
//   - round.finishOrder                 → state.ranks
//
// Partners are derived from the seats topology — in 4P each player has one
// distinct teammate; in 6P/8P teams have 3+ players, so partner falls back
// to the first teammate by position (the realtime layer only needs *some*
// partner reference for snapshot rendering; per-game-mode richer adjacency
// information is available via state.teams + seat order).

import { encodeCards } from './cardCodec.js';
import type { GameState } from './buildClientPayload.js';
import type { GameRound, PlayerId } from '../game/round.js';
import type { RoomState } from '../room/lifecycle.js';
import type { CardId, PlayerHandle, PlayerStatus } from './messages.js';
import type { TeamKey } from '../game/mode.js';

export function buildGameState(room: RoomState, round: GameRound): GameState {
  const hands: Record<PlayerId, CardId[]> = {};
  for (const [pid, cards] of Object.entries(round.hands)) {
    hands[pid] = encodeCards(cards);
  }

  const handles: Record<PlayerId, PlayerHandle> = {};
  const statuses: Record<PlayerId, PlayerStatus> = {};
  for (const member of room.members) {
    handles[member.id] = member.handle;
    statuses[member.id] = member.status;
  }

  const teams: Record<PlayerId, TeamKey> = {};
  for (const seat of round.seats) {
    teams[seat.id] = seat.team;
  }

  const partners: Record<PlayerId, PlayerId> = {};
  for (const seat of round.seats) {
    // First teammate by position. In 4P this is unique. In 6P/8P teams have
    // 3+ players — first-by-position keeps the mapping deterministic.
    const teammate = round.seats.find(
      (s) => s.team === seat.team && s.id !== seat.id
    );
    partners[seat.id] = teammate?.id ?? seat.id;
  }

  const ranks: Record<PlayerId, number | null> = {};
  for (const seat of round.seats) ranks[seat.id] = null;
  for (let i = 0; i < round.finishOrder.length; i++) {
    const pid = round.finishOrder[i];
    if (pid !== undefined) ranks[pid] = i + 1;
  }

  return { hands, handles, teams, partners, statuses, ranks };
}
