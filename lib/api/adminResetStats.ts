// POST /api/admin/reset-stats — pure handler logic.
//
// Admin-token-gated reset of a player's lifetime stats (gamesPlayed → 0).
// Body: { handle }. Auth mirrors cleanupRooms.ts via `authorizeAdmin`. When
// the handle has no profile there's nothing to reset → 404 so the operator
// learns the handle was never seen rather than getting a false success.

import { authorizeAdmin, json } from './adminAuth.js';
import type { PlayerProfile, ProfileStore } from '../storage/profileStore.js';

export interface AdminResetStatsDeps {
  profileStore: ProfileStore;
  adminToken?: string;
}

export interface AdminResetStatsResponseBody {
  ok: true;
  handle: string;
  gamesPlayed: number;
}

export async function handleAdminResetStats(
  req: Request,
  deps: AdminResetStatsDeps
): Promise<Response> {
  if (req.method !== 'POST') {
    return json({ error: 'method_not_allowed' }, 405);
  }
  const auth = authorizeAdmin(req, deps.adminToken);
  if (auth.reject) return auth.reject;

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

  try {
    const profile: PlayerProfile | null = await deps.profileStore.resetStats(
      parsed.value.handle
    );
    if (profile === null) {
      return json({ error: 'not_found', details: 'no profile for handle' }, 404);
    }
    const responseBody: AdminResetStatsResponseBody = {
      ok: true,
      handle: profile.handle,
      gamesPlayed: profile.gamesPlayed ?? 0,
    };
    return json(responseBody, 200);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[admin/reset-stats] failed to reset stats', message);
    return json({ error: 'internal_error', details: message }, 500);
  }
}

function parseBody(
  body: unknown
): { ok: true; value: { handle: string } } | { ok: false; error: string } {
  if (!body || typeof body !== 'object') {
    return { ok: false, error: 'body must be a JSON object' };
  }
  const obj = body as Record<string, unknown>;
  const handle = obj['handle'];
  if (typeof handle !== 'string' || handle.trim().length === 0) {
    return { ok: false, error: 'handle must be a non-empty string' };
  }
  return { ok: true, value: { handle: handle.trim() } };
}
