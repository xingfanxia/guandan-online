// Behavior tests for the admin endpoints: reports / ban / reset-stats.
// Auth matrix (503 unset / 401 bad / 200 good) + mutation behavior.

import { describe, expect, it } from 'vitest';
import { handleAdminReports, type AdminReportsResponseBody } from '@lib/api/adminReports';
import { handleAdminBan, type AdminBanResponseBody } from '@lib/api/adminBan';
import { handleAdminResetStats, type AdminResetStatsResponseBody } from '@lib/api/adminResetStats';
import { createMemoryReportStore } from '@lib/security/reports';
import { createMemoryProfileStore } from '@lib/storage/profileStore';

const TOKEN = 'admin-secret-xyz';

function req(opts: {
  method?: string;
  bearer?: string;
  body?: unknown;
  url?: string;
}): Request {
  const headers: Record<string, string> = {};
  if (opts.bearer) headers['authorization'] = `Bearer ${opts.bearer}`;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  return new Request(opts.url ?? 'http://test/', {
    method: opts.method ?? 'GET',
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
}

// ─── Auth matrix (shared across all three endpoints) ──────────────────────────

describe('admin endpoints — auth matrix', () => {
  it('GET /admin/reports: 503 when token unset, 401 bad, 200 good', async () => {
    const store = createMemoryReportStore();
    expect((await handleAdminReports(req({ bearer: 'x' }), { reportStore: store })).status).toBe(503);
    expect(
      (await handleAdminReports(req({ bearer: 'wrong' }), { reportStore: store, adminToken: TOKEN })).status
    ).toBe(401);
    expect(
      (await handleAdminReports(req({}), { reportStore: store, adminToken: TOKEN })).status
    ).toBe(401); // missing bearer
    expect(
      (await handleAdminReports(req({ bearer: TOKEN }), { reportStore: store, adminToken: TOKEN })).status
    ).toBe(200);
  });

  it('POST /admin/ban: 503 / 401 / 200', async () => {
    const store = createMemoryProfileStore();
    const body = { handle: '@x', banned: true };
    expect((await handleAdminBan(req({ method: 'POST', bearer: 'x', body }), { profileStore: store })).status).toBe(503);
    expect(
      (await handleAdminBan(req({ method: 'POST', bearer: 'wrong', body }), { profileStore: store, adminToken: TOKEN })).status
    ).toBe(401);
    expect(
      (await handleAdminBan(req({ method: 'POST', bearer: TOKEN, body }), { profileStore: store, adminToken: TOKEN })).status
    ).toBe(200);
  });

  it('POST /admin/reset-stats: 503 / 401', async () => {
    const store = createMemoryProfileStore();
    const body = { handle: '@x' };
    expect((await handleAdminResetStats(req({ method: 'POST', bearer: 'x', body }), { profileStore: store })).status).toBe(503);
    expect(
      (await handleAdminResetStats(req({ method: 'POST', bearer: 'wrong', body }), { profileStore: store, adminToken: TOKEN })).status
    ).toBe(401);
  });

  it('rejects wrong HTTP methods', async () => {
    const reportStore = createMemoryReportStore();
    const profileStore = createMemoryProfileStore();
    expect((await handleAdminReports(req({ method: 'POST', bearer: TOKEN }), { reportStore, adminToken: TOKEN })).status).toBe(405);
    expect((await handleAdminBan(req({ method: 'GET', bearer: TOKEN }), { profileStore, adminToken: TOKEN })).status).toBe(405);
    expect((await handleAdminResetStats(req({ method: 'GET', bearer: TOKEN }), { profileStore, adminToken: TOKEN })).status).toBe(405);
  });
});

// ─── /admin/reports behavior ──────────────────────────────────────────────────

describe('handleAdminReports — data', () => {
  it('returns recent reports newest-first', async () => {
    const store = createMemoryReportStore();
    await store.record({ reporterHandle: '@a', targetHandle: '@b', gameId: 'G1', reason: 'afk', createdAt: 100 });
    await store.record({ reporterHandle: '@a', targetHandle: '@c', gameId: 'G2', reason: 'abuse', createdAt: 200 });
    const res = await handleAdminReports(req({ bearer: TOKEN }), { reportStore: store, adminToken: TOKEN });
    const body = (await res.json()) as AdminReportsResponseBody;
    expect(body.reports).toHaveLength(2);
    expect(body.reports[0]!.gameId).toBe('G2');
  });

  it('honors the limit query param', async () => {
    const store = createMemoryReportStore();
    for (let i = 0; i < 5; i++) {
      await store.record({ reporterHandle: '@a', targetHandle: `@t${i}`, gameId: 'G', reason: 'other', createdAt: i });
    }
    const res = await handleAdminReports(
      req({ bearer: TOKEN, url: 'http://test/api/admin/reports?limit=2' }),
      { reportStore: store, adminToken: TOKEN }
    );
    const body = (await res.json()) as AdminReportsResponseBody;
    expect(body.reports).toHaveLength(2);
  });
});

// ─── /admin/ban behavior ──────────────────────────────────────────────────────

describe('handleAdminBan — toggle', () => {
  it('bans a handle so isBanned reads true', async () => {
    const store = createMemoryProfileStore();
    const res = await handleAdminBan(
      req({ method: 'POST', bearer: TOKEN, body: { handle: '@cheater', banned: true } }),
      { profileStore: store, adminToken: TOKEN }
    );
    const body = (await res.json()) as AdminBanResponseBody;
    expect(body).toEqual({ ok: true, handle: '@cheater', banned: true });
    expect(await store.isBanned('@cheater')).toBe(true);
  });

  it('unbans a previously-banned handle', async () => {
    const store = createMemoryProfileStore();
    await store.setBanned('@x', true);
    await handleAdminBan(
      req({ method: 'POST', bearer: TOKEN, body: { handle: '@x', banned: false } }),
      { profileStore: store, adminToken: TOKEN }
    );
    expect(await store.isBanned('@x')).toBe(false);
  });

  it('rejects a non-boolean banned field', async () => {
    const store = createMemoryProfileStore();
    const res = await handleAdminBan(
      req({ method: 'POST', bearer: TOKEN, body: { handle: '@x', banned: 'yes' } }),
      { profileStore: store, adminToken: TOKEN }
    );
    expect(res.status).toBe(400);
  });
});

// ─── /admin/reset-stats behavior ──────────────────────────────────────────────

describe('handleAdminResetStats', () => {
  it('zeroes gamesPlayed and returns 200', async () => {
    const store = createMemoryProfileStore();
    await store.put({ handle: '@grinder', createdAt: 1, banned: false, gamesPlayed: 99 });
    const res = await handleAdminResetStats(
      req({ method: 'POST', bearer: TOKEN, body: { handle: '@grinder' } }),
      { profileStore: store, adminToken: TOKEN }
    );
    const body = (await res.json()) as AdminResetStatsResponseBody;
    expect(body).toEqual({ ok: true, handle: '@grinder', gamesPlayed: 0 });
    expect((await store.get('@grinder'))!.gamesPlayed).toBe(0);
  });

  it('returns 404 when the handle has no profile', async () => {
    const store = createMemoryProfileStore();
    const res = await handleAdminResetStats(
      req({ method: 'POST', bearer: TOKEN, body: { handle: '@ghost' } }),
      { profileStore: store, adminToken: TOKEN }
    );
    expect(res.status).toBe(404);
  });
});
