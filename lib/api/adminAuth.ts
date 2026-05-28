// Shared admin-token gate for the SEC-3 admin endpoints.
//
// Same posture as `lib/api/cleanupRooms.ts`: fail-closed (503) when no token
// is configured so a misconfigured deploy can't be driven anonymously, then
// 401 on a missing/mismatched bearer using a CONSTANT-TIME compare to avoid
// leaking the token byte-by-byte via response timing.
//
// Returns null when the request is authorized; otherwise returns the Response
// the handler should send immediately.

import { extractBearerToken } from '../auth/ownershipToken.js';

export interface AdminAuthResult {
  /** Set when the request is rejected — caller returns this Response. */
  readonly reject: Response | null;
}

/**
 * Authorize an admin request. Pass the configured `adminToken` (from
 * `process.env['ADMIN_TOKEN']` in the route wrapper). On success the returned
 * `reject` is null; on failure it carries the 503 / 401 Response to return.
 */
export function authorizeAdmin(req: Request, adminToken: string | undefined): AdminAuthResult {
  if (!adminToken || adminToken.length === 0) {
    return { reject: json({ error: 'admin_token_not_configured' }, 503) };
  }
  const bearer = extractBearerToken(req);
  if (!bearer || !constantTimeEqual(bearer, adminToken)) {
    return { reject: json({ error: 'unauthorized' }, 401) };
  }
  return { reject: null };
}

/**
 * Constant-time string comparison — prevents timing-attack discovery of the
 * admin token. Returns true iff the two strings are byte-identical. Copied
 * verbatim from cleanupRooms.ts so the auth semantics stay identical.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
