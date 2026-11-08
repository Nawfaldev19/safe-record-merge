# Testing

## How to run

```bash
npm test               # unit, integration and component tests
npm run test:coverage  # the same, with a coverage report and thresholds
npm run test:e2e       # browser tests against the production build
npm run check          # lint, type check, coverage run and build, as in CI
```

The first browser run needs `npx playwright install chromium`. On a system Playwright
has no browser build for, use an installed Chrome: `PW_CHANNEL=chrome npm run test:e2e`.

## Layers

| Layer       | Where               | Runs in             | Count                              | What it is for                                                                   |
| ----------- | ------------------- | ------------------- | ---------------------------------- | -------------------------------------------------------------------------------- |
| Unit        | `tests/unit`        | Node                | 123                                | Matching, stage rules, CSV escaping, cursors, the merge screen's model, contrast |
| Integration | `tests/integration` | Node, real database | 89                                 | Services, SQL, policies and the API together                                     |
| Component   | `tests/component`   | jsdom               | 16                                 | Shared components and hooks                                                      |
| End to end  | `tests/e2e`         | A real browser      | 15, two of them also at phone size | Whole journeys through the built app                                             |

Counts are test cases at the time of writing.

### Unit tests

`matching.test.ts` is the largest. It covers normalization (five ways of writing one
phone number, accents, punctuation), edit distance including neighbouring-letter
swaps, exact scores and reasons for each kind of duplicate, the cases that must _not_
match (a shared surname, two missing emails), blocking keys, dismissed pairs, and a
roster of 3,000 synthetic people with 30 planted duplicates. That last test asserts
three things at once: all 30 are found, fewer than a fiftieth of the all-pairs
comparisons are made, and it finishes within two seconds.

`domain.test.ts` covers stage derivation on its boundary days, CSV escaping including
four formula prefixes, tampered cursors, and input parsing.
`merge-model.test.ts` covers the comparison screen's defaults and the translation
from "left and right" to "kept and folded in".
`design-tokens.test.ts` reads `tokens.css` and computes WCAG contrast for every text
and background pair in both themes.

### Integration tests

These run against the same embedded Postgres as the demo, with a clock the test
controls. Nothing is mocked.

`merge.test.ts` is the centre of the suite:

- **What a merge does.** Chosen values per field; notes joined; trips unioned without
  doubling a shared one; "attended" kept from either side; payments and history
  moved; the stage changing because dues arrived from the other record.
- **Atomicity.** A constraint is added that makes the final step (the journal write)
  fail. The test then compares every column of both records, and their sign-ups and
  payments, with a snapshot taken before. They must be identical.
- **Concurrency.** Two merges of the same pair, in opposite directions, are started
  together. Exactly one succeeds and exactly one journal entry exists.
- **Stale data.** A record edited after the comparison was loaded makes the merge a
  conflict.
- **Undo.** The full state of both records before a merge and after its undo must be
  equal, column for column and row for row. Undo is refused after an edit, after a
  later merge, while the kept record is itself merged away, a second time, and for
  non-organizers, each with its own message.
- **Signposts.** A merged-away id leads to the kept record, through a chain of two
  merges as well.

`tenant-isolation.test.ts` attacks isolation from three directions. In the database:
every table with a `workspace_id` column must have forced row-level security (asked
from the catalog, so a new table cannot be forgotten); rows of another club are
invisible, cannot be updated, and cannot be inserted; a record cannot be pointed at
another club's record; password hashes and sessions are unreadable from the tenant
role. In the services: merging, comparing, dismissing and undoing across clubs all
answer "not found". Through the API: the same with a signed-in user of the other
club, checking also that no private note appears anywhere in the response.

`members.test.ts` covers stages (including that SQL and the shared function agree
for every person, and the day dues run out), search without accents and with
wildcards as plain text, both sort orders paged without gaps or repeats, per-user
unread markers, optimistic locking and roles.

`export-and-http.test.ts` checks the exact bytes of the CSV, including a name and a
note that a spreadsheet would run as formulas, that a 450-row export is written row
by row, and the access rules of the download. `auth-and-seed.test.ts` covers sign-in
and checks that the seed data really contains one duplicate of each kind.

### Component tests

They render the shared components and act through roles and labels. jsdom lacks the
`<dialog>` methods, which `tests/component/setup.ts` stands in for; the real dialogs
are exercised in the browser tests.

### End-to-end tests

They run the production build with a throwaway in-memory database and seed data.

- `merge-flow.spec.ts`: read the duplicates list, compare a pair, choose values,
  merge, follow an old link to the folded record, fail to undo as a volunteer, undo
  as an organizer, and see both records back. Then: undo blocked after an edit, and a
  look-alike pair dismissed for good.
- `roster.spec.ts`: stage filter, search, sorting and paging; unread markers; adding
  and editing with field errors; fixing a stage; downloading the CSV.
- `access.spec.ts`: what a reader cannot do, switching club, an unknown club, and the
  sign-in redirect.
- `layout.spec.ts`: no sideways scrolling at desktop and phone size (the comparison
  grid collapses to one column), theme persistence, and the skip link.

Tests that count people read the expected number from the page, because other tests
add and merge people in the same database.

## Coverage

Coverage is measured on the core logic: `src/shared`, `src/server/domain`,
`src/server/services`, `src/web/lib` and the merge screen's model. Thresholds in
`vitest.config.ts` fail the run below 80% (75% for branches).

| Measure    | Result |
| ---------- | ------ |
| Statements | 96.92% |
| Branches   | 90.34% |
| Functions  | 99.35% |
| Lines      | 99.8%  |

## Known gaps

- **Pages are not unit tested.** Files under `src/web/features`, apart from the merge
  model, are covered by the browser tests and are outside the coverage figure.
- **GraphQL and HTTP glue is outside the coverage figure.** It is exercised by the
  integration tests but holds wiring, not rules.
- **Concurrency is tested on one connection.** The embedded database runs
  transactions one after another. The row locks are written for a pooled Postgres but
  have not been run against one.
- **Matching quality is not measured.** There is no labelled set of real duplicates,
  so precision and recall are argued from cases, not reported as numbers.
- **The performance test uses synthetic names**, which are more evenly spread than
  real ones. Real rosters have common surnames and therefore larger blocks.
- **The container setup is not tested.**
- **No automated accessibility audit**, for licence reasons explained in
  `THIRD_PARTY_NOTICES.md`. Roles, labels, keyboard order and contrast are tested.
- **One browser engine.** The browser tests run on Chromium only.
