// Join flow — a second player joins an existing room via code.
//
// Two scenarios:
//   1. Happy path: existing room created by another host → JoinModal → wait page
//   2. Invalid code error surfaces in the modal
//
// Covers Landing.tsx JoinModal + lib/api/rooms.joinRoom + lib/api/joinRoom.ts.

import { test, expect } from '@playwright/test';
import { createRoom } from './helpers/api.js';
import { preseedHandle } from './helpers/ui.js';

test.describe('@join existing room', () => {
  test('a 2nd player joins a 4P room with 2 bots → wait page renders 4/4', async ({ page }) => {
    // Host creates a 4P room with 2 bots; the 2nd seat is left for a human.
    const host = await createRoom({
      mode: '4',
      handle: '@host',
      bots: [{ tier: 'easy' }, { tier: 'easy' }],
    });

    await preseedHandle(page, '@bob');
    await page.goto('/');

    // Open join modal.
    await page.getByRole('button', { name: '加入房间' }).click();
    const modal = page.locator('[role=dialog][aria-label="加入房间"]');
    await expect(modal).toBeVisible();
    await modal.locator('input[aria-label="room code"]').fill(host.code);
    await modal.getByRole('button', { name: /^加入$/ }).click();

    // After successful join we land on the wait page with 4/4 ready.
    await expect(page).toHaveURL(new RegExp(`#/wait\\?code=${host.code}$`));
    await expect(page.locator('.waiting__title')).toContainText('4/4');
  });

  test('valid-format but nonexistent code returns "房间不存在或已结束" inline', async ({
    page,
  }) => {
    await preseedHandle(page, '@bob');
    await page.goto('/');
    await page.getByRole('button', { name: '加入房间' }).click();
    const modal = page.locator('[role=dialog][aria-label="加入房间"]');
    // Use a code matching the LDLDLD format that isn't in the store.
    // AAAAAA fails server-side validation as 'invalid_room_code'; we want the
    // friendlier "room_not_found" branch instead.
    await modal.locator('input[aria-label="room code"]').fill('A2B3C4');
    await modal.getByRole('button', { name: /^加入$/ }).click();
    await expect(modal.locator('.modal__error')).toContainText('房间不存在或已结束');
    // Modal stays open so the user can re-enter.
    await expect(modal).toBeVisible();
  });

  test('short code rejected client-side', async ({ page }) => {
    await preseedHandle(page, '@bob');
    await page.goto('/');
    await page.getByRole('button', { name: '加入房间' }).click();
    const modal = page.locator('[role=dialog][aria-label="加入房间"]');
    await modal.locator('input[aria-label="room code"]').fill('AB1'); // 3 chars
    // Submit button is disabled until 6 chars.
    await expect(modal.getByRole('button', { name: /^加入$/ })).toBeDisabled();
  });
});
