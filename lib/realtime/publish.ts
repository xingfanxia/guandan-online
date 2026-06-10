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

import { assertNoOpponentHandLeak, buildClientPayload } from './buildClientPayload.js';
import type { AuthorEvent, GameState } from './buildClientPayload.js';
import type { EventBus } from './eventBus.js';
import type { EventLog } from './eventLog.js';
import type { PlayerId } from '../game/round.js';

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

  // Fan out to recipients IN PARALLEL — each recipient owns independent
  // stream keys, so only the per-recipient append→publish order matters.
  // The previous sequential loop cost (recipients × events) serial Redis
  // round-trips per move; with a remote Redis that compounded into
  // multi-second bot-response latency (the 2026-06-09 11.5s /move POST).
  await Promise.all(
    recipients.map(async (recipient) => {
      const payload = buildClientPayload(recipient, event, state);
      if (payload === null) return;

      // Dev / test runtime leak detector. Production trusts the build-time
      // grep-no-leak gate + per-event tests and skips the runtime scan.
      if (process.env['NODE_ENV'] !== 'production') {
        assertNoOpponentHandLeak(payload, recipient, state);
      }

      // Order matters within a recipient: append-before-publish (see
      // docblock). Never reorder or parallelize these two.
      await log.append(eventLogKey(roomId, recipient), payload);
      await bus.publish(`game:${roomId}:player:${recipient}`, payload);
    })
  );
}
