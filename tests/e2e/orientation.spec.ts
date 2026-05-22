// UI-7 — CSS rotate wrapper when device is portrait-mobile + autofocus polish.
//
// OrientationLock keys off `useOrientation()` which checks two media queries:
//   - `(orientation: portrait)` — matches when innerHeight > innerWidth
//   - `(max-width: 900px)` — matches when the viewport is mobile-sized
// We override viewport per test (no full device emulation) so all 3 cases run
// against the chromium project without forcing a new worker.

import { test, expect } from '@playwright/test';
import { preseedHandle } from './helpers/ui.js';

test.describe('@orientation portrait-mobile rotate', () => {
  test.use({ viewport: { width: 393, height: 852 } });

  test('OrientationLock applies the rotate wrapper class on portrait phones', async ({ page }) => {
    await preseedHandle(page, '@alice'); // skip auto-modal so it doesn't bypass rotate
    await page.goto('/');
    const wrapper = page.locator('.orientation-rotate-active');
    await expect(wrapper).toBeVisible({ timeout: 5_000 });
    const vpH = await wrapper.evaluate((el) =>
      window.getComputedStyle(el).getPropertyValue('--vp-h').trim()
    );
    expect(vpH).toBe('100%');
  });

  test('first-paint auto sign-in modal does NOT bypass the rotate (input not autofocused)', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.locator('.orientation-rotate-active')).toBeVisible();
    const modal = page.locator('[role=dialog][aria-label="登录 handle"]');
    await expect(modal).toBeVisible();
    const input = modal.locator('input[aria-label="handle"]');
    await expect(input).not.toBeFocused();
    await expect(page.locator('.orientation-rotate-bypass')).toHaveCount(0);
  });

  test('focusing an input inside the rotate wrapper switches to bypass mode', async ({ page }) => {
    await preseedHandle(page, '@alice');
    await page.goto('/');
    await expect(page.locator('.orientation-rotate-active')).toBeVisible();
    await page.locator('button.lobby-nav__signin').click();
    const input = page.locator('input[aria-label="handle"]');
    await expect(input).toBeFocused();
    await expect(page.locator('.orientation-rotate-bypass')).toHaveCount(1);
  });
});

test.describe('@orientation landscape passes through', () => {
  test.use({ viewport: { width: 852, height: 393 } });

  test('landscape phones do NOT apply the rotate wrapper', async ({ page }) => {
    await preseedHandle(page, '@alice');
    await page.goto('/');
    await expect(page.locator('.orientation-rotate-active')).toHaveCount(0);
    await expect(page.locator('.orientation-rotate-bypass')).toHaveCount(0);
  });
});

test.describe('@orientation desktop renders bare', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('wide viewports render children without any rotate wrapper', async ({ page }) => {
    await preseedHandle(page, '@alice');
    await page.goto('/');
    await expect(page.locator('.orientation-rotate-active')).toHaveCount(0);
    await expect(page.locator('.orientation-rotate-bypass')).toHaveCount(0);
  });
});
