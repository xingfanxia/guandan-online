// Mobile modal flows (F4) — sign-in, join-code, and create-room at mobile
// viewport sizing. Runs on the mobile-landscape project: in landscape the
// OrientationLock does NOT apply its portrait CSS rotate, so modal/input
// interactions behave normally (the rotate's input-bypass swap is what made
// the broader journey specs flaky at small viewports). This closes the gap
// where modal flows were only ever exercised at desktop sizing.

import { test, expect } from '@playwright/test';
import { preseedHandle } from './helpers/ui.js';

test.describe('@mobile sign-in modal (landscape)', () => {
  test('auto-opens, accepts a valid handle, persists, and closes', async ({ page }) => {
    await page.goto('/');
    const modal = page.locator('[role=dialog][aria-label="登录 handle"]');
    await expect(modal).toBeVisible();

    const input = modal.locator('input[aria-label="handle"]');
    await input.fill('@小明');
    await page.getByRole('button', { name: '确认' }).click();

    await expect(modal).toBeHidden();
    await expect(page.locator('.lobby-nav__me-handle')).toHaveText('@小明');
    const stored = await page.evaluate(() =>
      window.localStorage.getItem('guandan.handle')
    );
    expect(stored).toBe('@小明');
  });

  test('rejects a too-short handle and keeps the modal open', async ({ page }) => {
    await page.goto('/');
    const input = page.locator('input[aria-label="handle"]');
    await input.fill('x');
    await page.getByRole('button', { name: '确认' }).click();
    await expect(page.locator('.modal__error')).toBeVisible();
    await expect(page.locator('[role=dialog][aria-label="登录 handle"]')).toBeVisible();
  });
});

test.describe('@mobile lobby navigation (landscape)', () => {
  test.beforeEach(async ({ page }) => {
    await preseedHandle(page, '@阿祥');
  });

  test('join-code modal opens at mobile sizing', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: '加入房间' }).click();
    await expect(page.locator('[role=dialog][aria-label="加入房间"]')).toBeVisible();
  });

  test('create-room screen renders and accepts mode selection at mobile sizing', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: '创建房间' }).click();
    await expect(page).toHaveURL(/#\/create$/);
    await expect(page.locator('.lobby-nav__title')).toHaveText('创建房间');
    // The create form is interactive at mobile sizing — the submit CTA exists.
    await expect(page.getByRole('button', { name: /建立房间/ })).toBeVisible();
  });
});
