// Identity = the @handle the user types once and reuses across rooms.
//
// Persisted in localStorage under `guandan.handle`. Per AUTH plan the handle
// is the only client-side identity; rooms mint per-membership joinTokens on
// top of it. Tokens for active memberships live under `guandan.tokens`.
//
// In SSR/no-window contexts (smoke tests), the persist layer no-ops so callers
// can still call getHandle() / setHandle() without crashing.

const HANDLE_KEY = 'guandan.handle';
const TOKENS_KEY = 'guandan.tokens';

export interface RoomCredentials {
  /** Room code, e.g. "K7M2P9". */
  readonly code: string;
  /** Player ID assigned by the server ("p0" host, "p1" first joiner, ...). */
  readonly playerId: string;
  /** SSE reconnect token. Plaintext compare against server's stored joinToken. */
  readonly joinToken: string;
  /** Host admin token if we created this room — used for /start, /kick. */
  readonly hostToken?: string;
  /**
   * The user's @handle at the time these credentials were minted. The server
   * assigns the playerId; this carries our display identity so consumers
   * (GameTable4P/GameTableMP) can match `evt.players[].handle === myHandle`
   * during snapshot reduction. Optional for back-compat with older entries
   * persisted before this field existed — readers fall back to getHandle().
   */
  readonly handle?: string;
  /** Wall-clock ms at storage time; lets us age out stale credentials. */
  readonly storedAt: number;
}

/**
 * Maximum age (in ms) before stored credentials are pruned by storeCredentials.
 * 7 days matches the typical SSE rotation + lobby timeout horizon — anything
 * older is almost certainly a dead room.
 */
const MAX_CREDENTIAL_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

export function getHandle(): string | null {
  if (!isBrowser()) return null;
  const raw = window.localStorage.getItem(HANDLE_KEY);
  return raw && raw.length > 0 ? raw : null;
}

export function setHandle(handle: string): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.setItem(HANDLE_KEY, handle);
  } catch (err) {
    console.warn('[identity] failed to persist handle', err);
  }
}

export function clearHandle(): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.removeItem(HANDLE_KEY);
  } catch (err) {
    console.warn('[identity] failed to clear handle', err);
  }
}

/**
 * Normalize a user-typed handle. Adds the leading `@` and trims whitespace.
 * Returns the lowercase form so case-insensitive comparison works downstream.
 * Server `lib/auth/handle.ts` does the same normalization, so we keep them
 * in sync (any leading `@` is collapsed; whitespace removed).
 */
export function normalizeHandle(input: string): string {
  const trimmed = input.trim();
  const stripped = trimmed.startsWith('@') ? trimmed.slice(1) : trimmed;
  return `@${stripped}`;
}

/**
 * Compare two handles ignoring the `@` prefix and case. The CLIENT normalizes
 * to `@lower` (normalizeHandle above) but the SERVER's lib/auth/handle.ts
 * normalizes to bare lowercase (strips `@`), and bot handles arrive with `@`
 * baked in — so raw `===` between a local handle and a wire handle is never
 * safe. Every roster lookup must go through this.
 */
export function handlesEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const canon = (h: string): string => {
    const t = h.trim();
    return (t.startsWith('@') ? t.slice(1) : t).toLowerCase();
  };
  return canon(a) === canon(b);
}

/**
 * Loose client-side handle validation. Server does the canonical check —
 * this exists so the UI can highlight obvious mistakes before the round-trip.
 * Allow letters / digits / underscore / 2-16 chars after the `@`. Reject empty
 * after normalization. CJK chars are allowed via the unicode regex.
 */
export function isHandleValidLocally(handle: string): boolean {
  const normalized = normalizeHandle(handle);
  if (normalized.length < 3) return false; // "@" + at least 2 chars
  const body = normalized.slice(1);
  if (body.length > 16) return false;
  return /^[\p{L}\p{N}_]+$/u.test(body);
}

function readTokens(): RoomCredentials[] {
  if (!isBrowser()) return [];
  const raw = window.localStorage.getItem(TOKENS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((c): c is RoomCredentials =>
      Boolean(
        c &&
          typeof c === 'object' &&
          typeof c.code === 'string' &&
          typeof c.playerId === 'string' &&
          typeof c.joinToken === 'string' &&
          typeof c.storedAt === 'number'
      )
    );
  } catch {
    return [];
  }
}

/**
 * Persist the credential list. Returns true on success, false when the write
 * is skipped (SSR) or fails (e.g., QuotaExceededError when localStorage is
 * full). We never throw — a stale token cache is recoverable; a thrown error
 * from setItem would kill the calling flow (createRoom, joinRoom).
 */
function writeTokens(list: RoomCredentials[]): boolean {
  if (!isBrowser()) return false;
  try {
    window.localStorage.setItem(TOKENS_KEY, JSON.stringify(list));
    return true;
  } catch (err) {
    // Common case: Safari private mode or storage quota exceeded. Log and
    // continue — the in-flight room flow stays functional, we just can't
    // rejoin via the recent-rooms list later.
    console.warn('[identity] failed to persist tokens', err);
    return false;
  }
}

export function getCredentialsForRoom(code: string): RoomCredentials | null {
  return readTokens().find((c) => c.code === code) ?? null;
}

/**
 * Persist credentials for a room. Prunes entries older than 7 days first so
 * the list doesn't grow unbounded across long-running browsers. Returns true
 * when the write succeeded, false on quota / SSR.
 */
export function storeCredentials(creds: RoomCredentials): boolean {
  const cutoff = Date.now() - MAX_CREDENTIAL_AGE_MS;
  const list = readTokens()
    .filter((c) => c.code !== creds.code)
    .filter((c) => c.storedAt >= cutoff);
  list.push(creds);
  return writeTokens(list);
}

export function clearCredentials(code: string): void {
  writeTokens(readTokens().filter((c) => c.code !== code));
}

export function listRecentCredentials(maxAgeMs = 24 * 60 * 60 * 1000): readonly RoomCredentials[] {
  const cutoff = Date.now() - maxAgeMs;
  return readTokens().filter((c) => c.storedAt >= cutoff);
}
