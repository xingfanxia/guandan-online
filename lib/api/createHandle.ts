// POST /api/auth/createHandle — pure handler logic. (SEC-2)
//
// Registers a new @handle as a durable PlayerProfile, gated by a per-IP
// account-creation throttle (5 / 24h). Body: { handle }.
//
// The flow, in order (so the cheapest rejection happens first and an invalid
// request never consumes a throttle slot):
//   1. validate the handle format (400 on bad shape)
//   2. reject if the handle is already taken OR banned (409)
//   3. extract + hash the client IP, then check the throttle (429 if over cap)
//   4. persist a fresh profile (201 { ok, handle })
//
// Note on ordering: the taken/banned check runs BEFORE the throttle so a user
// re-submitting their own already-registered handle (e.g. a double-tap) gets a
// clean 409 instead of silently eating a throttle slot. The throttle only
// counts genuinely-new registrations.
//
// The Vercel wrapper (api/auth/createHandle.ts) injects the live ipThrottle +
// profileStore from the shared singletons and the IP_HASH_SALT from env. Tests
// construct `deps` directly with a deterministic clock + salt.

import { normalizeHandle, validateHandle } from '../auth/handle.js';
import { extractClientIp, hashIp } from '../security/ipHash.js';
import type { IpThrottle } from '../security/ipThrottle.js';
import type { ProfileStore, PlayerProfile } from '../storage/profileStore.js';

export interface CreateHandleDeps {
  ipThrottle: IpThrottle;
  profileStore: ProfileStore;
  /** Server-side secret salt for hashing the client IP. */
  salt: string;
  /** Wall clock. Defaults to Date.now. */
  now?: () => number;
  /**
   * How to extract the raw client IP. Defaults to extractClientIp
   * (X-Forwarded-For → X-Real-IP). Tests inject a stub to drive the throttle.
   */
  extractIp?: (req: Request) => string | null;
}

export interface CreateHandleResponseBody {
  ok: true;
  /** The normalized handle that was registered. */
  handle: string;
}

export async function handleCreateHandle(
  req: Request,
  deps: CreateHandleDeps
): Promise<Response> {
  if (req.method !== 'POST') {
    return json({ error: 'method_not_allowed' }, 405);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }

  // 1. Validate handle format. normalizeHandle strips a leading @ + lowercases;
  // validateHandle enforces the 3–20 ASCII-alphanumeric+underscore rule.
  if (!body || typeof body !== 'object') {
    return json({ error: 'invalid_request', details: 'body must be a JSON object' }, 400);
  }
  const rawHandle = (body as Record<string, unknown>)['handle'];
  const handle = normalizeHandle(rawHandle);
  const validation = validateHandle(handle);
  if (!validation.valid) {
    return json({ error: 'invalid_handle', details: validation.error ?? 'invalid handle' }, 400);
  }

  const now = (deps.now ?? Date.now)();

  // 2. Reject already-registered or banned handles before touching the
  // throttle. A banned handle is also surfaced as 409 (taken) — we don't leak
  // ban status to the client, only that the handle is unavailable.
  try {
    const existing = await deps.profileStore.get(handle);
    if (existing) {
      return json({ error: 'handle_taken', details: 'handle already registered' }, 409);
    }
    if (await deps.profileStore.isBanned(handle)) {
      // isBanned covers handles with a ban record but no full profile.
      return json({ error: 'handle_taken', details: 'handle unavailable' }, 409);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[createHandle] profile lookup failed', message);
    return json({ error: 'internal_error', details: message }, 500);
  }

  // 3. Per-IP account-creation throttle. An un-identifiable request (no IP
  // headers) is NOT throttled — we can't bucket it, and failing closed here
  // would block legitimate dev / proxy-stripped traffic. extractClientIp +
  // hashIp guarantee the raw IP is never persisted beyond the digest.
  const extractIp = deps.extractIp ?? extractClientIp;
  const rawIp = extractIp(req);
  if (rawIp) {
    const ipHash = hashIp(rawIp, deps.salt);
    try {
      const result = await deps.ipThrottle.tryRegister(ipHash, now);
      if (!result.allowed) {
        return json({ error: 'too_many_accounts', details: '该网络注册账号过于频繁，请稍后再试' }, 429);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[createHandle] throttle check failed', message);
      return json({ error: 'internal_error', details: message }, 500);
    }
  }

  // 4. Persist the new profile.
  const profile: PlayerProfile = {
    handle,
    createdAt: now,
    banned: false,
  };
  try {
    await deps.profileStore.put(profile);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[createHandle] profile persist failed', message);
    return json({ error: 'internal_error', details: message }, 500);
  }

  const responseBody: CreateHandleResponseBody = { ok: true, handle };
  return json(responseBody, 201);
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
