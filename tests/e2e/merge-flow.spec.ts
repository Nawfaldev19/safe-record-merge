import { expect, test } from '@playwright/test';
import { openComparison, pathOf, signInAs } from './helpers';

/**
 * The main journey: a volunteer finds a duplicate, compares the two records,
 * chooses what to keep and merges them; an old link then leads to the kept
 * record; an organizer undoes the merge and both records are back.
 */
test('find a duplicate, merge it, follow an old link, then undo', async ({ page, browser }) => {
  await signInAs(page, 'volunteer');

  await test.step('the duplicates list explains each suggestion', async () => {
    await page.getByRole('link', { name: 'Duplicates', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Likely duplicates' })).toBeVisible();
    await expect(page.getByText(/Checked 31 people by comparing \d+ pairs/)).toBeVisible();

    const list = page.getByRole('list', { name: 'Likely duplicates' });
    await expect(list.getByRole('listitem')).toHaveCount(5);
    const swapped = list.getByRole('listitem').filter({ hasText: 'Wolska' });
    await expect(swapped).toContainText(
      'Same phone number · Same name with first and last name swapped',
    );
    await expect(swapped.getByLabel('95% alike')).toBeVisible();
  });

  let foldedPath = '';
  await test.step('compare the two records and choose what to keep', async () => {
    await openComparison(page, /Zoë Brandt/);
    const [, , , , leftId, rightId] = pathOf(page.url()).split('/');
    const workspacePath = pathOf(page.url()).split('/merge/')[0] ?? '';

    const keepAccented = page.getByRole('radio', { name: /^Keep the record of Zoë Brandt/ });
    await keepAccented.check();
    await expect(page.getByRole('heading', { name: 'What will happen' })).toBeVisible();
    await expect(
      page.getByText('3 in total (1 trip is on both records and will be counted once)'),
    ).toBeVisible();

    // Keep the paper form's spelling of the first name, to show a per-field choice.
    await page.getByRole('radio', { name: 'First name: Zoe' }).check();
    await page.getByRole('radio', { name: 'Both, one after the other' }).check();
    const summary = page.getByRole('region', { name: 'What will happen' });
    await expect(summary.getByText('Zoe Brandt', { exact: true })).toBeVisible();

    // Work out which id is being folded in: the one that is not kept.
    const leftIsKept = await page
      .getByRole('radio', { name: /^Keep the record of/ })
      .first()
      .isChecked();
    foldedPath = `${workspacePath}/members/${(leftIsKept ? rightId : leftId) ?? ''}`;
  });

  await test.step('merge, and land on the kept record with everything combined', async () => {
    await page.getByRole('button', { name: 'Merge these two records' }).click();
    await expect(page.getByText('Merged. You can undo this from the merge history.')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Zoe Brandt', level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Trips (3)' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Dues (1)' })).toBeVisible();
    await expect(page.getByLabel('Notes')).toHaveValue(
      'Leads the Thursday evening walks.\n\nHas a first aid certificate.',
    );
    await expect(page.getByRole('list', { name: 'History' })).toContainText(
      'Merged with a second record of Zoe Brandt',
    );
  });

  await test.step('the pair is gone from the duplicates list and the roster', async () => {
    await page.getByRole('link', { name: 'Duplicates', exact: true }).click();
    await expect(
      page.getByRole('list', { name: 'Likely duplicates' }).getByRole('listitem'),
    ).toHaveCount(4);
    await page.getByRole('link', { name: 'Roster', exact: true }).click();
    await page.getByLabel('Search by name or email').fill('brandt');
    await expect(page.getByRole('list', { name: 'People' }).getByRole('listitem')).toHaveCount(1);
  });

  await test.step('an old link to the folded record leads to the kept one', async () => {
    await page.goto(foldedPath);
    await expect(page.getByRole('heading', { name: 'Zoe Brandt', level: 1 })).toBeVisible();
    await expect(
      page.getByText(/You followed a link to an older record of Zo. Brandt/),
    ).toBeVisible();
  });

  await test.step('a volunteer cannot undo; an organizer can', async () => {
    await page.getByRole('link', { name: 'Merge history' }).click();
    const entry = page
      .getByRole('list', { name: 'Merges' })
      .getByRole('listitem')
      .filter({ hasText: 'Zoe Brandt' });
    await expect(entry).toContainText('by Petra Nowak');
    await expect(entry.getByRole('button', { name: /Undo/ })).toBeHidden();

    const context = await browser.newContext();
    const organizer = await context.newPage();
    await signInAs(organizer, 'organizer');
    await organizer.getByRole('link', { name: 'Merge history' }).click();
    await organizer.getByRole('button', { name: 'Undo the merge of Zoe Brandt' }).click();
    await organizer
      .getByRole('dialog', { name: 'Undo this merge?' })
      .getByRole('button', { name: 'Undo the merge' })
      .click();
    await expect(organizer.getByText('Undone. Both records are back as they were.')).toBeVisible();

    await organizer.getByRole('link', { name: 'Duplicates', exact: true }).click();
    await expect(
      organizer.getByRole('list', { name: 'Likely duplicates' }).getByRole('listitem'),
    ).toHaveCount(5);
    await organizer.getByRole('link', { name: 'Roster', exact: true }).click();
    await organizer.getByLabel('Search by name or email').fill('brandt');
    await expect(organizer.getByRole('list', { name: 'People' }).getByRole('listitem')).toHaveCount(
      2,
    );
    await expect(organizer.getByRole('link', { name: 'Zoë Brandt' })).toBeVisible();
    await context.close();
  });
});

test('a merge is blocked from undo once the kept record has been edited', async ({ page }) => {
  await signInAs(page, 'organizer');
  await openComparison(page, /Priya Raman/);
  await page.getByRole('button', { name: 'Merge these two records' }).click();
  await expect(page.getByRole('heading', { name: 'Priya Raman', level: 1 })).toBeVisible();

  await page.getByLabel('Notes').fill('Prefers weekend trips.');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();

  await page.getByRole('link', { name: 'Merge history' }).click();
  const entry = page
    .getByRole('list', { name: 'Merges' })
    .getByRole('listitem')
    .filter({ hasText: 'Priya Raman' });
  await expect(entry).toContainText(
    'The kept record was changed after this merge, so it cannot be undone automatically.',
  );
  await expect(entry.getByRole('button', { name: /Undo/ })).toBeDisabled();
});

test('two people who only look alike can be marked as different, for good', async ({ page }) => {
  await signInAs(page, 'volunteer');
  await page.getByRole('link', { name: 'Duplicates', exact: true }).click();
  const list = page.getByRole('list', { name: 'Likely duplicates' });
  const lookalikes = list.getByRole('listitem').filter({ hasText: 'Lindgren' });
  await expect(lookalikes).toContainText('Same phone number · Very similar name');

  await lookalikes.getByRole('button', { name: /are not the same person$/ }).click();
  await expect(page.getByText('Noted. This pair will not be suggested again.')).toBeVisible();
  await expect(lookalikes).toHaveCount(0);

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Likely duplicates' })).toBeVisible();
  await expect(list.getByRole('listitem').filter({ hasText: 'Lindgren' })).toHaveCount(0);

  await page.getByRole('link', { name: 'Roster', exact: true }).click();
  await page.getByLabel('Search by name or email').fill('lindgren');
  await expect(page.getByRole('list', { name: 'People' }).getByRole('listitem')).toHaveCount(2);
});
