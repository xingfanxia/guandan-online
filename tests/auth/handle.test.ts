import { describe, expect, it } from 'vitest';
import { normalizeHandle, validateHandle, isValidHandle } from '@lib/auth/handle';

describe('normalizeHandle', () => {
  it('strips leading @ symbol', () => {
    expect(normalizeHandle('@fufu')).toBe('fufu');
  });

  it('lowercases', () => {
    expect(normalizeHandle('FuFu')).toBe('fufu');
  });

  it('trims surrounding whitespace', () => {
    expect(normalizeHandle('  alice  ')).toBe('alice');
  });

  it('combines: trim → strip-@ → lowercase', () => {
    expect(normalizeHandle('  @BobSmith  ')).toBe('bobsmith');
  });

  it('returns empty string for null / undefined / non-string', () => {
    expect(normalizeHandle(null)).toBe('');
    expect(normalizeHandle(undefined)).toBe('');
    expect(normalizeHandle(123)).toBe('');
  });

  it('handles a bare @ (returns empty)', () => {
    expect(normalizeHandle('@')).toBe('');
  });
});

describe('validateHandle', () => {
  it('accepts a valid 3-20 char alphanumeric+underscore handle', () => {
    expect(validateHandle('fufu')).toEqual({ valid: true });
    expect(validateHandle('alice_42')).toEqual({ valid: true });
    expect(validateHandle('abc')).toEqual({ valid: true }); // min length
    expect(validateHandle('a'.repeat(20))).toEqual({ valid: true }); // max length
  });

  it('rejects too-short handle', () => {
    const result = validateHandle('ab');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('3');
  });

  it('rejects too-long handle', () => {
    const result = validateHandle('a'.repeat(21));
    expect(result.valid).toBe(false);
    expect(result.error).toContain('20');
  });

  it('rejects empty / null / undefined', () => {
    expect(validateHandle('').valid).toBe(false);
    expect(validateHandle(null).valid).toBe(false);
    expect(validateHandle(undefined).valid).toBe(false);
  });

  it('rejects handles with @ symbol (caller should normalize first)', () => {
    expect(validateHandle('@fufu').valid).toBe(false);
  });

  it('rejects handles with dashes, spaces, dots, or other symbols', () => {
    expect(validateHandle('fu-fu').valid).toBe(false);
    expect(validateHandle('fu fu').valid).toBe(false);
    expect(validateHandle('fu.fu').valid).toBe(false);
    expect(validateHandle('fu!').valid).toBe(false);
  });

  it('rejects non-ASCII characters (current sibling-compat constraint)', () => {
    // Documented constraint: shared namespace with sibling scorer uses ASCII handles.
    // See lib/auth/README.md for the rationale and the open question about
    // whether to expand both apps to Unicode handles.
    expect(validateHandle('阿祥').valid).toBe(false);
    expect(validateHandle('小李').valid).toBe(false);
  });

  it('isValidHandle returns boolean shortcut', () => {
    expect(isValidHandle('fufu')).toBe(true);
    expect(isValidHandle('ab')).toBe(false);
  });
});
