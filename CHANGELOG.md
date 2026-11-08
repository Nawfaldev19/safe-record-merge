# Changelog

All notable changes to this project are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com), and the project uses
[Semantic Versioning](https://semver.org).

## [1.0.0] - 2026-10-12

### Added

- Clubs with organizer, volunteer and reader roles, isolated by Postgres row-level
  security.
- A roster with search that ignores accents, a stage filter, two sort orders and
  keyset paging.
- Stages derived from dues and trips, with a manual override.
- Per-user unread markers.
- Duplicate detection by email, phone and name, with blocking, a score and written
  reasons, and "not the same person".
- A side-by-side comparison screen with a choice per field.
- Merging in one transaction, with a journal entry per merge.
- Exact undo of a merge, refused when the kept record has changed since.
- Signposts from merged records to the record that replaced them.
- A streamed CSV export that is safe against formula injection.
- Seeded demo data with one duplicate of each kind, and one-click demo sign-in.
- Unit, integration, component and end-to-end tests, and a CI workflow.
