// GET /api/admin/reports — pure handler logic.
//
// Admin-token-gated read of the most recent player reports for the moderation
// dashboard. Auth mirrors cleanupRooms.ts via the shared `authorizeAdmin`
// helper: 503 when ADMIN_TOKEN is unset (fail-closed), 401 on a missing /
// mismatched bearer (constant-time compare), 200 + data on a good token.

import { authorizeAdmin, json } from './adminAuth.js';
import type { PlayerReport, ReportStore } from '../security/reports.js';

export interface AdminReportsDeps {
  reportStore: ReportStore;
  adminToken?: string;
  /** Max reports to return. Defaults to 50, capped at 200. */
  defaultLimit?: number;
}

export interface AdminReportsResponseBody {
  reports: readonly PlayerReport[];
}

const HARD_LIMIT = 200;

export async function handleAdminReports(
  req: Request,
  deps: AdminReportsDeps
): Promise<Response> {
  if (req.method !== 'GET') {
    return json({ error: 'method_not_allowed' }, 405);
  }
  const auth = authorizeAdmin(req, deps.adminToken);
  if (auth.reject) return auth.reject;

  const url = new URL(req.url);
  const limit = resolveLimit(url.searchParams.get('limit'), deps.defaultLimit ?? 50);

  try {
    const reports = await deps.reportStore.listRecent(limit);
    const body: AdminReportsResponseBody = { reports };
    return json(body, 200);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[admin/reports] failed to list reports', message);
    return json({ error: 'internal_error', details: message }, 500);
  }
}

function resolveLimit(raw: string | null, fallback: number): number {
  if (raw === null) return Math.min(fallback, HARD_LIMIT);
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return Math.min(fallback, HARD_LIMIT);
  return Math.min(Math.floor(n), HARD_LIMIT);
}
