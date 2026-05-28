// Typed client for the SEC-3 admin + DEPLOY-2 telemetry endpoints.
//
// Each function maps to one HTTP handler:
//   GET  /api/admin/reports        → fetchReports
//   POST /api/admin/ban            → setBan
//   POST /api/admin/reset-stats    → resetStats
//   GET  /api/telemetry/latency    → fetchLatency
//
// The admin token travels as `Authorization: Bearer <token>`. fetch impl is
// dependency-injectable so the AdminDashboard tests run without a network.
// Reuses RoomApiError for consistent error surfacing across the client layer.

import { RoomApiError, type Fetcher } from './rooms';

export type ReportReason = 'cheating' | 'abuse' | 'afk' | 'other';

export interface PlayerReport {
  readonly reporterHandle: string;
  readonly targetHandle: string;
  readonly gameId: string;
  readonly reason: ReportReason;
  readonly createdAt: number;
}

export interface RegionLatencySummary {
  readonly p50: number;
  readonly p95: number;
  readonly p99: number;
  readonly count: number;
}

export type LatencyAggregate = Record<string, RegionLatencySummary>;

export interface AdminApiOptions {
  fetcher?: Fetcher;
  baseUrl?: string;
}

const defaultFetcher: Fetcher = (...args) => fetch(...args);

async function call<T>(url: string, init: RequestInit, fetcher: Fetcher): Promise<T> {
  let res: Response;
  try {
    res = await fetcher(url, init);
  } catch (err) {
    throw new RoomApiError(0, 'network_error', (err as Error).message);
  }
  let body: unknown = null;
  const text = await res.text();
  if (text.length > 0) {
    try {
      body = JSON.parse(text);
    } catch {
      throw new RoomApiError(res.status, 'invalid_response', text.slice(0, 200));
    }
  }
  if (!res.ok) {
    const obj = (body as Record<string, unknown> | null) ?? {};
    const code = typeof obj['error'] === 'string' ? obj['error'] : `http_${res.status}`;
    const details = typeof obj['details'] === 'string' ? obj['details'] : undefined;
    throw new RoomApiError(res.status, code, details);
  }
  return body as T;
}

function authHeaders(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

export async function fetchReports(
  token: string,
  limit = 50,
  opts: AdminApiOptions = {}
): Promise<readonly PlayerReport[]> {
  const fetcher = opts.fetcher ?? defaultFetcher;
  const base = opts.baseUrl ?? '';
  const body = await call<{ reports: readonly PlayerReport[] }>(
    `${base}/api/admin/reports?limit=${encodeURIComponent(limit)}`,
    { method: 'GET', headers: authHeaders(token) },
    fetcher
  );
  return body.reports;
}

export async function setBan(
  token: string,
  handle: string,
  banned: boolean,
  opts: AdminApiOptions = {}
): Promise<{ handle: string; banned: boolean }> {
  const fetcher = opts.fetcher ?? defaultFetcher;
  const base = opts.baseUrl ?? '';
  return call<{ ok: true; handle: string; banned: boolean }>(
    `${base}/api/admin/ban`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders(token) },
      body: JSON.stringify({ handle, banned }),
    },
    fetcher
  );
}

export async function resetStats(
  token: string,
  handle: string,
  opts: AdminApiOptions = {}
): Promise<{ handle: string; gamesPlayed: number }> {
  const fetcher = opts.fetcher ?? defaultFetcher;
  const base = opts.baseUrl ?? '';
  return call<{ ok: true; handle: string; gamesPlayed: number }>(
    `${base}/api/admin/reset-stats`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders(token) },
      body: JSON.stringify({ handle }),
    },
    fetcher
  );
}

export async function fetchLatency(
  token: string,
  opts: AdminApiOptions = {}
): Promise<LatencyAggregate> {
  const fetcher = opts.fetcher ?? defaultFetcher;
  const base = opts.baseUrl ?? '';
  const body = await call<{ regions: LatencyAggregate }>(
    `${base}/api/telemetry/latency`,
    { method: 'GET', headers: authHeaders(token) },
    fetcher
  );
  return body.regions;
}
