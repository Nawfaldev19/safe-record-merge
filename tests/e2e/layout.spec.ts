import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { openComparison, signInAs } from './helpers';

/** These run twice: on a desktop viewport and on a phone-sized one. */

async function expectNoSidewaysScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
}

test('pages fit the viewport without sideways scrolling', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expectNoSidewaysScroll(page);

  await signInAs(page, 'organizer');
  await expect(
    page.getByRole('list', { name: 'People' }).getByRole('listitem').first(),
  ).toBeVisible();
  await expectNoSidewaysScroll(page);

  await openComparison(page, /Engstr/);
  await expect(page.getByRole('heading', { name: 'What will happen' })).toBeVisible();
  await expectNoSidewaysScroll(page);

  await page.getByRole('link', { name: 'Merge history' }).click();
  await expect(page.getByRole('list', { name: 'Merges' })).toBeVisible();
  await expectNoSidewaysScroll(page);
});

test('the theme choice is applied before paint and survives a reload', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  const html = page.locator('html');
  await expect(html).toHaveAttribute('data-theme', 'light');
  await page.getByRole('button', { name: 'Switch to dark theme' }).click();
  await expect(html).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(html).toHaveAttribute('data-theme', 'dark');
});

test('the first Tab stop inside the app is a skip link to the content', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'Tab order is a keyboard concern.');
  await signInAs(page, 'reader');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Roster', level: 1 })).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
});
