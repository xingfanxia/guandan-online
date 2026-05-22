// UI helpers — small wrappers over Playwright's locator API for repetitive
// landing/signin/createroom flows.

import type { Page } from '@playwright/test';

/**
 * Set @handle into localStorage BEFORE the page is opened — short-circuits
 * the sign-in modal so test flows can land directly on the landing page or
 * deeper. Use this when the test isn't exercising the sign-in surface.
 */
export async function preseedHandle(page: Page, handle = '@alice'): Promise<void> {
  await page.addInitScript((h) => {
    try {
      window.localStorage.setItem('guandan.handle', h);
    } catch {
      /* private-mode safari etc. */
    }
  }, handle);
}

/**
 * Stash join credentials into localStorage so `#/table?code=...` works without
 * having to actually click through the join flow. Matches the RoomCredentials
 * shape persisted by src/lib/identity.ts (the page-side reader rejects entries
 * that don't carry `storedAt` — see readTokens filter).
 *
 * `handle` is optional but recommended — the C-1 fix added it so the HUD can
 * show the user's @handle instead of falling back to playerId.
 */
export async function preseedCredentials(
  page: Page,
  args: {
    code: string;
    playerId: string;
    joinToken: string;
    hostToken?: string;
    handle?: string;
  }
): Promise<void> {
  await page.addInitScript((data) => {
    try {
      const existing = JSON.parse(window.localStorage.getItem('guandan.tokens') ?? '[]');
      const filtered = existing.filter((entry: { code: string }) => entry.code !== data.code);
      const entry: Record<string, unknown> = {
        code: data.code,
        playerId: data.playerId,
        joinToken: data.joinToken,
        storedAt: Date.now(),
      };
      if (data.hostToken) entry['hostToken'] = data.hostToken;
      if (data.handle) entry['handle'] = data.handle;
      filtered.push(entry);
      window.localStorage.setItem('guandan.tokens', JSON.stringify(filtered));
    } catch {
      /* noop */
    }
  }, args);
}

/**
 * Wait for the deal event to materialize in the DOM (the local hand renders
 * 27 cards with [data-rank] attrs).
 *
 * On timeout, dumps a tiny snapshot of the current DOM to the console so
 * failures show what actually rendered instead of a bare locator timeout.
 */
export async function waitForDeal(page: Page): Promise<void> {
  try {
    await page
      .locator('.hand [data-rank]')
      .first()
      .waitFor({ state: 'visible', timeout: 15_000 });
  } catch (err) {
    const url = page.url();
    const headings = await page.locator('h1, h2').allInnerTexts();
    const error = await page
      .locator('.modal__error, .waiting__error')
      .allInnerTexts()
      .catch(() => []);
    const visibleText = (await page.locator('body').innerText()).slice(0, 400);
    console.error(
      `[waitForDeal] page url=${url} headings=${JSON.stringify(headings)} ` +
        `errors=${JSON.stringify(error)} visible=${visibleText}`
    );
    throw err;
  }
}
