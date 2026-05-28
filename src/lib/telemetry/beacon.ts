// Client-side latency beacon. (DEPLOY-2)
//
// `measureRoundTrip` times an async call (a fetch / SSE handshake / move POST)
// and returns both its result and the elapsed ms. `sendLatencyBeacon` POSTs a
// round-trip-time sample to /api/telemetry/latency; it is fire-and-forget by
// design — a failed beacon must never disturb gameplay — so it swallows
// errors and returns a boolean for tests rather than throwing.
//
// fetch impl is dependency-injectable so tests run without a real network.

export type Fetcher = typeof fetch;

const defaultFetcher: Fetcher = (...args) => fetch(...args);

export interface BeaconOptions {
  /** Override the global fetch impl (tests + SSR). */
  fetcher?: Fetcher;
  /** Base URL prefix. Defaults to '' (same-origin). */
  baseUrl?: string;
  /** Optional explicit region tag; server tags from geo headers when absent. */
  region?: string;
}

/**
 * POST a single latency sample. Fire-and-forget: never throws, returns true on
 * a 2xx response and false on any error / non-2xx (so a beacon failure can't
 * break the calling game flow). Negative / non-finite samples are dropped.
 */
export async function sendLatencyBeacon(
  roundTripMs: number,
  opts: BeaconOptions = {}
): Promise<boolean> {
  if (!Number.isFinite(roundTripMs) || roundTripMs < 0) return false;
  const fetcher = opts.fetcher ?? defaultFetcher;
  const base = opts.baseUrl ?? '';
  const body: Record<string, unknown> = { roundTripMs };
  if (opts.region) body['region'] = opts.region;
  try {
    const res = await fetcher(`${base}/api/telemetry/latency`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      // Best-effort; don't hold the page open on unload.
      keepalive: true,
    });
    return res.ok;
  } catch {
    return false;
  }
}

export interface MeasuredCall<T> {
  /** The wrapped call's resolved value. */
  result: T;
  /** Elapsed wall-clock milliseconds, rounded to the nearest ms. */
  roundTripMs: number;
}

/**
 * Time an async function. Returns its result alongside the elapsed ms. Uses
 * `performance.now()` when available (monotonic, immune to clock changes),
 * falling back to Date.now. Re-throws the wrapped call's error unchanged — the
 * caller decides whether a failed call should still emit a beacon.
 */
export async function measureRoundTrip<T>(fn: () => Promise<T>): Promise<MeasuredCall<T>> {
  const clock =
    typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? () => performance.now()
      : () => Date.now();
  const start = clock();
  const result = await fn();
  const roundTripMs = Math.round(clock() - start);
  return { result, roundTripMs };
}

/**
 * Convenience: time a call AND emit a beacon for it, returning the call's
 * result. Beacon emission is fire-and-forget (awaited only so tests can assert
 * it ran; failures are swallowed inside sendLatencyBeacon). The wrapped call's
 * error propagates; no beacon is sent on failure.
 */
export async function measureAndBeacon<T>(
  fn: () => Promise<T>,
  opts: BeaconOptions = {}
): Promise<T> {
  const { result, roundTripMs } = await measureRoundTrip(fn);
  void sendLatencyBeacon(roundTripMs, opts);
  return result;
}
