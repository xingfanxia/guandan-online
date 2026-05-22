// @vitest-environment jsdom
//
// Unit tests for src/lib/identity.ts — focuses on the F-C1 + F-I2 fixes:
// - RoomCredentials now carries an optional `handle` field (round-trip).
// - storeCredentials wraps setItem in try/catch (QuotaExceededError-safe).
// - storeCredentials prunes entries older than 7 days before writing.
// - setHandle / clearHandle also wrap localStorage writes in try/catch.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  getHandle,
  setHandle,
  clearHandle,
  getCredentialsForRoom,
  storeCredentials,
  clearCredentials,
  type RoomCredentials,
} from '@/lib/identity';

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('RoomCredentials handle field — F-C1 round-trip', () => {
  it('persists and re-reads the handle field on credentials', () => {
    const creds: RoomCredentials = {
      code: 'K7M2P9',
      playerId: 'p0',
      joinToken: 'jt',
      handle: '@饭团',
      storedAt: Date.now(),
    };
    storeCredentials(creds);
    const read = getCredentialsForRoom('K7M2P9');
    expect(read).not.toBeNull();
    expect(read?.handle).toBe('@饭团');
    expect(read?.playerId).toBe('p0');
  });

  it('back-compat: reads credentials persisted without a handle field', () => {
    // Simulate a token entry written by an older client.
    const legacy = [
      {
        code: 'OLD001',
        playerId: 'p0',
        joinToken: 'jt0',
        storedAt: Date.now(),
        // no handle field
      },
    ];
    window.localStorage.setItem('guandan.tokens', JSON.stringify(legacy));
    const read = getCredentialsForRoom('OLD001');
    expect(read).not.toBeNull();
    expect(read?.handle).toBeUndefined();
    expect(read?.playerId).toBe('p0');
  });

  it('replaces the existing entry when storing creds for the same code twice', () => {
    storeCredentials({
      code: 'K7M2P9',
      playerId: 'p0',
      joinToken: 'jt-1',
      handle: '@old',
      storedAt: Date.now() - 1000,
    });
    storeCredentials({
      code: 'K7M2P9',
      playerId: 'p0',
      joinToken: 'jt-2',
      handle: '@new',
      storedAt: Date.now(),
    });
    const read = getCredentialsForRoom('K7M2P9');
    expect(read?.handle).toBe('@new');
    expect(read?.joinToken).toBe('jt-2');
  });
});

describe('storeCredentials — F-I2 quota + pruning', () => {
  it('returns false and does not throw when localStorage.setItem throws QuotaExceededError', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    // jsdom's Storage uses a prototype-property setter rather than an own
    // method, so direct prototype patching is the reliable interception
    // path (vi.spyOn on window.localStorage doesn't catch because the
    // method is inherited from Storage.prototype).
    const proto = Object.getPrototypeOf(window.localStorage);
    const original = proto.setItem;
    proto.setItem = function () {
      throw new DOMException('Quota exceeded', 'QuotaExceededError');
    };
    try {
      let result: boolean | undefined;
      expect(() => {
        result = storeCredentials({
          code: 'K7M2P9',
          playerId: 'p0',
          joinToken: 'jt',
          handle: '@me',
          storedAt: Date.now(),
        });
      }).not.toThrow();
      expect(result).toBe(false);
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      proto.setItem = original;
    }
  });

  it('returns true on a successful write', () => {
    const ok = storeCredentials({
      code: 'K7M2P9',
      playerId: 'p0',
      joinToken: 'jt',
      handle: '@me',
      storedAt: Date.now(),
    });
    expect(ok).toBe(true);
  });

  it('prunes entries older than 7 days when storing a new credential', () => {
    const eightDaysAgo = Date.now() - 8 * 24 * 60 * 60 * 1000;
    const sixDaysAgo = Date.now() - 6 * 24 * 60 * 60 * 1000;
    // Seed two stale + one fresh entry.
    window.localStorage.setItem(
      'guandan.tokens',
      JSON.stringify([
        { code: 'STALE1', playerId: 'p0', joinToken: 'jt', storedAt: eightDaysAgo },
        { code: 'FRESH1', playerId: 'p1', joinToken: 'jt', storedAt: sixDaysAgo },
        { code: 'STALE2', playerId: 'p2', joinToken: 'jt', storedAt: eightDaysAgo },
      ])
    );
    storeCredentials({
      code: 'NEW001',
      playerId: 'p0',
      joinToken: 'jt-new',
      handle: '@me',
      storedAt: Date.now(),
    });
    const stored = JSON.parse(window.localStorage.getItem('guandan.tokens') ?? '[]');
    const codes = stored.map((c: { code: string }) => c.code).sort();
    expect(codes).toEqual(['FRESH1', 'NEW001']);
  });
});

describe('setHandle / clearHandle — try/catch hardening', () => {
  it('setHandle returns silently when localStorage throws', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const proto = Object.getPrototypeOf(window.localStorage);
    const original = proto.setItem;
    proto.setItem = function () {
      throw new DOMException('Quota exceeded', 'QuotaExceededError');
    };
    try {
      expect(() => setHandle('@boom')).not.toThrow();
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      proto.setItem = original;
    }
  });

  it('clearHandle returns silently when localStorage throws', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const proto = Object.getPrototypeOf(window.localStorage);
    const original = proto.removeItem;
    proto.removeItem = function () {
      throw new DOMException('Some error', 'InvalidAccessError');
    };
    try {
      expect(() => clearHandle()).not.toThrow();
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      proto.removeItem = original;
    }
  });

  it('getHandle / setHandle happy-path round-trip', () => {
    setHandle('@hello');
    expect(getHandle()).toBe('@hello');
    clearHandle();
    expect(getHandle()).toBeNull();
  });
});

describe('clearCredentials', () => {
  it('removes only the specified code, leaves siblings untouched', () => {
    storeCredentials({
      code: 'AAA111',
      playerId: 'p0',
      joinToken: 'jt0',
      handle: '@me',
      storedAt: Date.now(),
    });
    storeCredentials({
      code: 'BBB222',
      playerId: 'p1',
      joinToken: 'jt1',
      handle: '@me',
      storedAt: Date.now(),
    });
    clearCredentials('AAA111');
    expect(getCredentialsForRoom('AAA111')).toBeNull();
    expect(getCredentialsForRoom('BBB222')).not.toBeNull();
  });
});
