// IP hashing + extraction for SEC-2 (account-creation throttle + same-room
// IP-collision warning).
//
// Privacy posture: we NEVER persist or return a raw client IP. The only thing
// that leaves this module is a salted, irreversible digest. The hash is used
// as an opaque bucket key for the per-IP throttle and as a grouping key for
// the same-room collision signal — neither of those needs the original IP,
// only "are these two requests from the same source".
//
// Why a non-crypto hash (FNV-1a) rather than SHA-256: hashIp must be SYNC (it
// runs inline in the create-handle handler and in the join path), and Web
// Crypto's subtle.digest is async-only. FNV-1a with a server-side secret salt
// gives us a stable, well-distributed, dependency-free digest. This is not a
// password hash — it defends against casual correlation, not a motivated
// attacker with the salt. The salt being server-side (IP_HASH_SALT env var)
// means the output is not reversible by anyone who only sees stored hashes.

/**
 * Salted FNV-1a (32-bit) digest of an IP string, returned as 8 lowercase hex
 * chars. Deterministic: the same `(ip, salt)` always yields the same hash;
 * changing the salt changes every output. The raw `ip` is never stored or
 * returned — only this digest.
 */
export function hashIp(ip: string, salt: string): string {
  // FNV-1a 32-bit. Offset basis 0x811c9dc5, prime 0x01000193. We mix the salt
  // in front of the IP so a per-deployment secret salt fully reshuffles the
  // keyspace (a fixed salt → a fixed but private mapping).
  const input = `${salt}:${ip}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    // hash *= 16777619, kept in 32-bit unsigned range via Math.imul + >>> 0.
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/**
 * Pull the client IP from a Request. Prefers `x-forwarded-for` (Vercel's edge
 * sets this; the leftmost comma-split entry is the original client), falling
 * back to `x-real-ip`. Returns null when neither header is present — callers
 * decide how to treat an un-identifiable request (the throttle skips it; the
 * member is stamped with no ipHash).
 *
 * The returned value is the raw IP and MUST be passed straight to hashIp — it
 * is never persisted on its own.
 */
export function extractClientIp(request: Request): string | null {
  const xff = request.headers.get('x-forwarded-for');
  if (xff) {
    const first = xff.split(',')[0]?.trim();
    if (first) return first;
  }
  const real = request.headers.get('x-real-ip')?.trim();
  if (real) return real;
  return null;
}
