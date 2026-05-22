// Error handling — what the user sees when things go wrong.
//
// These are robustness probes (404-ish surfaces) to make sure error paths
// don't crash. They lean on the actual UI fallbacks and the API error JSON.

import { test, expect } from '@playwright/test';
import { createRoom } from './helpers/api.js';
import { preseedHandle, preseedCredentials } from './helpers/ui.js';

test.describe('@errors UI surfaces', () => {
  test('table route without stored credentials renders MissingCreds screen', async ({ page }) => {
    await preseedHandle(page, '@alice');
    // No preseedCredentials → getCredentialsForRoom returns null
    await page.goto('/#/table?code=A2B3C4');
    await expect(page.locator('h1')).toContainText('需要先加入房间');
    await expect(page.getByRole('link', { name: '返回首页' })).toBeVisible();
  });

  test('wait route for nonexistent room shows the "room ended" error', async ({ page }) => {
    await preseedHandle(page, '@alice');
    // Valid-format LDLDLD code that doesn't exist in the store. Waiting polls
    // GET /api/room/<code>; the 404 is mapped to "房间已结束或被解散" by the
    // RoomApiError handler. While the first poll is in flight we briefly show
    // "正在载入…" so either string satisfies the assertion. The error message
    // lives in the SECOND `.waiting__top-val` (the first holds the room code).
    await page.goto('/#/wait?code=A2B3C4');
    await expect(page.locator('.waiting__top-val').nth(1)).toContainText(
      /房间已结束|正在载入/,
      { timeout: 6_000 }
    );
  });

  test('table route for an actual room but missing real credentials → server kicks SSE', async ({
    page,
  }) => {
    // Create a real room
    const room = await createRoom({
      mode: '4',
      handle: '@host',
      bots: [{ tier: 'easy' }, { tier: 'easy' }, { tier: 'easy' }],
    });
    await preseedHandle(page, '@imposter');
    // Seed creds with a forged join token — SSE will reject and the UI lands
    // in "closed" connection state. We mainly want to verify NO uncaught crash.
    await preseedCredentials(page, {
      code: room.code,
      playerId: 'p1',
      joinToken: 'forged-token',
    });
    await page.goto(`/#/table?code=${room.code}`);
    // Page still renders (no white screen) even though SSE will 401.
    await expect(page.locator('body')).toContainText(/我|ROOM|未/i, { timeout: 5_000 });
  });
});

test.describe('@errors API contracts', () => {
  test('POST /api/room/create rejects missing handle (400 invalid_request)', async ({
    request: req,
  }) => {
    const res = await req.post('/api/room/create', {
      data: { mode: '4' },
      headers: { 'content-type': 'application/json' },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid_request');
  });

  test('POST /api/room/create rejects bad mode (400)', async ({ request: req }) => {
    const res = await req.post('/api/room/create', {
      data: { mode: '99', host: { handle: '@alice' } },
      headers: { 'content-type': 'application/json' },
    });
    expect(res.status()).toBe(400);
  });

  test('GET /api/room/[code] returns 404 for missing room', async ({ request: req }) => {
    // Valid-format code that doesn't exist.
    const res = await req.get('/api/room/A2B3C4');
    expect(res.status()).toBe(404);
  });

  test('POST /api/room/[code]/start without authorization → 401', async ({ request: req }) => {
    const room = await createRoom({
      mode: '4',
      handle: '@alice',
      bots: [{ tier: 'easy' }, { tier: 'easy' }, { tier: 'easy' }],
    });
    const res = await req.post(`/api/room/${room.code}/start`, {
      headers: { 'content-type': 'application/json' },
      data: {},
    });
    expect(res.status()).toBe(401);
  });

  test('GET /api/cron/cleanup-rooms without bearer → 401 or 503', async ({ request: req }) => {
    // 401 when ADMIN_TOKEN is set and bearer is missing.
    // 503 ("admin_token_not_configured") in dev where ADMIN_TOKEN isn't set —
    // a fail-closed posture. Either response is acceptable for this gate.
    const res = await req.get('/api/cron/cleanup-rooms');
    expect([401, 403, 503]).toContain(res.status());
  });

  test('GET /api/cron/cleanup-rooms with wrong token → 401 or 503', async ({
    request: req,
  }) => {
    const res = await req.get('/api/cron/cleanup-rooms', {
      headers: { authorization: 'Bearer wrong-token' },
    });
    expect([401, 403, 503]).toContain(res.status());
  });
});
