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
  /** Wall-clock ms at storage time; lets us age out stale credentials. */
  readonly storedAt: number;
}

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
  window.localStorage.setItem(HANDLE_KEY, handle);
}

export function clearHandle(): void {
  if (!isBrowser()) return;
  window.localStorage.removeItem(HANDLE_KEY);
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

function writeTokens(list: RoomCredentials[]): void {
  if (!isBrowser()) return;
  window.localStorage.setItem(TOKENS_KEY, JSON.stringify(list));
}

export function getCredentialsForRoom(code: string): RoomCredentials | null {
  return readTokens().find((c) => c.code === code) ?? null;
}

export function storeCredentials(creds: RoomCredentials): void {
  const list = readTokens().filter((c) => c.code !== creds.code);
  list.push(creds);
  writeTokens(list);
}

export function clearCredentials(code: string): void {
  writeTokens(readTokens().filter((c) => c.code !== code));
}

export function listRecentCredentials(maxAgeMs = 24 * 60 * 60 * 1000): readonly RoomCredentials[] {
  const cutoff = Date.now() - maxAgeMs;
  return readTokens().filter((c) => c.storedAt >= cutoff);
}
