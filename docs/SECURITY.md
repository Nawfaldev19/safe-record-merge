# Security

This document describes what Record Merge protects, from whom, and how. It also lists
what it does not protect.

## What is worth protecting

| Asset                                                | Why it matters                                                             |
| ---------------------------------------------------- | -------------------------------------------------------------------------- |
| A club's roster: names, emails, phone numbers, notes | Personal data of people who never use this application themselves          |
| The integrity of the roster                          | A wrong merge joins two people's histories; a lost merge splits one person |
| Trip and dues records                                | They decide who counts as a member                                         |
| Sessions and passwords                               | They open everything a user may do                                         |

## Who might attack, or simply make a mistake

| Actor                               | Starting point                                     |
| ----------------------------------- | -------------------------------------------------- |
| Anonymous visitor                   | Can reach the API and guess passwords              |
| Reader                              | A valid session with no right to change anything   |
| Volunteer                           | May merge, and may merge wrongly                   |
| User of another club                | A valid session and knowledge of how the API works |
| Someone on the roster               | Chose their own name, which ends up in an export   |
| Someone with a copy of the database | A leaked backup                                    |

## Threats and controls

| Threat                                                     | Control                                                                                                                              | Where                                                     |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------- |
| A query reads or writes another club's rows                | Row-level security on every tenant table, forced for the owner; request code runs as a role limited to one workspace per transaction | `db/migrations.ts`, `db/database.ts`                      |
| A record is pointed at another club's record               | Composite foreign keys on `(workspace_id, id)`, including the self-reference used by merges                                          | `db/migrations.ts`                                        |
| Probing for ids from other clubs                           | Non-members get `NOT_FOUND`, the same answer as for a missing club; so do merges, comparisons and undo with foreign ids              | `services/auth-service.ts`, `services/merge-service.ts`   |
| A reader changes data, or a volunteer undoes a merge       | Role checked in the service, not only hidden in the interface                                                                        | `assertRole` in each service                              |
| A merge is left half done                                  | One transaction; both rows locked first                                                                                              | `services/merge-service.ts`                               |
| Two people merge the same pair at once                     | Row locks in a fixed order; the second finds the pair already merged                                                                 | `services/merge-service.ts`                               |
| A merge or an edit based on stale data                     | Expected revisions are sent with the request and checked                                                                             | `services/merge-service.ts`, `services/member-service.ts` |
| A wrong merge cannot be corrected                          | A journal per merge and an exact undo                                                                                                | `services/merge-service.ts`                               |
| Undo silently discards later edits                         | Undo is refused unless the kept record's revision is unchanged                                                                       | `services/merge-service.ts`                               |
| A name or note runs as a formula when the export is opened | Cells starting with `=`, `+`, `-`, `@`, tab or carriage return are prefixed with an apostrophe                                       | `domain/csv.ts`                                           |
| The export is downloaded by someone without the right      | Session, membership and role are checked before the first byte is written                                                            | `http/server.ts`, `services/export-service.ts`            |
| Search input changes the meaning of a query                | Bound parameters; `%`, `_` and `\` are escaped before use in `LIKE`                                                                  | `services/member-service.ts`                              |
| Password guessing                                          | scrypt hashes; eight attempts per minute for one address and email; equal response time for unknown emails                           | `domain/secrets.ts`, `services/auth-service.ts`           |
| Session theft through script                               | `HttpOnly` cookie; a Content-Security-Policy with no inline scripts                                                                  | `graphql/yoga.ts`, `http/server.ts`                       |
| Cross-site request forgery                                 | `SameSite=Lax` cookie, which browsers do not send on cross-site `POST`; mutations are refused over `GET`                             | `graphql/yoga.ts`                                         |
| A database copy is used to sign in                         | Only hashes of session tokens are stored                                                                                             | `domain/secrets.ts`                                       |
| Password hashes read through the tenant role               | Column-level grant: the tenant role can read a user's id, email and name only                                                        | `db/migrations.ts`                                        |
| Malformed or oversized input                               | Zod schemas at the service edge, with length limits; database check constraints behind them                                          | `services/validation.ts`                                  |
| Reading files outside the web folder                       | Paths are normalized and must stay under the web root                                                                                | `http/server.ts`                                          |
| Clickjacking, content sniffing, referrer leaks             | `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`                 | `http/server.ts`                                          |
| Internal details leak through errors                       | Only expected errors reach the client; everything else is logged and masked                                                          | `graphql/yoga.ts`                                         |

Nearly every control in this table has a test that fails if the control is removed;
[TESTING.md](TESTING.md) describes them. The ones that rest on review are bound
parameters and keeping personal details out of logs.

## How authorization is decided

1. The session cookie is hashed and looked up. No session means no user.
2. For anything inside a club, `requireScope` reads the user's membership. No
   membership: `NOT_FOUND`. It returns a `Scope` (workspace, user, role).
3. The service checks the role the action needs: reading for readers, changing and
   merging for volunteers, undoing merges and fixing stages for organizers.
4. The service opens a tenant transaction for that workspace. From here the database
   enforces the boundary, whatever the SQL says.

Steps 2 and 4 are independent. A bug in one is caught by the other.

## Personal data

A roster is personal data about people who did not sign up to this application. Two
design choices follow from that:

- **Logs carry ids and counts, never names, emails, phone numbers or notes.** The
  logger takes structured fields, and no service passes personal fields to it.
- **The export is the one place data leaves the system in bulk**, so it needs a
  volunteer role and is not available to readers.

What a real deployment would also need is listed below.

## Secrets and configuration

Record Merge needs no secret to run: session tokens are random and stored hashed, and
nothing is signed with a server key. `.env.example` therefore contains only settings.
The demo password in the README belongs to fictional seed accounts and is published
on purpose; a real deployment would set `SEED_DEMO=false`.

## What is not covered

- **Erasure and retention.** Nothing is ever deleted: merged records remain as
  signposts and journals keep old values. A real system would need a way to erase a
  person on request, including from journal snapshots.
- **An audit trail of who viewed what.** Unread markers record that a user opened a
  record, but they are a convenience, not an access log.
- **Account management.** No password change, reset, second factor or lock-out
  notice. Users and roles come from seed data.
- **Transport security.** The server speaks plain HTTP and expects TLS to be added
  in front of it. Cookies are marked `Secure` only when `PUBLIC_URL` starts with
  `https://`.
- **Shared rate limits.** Sign-in counters are in memory, per process.
- **Encryption at rest.** The database files are plain.
- **Dependency monitoring.** `npm audit` reported no known issues when this was
  written; nothing checks that continuously.

## Reporting a problem

This is a demo with no deployment. If you find a flaw, open an issue on the
repository.
