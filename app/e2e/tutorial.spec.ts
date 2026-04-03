import { test, expect } from "@playwright/test";

/**
 * Tutorial recording — walks through the full escrow flow visually.
 * Run: npm run test:e2e
 * The .webm video is saved to: test-results/tutorial-*/
 * Convert to GIF: npm run gif -- test-results/FOLDER/video.webm tutorial.gif
 *
 * NOTE: wallet interactions (Phantom) cannot be automated in a real browser.
 * This test documents the UI flow. For automated wallet signing, use a mock
 * wallet or the Anchor test suite instead.
 */

test("escrow flow — connect, post job, apply, accept, pay", async ({ page }) => {
  // ── 1. Landing page ────────────────────────────────────────────────────────
  await page.goto("/");
  await expect(page.getByText("Escrow Freelancer Offers")).toBeVisible();
  await page.waitForTimeout(1500);

  // ── 2. Connect wallet prompt ───────────────────────────────────────────────
  await expect(page.getByText("Connect your Phantom wallet")).toBeVisible();
  await page.waitForTimeout(2000);

  // ── 3. Show the two views (after manually connecting in --ui mode) ─────────
  // Skip actual wallet connection in automated run — just document the UI.
  await page.waitForTimeout(1000);
});

test("client view — post a job form", async ({ page }) => {
  await page.goto("/");
  await page.waitForTimeout(1000);

  // Show the connect prompt
  await expect(page.locator(".connect-prompt")).toBeVisible();
  await page.waitForTimeout(2000);
});
