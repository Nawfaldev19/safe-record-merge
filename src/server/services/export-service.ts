import { STAGE_LABELS } from '../../shared/stage';
import { csvRow } from '../domain/csv';
import { assertRole } from './auth-service';
import { cursorOf, fetchMembers } from './member-service';
import type { MemberFilter } from './member-service';
import { encodeCursor } from '../domain/pagination';
import type { Deps, Scope } from './records';
import { isoDay } from './records';

const HEADER = [
  'Last name',
  'First name',
  'Email',
  'Phone',
  'Stage',
  'Dues paid until',
  'Trips',
  'Source',
  'Added on',
  'Notes',
];
const BATCH = 200;

/**
 * Writes the roster as CSV, a batch at a time, to whatever `write` is given.
 * Memory use stays flat however long the roster is: each batch is fetched by
 * keyset, written out, and dropped before the next is fetched.
 * Returns the number of people written.
 */
export async function exportMembersCsv(
  deps: Deps,
  scope: Scope,
  filter: Omit<MemberFilter, 'sort'>,
  write: (chunk: string) => void | Promise<void>,
): Promise<number> {
  assertRole(scope, 'volunteer');
  const sorted: MemberFilter = { ...filter, sort: 'NAME' };
  const today = isoDay(deps.now());
  await write(csvRow(HEADER));

  let after: string | null = null;
  let written = 0;
  for (;;) {
    const cursor: string | null = after;
    const batch = await deps.db.tenant(scope.workspaceId, (q) =>
      fetchMembers(q, scope, today, sorted, cursor, BATCH),
    );
    for (const member of batch) {
      await write(
        csvRow([
          member.lastName,
          member.firstName,
          member.email,
          member.phone,
          STAGE_LABELS[member.stage],
          member.duesPaidUntil,
          member.tripCount,
          member.source,
          isoDay(member.createdAt),
          member.notes,
        ]),
      );
    }
    written += batch.length;
    const last = batch.at(-1);
    if (batch.length < BATCH || !last) return written;
    after = encodeCursor(cursorOf(last, 'NAME'));
  }
}
