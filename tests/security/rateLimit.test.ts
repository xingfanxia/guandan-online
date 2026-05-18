import { describe, expect, it } from 'vitest';
import { createSlidingWindowLimiter } from '@lib/security/rateLimit';

describe('createSlidingWindowLimiter — basic allow / deny', () => {
  it('allows requests up to max within the window', () => {
    const lim = createSlidingWindowLimiter({ windowMs: 1000, max: 3 });
    expect(lim.check('k', 0).allowed).toBe(true);
    expect(lim.check('k', 100).allowed).toBe(true);
    expect(lim.check('k', 200).allowed).toBe(true);
  });

  it('denies the (max + 1)th request within the window', () => {
    const lim = createSlidingWindowLimiter({ windowMs: 1000, max: 3 });
    lim.check('k', 0);
    lim.check('k', 100);
    lim.check('k', 200);
    const r = lim.check('k', 300);
    expect(r.allowed).toBe(false);
    expect(r.retryAfterMs).toBeGreaterThan(0);
  });

  it('rolling window: after windowMs passes, earlier requests don\'t count', () => {
    const lim = createSlidingWindowLimiter({ windowMs: 1000, max: 2 });
    lim.check('k', 0);
    lim.check('k', 500);
    expect(lim.check('k', 999).allowed).toBe(false); // 3rd within window
    // Wait past the window of the FIRST request
    expect(lim.check('k', 1001).allowed).toBe(true);
  });
});

describe('createSlidingWindowLimiter — key isolation', () => {
  it('different keys have independent quotas', () => {
    const lim = createSlidingWindowLimiter({ windowMs: 1000, max: 1 });
    expect(lim.check('a', 0).allowed).toBe(true);
    expect(lim.check('b', 0).allowed).toBe(true); // different key
    expect(lim.check('a', 100).allowed).toBe(false); // a's quota used
    expect(lim.check('b', 100).allowed).toBe(false); // b's quota used
  });
});

describe('createSlidingWindowLimiter — retryAfterMs accuracy', () => {
  it('retryAfterMs equals the time until the oldest request in window expires', () => {
    const lim = createSlidingWindowLimiter({ windowMs: 1000, max: 1 });
    lim.check('k', 100); // first request at 100ms
    const r = lim.check('k', 200); // denied; oldest at 100 expires at 1100 → retry in 900
    expect(r.allowed).toBe(false);
    expect(r.retryAfterMs).toBe(900);
  });
});

describe('createSlidingWindowLimiter — input validation', () => {
  it('throws if max < 1', () => {
    expect(() => createSlidingWindowLimiter({ windowMs: 1000, max: 0 })).toThrow(
      /max/i
    );
  });

  it('throws if windowMs <= 0', () => {
    expect(() => createSlidingWindowLimiter({ windowMs: 0, max: 1 })).toThrow(
      /window/i
    );
  });
});
