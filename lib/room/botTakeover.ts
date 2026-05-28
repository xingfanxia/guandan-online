// AI-4 — bot takeover + human reclaim (pure).
//
// When findDisconnectedHumans (lib/room/dcDetection.ts) flags a silent human
// during an in-game round, the dc-check cron calls `promoteToBot` to flip that
// seat to a bot so the table keeps moving. The original human's reclaim
// credentials are stashed on `takenOverFrom`; a reconnecting client presenting
// the matching joinToken resumes the seat via `reclaimSeat` (wired into the
// join handler — see INTEGRATION NOTES).
//
// The member's hand + seat are NOT touched here: hands live in the GameRound
// (lib/game/round.ts), keyed by PlayerId, and the PlayerId is stable across the
// human↔bot flip. So a takeover changes only the member's status/difficulty
// and is fully reversible.
//
// Pure + immutable: each transition returns a new RoomState; we never mutate
// the input `state` or its `members` array.

import type { PlayerId } from '../game/round.js';
import type { RoomState, RoomMember } from './lifecycle.js';

/** Default tier a disconnected human's seat is taken over at. */
export type TakeoverTier = 'easy' | 'medium';

/**
 * Flip a connected human member to a bot. Stashes the human's reclaim
 * credentials (`handle` + `joinToken`) on `takenOverFrom` so a reconnecting
 * client can later resume the seat.
 *
 * No-op (returns the input state unchanged) when:
 *   - the member is not found, or
 *   - the member is already a bot (idempotent — a second sweep tick that
 *     re-flags the same seat must not clobber the original `takenOverFrom`).
 */
export function promoteToBot(
  state: RoomState,
  playerId: PlayerId,
  difficulty: TakeoverTier = 'medium'
): RoomState {
  const member = state.members.find((m) => m.id === playerId);
  if (!member) return state;
  if (member.status === 'bot') return state;

  const promoted: RoomMember = {
    ...member,
    status: 'bot',
    difficulty,
    takenOverFrom: { handle: member.handle, joinToken: member.joinToken },
  };

  return {
    ...state,
    members: state.members.map((m) => (m.id === playerId ? promoted : m)),
  };
}

export interface ReclaimResult {
  state: RoomState;
  /** True when the seat was successfully flipped back to a human. */
  reclaimed: boolean;
}

/**
 * Reclaim a taken-over seat. Succeeds only when the member is a takeover-bot
 * (has `takenOverFrom`) AND the presented `joinToken` matches the stashed
 * original token. On success the member flips back to `connected`, the bot
 * `difficulty` + `takenOverFrom` marker are cleared, and the original handle
 * is restored.
 *
 * On any mismatch (member missing, genuine bot with no `takenOverFrom`, or
 * wrong token) returns `{ state, reclaimed: false }` with the state unchanged —
 * this is the gate that stops an attacker from stealing a seat with a
 * fabricated token.
 */
export function reclaimSeat(
  state: RoomState,
  playerId: PlayerId,
  joinToken: string
): ReclaimResult {
  const member = state.members.find((m) => m.id === playerId);
  if (!member) return { state, reclaimed: false };

  const original = member.takenOverFrom;
  // Genuine bot (host fill) or a live human → nothing to reclaim.
  if (member.status !== 'bot' || original === undefined) {
    return { state, reclaimed: false };
  }
  if (joinToken !== original.joinToken) {
    return { state, reclaimed: false };
  }

  // Flip back to human. Restore the original handle + join token; drop the
  // bot-only fields. `difficulty` and `takenOverFrom` are removed by omission
  // (we rebuild the member object rather than setting them to undefined).
  const restored: RoomMember = {
    id: member.id,
    handle: original.handle,
    joinToken: original.joinToken,
    joinedAt: member.joinedAt,
    status: 'connected',
  };
  if (member.ipHash !== undefined) {
    restored.ipHash = member.ipHash;
  }

  return {
    state: {
      ...state,
      members: state.members.map((m) => (m.id === playerId ? restored : m)),
    },
    reclaimed: true,
  };
}
