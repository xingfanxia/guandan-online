// Behavior tests for handleReport — POST /api/report.

import { describe, expect, it } from 'vitest';
import { handleReport, type ReportResponseBody } from '@lib/api/report';
import { createMemoryReportStore } from '@lib/security/reports';
import type { RateLimiter } from '@lib/security/rateLimit';

function req(body: unknown, headers: Record<string, string> = {}, method = 'POST'): Request {
  return new Request('http://test/api/report', {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: method === 'POST' ? JSON.stringify(body) : undefined,
  });
}

const validBody = {
  reporterHandle: '@阿祥',
  targetHandle: '@老郭',
  gameId: 'G1',
  reason: 'cheating',
};

describe('handleReport — validation', () => {
  it('rejects non-POST', async () => {
    const res = await handleReport(req(validBody, {}, 'GET'), {
      reportStore: createMemoryReportStore(),
    });
    expect(res.status).toBe(405);
  });

  it('rejects invalid JSON', async () => {
    const bad = new Request('http://test/api/report', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not json',
    });
    const res = await handleReport(bad, { reportStore: createMemoryReportStore() });
    expect(res.status).toBe(400);
  });

  it('rejects a missing reason', async () => {
    const { reason, ...rest } = validBody;
    void reason;
    const res = await handleReport(req(rest), { reportStore: createMemoryReportStore() });
    expect(res.status).toBe(400);
  });

  it('rejects an unknown reason', async () => {
    const res = await handleReport(req({ ...validBody, reason: 'spamming' }), {
      reportStore: createMemoryReportStore(),
    });
    expect(res.status).toBe(400);
  });

  it('rejects self-reports', async () => {
    const res = await handleReport(
      req({ ...validBody, targetHandle: validBody.reporterHandle }),
      { reportStore: createMemoryReportStore() }
    );
    expect(res.status).toBe(400);
  });
});

describe('handleReport — persistence + dedupe', () => {
  it('persists a fresh report (200, deduped:false)', async () => {
    const store = createMemoryReportStore();
    const res = await handleReport(req(validBody), { reportStore: store });
    expect(res.status).toBe(200);
    const body = (await res.json()) as ReportResponseBody;
    expect(body).toEqual({ ok: true, deduped: false });
    expect(await store.has('@阿祥', '@老郭', 'G1')).toBe(true);
  });

  it('a second identical report is deduped (200, deduped:true)', async () => {
    const store = createMemoryReportStore();
    await handleReport(req(validBody), { reportStore: store });
    const res = await handleReport(req(validBody), { reportStore: store });
    const body = (await res.json()) as ReportResponseBody;
    expect(body.deduped).toBe(true);
    expect(await store.listRecent(10)).toHaveLength(1);
  });

  it('stamps createdAt from the injected clock', async () => {
    const store = createMemoryReportStore();
    await handleReport(req(validBody), { reportStore: store, now: () => 123_456 });
    const recent = await store.listRecent(1);
    expect(recent[0]!.createdAt).toBe(123_456);
  });
});

describe('handleReport — rate limiting', () => {
  it('returns 429 when the limiter denies', async () => {
    const denying: RateLimiter = { check: () => ({ allowed: false, retryAfterMs: 5000 }) };
    const res = await handleReport(req(validBody), {
      reportStore: createMemoryReportStore(),
      rateLimiter: denying,
    });
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('5');
  });

  it('passes through when the limiter allows', async () => {
    const allowing: RateLimiter = { check: () => ({ allowed: true }) };
    const res = await handleReport(req(validBody), {
      reportStore: createMemoryReportStore(),
      rateLimiter: allowing,
    });
    expect(res.status).toBe(200);
  });
});
