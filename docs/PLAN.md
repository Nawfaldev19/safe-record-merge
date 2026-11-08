# Plan

This is the plan the demo was built from. It is kept so that a reader can compare
what was intended with what exists.

## Goal

Show how to design an operation that destroys information (two records become one)
so that it is **safe** (all of it happens or none of it), **auditable** (what
changed is written down) and **reversible** (it can be put back exactly), and how to
find the candidates for it without comparing everything with everything.

## The fictional setting

A hiking club keeps a roster. People join by paper form, by web form and at events,
so the same person is often on the list twice, spelled a little differently. A
volunteer wants to tidy up without losing anyone's trip history or dues.

## In scope

| Area           | What is built                                                                       |
| -------------- | ----------------------------------------------------------------------------------- |
| Workspaces     | Sign-in, several clubs per user, three roles (organizer, volunteer, reader)         |
| Roster         | Search, stage filter, two sort orders, keyset paging, add and edit                  |
| Stages         | Enquiry, trial, member, lapsed: derived from dues and trips, with a manual override |
| Unread markers | Per user: a record is unread until that user opens it                               |
| Duplicates     | Candidate pairs with a score and reasons; "not the same person"                     |
| Merge          | Side-by-side comparison, a choice per field, one transaction                        |
| Undo           | A journal per merge, exact reversal, clear refusal when it is no longer safe        |
| Export         | Streamed CSV of the current filter, safe to open in a spreadsheet                   |

## Out of scope

Entering trips and payments, automatic merging without a person deciding, learning
the matching weights from data, and merging more than two records at once. The
README lists the limits for readers.

## Requirements that shaped the design

- A merge must never be half done. This puts every step in one transaction and
  locks both rows first (ADR 1).
- A merge must be reversible without guessing. This forces a journal that records
  ids, not counts (ADR 2).
- Undo must never silently discard a later edit. This forces a precondition that
  can be checked exactly (ADR 3).
- Old links must keep working. This leaves the folded record in place as a signpost
  (ADR 4).
- Finding duplicates must stay fast as the roster grows. This forces blocking
  (ADR 5).
- A suggestion must be explainable to a volunteer. This rules out an opaque score
  (ADR 6).

## Order of work

1. The matching module and its tests, with no database involved.
2. Stage rules and CSV escaping, also pure.
3. The schema with row-level security, then the roster service.
4. The merge service and its journal, then undo, each with integration tests
   written alongside.
5. The GraphQL API, the CSV route and the seed data with planted duplicates.
6. The web app: roster, profile, duplicates, the comparison screen, the history.
7. Browser tests for merge, undo and access.
8. Documentation, continuous integration and the container setup.

## Definition of done

- `npm run check` passes: lint, type check, tests with coverage above 80% on core
  logic, and the production build.
- `npm run test:e2e` passes.
- A reader can start the demo using only the README.
- Every claim in the docs can be traced to code or to a test.
