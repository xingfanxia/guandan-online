import { describe, expect, it } from 'vitest';
import {
  generateOwnershipToken,
  hashToken,
  validateOwnershipToken,
  extractBearerToken,
} from '@lib/auth/ownershipToken';

describe('generateOwnershipToken', () => {
  it('returns a 64-char lowercase hex string', () => {
    const token = generateOwnershipToken();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });

  it('returns a fresh value on every call', () => {
    const a = generateOwnershipToken();
    const b = generateOwnershipToken();
    expect(a).not.toBe(b);
  });
});

describe('hashToken', () => {
  it('produces 64-char lowercase hex (SHA-256)', async () => {
    const hash = await hashToken('hello-world');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic for the same input', async () => {
    const a = await hashToken('same-input');
    const b = await hashToken('same-input');
    expect(a).toBe(b);
  });

  it('produces different hashes for different inputs', async () => {
    const a = await hashToken('input-1');
    const b = await hashToken('input-2');
    expect(a).not.toBe(b);
  });

  it('matches a known SHA-256 vector', async () => {
    // sha256("hello") = 2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824
    const hash = await hashToken('hello');
    expect(hash).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
  });
});

describe('validateOwnershipToken', () => {
  it('returns true when provided token hashes to storedHash', async () => {
    const token = generateOwnershipToken();
    const storedHash = await hashToken(token);
    await expect(validateOwnershipToken(token, storedHash)).resolves.toBe(true);
  });

  it('returns false when token does not match', async () => {
    const storedHash = await hashToken('correct-token');
    await expect(validateOwnershipToken('wrong-token', storedHash)).resolves.toBe(false);
  });

  it('returns false when provided is null / undefined / non-string', async () => {
    const storedHash = await hashToken('anything');
    // @ts-expect-error — runtime defense; type system normally prevents this
    await expect(validateOwnershipToken(null, storedHash)).resolves.toBe(false);
    // @ts-expect-error — runtime defense
    await expect(validateOwnershipToken(undefined, storedHash)).resolves.toBe(false);
    // @ts-expect-error — runtime defense
    await expect(validateOwnershipToken(123, storedHash)).resolves.toBe(false);
  });

  it('returns false when storedHash is null / undefined / non-string', async () => {
    // @ts-expect-error — runtime defense
    await expect(validateOwnershipToken('token', null)).resolves.toBe(false);
    // @ts-expect-error — runtime defense
    await expect(validateOwnershipToken('token', undefined)).resolves.toBe(false);
  });

  it('returns false when storedHash is not 64 chars (corrupted / wrong format)', async () => {
    // 64-char SHA-256 hex is the contract. Anything else is corruption or
    // a schema change that hasn't been migrated. Reject explicitly so a
    // length-equality short-circuit can't become a 1-bit oracle.
    await expect(validateOwnershipToken('token', 'short')).resolves.toBe(false);
    await expect(validateOwnershipToken('token', 'a'.repeat(63))).resolves.toBe(false);
    await expect(validateOwnershipToken('token', 'a'.repeat(65))).resolves.toBe(false);
  });

  it('returns false when provided is empty string', async () => {
    const storedHash = await hashToken('anything');
    await expect(validateOwnershipToken('', storedHash)).resolves.toBe(false);
  });
});

describe('extractBearerToken', () => {
  it('parses standard Authorization: Bearer <token>', () => {
    const req = new Request('https://example.com/', {
      headers: { Authorization: 'Bearer abc123' },
    });
    expect(extractBearerToken(req)).toBe('abc123');
  });

  it('is case-insensitive on the scheme name', () => {
    const req = new Request('https://example.com/', {
      headers: { Authorization: 'bearer abc123' },
    });
    expect(extractBearerToken(req)).toBe('abc123');
  });

  it('accepts lowercase authorization header (fetch headers are case-insensitive)', () => {
    const req = new Request('https://example.com/', {
      headers: { authorization: 'Bearer xyz789' },
    });
    expect(extractBearerToken(req)).toBe('xyz789');
  });

  it('returns null when header is absent', () => {
    const req = new Request('https://example.com/');
    expect(extractBearerToken(req)).toBeNull();
  });

  it('returns null when scheme is not Bearer', () => {
    const req = new Request('https://example.com/', {
      headers: { Authorization: 'Basic dXNlcjpwYXNz' },
    });
    expect(extractBearerToken(req)).toBeNull();
  });

  it('trims surrounding whitespace from the token', () => {
    const req = new Request('https://example.com/', {
      headers: { Authorization: '  Bearer  spaced-token  ' },
    });
    expect(extractBearerToken(req)).toBe('spaced-token');
  });
});
