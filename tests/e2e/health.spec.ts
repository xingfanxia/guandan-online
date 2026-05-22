// Sanity tests — verify the dev server topology (Vite + api-middleware) is up.

import { test, expect } from '@playwright/test';
import { health } from './helpers/api.js';

test.describe('@health server topology', () => {
  test('GET /api/health returns ok', async () => {
    const body = await health();
    expect(body).toMatchObject({ ok: true, service: 'guandan-online' });
  });

  test('SPA root renders the brand mark', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.lobby-nav__brand-name')).toHaveText(
      /guandan online/i
    );
  });

  test('SSE endpoint rejects invalid room code format with 400', async ({ request: req }) => {
    // isValidRoomCode rejects anything that's not LDLDLD (3 letters + 3 digits
    // alternating, banning I/O/Z + 0/1).
    const res = await req.get('/api/sse/__nope__', { timeout: 3000 });
    expect(res.status()).toBe(400);
  });

  test('SSE endpoint rejects valid-format but unknown room with 401 (token missing)', async ({
    request: req,
  }) => {
    // Valid LDLDLD code that does not exist in the store — fails the token
    // check before the room lookup, so we get 401 (unauthorized).
    const res = await req.get('/api/sse/A2B3C4', { timeout: 3000 });
    expect(res.status()).toBe(401);
  });
});
