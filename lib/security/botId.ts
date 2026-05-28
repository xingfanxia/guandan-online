// Vercel BotID verdict reader — pure, dependency-free, framework-agnostic.
//
// Vercel BotID (GA June 2025, powered by Kasada) is edge bot detection. The
// production integration is the `botid/server` SDK's `checkBotId()`, which
// returns `{ isBot, isVerifiedBot, verifiedBotName, verifiedBotCategory }` by
// reading challenge headers the client `<BotIdClient>` script attaches to
// protected requests (see docs/research note below + Vercel changelog).
//
// We CANNOT run the real edge/Kasada layer in unit tests, and `checkBotId()`
// takes no arguments + reaches into framework request context — neither is
// testable in isolation. So this module is the testable seam: a pure reader
// that parses the verdict the platform forwards as request headers, plus a
// gate that decides allow/deny with a friendly-bot User-Agent allowlist.
//
// Integration shape (see INTEGRATION NOTES in the SEC-4 report):
//   - The Vercel route calls `checkBotId()` and forwards the verdict as
//     headers onto the downstream `Request` (or the platform forwards them
//     directly when BotID rewrites are configured in vercel.json).
//   - The pure handler then calls `shouldBlockRequest(request, opts)` and
//     returns 403 when `{ blocked: true }`.
//
// Header contract (documented, sensible names — adjust the constants here if
// Vercel's forwarded-header names differ in your deployment):
//   - `x-vercel-bot`      → verdict string: 'human' | 'bot' | 'verified-bot'
//   - `x-vercel-bot-name` → optional verified-bot name (e.g. 'Googlebot');
//                           treated as a hint, not authoritative.
// A request with neither header carries no platform signal → 'unknown'
// (fail-open at the reader layer; the GATE decides policy, per SEC-4 brief).

/** Canonical verdict header set by the platform / forwarded by the route. */
export const BOT_VERDICT_HEADER = 'x-vercel-bot';

/** Optional verified-bot name header (hint only — never trusted for allow). */
export const BOT_NAME_HEADER = 'x-vercel-bot-name';

export interface BotIdVerdict {
  /**
   * True when the platform classified the session as automated — covers BOTH
   * plain bots and verified bots (mirrors the SDK's `isBot`, which is true for
   * verified bots too). Use `verdict` to distinguish.
   */
  isBot: boolean;
  /**
   * Four-way classification:
   *   - 'human'        — passed bot detection.
   *   - 'bot'          — flagged, NOT on Vercel's verified-bot list.
   *   - 'verified-bot' — flagged but a known-good automated agent
   *                      (search crawler, uptime monitor, LLM fetcher).
   *   - 'unknown'      — no platform signal present (header absent / blank /
   *                      unrecognized). Fail-open here; gate decides.
   */
  verdict: 'human' | 'bot' | 'verified-bot' | 'unknown';
}

export interface BotGateOptions {
  /**
   * User-Agent substrings that identify our OWN trusted automation — Vercel
   * cron probes, uptime/health monitors, synthetic checks. Matched
   * case-insensitively as substrings against the request's User-Agent.
   */
  allowlist?: readonly string[];
  /**
   * When true, treat the 'unknown' verdict as a bot and block it (strict
   * posture for high-value routes). Defaults to false — unknown is allowed,
   * because legitimate clients may reach the route before the client script
   * has attached challenge headers, and we fail-open to avoid locking real
   * users out.
   */
  blockUnverified?: boolean;
}

/**
 * Read the BotID verdict off a request's headers. Pure — no network, no SDK.
 *
 * Recognized verdict strings (case-insensitive, trimmed):
 *   'human'                                  → human
 *   'bot' | 'true' | '1' | 'malicious'       → bot
 *   'verified-bot' | 'verified' | 'good-bot' → verified-bot
 * Anything else (absent / blank / unrecognized) → unknown.
 */
export function readBotIdVerdict(request: Request): BotIdVerdict {
  const raw = request.headers.get(BOT_VERDICT_HEADER);
  if (raw === null) return { isBot: false, verdict: 'unknown' };

  const value = raw.trim().toLowerCase();
  if (value.length === 0) return { isBot: false, verdict: 'unknown' };

  switch (value) {
    case 'human':
    case 'pass':
    case 'false':
    case '0':
      return { isBot: false, verdict: 'human' };
    case 'verified-bot':
    case 'verified':
    case 'good-bot':
      return { isBot: true, verdict: 'verified-bot' };
    case 'bot':
    case 'true':
    case '1':
    case 'malicious':
    case 'fail':
      return { isBot: true, verdict: 'bot' };
    default:
      return { isBot: false, verdict: 'unknown' };
  }
}

/**
 * Decide whether to block a request based on its BotID verdict + a friendly-UA
 * allowlist.
 *
 * Policy:
 *   - 'human'        → allowed.
 *   - 'verified-bot' → allowed ONLY if the User-Agent matches an allowlist
 *                      substring (our own crawlers / probes). A verified bot
 *                      we don't recognize is still blocked — the allowlist is
 *                      the authority for which automation we serve, the
 *                      verdict alone is not a free pass.
 *   - 'bot'          → blocked, UNLESS the User-Agent matches the allowlist
 *                      (defense-in-depth for our own probes that the platform
 *                      mis-flagged or that arrive before classification).
 *   - 'unknown'      → blocked only when `blockUnverified` is set; otherwise
 *                      allowed (fail-open default).
 *
 * The allowlist matches the User-Agent for human/unknown verdicts too, but
 * those are already allowed by default, so it only matters for the bot cases.
 */
export function shouldBlockRequest(
  request: Request,
  opts: BotGateOptions = {}
): { blocked: boolean; reason?: string } {
  const { verdict } = readBotIdVerdict(request);
  const allowlisted = isAllowlistedUserAgent(request, opts.allowlist);

  switch (verdict) {
    case 'human':
      return { blocked: false };

    case 'verified-bot':
      // A verified bot is automation Vercel vouches for, but WE decide which
      // automation our routes serve. Only allow when its UA is on our list.
      if (allowlisted) return { blocked: false };
      return {
        blocked: true,
        reason: 'verified bot not on allowlist',
      };

    case 'bot':
      if (allowlisted) return { blocked: false };
      return { blocked: true, reason: 'bot verdict' };

    case 'unknown':
    default:
      if (allowlisted) return { blocked: false };
      if (opts.blockUnverified) {
        return { blocked: true, reason: 'unverified (no bot signal)' };
      }
      return { blocked: false };
  }
}

/**
 * Case-insensitive substring match of the request's User-Agent against the
 * allowlist. Returns false when there is no User-Agent or no allowlist — an
 * empty/absent UA can never be "trusted automation".
 */
function isAllowlistedUserAgent(
  request: Request,
  allowlist?: readonly string[]
): boolean {
  if (!allowlist || allowlist.length === 0) return false;
  const ua = request.headers.get('user-agent');
  if (ua === null) return false;
  const haystack = ua.toLowerCase();
  for (const needle of allowlist) {
    const trimmed = needle.trim().toLowerCase();
    if (trimmed.length > 0 && haystack.includes(trimmed)) return true;
  }
  return false;
}
