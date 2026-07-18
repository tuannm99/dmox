import { test, expect } from '@playwright/test';

test('browse -> search happy path', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: /example docs/i }).click();
  await expect(page).toHaveURL(/\/w\/example/);
  await page.getByRole('link', { name: 'guide.md' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
});

test('deep link into a doc route loads directly without prior client-side navigation', async ({ page, baseURL }) => {
  const prefix = baseURL?.includes('4173') ? '/w/example/doc/local/guide.md' : '/w/example/doc/local/guide.md';
  await page.goto(prefix);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
});
