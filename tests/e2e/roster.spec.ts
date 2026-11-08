import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { signInAs } from './helpers';

test('the roster filters by stage, searches without accents and sorts', async ({ page }) => {
  await signInAs(page, 'organizer');
  const people = page.getByRole('list', { name: 'People' }).getByRole('listitem');
  await expect(
    page.getByText(/^\d+ people in Greywether Hiking Club, \d+ you have not opened yet\.$/),
  ).toBeVisible();

  const stages = page.getByRole('group', { name: 'Filter by stage' });
  await stages.getByRole('button', { name: /^Lapsed/ }).click();
  await expect(people.first()).toContainText('Lapsed');
  const lapsed = await people.count();
  expect(lapsed).toBeGreaterThan(0);
  await expect(stages.getByRole('button', { name: `Lapsed (${String(lapsed)})` })).toBeVisible();

  await stages.getByRole('button', { name: /^Everyone/ }).click();
  await page.getByLabel('Search by name or email').fill('ENGSTROM');
  await expect(people).toHaveCount(2);
  await expect(people.filter({ hasText: 'Engström' })).toHaveCount(1);

  await page.getByLabel('Search by name or email').fill('nobody-by-this-name');
  await expect(page.getByRole('heading', { name: 'Nobody matches' })).toBeVisible();

  await page.getByLabel('Search by name or email').fill('');
  await page.getByLabel('Sort by').selectOption({ label: 'Newest first' });
  await expect(people.first()).toContainText('New');
  await page.getByRole('button', { name: 'Load more' }).click();
  // Other tests add and merge people, so the total is read from the page.
  const everyone = await stages.getByRole('button', { name: /^Everyone \(\d+\)$/ }).textContent();
  const total = Number(/\d+/.exec(everyone ?? '')?.[0]);
  expect(total).toBeGreaterThan(25);
  await expect(people).toHaveCount(total);
});

test('opening a record marks it as read, for that person only', async ({ page }) => {
  await signInAs(page, 'reader');
  await page.getByLabel('Search by name or email').fill('fenwick');
  const row = page
    .getByRole('list', { name: 'People' })
    .getByRole('listitem')
    .filter({ hasText: 'Ada Fenwick' });
  await expect(row.getByRole('img', { name: 'Not opened yet' })).toBeVisible();

  await row.getByRole('link', { name: 'Ada Fenwick' }).click();
  await expect(page.getByRole('heading', { name: 'Ada Fenwick', level: 1 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Trips (3)' })).toBeVisible();
  await expect(page.getByLabel('First name')).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Save changes' })).toBeHidden();

  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'Roster' })
    .click();
  await page.getByLabel('Search by name or email').fill('fenwick');
  await expect(row.getByRole('img', { name: 'Opened before' })).toBeVisible();
});

test('a volunteer adds a person, sees field errors, and edits the record', async ({ page }) => {
  await signInAs(page, 'volunteer');
  await page.getByRole('button', { name: 'Add a person' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add a person' });
  await dialog.getByLabel('Last name').fill('Sandoval');
  await dialog.getByLabel('Email (optional)').fill('not-an-email');
  await dialog.getByRole('button', { name: 'Add to the roster' }).click();
  await expect(dialog.getByText('This is needed.')).toBeVisible();
  await expect(dialog.getByText('This is not an email address.')).toBeVisible();

  await dialog.getByLabel('First name').fill('Iris');
  await dialog.getByLabel('Email (optional)').fill('iris.sandoval@example.com');
  await dialog.getByRole('button', { name: 'Add to the roster' }).click();

  await expect(page.getByRole('heading', { name: 'Iris Sandoval', level: 1 })).toBeVisible();
  await expect(page.getByText('Enquiry', { exact: true })).toBeVisible();
  await expect(page.getByRole('list', { name: 'History' })).toContainText('Added to the roster');

  const save = page.getByRole('button', { name: 'Save changes' });
  await expect(save).toBeDisabled();
  await page.getByLabel('Phone').fill('07700 900188');
  await save.click();
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  await expect(page.getByRole('list', { name: 'History' })).toContainText('Changed phone');
  await expect(page.getByLabel('Fix the stage by hand')).toBeHidden();
});

test('an organizer fixes a stage by hand and frees it again', async ({ page }) => {
  await signInAs(page, 'organizer');
  await page.getByLabel('Search by name or email').fill('hartley');
  await page.getByRole('link', { name: 'Esme Hartley' }).click();
  await expect(page.locator('.badge', { hasText: /^Enquiry$/ })).toBeVisible();

  await page.getByLabel('Fix the stage by hand').selectOption({ label: 'Member' });
  await expect(page.getByText('Member (fixed)')).toBeVisible();
  await expect(page.getByRole('list', { name: 'History' })).toContainText(
    'Fixed the stage as Member',
  );

  await page
    .getByLabel('Fix the stage by hand')
    .selectOption({ label: 'Not fixed: follow dues and trips' });
  await expect(page.locator('.badge', { hasText: /^Enquiry$/ })).toBeVisible();
});

test('the export downloads the filtered roster as CSV', async ({ page }) => {
  await signInAs(page, 'volunteer');
  await page
    .getByRole('group', { name: 'Filter by stage' })
    .getByRole('button', { name: /^Member/ })
    .click();
  await expect(
    page.getByRole('list', { name: 'People' }).getByRole('listitem').first(),
  ).toContainText('Member');

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Export CSV' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('roster.csv');

  const lines = (await readFile(await download.path(), 'utf8')).split('\r\n').filter(Boolean);
  expect(lines[0]).toBe(
    'Last name,First name,Email,Phone,Stage,Dues paid until,Trips,Source,Added on,Notes',
  );
  expect(lines.length).toBeGreaterThan(3);
  for (const line of lines.slice(1)) expect(line).toContain(',Member,');
});
