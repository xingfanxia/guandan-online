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
//   - createUpstashEventBus() — Redis Streams + polling; production. Upstash's
//     REST client lacks a real SUBSCRIBE, so publish is modeled as XADD to a
//     bus:<channel> stream and subscribe polls XRANGE since the last seen id.
//
// Errors thrown by handlers are caught and logged, never propagated — one
// crashed subscriber must not block delivery to others.

import type { ServerEvent } from './messages.js';
import { decodeStreamValue, type RedisLike } from './redisClient.js';

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

// ─── Upstash Redis implementation ─────────────────────────────────────────────
//
// Backing model:
//   - Each channel maps to a `bus:<channel>` Redis Stream.
//   - publish    → XADD '*' (server-assigned id), then EXPIRE for TTL refresh.
//   - subscribe  → seed cursor at the current top of the stream (so existing
//                  entries are skipped — live-only semantics), then schedule
//                  a setTimeout poll loop. Each tick reads `(<cursor> +` and
//                  invokes the handler for each new entry.
//   - unsubscribe → cancels the pending timer; idempotent.
//
// Resume semantics (resync of missed events on reconnect) live in the
// EventLog + SSE Last-Event-ID path, not here. The bus is ephemeral fanout —
// the durability layer is the log.

export interface UpstashEventBusOptions {
  /** Key namespace prefix. Defaults to 'bus:'. */
  keyPrefix?: string;
  /** Poll interval in milliseconds. Defaults to 200ms. */
  pollIntervalMs?: number;
  /** TTL refreshed on the channel stream after every publish. Defaults to 1h. */
  ttlSeconds?: number;
}

export function createUpstashEventBus(
  redis: RedisLike,
  options: UpstashEventBusOptions = {}
): EventBus {
  const prefix = options.keyPrefix ?? 'bus:';
  const pollMs = options.pollIntervalMs ?? 200;
  const ttl = options.ttlSeconds ?? 3600;

  const key = (channel: string) => `${prefix}${channel}`;

  return {
    async publish(channel, event) {
      await redis.xadd(key(channel), '*', { data: JSON.stringify(event) });
      await redis.expire(key(channel), ttl);
    },

    async subscribe(channel, handler) {
      // Seed cursor at the current top of the stream so existing entries are
      // skipped. For low-throughput per-recipient channels this initial scan
      // is cheap; if it becomes a hot spot, swap to XREVRANGE + count=1.
      const seed = await redis.xrange(key(channel), '-', '+');
      const seedIds = Object.keys(seed);
      let cursor = seedIds.length > 0 ? seedIds[seedIds.length - 1]! : '0-0';

      let cancelled = false;
      let timer: ReturnType<typeof setTimeout> | null = null;

      const tick = async (): Promise<void> => {
        if (cancelled) return;
        try {
          const entries = await redis.xrange(key(channel), `(${cursor}`, '+');
          for (const [streamId, fields] of Object.entries(entries)) {
            if (cancelled) return;
            // Upstash auto-deserializes field values on read, so `fields['data']`
            // is the parsed event object (NOT a JSON string) in production. Use
            // decodeStreamValue, not JSON.parse, which would throw
            // `"[object Object]" is not valid JSON` and silently drop every live
            // event (the SSE black-screen on the live path). The try/catch keeps
            // a single bad entry from halting the poll loop.
            try {
              const parsed = decodeStreamValue<ServerEvent>(fields['data']);
              if (parsed !== null) handler(parsed);
            } catch (err) {
              console.error('[upstashEventBus] handler threw:', err);
            }
            cursor = streamId;
          }
        } catch (err) {
          console.error('[upstashEventBus] poll error:', err);
        }
        if (!cancelled) {
          timer = setTimeout(() => void tick(), pollMs);
        }
      };

      timer = setTimeout(() => void tick(), pollMs);

      const unsubscribe: Unsubscribe = () => {
        cancelled = true;
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        return Promise.resolve();
      };
      return unsubscribe;
    },
  };
}
