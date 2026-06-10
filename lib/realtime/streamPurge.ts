// Stream purge — deletes a room's per-recipient event-log + bus streams.
//
// Why this exists: stream keys are reclaimed by TTL (EXPIRE), and since the
// 2026-06-09 latency work those EXPIREs are fire-and-forget. If the FIRST
// expire after a stream's creating XADD is dropped, the stream has no TTL at
// all — and the cleanup cron used to delete only the room record, never the
// streams, so such a key would leak forever. The cron now calls this purge
// for every stale room it prunes, making stream lifetime independent of the
// best-effort EXPIRE path.
//
// Best-effort by design: a failed DEL is logged and swallowed — cleanup must
// never abort the cron pass, and any key that still has its TTL will expire
// on its own anyway.

import type { RedisLike } from './redisClient.js';
import { eventLogKey, playerChannel } from './publish.js';
import { DEFAULT_EVENT_LOG_PREFIX } from './eventLog.js';
import { DEFAULT_EVENT_BUS_PREFIX } from './eventBus.js';

export type StreamPurge = (
  roomId: string,
  memberIds: readonly string[]
) => Promise<void>;

/**
 * Build the purge function over the production Redis client. Pass null
 * (memory backend) to get a no-op — memory log/bus state is process-local
 * and dies with the process.
 */
export function createStreamPurge(redis: RedisLike | null): StreamPurge {
  if (!redis) {
    return async () => undefined;
  }
  return async (roomId, memberIds) => {
    const keys: string[] = [];
    for (const id of memberIds) {
      keys.push(`${DEFAULT_EVENT_LOG_PREFIX}${eventLogKey(roomId, id)}`);
      keys.push(`${DEFAULT_EVENT_BUS_PREFIX}${playerChannel(roomId, id)}`);
    }
    await Promise.all(
      keys.map((key) =>
        Promise.resolve(redis.del(key)).catch((err) =>
          console.error('[streamPurge] del failed (best-effort):', key, err)
        )
      )
    );
  };
}
