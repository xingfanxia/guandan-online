// Latency-beacon ingestion + per-region percentile aggregation.
//
// Clients POST a round-trip-time beacon (one SSE-or-fetch round trip in ms,
// tagged with a coarse region). We retain a bounded ring of recent samples
// per region and compute p50 / p95 / p99 on demand for the admin dashboard's
// DEPLOY-2 latency panel.
//
// Percentile method: NEAREST-RANK on the sorted ascending sample array.
//   rank = ceil(p/100 * N), then index = rank - 1 (clamped to [0, N-1]).
// For p50 over [10,20,30,40] (N=4): rank = ceil(0.5*4) = 2 → index 1 → 20.
// Nearest-rank is chosen over linear interpolation because latency buckets are
// integers (ms) and an interpolated "37.5 ms p95" reads as false precision; a
// real observed sample is the honest number to surface.
//
// Storage shape mirrors roomStore.ts: a memory ring for dev / tests and a
// Redis impl. Per region we keep at most `maxSamples` newest beacons.

import type { RedisLike } from '../realtime/redisClient.js';

export interface LatencyBeacon {
  /** Coarse region tag, e.g. 'iad1' / 'hkg1' / 'unknown'. */
  readonly region: string;
  /** Observed round-trip time in milliseconds. */
  readonly roundTripMs: number;
  /** Wall-clock ms when the sample was taken. */
  readonly at: number;
}

export interface RegionLatencySummary {
  readonly p50: number;
  readonly p95: number;
  readonly p99: number;
  readonly count: number;
}

export type LatencyAggregate = Record<string, RegionLatencySummary>;

export interface LatencyStore {
  /** Record one beacon. Drops the oldest sample for the region past the cap. */
  record(beacon: LatencyBeacon): Promise<void>;
  /** Compute p50 / p95 / p99 per region from the retained samples. */
  aggregate(): Promise<LatencyAggregate>;
}

export interface LatencyStoreOptions {
  /** Key namespace prefix. Defaults to 'latency:'. */
  keyPrefix?: string;
  /** Max retained samples per region. Defaults to 1000. */
  maxSamples?: number;
}

const DEFAULT_MAX_SAMPLES = 1000;

/**
 * Nearest-rank percentile over an ASCENDING-sorted array of finite numbers.
 * `p` is 0–100. Empty input → 0. See module header for the formula + rationale.
 */
export function nearestRankPercentile(sortedAsc: readonly number[], p: number): number {
  const n = sortedAsc.length;
  if (n === 0) return 0;
  const rank = Math.ceil((p / 100) * n);
  const index = Math.min(Math.max(rank, 1), n) - 1;
  return sortedAsc[index]!;
}

/** Summarize a list of round-trip-time samples into p50/p95/p99 + count. */
export function summarizeSamples(samples: readonly number[]): RegionLatencySummary {
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    p50: nearestRankPercentile(sorted, 50),
    p95: nearestRankPercentile(sorted, 95),
    p99: nearestRankPercentile(sorted, 99),
    count: sorted.length,
  };
}

// ─── Memory implementation ────────────────────────────────────────────────────

export function createMemoryLatencyStore(
  options: LatencyStoreOptions = {}
): LatencyStore {
  const maxSamples = options.maxSamples ?? DEFAULT_MAX_SAMPLES;
  // region → ring of round-trip-time samples (oldest first).
  const byRegion = new Map<string, number[]>();

  return {
    async record(beacon) {
      let ring = byRegion.get(beacon.region);
      if (!ring) {
        ring = [];
        byRegion.set(beacon.region, ring);
      }
      ring.push(beacon.roundTripMs);
      if (ring.length > maxSamples) {
        // Drop the oldest overflow to keep the ring bounded.
        ring.splice(0, ring.length - maxSamples);
      }
    },
    async aggregate() {
      const out: LatencyAggregate = {};
      for (const [region, ring] of byRegion) {
        out[region] = summarizeSamples(ring);
      }
      return out;
    },
  };
}

// ─── Upstash Redis implementation ─────────────────────────────────────────────
//
// Per region we keep a set of "<at>:<rtt>" members (the timestamp prefix keeps
// members unique so two identical RTTs at different times both count). The
// region names themselves live in a `<prefix>regions` set so aggregate() can
// enumerate without a SCAN. Trimming past maxSamples drops the oldest members.
//
// Note: RedisLike exposes only set primitives, so this is O(N) per region on
// read. Sample volume is low (one beacon per game round per client) and the
// admin dashboard reads infrequently, so the simplicity is worth the cost.

interface RedisSample {
  at: number;
  rtt: number;
}

function encodeSample(beacon: LatencyBeacon): string {
  return `${beacon.at}:${beacon.roundTripMs}`;
}

function decodeSample(member: string): RedisSample | null {
  const sep = member.indexOf(':');
  if (sep < 0) return null;
  const at = Number(member.slice(0, sep));
  const rtt = Number(member.slice(sep + 1));
  if (!Number.isFinite(at) || !Number.isFinite(rtt)) return null;
  return { at, rtt };
}

export function createLatencyStore(
  redis: RedisLike,
  options: LatencyStoreOptions = {}
): LatencyStore {
  const prefix = options.keyPrefix ?? 'latency:';
  const maxSamples = options.maxSamples ?? DEFAULT_MAX_SAMPLES;
  const regionsKey = `${prefix}regions`;
  const samplesKey = (region: string) => `${prefix}samples:${region}`;

  async function readSamples(region: string): Promise<RedisSample[]> {
    const members = await redis.smembers(samplesKey(region));
    const parsed: RedisSample[] = [];
    for (const m of members) {
      const s = decodeSample(m);
      if (s) parsed.push(s);
    }
    // Oldest first so trimming drops the front.
    parsed.sort((a, b) => a.at - b.at);
    return parsed;
  }

  return {
    async record(beacon) {
      await redis.sadd(regionsKey, beacon.region);
      await redis.sadd(samplesKey(beacon.region), encodeSample(beacon));
      const samples = await readSamples(beacon.region);
      if (samples.length > maxSamples) {
        const overflow = samples.slice(0, samples.length - maxSamples);
        if (overflow.length > 0) {
          await redis.srem(
            samplesKey(beacon.region),
            ...overflow.map((s) => `${s.at}:${s.rtt}`)
          );
        }
      }
    },
    async aggregate() {
      const regions = await redis.smembers(regionsKey);
      const out: LatencyAggregate = {};
      for (const region of regions) {
        const samples = await readSamples(region);
        out[region] = summarizeSamples(samples.map((s) => s.rtt));
      }
      return out;
    },
  };
}
