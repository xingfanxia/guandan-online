// POST /api/report — pure handler logic.
//
// A player flags another player during a game. Body:
//   { reporterHandle, targetHandle, gameId, reason }
// where `reason` is one of the ReportReason enum values. Dedupes on the
// (reporter, target, gameId) tuple — a second identical report is accepted
// idempotently (200 with `deduped: true`) rather than written twice.
//
// Auth: none beyond an optional per-IP rate limit. The report surface is
// unauthenticated by design (a victim mid-game shouldn't need a token to
// flag a cheater), so the rate limiter is the only spam gate. The Vercel
// wrapper injects an Upstash-backed limiter in production.

import type { RateLimiter } from '../security/rateLimit.js';
import {
  REPORT_REASONS,
  type PlayerReport,
  type ReportReason,
  type ReportStore,
} from '../security/reports.js';

export interface ReportDeps {
  reportStore: ReportStore;
  /** Wall clock. Defaults to Date.now. */
  now?: () => number;
  /** Optional per-IP rate limiter. Omitted in unit tests unless verifying. */
  rateLimiter?: RateLimiter;
  /** How to derive the rate-limit identity. Defaults to X-Forwarded-For. */
  identify?: (req: Request) => string;
}

export interface ReportResponseBody {
  ok: true;
  deduped: boolean;
}

export async function handleReport(
  req: Request,
  deps: ReportDeps
): Promise<Response> {
  if (req.method !== 'POST') {
    return json({ error: 'method_not_allowed' }, 405);
  }

  if (deps.rateLimiter) {
    const ident = deps.identify ? deps.identify(req) : extractIdentity(req);
    const now = (deps.now ?? Date.now)();
    const rl = await deps.rateLimiter.check(`report:${ident}`, now);
    if (!rl.allowed) {
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (rl.retryAfterMs !== undefined) {
        headers['retry-after'] = Math.ceil(rl.retryAfterMs / 1000).toString();
      }
      return new Response(JSON.stringify({ error: 'rate_limited' }), {
        status: 429,
        headers,
      });
    }
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }

  const parsed = parseBody(body);
  if (!parsed.ok) {
    return json({ error: 'invalid_request', details: parsed.error }, 400);
  }

  const report: PlayerReport = {
    ...parsed.value,
    createdAt: (deps.now ?? Date.now)(),
  };

  try {
    const result = await deps.reportStore.record(report);
    const responseBody: ReportResponseBody = { ok: true, deduped: result.deduped };
    return json(responseBody, 200);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[report] failed to record report', message);
    return json({ error: 'internal_error', details: message }, 500);
  }
}

interface ParsedReport {
  reporterHandle: string;
  targetHandle: string;
  gameId: string;
  reason: ReportReason;
}

const VALID_REASONS = new Set<ReportReason>(REPORT_REASONS);

function parseBody(
  body: unknown
): { ok: true; value: ParsedReport } | { ok: false; error: string } {
  if (!body || typeof body !== 'object') {
    return { ok: false, error: 'body must be a JSON object' };
  }
  const obj = body as Record<string, unknown>;
  const reporterHandle = obj['reporterHandle'];
  const targetHandle = obj['targetHandle'];
  const gameId = obj['gameId'];
  const reason = obj['reason'];

  if (typeof reporterHandle !== 'string' || reporterHandle.trim().length === 0) {
    return { ok: false, error: 'reporterHandle must be a non-empty string' };
  }
  if (typeof targetHandle !== 'string' || targetHandle.trim().length === 0) {
    return { ok: false, error: 'targetHandle must be a non-empty string' };
  }
  if (reporterHandle === targetHandle) {
    return { ok: false, error: 'cannot report yourself' };
  }
  if (typeof gameId !== 'string' || gameId.trim().length === 0) {
    return { ok: false, error: 'gameId must be a non-empty string' };
  }
  if (typeof reason !== 'string' || !VALID_REASONS.has(reason as ReportReason)) {
    return {
      ok: false,
      error: `reason must be one of ${REPORT_REASONS.join(', ')}`,
    };
  }

  return {
    ok: true,
    value: {
      reporterHandle: reporterHandle.trim(),
      targetHandle: targetHandle.trim(),
      gameId: gameId.trim(),
      reason: reason as ReportReason,
    },
  };
}

function extractIdentity(req: Request): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0]!.trim();
  const real = req.headers.get('x-real-ip');
  if (real) return real;
  return 'anon';
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
