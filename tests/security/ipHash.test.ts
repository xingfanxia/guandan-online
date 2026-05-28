// Behavior tests for hashIp + extractClientIp (SEC-2).

import { describe, expect, it } from 'vitest';
import { hashIp, extractClientIp } from '@lib/security/ipHash';

describe('hashIp', () => {
  it('is deterministic — same ip + salt yields the same hash', () => {
    expect(hashIp('203.0.113.7', 'salt-a')).toBe(hashIp('203.0.113.7', 'salt-a'));
  });

  it('is salted — different salt changes the hash for the same ip', () => {
    expect(hashIp('203.0.113.7', 'salt-a')).not.toBe(hashIp('203.0.113.7', 'salt-b'));
  });

  it('distinguishes different ips under the same salt', () => {
    expect(hashIp('203.0.113.7', 'salt-a')).not.toBe(hashIp('203.0.113.8', 'salt-a'));
  });

  it('never returns the raw ip', () => {
    const ip = '198.51.100.42';
    const hash = hashIp(ip, 'secret');
    expect(hash).not.toContain(ip);
    expect(hash).not.toContain('198');
  });

  it('returns 8 lowercase hex chars', () => {
    const hash = hashIp('10.0.0.1', 'secret');
    expect(hash).toMatch(/^[0-9a-f]{8}$/);
  });

  it('handles IPv6 addresses', () => {
    const h1 = hashIp('2001:db8::1', 'secret');
    const h2 = hashIp('2001:db8::2', 'secret');
    expect(h1).toMatch(/^[0-9a-f]{8}$/);
    expect(h1).not.toBe(h2);
  });

  it('produces well-distributed hashes across many ips (no trivial collisions)', () => {
    const hashes = new Set<string>();
    for (let i = 0; i < 200; i++) {
      hashes.add(hashIp(`192.168.1.${i}`, 'salt'));
    }
    // FNV-1a over distinct inputs should give 200 distinct 32-bit digests.
    expect(hashes.size).toBe(200);
  });
});

describe('extractClientIp', () => {
  function reqWith(headers: Record<string, string>): Request {
    return new Request('http://test/api/auth/createHandle', {
      method: 'POST',
      headers,
    });
  }

  it('reads the first entry of x-forwarded-for', () => {
    const req = reqWith({ 'x-forwarded-for': '203.0.113.7, 70.41.3.18, 150.172.238.178' });
    expect(extractClientIp(req)).toBe('203.0.113.7');
  });

  it('trims whitespace around the forwarded ip', () => {
    const req = reqWith({ 'x-forwarded-for': '  203.0.113.7  , 70.41.3.18' });
    expect(extractClientIp(req)).toBe('203.0.113.7');
  });

  it('falls back to x-real-ip when x-forwarded-for is absent', () => {
    const req = reqWith({ 'x-real-ip': '198.51.100.5' });
    expect(extractClientIp(req)).toBe('198.51.100.5');
  });

  it('prefers x-forwarded-for over x-real-ip', () => {
    const req = reqWith({
      'x-forwarded-for': '203.0.113.7',
      'x-real-ip': '198.51.100.5',
    });
    expect(extractClientIp(req)).toBe('203.0.113.7');
  });

  it('returns null when neither header is present', () => {
    const req = reqWith({});
    expect(extractClientIp(req)).toBeNull();
  });

  it('returns null when x-forwarded-for is empty / whitespace-only', () => {
    const req = reqWith({ 'x-forwarded-for': '   ' });
    expect(extractClientIp(req)).toBeNull();
  });
});
