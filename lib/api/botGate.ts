// Shared bot-gate helper (SEC-4). Wraps lib/security/botId.shouldBlockRequest
// into a route-friendly form: returns a 403 Response when the request should be
// blocked, or null to let the route proceed.
//
// Wired into the abuse-prone unauthenticated/scripted POST surfaces
// (room create, move, join). The verdict is read from a platform-forwarded
// header (BOT_VERDICT_HEADER) — absent in local dev / e2e, which yields the
// fail-open 'unknown' verdict, so non-production traffic is never blocked.
//
// Full edge activation (the Vercel BotID client script + challenge rewrites)
// is a deploy-time step; this gate is the always-on server-side enforcement
// that reads whatever verdict the platform forwards.

import { shouldBlockRequest, type BotGateOptions } from '../security/botId.js';

/** User-Agent substrings for our own trusted automation (cron / uptime probes). */
export const FRIENDLY_BOT_ALLOWLIST: readonly string[] = [
  'vercel-cron',
  'GuandanUptimeProbe',
];

/**
 * Returns a 403 Response when the request is a disallowed bot, else null.
 * Callers: `const denied = botGateResponse(request); if (denied) return denied;`
 */
export function botGateResponse(
  request: Request,
  opts: BotGateOptions = { allowlist: FRIENDLY_BOT_ALLOWLIST }
): Response | null {
  const { blocked, reason } = shouldBlockRequest(request, opts);
  if (!blocked) return null;
  return new Response(
    JSON.stringify({ error: 'bot_detected', details: reason ?? 'blocked' }),
    { status: 403, headers: { 'content-type': 'application/json' } }
  );
}
