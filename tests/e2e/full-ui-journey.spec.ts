// Full UI journey — driving the entire host flow from Landing without any
// API shortcuts. Verifies that real clicks compose end-to-end into a playable
// game surface.
//
// This is the highest-value e2e check: if it passes, the entire happy path
// (sign-in → create → wait → start → deal → hand renders) is intact.

import { test, expect } from '@playwright/test';

test.describe('@journey full host flow', () => {
  test('sign in, create 4P with 3 easy bots, start, see hand', async ({ page }) => {
    await page.goto('/');

    // ── Sign in ──
    const input = page.locator('input[aria-label="handle"]');
    await input.fill('@alice');
    await page.getByRole('button', { name: '确认' }).click();
    await expect(page.locator('.lobby-nav__me-handle')).toHaveText('@alice');

    // ── Create ──
    await page.getByRole('button', { name: '创建房间' }).click();
    await expect(page).toHaveURL(/#\/create$/);

    // Set 3 bots (seats 2..4 → "AI 入门")
    for (const seat of [1, 2, 3]) {
      const seatGroup = page.getByRole('radiogroup', { name: `座位 ${seat + 1} 难度` });
      await seatGroup.getByRole('button', { name: 'AI 入门' }).click();
    }
    await page.getByRole('button', { name: '建立房间 →' }).click();

    // ── Wait page ──
    await expect(page).toHaveURL(/#\/wait\?code=[A-Z0-9]{6}$/);
    await expect(page.locator('.waiting__title')).toContainText('4/4');
    const startBtn = page.getByRole('button', { name: /开始游戏$/ });
    await expect(startBtn).toBeEnabled();

    // ── Start ──
    await startBtn.click();
    await expect(page).toHaveURL(/#\/table\?code=[A-Z0-9]{6}$/, { timeout: 10_000 });

    // ── Deal ──
    await page.locator('.hand [data-rank]').first().waitFor({ state: 'visible', timeout: 10_000 });
    const cards = page.locator('.hand [data-rank]');
    await expect(cards).toHaveCount(27);
    // HUD shows the handle (not the playerId) — this is the C-1 regression check.
    await expect(page.locator('.my-hand-meta')).toContainText('@alice');
  });
});
