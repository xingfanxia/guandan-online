// Behavior tests for handleCreateHandle — pure HTTP handler exercised through
// synthetic Request objects + memory profile store + memory throttle. (SEC-2)

import { describe, expect, it } from 'vitest';
import {
  handleCreateHandle,
  type CreateHandleResponseBody,
} from '@lib/api/createHandle';
import { createMemoryProfileStore } from '@lib/storage/profileStore';
import {
  createMemoryIpThrottle,
  DEFAULT_MAX_ACCOUNTS,
} from '@lib/security/ipThrottle';

const T0 = 1_700_000_000_000;
const SALT = 'test-salt';
const CLIENT_IP = '203.0.113.7';

function req(body: unknown, ip: string | null = CLIENT_IP): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (ip !== null) headers['x-forwarded-for'] = ip;
  return new Request('http://test/api/auth/createHandle', {
    method: 'POST',
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function deps(overrides: Partial<Parameters<typeof handleCreateHandle>[1]> = {}) {
  return {
    ipThrottle: createMemoryIpThrottle(() => T0),
    profileStore: createMemoryProfileStore(() => T0),
    salt: SALT,
    now: () => T0,
    ...overrides,
  };
}

describe('handleCreateHandle — happy path', () => {
  it('returns 201 { ok, handle } and persists a profile', async () => {
    const d = deps();
    const res = await handleCreateHandle(req({ handle: '@FuFu' }), d);
    expect(res.status).toBe(201);
    const body = (await res.json()) as CreateHandleResponseBody;
    expect(body).toEqual({ ok: true, handle: 'fufu' }); // normalized

    const persisted = await d.profileStore.get('fufu');
    expect(persisted).not.toBeNull();
    expect(persisted?.handle).toBe('fufu');
    expect(persisted?.banned).toBe(false);
    expect(persisted?.createdAt).toBe(T0);
  });

  it('normalizes the handle (strips @, lowercases) before persisting', async () => {
    const d = deps();
    await handleCreateHandle(req({ handle: '@MixedCase' }), d);
    expect(await d.profileStore.get('mixedcase')).not.toBeNull();
    expect(await d.profileStore.get('MixedCase')).toBeNull();
  });
});

describe('handleCreateHandle — rejects invalid input', () => {
  it('rejects non-POST methods', async () => {
    const r = new Request('http://test/api/auth/createHandle', { method: 'GET' });
    const res = await handleCreateHandle(r, deps());
    expect(res.status).toBe(405);
  });

  it('rejects invalid JSON', async () => {
    const r = new Request('http://test/api/auth/createHandle', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not-json',
    });
    const res = await handleCreateHandle(r, deps());
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('invalid_json');
  });

  it('rejects a too-short handle with 400 invalid_handle', async () => {
    const res = await handleCreateHandle(req({ handle: '@a' }), deps());
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('invalid_handle');
  });

  it('rejects a non-ASCII handle', async () => {
    const res = await handleCreateHandle(req({ handle: '@阿祥' }), deps());
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('invalid_handle');
  });

  it('rejects a missing handle field', async () => {
    const res = await handleCreateHandle(req({}), deps());
    expect(res.status).toBe(400);
  });

  it('does NOT consume a throttle slot on an invalid handle', async () => {
    const throttle = createMemoryIpThrottle(() => T0);
    const d = deps({ ipThrottle: throttle });
    // 6 invalid attempts — none should count against the per-IP cap.
    for (let i = 0; i < 6; i++) {
      await handleCreateHandle(req({ handle: '@x' }), d);
    }
    // A valid handle from the same IP still succeeds (slot 1).
    const ok = await handleCreateHandle(req({ handle: '@validname' }), d);
    expect(ok.status).toBe(201);
  });
});

describe('handleCreateHandle — already-taken / banned → 409', () => {
  it('returns 409 when the handle already has a profile', async () => {
    const d = deps();
    await d.profileStore.put({ handle: 'taken', createdAt: T0, banned: false });
    const res = await handleCreateHandle(req({ handle: '@taken' }), d);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toBe('handle_taken');
  });

  it('returns 409 when the handle is banned (even without a full profile)', async () => {
    const d = deps();
    await d.profileStore.setBanned('banned_one', true);
    const res = await handleCreateHandle(req({ handle: '@banned_one' }), d);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toBe('handle_taken');
  });

  it('does NOT consume a throttle slot when the handle is taken', async () => {
    const throttle = createMemoryIpThrottle(() => T0, { max: 1 });
    const d = deps({ ipThrottle: throttle });
    await d.profileStore.put({ handle: 'taken', createdAt: T0, banned: false });
    // Hitting a taken handle must not eat the single available slot.
    await handleCreateHandle(req({ handle: '@taken' }), d);
    const fresh = await handleCreateHandle(req({ handle: '@brandnew' }), d);
    expect(fresh.status).toBe(201);
  });
});

describe('handleCreateHandle — per-IP throttle → 429', () => {
  it('allows 5 distinct handles from one IP then 429s the 6th', async () => {
    const d = deps();
    for (let i = 0; i < DEFAULT_MAX_ACCOUNTS; i++) {
      const res = await handleCreateHandle(req({ handle: `@user${i}` }), d);
      expect(res.status).toBe(201);
    }
    const sixth = await handleCreateHandle(req({ handle: '@user5' }), d);
    expect(sixth.status).toBe(429);
    expect(((await sixth.json()) as { error: string }).error).toBe('too_many_accounts');
    // The 6th handle must NOT have been persisted.
    expect(await d.profileStore.get('user5')).toBeNull();
  });

  it('throttles per-IP — a different IP still gets fresh quota', async () => {
    const d = deps();
    for (let i = 0; i < DEFAULT_MAX_ACCOUNTS; i++) {
      const r = await handleCreateHandle(req({ handle: `@alpha${i}` }, '203.0.113.7'), d);
      expect(r.status).toBe(201);
    }
    expect(
      (await handleCreateHandle(req({ handle: '@alpha5' }, '203.0.113.7'), d)).status
    ).toBe(429);
    // Different source IP → allowed.
    const other = await handleCreateHandle(req({ handle: '@bravo0' }, '198.51.100.9'), d);
    expect(other.status).toBe(201);
  });

  it('does not throttle requests with no client IP (un-identifiable)', async () => {
    const d = deps();
    // Many no-IP requests — none should ever 429 (we can't bucket them).
    for (let i = 0; i < DEFAULT_MAX_ACCOUNTS + 3; i++) {
      const res = await handleCreateHandle(req({ handle: `@anon${i}` }, null), d);
      expect(res.status).toBe(201);
    }
  });
});

describe('handleCreateHandle — privacy: raw IP never persisted', () => {
  it('stores no raw IP anywhere in the persisted profile', async () => {
    const d = deps();
    await handleCreateHandle(req({ handle: '@privacy' }, CLIENT_IP), d);
    const persisted = await d.profileStore.get('privacy');
    expect(JSON.stringify(persisted)).not.toContain(CLIENT_IP);
    expect(JSON.stringify(persisted)).not.toContain('203.0.113');
  });

  it('uses the injected extractIp + salt to bucket the throttle', async () => {
    const seen: Array<{ ipHash: string }> = [];
    const recordingThrottle = {
      tryRegister(ipHash: string) {
        seen.push({ ipHash });
        return { allowed: true, count: seen.length };
      },
    };
    const d = deps({
      ipThrottle: recordingThrottle,
      extractIp: () => '10.10.10.10',
    });
    await handleCreateHandle(req({ handle: '@viaextract' }), d);
    // The throttle saw a hash, NOT the raw IP.
    expect(seen).toHaveLength(1);
    expect(seen[0]!.ipHash).not.toBe('10.10.10.10');
    expect(seen[0]!.ipHash).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe('handleCreateHandle — error surfaces are loud', () => {
  it('returns 500 when the profile store throws on lookup', async () => {
    const d = deps({
      profileStore: {
        get: () => {
          throw new Error('redis down');
        },
        put: async () => undefined,
        setBanned: async () => ({ handle: 'x', createdAt: 0, banned: true }),
        isBanned: async () => false,
        resetStats: async () => null,
      },
    });
    const res = await handleCreateHandle(req({ handle: '@boom' }), d);
    expect(res.status).toBe(500);
    expect(((await res.json()) as { error: string }).error).toBe('internal_error');
  });
});
