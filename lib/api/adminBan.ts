// POST /api/admin/ban — pure handler logic.
//
// Admin-token-gated toggle of a player's ban flag. Body: { handle, banned }.
// Auth mirrors cleanupRooms.ts via `authorizeAdmin` (503 fail-closed / 401 /
// 200). The mutated flag is readable via `profileStore.isBanned(handle)`,
// which the join path consults to refuse banned handles.

import { authorizeAdmin, json } from './adminAuth.js';
import type { PlayerProfile, ProfileStore } from '../storage/profileStore.js';

export interface AdminBanDeps {
  profileStore: ProfileStore;
  adminToken?: string;
}

export interface AdminBanResponseBody {
  ok: true;
  handle: string;
  banned: boolean;
}

export async function handleAdminBan(
  req: Request,
  deps: AdminBanDeps
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
    const profile: PlayerProfile = await deps.profileStore.setBanned(
      parsed.value.handle,
      parsed.value.banned
    );
    const responseBody: AdminBanResponseBody = {
      ok: true,
      handle: profile.handle,
      banned: profile.banned,
    };
    return json(responseBody, 200);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[admin/ban] failed to toggle ban', message);
    return json({ error: 'internal_error', details: message }, 500);
  }
}

function parseBody(
  body: unknown
): { ok: true; value: { handle: string; banned: boolean } } | { ok: false; error: string } {
  if (!body || typeof body !== 'object') {
    return { ok: false, error: 'body must be a JSON object' };
  }
  const obj = body as Record<string, unknown>;
  const handle = obj['handle'];
  const banned = obj['banned'];
  if (typeof handle !== 'string' || handle.trim().length === 0) {
    return { ok: false, error: 'handle must be a non-empty string' };
  }
  if (typeof banned !== 'boolean') {
    return { ok: false, error: 'banned must be a boolean' };
  }
  return { ok: true, value: { handle: handle.trim(), banned } };
}
