// Landing screen flows — sign-in modal behavior, CTA navigation, recent rooms.

import { test, expect } from '@playwright/test';
import { preseedHandle } from './helpers/ui.js';

test.describe('@landing sign-in modal', () => {
  test('first visit auto-opens sign-in modal WITHOUT autofocus', async ({ page }) => {
    await page.goto('/');
    const modal = page.locator('[role=dialog][aria-label="登录 handle"]');
    await expect(modal).toBeVisible();

    // UI-7 polish: auto-open does NOT autofocus the input (would bypass the
    // OrientationLock rotate on first paint on portrait mobile). User can
    // still click the input to type, but it should NOT have focus on mount.
    const input = modal.locator('input[aria-label="handle"]');
    await expect(input).not.toBeFocused();
  });

  test('manual sign-in via header button autofocuses the input', async ({ page }) => {
    await preseedHandle(page, '@alice');
    await page.goto('/');

    // Header shows the current handle; click the "切换" button to manually open.
    await page.locator('button.lobby-nav__signin').click();
    const modal = page.locator('[role=dialog][aria-label="登录 handle"]');
    await expect(modal).toBeVisible();
    const input = modal.locator('input[aria-label="handle"]');
    await expect(input).toBeFocused();
  });

  test('valid handle persists and closes modal', async ({ page }) => {
    await page.goto('/');
    const input = page.locator('input[aria-label="handle"]');
    await input.fill('@xingfan');
    await page.getByRole('button', { name: '确认' }).click();
    await expect(page.locator('[role=dialog][aria-label="登录 handle"]')).toBeHidden();
    await expect(page.locator('.lobby-nav__me-handle')).toHaveText('@xingfan');
    // Persisted to localStorage:
    const stored = await page.evaluate(() => window.localStorage.getItem('guandan.handle'));
    expect(stored).toBe('@xingfan');
  });

  test('invalid handle surfaces an error and keeps modal open', async ({ page }) => {
    await page.goto('/');
    const input = page.locator('input[aria-label="handle"]');
    await input.fill('a'); // too short
    await page.getByRole('button', { name: '确认' }).click();
    const error = page.locator('.modal__error');
    await expect(error).toBeVisible();
    await expect(error).toContainText('2-16');
  });
});

test.describe('@landing CTA navigation', () => {
  test.beforeEach(async ({ page }) => {
    await preseedHandle(page, '@alice');
  });

  test('"创建房间" navigates to #/create', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: '创建房间' }).click();
    await expect(page).toHaveURL(/#\/create$/);
    await expect(page.locator('.lobby-nav__title')).toHaveText('创建房间');
  });

  test('"加入房间" opens code modal', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: '加入房间' }).click();
    const modal = page.locator('[role=dialog][aria-label="加入房间"]');
    await expect(modal).toBeVisible();
  });

  test('"浏览房间" opens the public room browse modal (ROOM-3)', async ({ page }) => {
    await preseedHandle(page, '@alice');
    await page.goto('/');
    const btn = page.getByRole('button', { name: '浏览房间' });
    await expect(btn).toBeEnabled();
    await btn.click();
    const modal = page.getByRole('dialog', { name: '浏览房间' });
    await expect(modal).toBeVisible();
    // Fresh memory infra → empty state copy explains how rooms get listed.
    await expect(modal).toContainText(/公开房间/);
  });
});

test.describe('@landing recent rooms list', () => {
  test('empty state when no rooms in localStorage', async ({ page }) => {
    await preseedHandle(page, '@alice');
    await page.goto('/');
    await expect(page.locator('.landing__rooms-empty')).toBeVisible();
    await expect(page.locator('.landing__rooms-count em')).toHaveText('0');
  });
});
