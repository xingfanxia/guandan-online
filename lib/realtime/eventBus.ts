// EventBus — pub/sub abstraction for realtime fanout.
//
// SYNC: docs/research/realtime-sync-deep-dive.md § 7.2 final paragraph
// ("Why one Redis channel per recipient...") — the per-recipient channel
// pattern means the publisher does filtering once at send time, and SSE
// handlers do zero filtering. This interface is the seam between game
// state writes and SSE wire output.
//
// Two implementations target this contract:
//   - createMemoryEventBus()  — in-process; used in tests and dev (no Redis)
//   - createUpstashEventBus() — TBD in NET-1 part C; wraps @upstash/redis
//     pub/sub against a live KV instance
//
// Errors thrown by handlers are caught and logged, never propagated — one
// crashed subscriber must not block delivery to others.

import type { ServerEvent } from './messages';

export type Unsubscribe = () => Promise<void>;

export interface EventBus {
  publish(channel: string, event: ServerEvent): Promise<void>;
  subscribe(
    channel: string,
    handler: (event: ServerEvent) => void
  ): Promise<Unsubscribe>;
}

/**
 * In-process EventBus. Channels map to Sets of handlers. Async-by-API but
 * fully synchronous internally so test ordering is deterministic.
 */
export function createMemoryEventBus(): EventBus {
  const channels = new Map<string, Set<(e: ServerEvent) => void>>();

  return {
    publish(channel, event) {
      const handlers = channels.get(channel);
      if (handlers) {
        for (const handler of handlers) {
          try {
            handler(event);
          } catch (err) {
            // Defensive: a crashing handler must not break the chain.
            // Use console.error so the failure is visible in tests/logs
            // without throwing. NET-3 will wire structured logging later.
            console.error('[eventBus] subscriber threw:', err);
          }
        }
      }
      return Promise.resolve();
    },

    subscribe(channel, handler) {
      let handlers = channels.get(channel);
      if (!handlers) {
        handlers = new Set();
        channels.set(channel, handlers);
      }
      handlers.add(handler);

      const unsubscribe: Unsubscribe = () => {
        handlers!.delete(handler);
        if (handlers!.size === 0) channels.delete(channel);
        return Promise.resolve();
      };
      return Promise.resolve(unsubscribe);
    },
  };
}
