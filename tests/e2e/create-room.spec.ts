// CreateRoom — exercises the host create flow against the live API middleware.

import { test, expect } from '@playwright/test';
import { preseedHandle } from './helpers/ui.js';

test.describe('@create-room', () => {
  test.beforeEach(async ({ page }) => {
    await preseedHandle(page, '@alice');
  });

  test('default 4P with no AI bots — fails the create (no human seat-2 to wait for in e2e), so set AI fill', async ({
    page,
  }) => {
    await page.goto('/#/create');
    await expect(page.locator('.lobby-nav__title')).toHaveText('创建房间');
    // 4P default selected
    const seg4 = page.getByRole('radio', { name: '4 人模式' });
    await expect(seg4).toHaveAttribute('aria-checked', 'true');
    // Spec preview reads default rules
    await expect(page.locator('.create__summary-list')).toContainText('严格'); // strictA defaults to on
  });

  test('toggle strictA flips spec preview to "宽松"', async ({ page }) => {
    await page.goto('/#/create');
    // First summary row reads "严格"
    await expect(page.locator('.create__summary-list')).toContainText('严格');
    // Find the strictA toggle button by label.
    await page.getByRole('button', { name: 'A 级严格' }).click();
    await expect(page.locator('.create__summary-list')).toContainText('宽松');
  });

  test('4P + 3 easy bots creates room → navigates to wait → wait page shows 4/4 ready', async ({
    page,
  }) => {
    await page.goto('/#/create');
    // Pick 4P (default). Seats 2..4 = three AI chips. Click "AI 入门" for each.
    for (const seat of [1, 2, 3]) {
      const seatGroup = page.getByRole('radiogroup', { name: `座位 ${seat + 1} 难度` });
      await seatGroup.getByRole('button', { name: 'AI 入门' }).click();
    }
    await page.getByRole('button', { name: '建立房间 →' }).click();
    // Should land on #/wait?code=XXXXXX
    await expect(page).toHaveURL(/#\/wait\?code=[A-Z0-9]{6}$/);
    // Wait page renders the 4/4 ready chip + "开始游戏" enabled.
    await expect(page.locator('.waiting__title')).toContainText('4/4');
    // Host CTA shows "开始游戏" once allReady.
    const start = page.getByRole('button', { name: /开始游戏$/ });
    await expect(start).toBeEnabled();
  });

  test('rejects bot count exceeding seat capacity', async ({ page }) => {
    // Can't test the host UI exceeding capacity (UI clamps) — go through the
    // direct API instead to ensure server rejects.
    const res = await page.request.post('/api/room/create', {
      headers: { 'content-type': 'application/json' },
      data: {
        mode: '4',
        host: { handle: '@alice' },
        bots: [
          { tier: 'easy' },
          { tier: 'easy' },
          { tier: 'easy' },
          { tier: 'easy' }, // 1 host + 4 bots > 4 seats
        ],
      },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid_request');
    expect(body.details).toContain('seats');
  });
});
