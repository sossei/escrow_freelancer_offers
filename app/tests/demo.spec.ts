import { test, expect } from '@playwright/test';

test('demo do projeto para README', async ({ page }) => {
  await page.goto('http://localhost:3000');

  await page.getByRole('button', { name: /connect/i }).click();
  await page.getByRole('button', { name: /start demo/i }).click();

  await page.getByLabel(/amount/i).fill('100');
  await page.getByRole('button', { name: /confirm/i }).click();

  await expect(page.getByText(/success/i)).toBeVisible();

  await page.waitForTimeout(2000);
});