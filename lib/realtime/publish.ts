// Single publish gateway — the ONLY place that calls EventBus.publish or
// EventLog.append. Centralizing publish prevents 30 scattered redis.publish
// sites from each having to remember to filter hidden state.
//
// SYNC: docs/research/realtime-sync-deep-dive.md § 7.4 ("Publish wrapper that
// enforces the discipline") lines ~1010-1057. The grep-no-leak CI script
// (scripts/security/grep-no-leak.sh) enforces this discipline mechanically:
// any reference to `.publish(` or `.append(` on bus/log outside this file
// breaks the build.
//
// Per-recipient log keying (security-critical): each filtered payload is
// appended to a recipient-specific log key — `eventLogKey(roomId, playerId)`.
// A single per-room log mixing all recipients' filtered payloads would let
// SSE backlog replay surface another player's "yourHand" view on resume,
// which IS hidden-state leakage. Per-recipient streams isolate the resume
// path so each client only re-reads payloads built for them.

import { assertNoOpponentHandLeak, buildClientPayload } from './buildClientPayload';
import type { AuthorEvent, GameState } from './buildClientPayload';
import type { EventBus } from './eventBus';
import type { EventLog } from './eventLog';
import type { PlayerId } from '../game/round';

/**
 * Compose the per-recipient log key. Consumers (handleSse) MUST use this
 * helper to read backlog rather than concatenating ad-hoc; if the format
 * here changes, the read side stays in sync via one import.
 */
export function eventLogKey(roomId: string, playerId: PlayerId): string {
  return `${roomId}:${playerId}`;
}

/**
 * Publish an event to every recipient in the game. Each recipient gets a
 * payload filtered to remove hidden state they shouldn't see. In dev mode,
 * each payload is also scanned for accidental opponent-card leaks and
 * throws HIDDEN_STATE_LEAK on detection.
 *
 * Side effects (per recipient):
 *   1. EventLog append to `eventLogKey(roomId, recipient)` — backs SSE
 *      Last-Event-ID resume; each recipient has their own monotonic id
 *      sequence, scoped to their filtered view.
 *   2. EventBus publish on `game:{roomId}:player:{playerId}` — live SSE
 *      fanout.
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

    await log.append(eventLogKey(roomId, recipient), payload);
    await bus.publish(`game:${roomId}:player:${recipient}`, payload);
  }
}
