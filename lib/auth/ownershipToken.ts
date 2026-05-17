// Per-user ownership tokens — shared @handle namespace with sibling scorer.
//
// SYNC: This file mirrors ~/projects/side-projects/guandan-scorer/api/players/_utils.js
// lines 247-285 (generateOwnershipToken / hashToken / validateOwnershipToken /
// extractBearerToken). Both apps share Upstash KV under Option B (see
// docs/research/cross-project-integration.md), so the auth semantics MUST stay
// byte-identical. If either side changes, sync both within the same PR.
//
// Issued at handle creation, sent as `Authorization: Bearer <token>` for
// self-edit. Stored hashed (SHA-256 hex) so a KV leak can't be replayed:
// preimage resistance means N stored hashes can't be reversed to usable tokens.
// Per-user tokens fan out across all player records, so blast radius justifies
// hashing (admin token is stored raw — single env-var secret).

/**
 * Generate a fresh 256-bit ownership token, hex-encoded (64 chars).
 *
 * Caller flow:
 *  1. const token = generateOwnershipToken();    // give to user once
 *  2. const hash  = await hashToken(token);       // store hash in KV
 *  3. later: validateOwnershipToken(token, hash); // on self-edit
 */
export function generateOwnershipToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** SHA-256 → 64-char lowercase hex. */
export async function hashToken(token: string): Promise<string> {
  const data = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Constant-time validate of a presented bearer token against a stored hash.
 *
 * Defense-in-depth: SHA-256 hex is always 64 chars. A length mismatch on the
 * stored hash means corruption or a schema change — reject explicitly rather
 * than fall through to constant-time compare on garbage. Without this, a
 * future schema change that stored a non-hashed value would silently turn the
 * length-equality short-circuit into a 1-bit oracle.
 */
export async function validateOwnershipToken(
  provided: string,
  storedHash: string
): Promise<boolean> {
  if (!provided || typeof provided !== 'string') return false;
  if (!storedHash || typeof storedHash !== 'string') return false;
  if (storedHash.length !== 64) return false;

  const providedHash = await hashToken(provided);
  if (providedHash.length !== storedHash.length) return false;

  let mismatch = 0;
  for (let i = 0; i < providedHash.length; i++) {
    mismatch |= providedHash.charCodeAt(i) ^ storedHash.charCodeAt(i);
  }
  return mismatch === 0;
}

/**
 * Pull the bearer token off an Authorization header. Returns null if absent
 * or malformed. Tolerates lowercase scheme + surrounding whitespace.
 */
export function extractBearerToken(request: Request): string | null {
  const auth = request.headers.get('authorization') || request.headers.get('Authorization');
  if (!auth) return null;
  const match = /^Bearer\s+(.+)$/i.exec(auth.trim());
  return match ? match[1]!.trim() : null;
}
