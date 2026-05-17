// Player @handle normalization + validation.
//
// SYNC: Mirrors sibling scorer's validateHandle at
// ~/projects/side-projects/guandan-scorer/api/players/_utils.js:23-36.
// Option B (shared namespace) means the same handle must validate the same
// way in both apps. Drift here causes accounts that work in one app but not
// the other.
//
// Constraint: ASCII-only (alphanumeric + underscore, 3-20 chars). The demos
// show Chinese display names like @阿祥, but those are displayName fields;
// the handle (identifier) is ASCII. See lib/auth/README.md for the open
// question on expanding both apps to Unicode handles.

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Canonicalize a user-supplied handle: trim, strip leading @, lowercase.
 * Returns '' for non-strings or for inputs that reduce to nothing (bare '@').
 */
export function normalizeHandle(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  const stripped = trimmed.startsWith('@') ? trimmed.slice(1) : trimmed;
  return stripped.toLowerCase();
}

const HANDLE_REGEX = /^[a-zA-Z0-9_]+$/;
const MIN_LEN = 3;
const MAX_LEN = 20;

/**
 * Validate a handle's format. Caller should normalize first if the input
 * came from user typing (validateHandle does NOT strip @, so '@fufu' fails).
 */
export function validateHandle(handle: unknown): ValidationResult {
  if (!handle || typeof handle !== 'string') {
    return { valid: false, error: 'Handle is required' };
  }
  if (handle.length < MIN_LEN) {
    return { valid: false, error: `Handle must be at least ${MIN_LEN} characters` };
  }
  if (handle.length > MAX_LEN) {
    return { valid: false, error: `Handle must be at most ${MAX_LEN} characters` };
  }
  if (!HANDLE_REGEX.test(handle)) {
    return {
      valid: false,
      error: 'Handle must be alphanumeric + underscore only (no @, spaces, dashes, dots, or non-ASCII)',
    };
  }
  return { valid: true };
}

/** Convenience boolean — same check as validateHandle without the reason. */
export function isValidHandle(handle: unknown): boolean {
  return validateHandle(handle).valid;
}
