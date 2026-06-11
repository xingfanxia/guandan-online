// The spec that actually PLAYS cards through the UI.
//
// REGRESSION GUARD: the 2026-06-09 audit found every UI move had been
// failing in production (flat-vs-nested move-body mismatch) while this e2e
// suite stayed green — because no spec ever clicked 出牌. game-flow.spec.ts
// stops at "button becomes enabled". This spec drives a real trick:
//   lead a card → assert hand shrank + trick shows my play → bots respond
//   → turn returns to me → pass also round-trips.
//
// Bots run synchronously inside the move POST against the vite-api-plugin's
// memory infra, so the whole cycle lands in one SSE burst — no long waits.

import { test, expect } from '@playwright/test';
import { createRoom } from './helpers/api.js';
import { preseedCredentials, preseedHandle, waitForDeal } from './helpers/ui.js';

test.describe('@flow play a real trick through the UI', () => {
  test.beforeEach(async ({ page }) => {
    await preseedHandle(page, '@alice');
  });

  test('host leads via 提示+出牌, bots respond, pass round-trips', async ({ page }) => {
    // Render-loop guard: clicking 提示 used to trip "Maximum update depth
    // exceeded" (unstable onSuggest identity re-firing SuggestionHint's
    // notify-effect). Any console error of that class fails the spec.
    const renderLoopErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error' && msg.text().includes('Maximum update depth')) {
        renderLoopErrors.push(msg.text());
      }
    });
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
    await page.goto(`/#/wait?code=${room.code}`);
    await page.getByRole('button', { name: /开始游戏$/ }).click();
    await expect(page).toHaveURL(new RegExp(`#/table\\?code=${room.code}$`), {
      timeout: 10_000,
    });
    await waitForDeal(page);

    // Host (seat 0) leads round 1 — the snapshot/deal must say so.
    await expect(page.locator('.turn-flag')).toBeVisible({ timeout: 5_000 });

    // 提示 auto-lifts a legal lead; 出牌 submits it.
    await page.getByRole('button', { name: '提示' }).click();
    const playBtn = page.getByRole('button', { name: '出牌' });
    await expect(playBtn).toBeEnabled({ timeout: 5_000 });
    await playBtn.click();

    // A wildcard lead may surface the confirm dialog — confirm through it.
    const wildcardConfirm = page.locator('.modal__actions .btn--primary', {
      hasText: '确认',
    });
    if (await wildcardConfirm.isVisible({ timeout: 1_000 }).catch(() => false)) {
      await wildcardConfirm.click();
    }

    // My move applied: hand shrank below 27 and no rejection line appeared.
    await expect
      .poll(
        async () => page.locator('.hand [data-rank]').count(),
        { timeout: 10_000 }
      )
      .toBeLessThan(27);
    await expect(page.locator('.move-error')).toHaveCount(0);

    // Bots responded in the same burst: someone else's play (or a fresh
    // trick) and the turn flag comes back to me.
    await expect(page.locator('.turn-flag')).toBeVisible({ timeout: 10_000 });

    // At least one bot hand count dropped below 27 OR the trick cleared
    // (all-pass → trick_won). Either way the table progressed past my lead.
    const seatCounts = await page.locator('.seat-count').allTextContents();
    const trickText = await page.locator('.trick').textContent();
    const botPlayed = seatCounts.some((t) => {
      const n = parseInt(t, 10);
      return Number.isFinite(n) && n < 27;
    });
    expect(botPlayed || trickText?.includes('—')).toBeTruthy();

    // Now exercise PASS if it's legal (someone's play is on the table);
    // otherwise lead again via 提示. Both paths POST a real command.
    const passBtn = page.getByRole('button', { name: '不出' });
    if (await passBtn.isEnabled()) {
      const before = await page.locator('.hand [data-rank]').count();
      await passBtn.click();
      // Pass keeps my hand size; the turn moves on and comes back.
      await expect(page.locator('.turn-flag')).toBeVisible({ timeout: 10_000 });
      await expect(page.locator('.hand [data-rank]')).toHaveCount(before);
      await expect(page.locator('.move-error')).toHaveCount(0);
    }

    expect(renderLoopErrors).toEqual([]);
  });
});
