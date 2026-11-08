import { expect, test } from '@playwright/test';
import { openComparison, pathOf, signInAs } from './helpers';

test('a reader can look at everything and change nothing', async ({ page }) => {
  await signInAs(page, 'reader');
  await expect(page.getByText('Reader', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add a person' })).toBeHidden();
  await expect(page.getByRole('link', { name: 'Export CSV' })).toBeHidden();

  const exportResponse = await page.request.get(
    `/files/${pathOf(page.url()).split('/')[2] ?? ''}/members.csv`,
  );
  expect(exportResponse.status()).toBe(403);

  await openComparison(page, /Wolska/);
  await expect(
    page.getByText('Your role lets you compare records, but not merge them.'),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Merge these two records' })).toBeHidden();
  await expect(page.getByRole('radio', { name: /^Keep the record of/ }).first()).toBeDisabled();

  await page.getByRole('link', { name: 'Duplicates', exact: true }).click();
  await expect(page.getByRole('button', { name: /are not the same person$/ })).toHaveCount(0);
});

test('switching club shows only that club, with the role held there', async ({ page }) => {
  await signInAs(page, 'organizer');
  await expect(page.getByText(/people in Greywether Hiking Club/)).toBeVisible();

  await page.getByLabel('Club').selectOption({ label: 'Saltmarsh Ramblers' });
  await expect(page.getByText(/^2 people in Saltmarsh Ramblers/)).toBeVisible();
  await expect(page.getByText('Reader', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Ravi Menon' })).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Add a person' })).toBeHidden();

  // The look-alike pair in this club was already marked as two people.
  await page.getByRole('link', { name: 'Duplicates', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'No duplicates found' })).toBeVisible();
});

test('a club the user is not in looks like one that does not exist', async ({ page }) => {
  await signInAs(page, 'volunteer');
  await page.goto('/w/00000000-0000-4000-8000-000000000000/roster');
  await expect(page.getByRole('heading', { name: 'Club not found' })).toBeVisible();
});

test('club pages send signed-out visitors to the sign-in page and back', async ({ page }) => {
  await signInAs(page, 'volunteer');
  const target = pathOf(page.url()).replace('/roster', '/duplicates');
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'One person, one record.' })).toBeVisible();

  await page.goto(target);
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await page.getByLabel('Email').fill('petra@example.com');
  await page.getByLabel('Password').fill('wrong-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Email or password is wrong.')).toBeVisible();

  await page.getByLabel('Password').fill('trailhead-demo');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Likely duplicates' })).toBeVisible();
  expect(pathOf(page.url())).toBe(target);
});
