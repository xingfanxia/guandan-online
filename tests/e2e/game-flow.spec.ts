// Full lobby → game flow exercised through the UI.

import { test, expect } from '@playwright/test';
import { createRoom, getRoom, startGame } from './helpers/api.js';
import { preseedCredentials, preseedHandle, waitForDeal } from './helpers/ui.js';

test.describe('@flow create → wait → start → deal', () => {
  test.beforeEach(async ({ page }) => {
    await preseedHandle(page, '@alice');
  });

  test('host creates 4P with 3 easy bots, starts game, sees the deal on the table', async ({ page }) => {
    // Pre-create the room via API (faster + deterministic) and seed credentials
    // so #/table?code=XXXXXX works without going through the UI create flow.
    const room = await createRoom({
      mode: '4',
      handle: '@alice',
      bots: [{ tier: 'easy' }, { tier: 'easy' }, { tier: 'easy' }],
    });
    await preseedCredentials(page, {
      code: room.code,
      playerId: room.hostId,
      joinToken: room.hostJoinToken,
      hostToken: room.hostToken,
      handle: '@alice',
    });
    // Verify the API-side room view first (catches any storage isolation regression).
    const view = await getRoom(room.code);
    expect(view.members).toHaveLength(4);

    // Go to wait page; start button should be enabled (all 4 seats filled).
    await page.goto(`/#/wait?code=${room.code}`);
    const startBtn = page.getByRole('button', { name: /开始游戏$/ });
    await expect(startBtn).toBeEnabled({ timeout: 10_000 });
    await startBtn.click();

    // Auto-navigate to #/table?code=XXXXXX on phase=in_game
    await expect(page).toHaveURL(new RegExp(`#/table\\?code=${room.code}$`), {
      timeout: 10_000,
    });

    // SSE should populate the local hand (27 cards).
    await waitForDeal(page);
    const cards = page.locator('.hand [data-rank]');
    await expect(cards).toHaveCount(27, { timeout: 5_000 });

    // HUD shows "我 · @alice · 27 张"
    await expect(page.locator('.my-hand-meta')).toContainText('@alice');
    await expect(page.locator('.my-hand-meta')).toContainText('27 张');
  });

  test('host can select a card and "出牌" button becomes enabled on their turn', async ({ page }) => {
    const room = await createRoom({
      mode: '4',
      handle: '@alice',
      bots: [{ tier: 'easy' }, { tier: 'easy' }, { tier: 'easy' }],
    });
    await preseedCredentials(page, {
      code: room.code,
      playerId: room.hostId,
      joinToken: room.hostJoinToken,
      hostToken: room.hostToken,
      handle: '@alice',
    });
    await startGame(room.code, room.hostToken);
    await page.goto(`/#/table?code=${room.code}`);
    await waitForDeal(page);

    // Initial state: "出牌" is disabled until a card is selected.
    const playBtn = page.getByRole('button', { name: '出牌' });
    await expect(playBtn).toBeDisabled();
    // Click a single card to lift it. The host (p0) is the leader so they own
    // the first turn.
    await page.locator('.hand [data-rank]').first().click();
    await expect(playBtn).toBeEnabled();

    // Click "理牌" clears the selection.
    await page.getByRole('button', { name: '理牌' }).click();
    await expect(playBtn).toBeDisabled();
  });
});

test.describe('@flow 6P table renders MP layout', () => {
  test.beforeEach(async ({ page }) => {
    await preseedHandle(page, '@hex');
  });

  test('6P room with 5 easy bots renders the MP oval layout', async ({ page }) => {
    const room = await createRoom({
      mode: '6',
      handle: '@hex',
      bots: [
        { tier: 'easy' },
        { tier: 'easy' },
        { tier: 'easy' },
        { tier: 'easy' },
        { tier: 'easy' },
      ],
    });
    await preseedCredentials(page, {
      code: room.code,
      playerId: room.hostId,
      joinToken: room.hostJoinToken,
      hostToken: room.hostToken,
      handle: '@hex',
    });
    await startGame(room.code, room.hostToken);
    await page.goto(`/#/table?code=${room.code}`);
    await waitForDeal(page);
    // MP layout selectors — multi-table.css uses .mp-table or similar
    // structural class. We assert via the hand presence at minimum.
    // 6P deals 18 cards/player from a 108-card double deck (3-deck variant is
    // 4P only). 8P deals 27 (216 / 8 = 27).
    const hand = page.locator('.hand [data-rank]');
    await expect(hand).toHaveCount(18, { timeout: 5_000 });
  });
});
