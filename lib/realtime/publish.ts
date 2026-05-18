// Single publish gateway — the ONLY place that calls EventBus.publish or
// EventLog.append. Centralizing publish prevents 30 scattered redis.publish
// sites from each having to remember to filter hidden state.
//
// SYNC: docs/research/realtime-sync-deep-dive.md § 7.4 ("Publish wrapper that
// enforces the discipline") lines ~1010-1057. The grep-no-leak CI script
// (scripts/security/grep-no-leak.sh) enforces this discipline mechanically:
// any reference to `.publish(` or `.append(` on bus/log outside this file
// breaks the build.

import { assertNoOpponentHandLeak, buildClientPayload } from './buildClientPayload';
import type { AuthorEvent, GameState } from './buildClientPayload';
import type { EventBus } from './eventBus';
import type { EventLog } from './eventLog';
import type { PlayerId } from '../game/round';

/**
 * Publish an event to every recipient in the game. Each recipient gets a
 * payload filtered to remove hidden state they shouldn't see. In dev mode,
 * each payload is also scanned for accidental opponent-card leaks and
 * throws HIDDEN_STATE_LEAK on detection.
 *
 * Side effects (per recipient):
 *   1. EventLog append (for SSE Last-Event-ID resume).
 *   2. EventBus publish (immediate SSE fanout via channel
 *      `game:{roomId}:player:{playerId}`).
 *
 * Order matters: append-before-publish means a fresh subscriber via XRANGE
 * will see the event before the SSE channel delivery (no missed events).
 */
export async function publishEvent(
  roomId: string,
  event: AuthorEvent,
  state: GameState,
  bus: EventBus,
  log: EventLog
): Promise<void> {
  const recipients = Object.keys(state.hands) as PlayerId[];

  for (const recipient of recipients) {
    const payload = buildClientPayload(recipient, event, state);
    if (payload === null) continue;

    // Dev / test runtime leak detector. Production trusts the build-time
    // grep-no-leak gate + per-event tests and skips the runtime scan.
    if (process.env['NODE_ENV'] !== 'production') {
      assertNoOpponentHandLeak(payload, recipient, state);
    }

    await log.append(roomId, payload);
    await bus.publish(`game:${roomId}:player:${recipient}`, payload);
  }
}
