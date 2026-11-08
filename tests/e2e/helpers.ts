import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';

export type DemoRole = 'organizer' | 'volunteer' | 'reader';

/** Signs in from the start page with one of the seeded demo accounts. */
export async function signInAs(page: Page, role: DemoRole): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: `Continue as ${role}` }).click();
  await expect(page.getByRole('heading', { name: 'Roster', level: 1 })).toBeVisible();
}

export function pathOf(url: string): string {
  return new URL(url).pathname;
}

/** Opens the comparison screen for the pair whose names are given, from the duplicates list. */
export async function openComparison(page: Page, names: RegExp): Promise<void> {
  await page.getByRole('link', { name: 'Duplicates', exact: true }).click();
  const pair = page
    .getByRole('list', { name: 'Likely duplicates' })
    .getByRole('listitem')
    .filter({ hasText: names });
  await pair.getByRole('link', { name: 'Compare' }).click();
  await expect(page.getByRole('heading', { name: 'Compare and merge' })).toBeVisible();
}
