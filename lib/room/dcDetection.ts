// AI-4 — disconnect detection (pure).
//
// The SSE handler bumps `lastSeenAt[playerId]` on connect; the move handler
// bumps it per move (see INTEGRATION NOTES). The dc-check cron reads this map
// to find humans who have gone silent past the disconnect threshold during an
// in-game round, then promotes their seat to a bot via lib/room/botTakeover.ts
// so the table keeps moving.
//
// Pure + immutable: every transition returns a new RoomState; we never mutate
// the input `state`, `members`, or `lastSeenAt`.

import type { PlayerId } from '../game/round.js';
import type { RoomState } from './lifecycle.js';

/**
 * Record that `playerId` was just seen at wall-clock `now`. Returns a new
 * RoomState with the timestamp updated; the prior `lastSeenAt` map (if any)
 * is spread into a fresh object so the input state is never mutated.
 */
export function markSeen(
  state: RoomState,
  playerId: PlayerId,
  now: number
): RoomState {
  return {
    ...state,
    lastSeenAt: {
      ...(state.lastSeenAt ?? {}),
      [playerId]: now,
    },
  };
}

/**
 * Connected human members whose last-seen timestamp is older than
 * `now - thresholdMs`. The last-seen fallback is the member's `joinedAt` —
 * a human who connected, was dealt in, but never opened an SSE stream still
 * gets taken over once the threshold elapses.
 *
 * Only meaningful while `phase === 'in_game'`: a lobby room has no round to
 * keep moving, so disconnected lobby seats are ignored entirely (the host can
 * still start once everyone is present, and stale lobby rooms are GC'd by the
 * cleanup cron instead).
 *
 * Bots (`status: 'bot'`) and already-disconnected members are never returned —
 * only `status: 'connected'` seats can be promoted.
 */
export function findDisconnectedHumans(
  state: RoomState,
  now: number,
  thresholdMs: number
): PlayerId[] {
  if (state.phase !== 'in_game') return [];

  const cutoff = now - thresholdMs;
  const seen = state.lastSeenAt ?? {};
  const result: PlayerId[] = [];

  for (const member of state.members) {
    if (member.status !== 'connected') continue;
    const lastSeen = seen[member.id] ?? member.joinedAt;
    if (lastSeen < cutoff) {
      result.push(member.id);
    }
  }

  return result;
}
