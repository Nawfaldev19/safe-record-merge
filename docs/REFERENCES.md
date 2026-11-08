# References

The specifications, documentation and books behind the patterns in this project.
Each entry says what it was used for.

## Record linkage and string matching

- **Ivan P. Fellegi and Alan B. Sunter, "A Theory for Record Linkage", Journal of
  the American Statistical Association, 1969.** The classic framing of deciding
  whether two records are the same entity by weighing agreement on separate fields.
  The additive scoring here is a hand-weighted relative of that idea, not an
  implementation of the paper's model.
- **Peter Christen, "Data Matching: Concepts and Techniques for Record Linkage,
  Entity Resolution, and Duplicate Detection", Springer, 2012.** Blocking, its effect
  on the number of comparisons, and the recall it costs.
- **Fred J. Damerau, "A Technique for Computer Detection and Correction of Spelling
  Errors", Communications of the ACM, 1964.** Counting a swap of two neighbouring
  letters as a single mistake.
- **Vladimir I. Levenshtein, "Binary codes capable of correcting deletions,
  insertions, and reversals", Soviet Physics Doklady, 1966.** Edit distance.
- **Unicode Standard Annex #15, Unicode Normalization Forms.**
  <https://unicode.org/reports/tr15/>. Decomposing accented letters before removing
  the marks.

## Specifications and standards

- **RFC 4180, Common Format and MIME Type for Comma-Separated Values (CSV) Files.**
  <https://www.rfc-editor.org/rfc/rfc4180>. Quoting and line endings of the export.
- **GraphQL Specification.** <https://spec.graphql.org/>. Type system, nullability
  and errors with `extensions`.
- **GraphQL Cursor Connections Specification.** <https://relay.dev/graphql/connections.htm>.
  The idea of opaque cursors. This project uses a simpler page shape and does not
  claim to implement the specification.
- **RFC 6265, HTTP State Management Mechanism.** <https://www.rfc-editor.org/rfc/rfc6265>.
  Cookie attributes used for the session.
- **RFC 7914, The scrypt Password-Based Key Derivation Function.**
  <https://www.rfc-editor.org/rfc/rfc7914>. Password hashing.
- **Web Content Accessibility Guidelines (WCAG) 2.2.** <https://www.w3.org/TR/WCAG22/>.
  Contrast thresholds and the luminance formula used in the design-token test.

## Database

- **PostgreSQL documentation, Row Security Policies.**
  <https://www.postgresql.org/docs/current/ddl-rowsecurity.html>. The tenancy model.
- **PostgreSQL documentation, Explicit Locking.**
  <https://www.postgresql.org/docs/current/explicit-locking.html>. Row-level locks
  with `FOR UPDATE`, and why locks are taken in a fixed order.
- **PostgreSQL documentation, Transaction Isolation.**
  <https://www.postgresql.org/docs/current/transaction-iso.html>.
- **PostgreSQL documentation, Pattern Matching.**
  <https://www.postgresql.org/docs/current/functions-matching.html>. `LIKE` with an
  escape character.
- **PostgreSQL documentation, Partial Indexes.**
  <https://www.postgresql.org/docs/current/indexes-partial.html>. Indexes that leave
  out merged records.
- **Markus Winand, "We need tool support for keyset pagination".**
  <https://use-the-index-luke.com/no-offset>. Paging of the roster and the export.

## Security guidance

- **OWASP, CSV Injection.** <https://owasp.org/www-community/attacks/CSV_Injection>.
  The formula prefixes the export defuses.
- **OWASP Cheat Sheet Series, Password Storage.**
  <https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html>.
- **OWASP Cheat Sheet Series, Session Management.**
  <https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html>.
- **MDN Web Docs, Content-Security-Policy.**
  <https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Security-Policy>.

## Ideas and books

- **Martin Kleppmann, "Designing Data-Intensive Applications", O'Reilly, 2017.**
  Transactions, lost updates, optimistic and pessimistic locking, and derived data.
- **Michael Nygard, "Documenting Architecture Decisions", 2011.** The format of
  `docs/DECISIONS.md`.

## Node.js and the browser platform

- **Node.js documentation, Stream: backpressuring in streams.**
  <https://nodejs.org/en/learn/modules/backpressuring-in-streams>. Waiting for
  `drain` while streaming the export.
- **MDN Web Docs, String.prototype.normalize().**
  <https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/normalize>.
- **MDN Web Docs, the dialog element.**
  <https://developer.mozilla.org/en-US/docs/Web/HTML/Element/dialog>.

## Libraries

- **PGlite.** <https://pglite.dev>
- **GraphQL Yoga.** <https://the-guild.dev/graphql/yoga-server>
- **Pothos.** <https://pothos-graphql.dev>
- **urql.** <https://github.com/urql-graphql/urql>
- **gql.tada.** <https://gql-tada.0no.co>
- **React.** <https://react.dev>
- **React Router.** <https://reactrouter.com>
- **Zod.** <https://zod.dev>
- **Vitest.** <https://vitest.dev>
- **Testing Library.** <https://testing-library.com>
- **Playwright.** <https://playwright.dev>

## Conventions

- **Conventional Commits.** <https://www.conventionalcommits.org>
- **Keep a Changelog.** <https://keepachangelog.com>
- **Semantic Versioning.** <https://semver.org>
