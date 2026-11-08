import type { Queryable } from '../db/database';
import { conflict, invalid, notFound } from '../domain/errors';
import { isUuid } from '../domain/pagination';
import { assertRole } from './auth-service';
import { derivedColumns, findMember, logActivity } from './member-service';
import type { Deps, MemberRecord, Scope } from './records';
import { isoDay } from './records';
import { mergeSchema, parseInput } from './validation';

/**
 * Merging two records of the same person, and undoing it.
 *
 * A merge is destructive by nature: afterwards one record holds everything and
 * the other is only a signpost. So it is done in one transaction, and it writes
 * a journal entry that lists exactly what it changed. Undo replays that entry
 * backwards. Nothing is ever deleted that the journal cannot put back.
 */

interface MemberFields {
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  notes: string;
}

interface DroppedSignup {
  id: string;
  tripId: string;
  attended: boolean;
  createdAt: string;
}

/** What a merge changed, in enough detail to reverse every step. */
export interface MergeSnapshot {
  survivorBefore: MemberFields;
  absorbedName: string;
  /** Sign-ups moved from the absorbed record to the survivor. */
  movedSignupIds: string[];
  /** Sign-ups of the absorbed record for trips the survivor was already on. */
  droppedSignups: DroppedSignup[];
  /** Survivor sign-ups switched to "attended" because the absorbed one was. */
  raisedAttendanceIds: string[];
  movedPaymentIds: string[];
  movedActivityIds: string[];
}

export interface MergeRecord {
  id: string;
  survivorId: string;
  absorbedId: string;
  survivorName: string;
  absorbedName: string;
  mergedByName: string;
  mergedAt: Date;
  undoneAt: Date | null;
  canUndo: boolean;
  /** Why undo is not possible, in words, or null when it is. */
  undoBlockedBy: string | null;
}

export interface MergePreview {
  left: MemberRecord;
  right: MemberRecord;
  sharedTrips: number;
  leftOnlyTrips: number;
  rightOnlyTrips: number;
  leftPayments: number;
  rightPayments: number;
}

const fieldsOf = (member: MemberRecord): MemberFields => ({
  firstName: member.firstName,
  lastName: member.lastName,
  email: member.email,
  phone: member.phone,
  notes: member.notes,
});

const fullName = (fields: { firstName: string; lastName: string }): string =>
  `${fields.firstName} ${fields.lastName}`;

/** Locks both rows in id order, so two merges of the same pair cannot deadlock. */
async function lockPair(q: Queryable, ids: readonly string[]): Promise<void> {
  await q.query('select id from members where id = any($1::uuid[]) order by id for update', [ids]);
}

/** What merging two records would combine, for the comparison screen. */
export async function previewMerge(
  deps: Deps,
  scope: Scope,
  leftId: string,
  rightId: string,
): Promise<MergePreview> {
  if (!isUuid(leftId) || !isUuid(rightId)) throw notFound('Member');
  if (leftId === rightId) throw invalid('Choose two different records.');

  return deps.db.tenant(scope.workspaceId, async (q) => {
    const today = isoDay(deps.now());
    const left = await findMember(q, scope, today, leftId);
    const right = await findMember(q, scope, today, rightId);
    if (!left || !right) throw notFound('Member');
    if (left.mergedIntoId !== null || right.mergedIntoId !== null) {
      throw conflict('One of these records has already been merged.');
    }

    const counts = await q.query<{ shared: number; left_payments: number; right_payments: number }>(
      `select
         (select count(*)::int from trip_signups a join trip_signups b on b.trip_id = a.trip_id
           where a.member_id = $1 and b.member_id = $2) as shared,
         (select count(*)::int from payments where member_id = $1) as left_payments,
         (select count(*)::int from payments where member_id = $2) as right_payments`,
      [leftId, rightId],
    );
    const shared = counts[0]?.shared ?? 0;
    return {
      left,
      right,
      sharedTrips: shared,
      leftOnlyTrips: left.tripCount - shared,
      rightOnlyTrips: right.tripCount - shared,
      leftPayments: counts[0]?.left_payments ?? 0,
      rightPayments: counts[0]?.right_payments ?? 0,
    };
  });
}

export async function mergeMembers(
  deps: Deps,
  scope: Scope,
  input: unknown,
): Promise<{ mergeId: string; survivor: MemberRecord }> {
  assertRole(scope, 'volunteer');
  const choice = parseInput(mergeSchema, input);
  if (choice.survivorId === choice.absorbedId) throw invalid('Choose two different records.');
  const now = deps.now();
  const today = isoDay(now);

  return deps.db.tenant(scope.workspaceId, async (q) => {
    await lockPair(q, [choice.survivorId, choice.absorbedId]);
    const survivor = await findMember(q, scope, today, choice.survivorId);
    const absorbed = await findMember(q, scope, today, choice.absorbedId);
    if (!survivor || !absorbed) throw notFound('Member');
    if (survivor.mergedIntoId !== null || absorbed.mergedIntoId !== null) {
      throw conflict('One of these records has already been merged.');
    }
    if (
      survivor.revision !== choice.expectedSurvivorRevision ||
      absorbed.revision !== choice.expectedAbsorbedRevision
    ) {
      throw conflict(
        'One of these records changed while you were comparing. Reload and check again.',
      );
    }

    const pick = <Key extends 'firstName' | 'lastName' | 'email' | 'phone'>(
      key: Key,
    ): MemberRecord[Key] => (choice[key] === 'survivor' ? survivor[key] : absorbed[key]);
    const notes = {
      survivor: survivor.notes,
      absorbed: absorbed.notes,
      both: [survivor.notes, absorbed.notes].filter((text) => text !== '').join('\n\n'),
    }[choice.notes];
    const merged: MemberFields = {
      firstName: pick('firstName'),
      lastName: pick('lastName'),
      email: pick('email'),
      phone: pick('phone'),
      notes: notes.slice(0, 4000),
    };

    // Sign-ups. A person can be on a trip once, so where both records are on the
    // same trip the absorbed sign-up is dropped (and remembered), and "attended"
    // is kept if either record had it.
    const survivorSignups = await q.query<{ id: string; trip_id: string; attended: boolean }>(
      'select id, trip_id, attended from trip_signups where member_id = $1',
      [survivor.id],
    );
    const absorbedSignups = await q.query<{
      id: string;
      trip_id: string;
      attended: boolean;
      created_at: Date;
    }>('select id, trip_id, attended, created_at from trip_signups where member_id = $1', [
      absorbed.id,
    ]);
    const survivorByTrip = new Map(survivorSignups.map((row) => [row.trip_id, row]));
    const snapshot: MergeSnapshot = {
      survivorBefore: fieldsOf(survivor),
      absorbedName: fullName(absorbed),
      movedSignupIds: [],
      droppedSignups: [],
      raisedAttendanceIds: [],
      movedPaymentIds: [],
      movedActivityIds: [],
    };
    for (const signup of absorbedSignups) {
      const existing = survivorByTrip.get(signup.trip_id);
      if (!existing) {
        snapshot.movedSignupIds.push(signup.id);
        continue;
      }
      snapshot.droppedSignups.push({
        id: signup.id,
        tripId: signup.trip_id,
        attended: signup.attended,
        createdAt: signup.created_at.toISOString(),
      });
      if (signup.attended && !existing.attended) snapshot.raisedAttendanceIds.push(existing.id);
    }
    await q.query('delete from trip_signups where id = any($1::uuid[])', [
      snapshot.droppedSignups.map((signup) => signup.id),
    ]);
    await q.query('update trip_signups set member_id = $1 where id = any($2::uuid[])', [
      survivor.id,
      snapshot.movedSignupIds,
    ]);
    await q.query('update trip_signups set attended = true where id = any($1::uuid[])', [
      snapshot.raisedAttendanceIds,
    ]);

    const payments = await q.query<{ id: string }>(
      'update payments set member_id = $1 where member_id = $2 returning id',
      [survivor.id, absorbed.id],
    );
    snapshot.movedPaymentIds = payments.map((row) => row.id);
    const activity = await q.query<{ id: number }>(
      'update activity_events set member_id = $1 where member_id = $2 returning id',
      [survivor.id, absorbed.id],
    );
    snapshot.movedActivityIds = activity.map((row) => String(row.id));

    const derived = derivedColumns(merged);
    const updated = await q.query<{ revision: number }>(
      `update members
          set first_name = $1, last_name = $2, email = $3, phone = $4, notes = $5,
              email_key = $6, phone_key = $7, sort_name = $8,
              revision = revision + 1, updated_at = $9
        where id = $10
        returning revision`,
      [
        merged.firstName,
        merged.lastName,
        merged.email,
        merged.phone,
        merged.notes,
        derived.emailKey,
        derived.phoneKey,
        derived.sortName,
        now,
        survivor.id,
      ],
    );
    await q.query(
      'update members set merged_into_id = $1, revision = revision + 1, updated_at = $2 where id = $3',
      [survivor.id, now, absorbed.id],
    );

    const journal = await q.query<{ id: string }>(
      `insert into merges (workspace_id, survivor_id, absorbed_id, merged_by, merged_at,
                           survivor_revision, snapshot)
       values ($1, $2, $3, $4, $5, $6, $7::jsonb)
       returning id`,
      [
        scope.workspaceId,
        survivor.id,
        absorbed.id,
        scope.userId,
        now,
        updated[0]?.revision ?? 0,
        JSON.stringify(snapshot),
      ],
    );
    await logActivity(
      q,
      scope,
      survivor.id,
      'merged',
      `Merged with a second record of ${snapshot.absorbedName}`,
      now,
    );

    const result = await findMember(q, scope, today, survivor.id);
    if (!result) throw notFound('Member');
    return { mergeId: journal[0]?.id ?? '', survivor: result };
  });
}

interface MergeRow {
  id: string;
  survivor_id: string;
  absorbed_id: string;
  merged_at: Date;
  undone_at: Date | null;
  survivor_revision: number;
  snapshot: MergeSnapshot;
  merged_by_name: string;
  survivor_first: string;
  survivor_last: string;
  current_revision: number;
  survivor_merged_into: string | null;
}

/** Whether a merge can be undone now, and if not, why not. */
function undoBlock(row: {
  undone_at: Date | null;
  survivor_merged_into: string | null;
  current_revision: number;
  survivor_revision: number;
}): string | null {
  if (row.undone_at !== null) return 'This merge has already been undone.';
  if (row.survivor_merged_into !== null) {
    return 'The kept record has since been merged into another. Undo that merge first.';
  }
  if (row.current_revision !== row.survivor_revision) {
    return 'The kept record was changed after this merge, so it cannot be undone automatically.';
  }
  return null;
}

const MERGE_SELECT = /* sql */ `
  select g.id, g.survivor_id, g.absorbed_id, g.merged_at, g.undone_at, g.survivor_revision,
         g.snapshot, u.name as merged_by_name,
         s.first_name as survivor_first, s.last_name as survivor_last,
         s.revision as current_revision, s.merged_into_id as survivor_merged_into
    from merges g
    join members s on s.id = g.survivor_id
    join users u on u.id = g.merged_by`;

const toMergeRecord = (row: MergeRow): MergeRecord => {
  const blockedBy = undoBlock(row);
  return {
    id: row.id,
    survivorId: row.survivor_id,
    absorbedId: row.absorbed_id,
    survivorName: `${row.survivor_first} ${row.survivor_last}`,
    absorbedName: row.snapshot.absorbedName,
    mergedByName: row.merged_by_name,
    mergedAt: row.merged_at,
    undoneAt: row.undone_at,
    canUndo: blockedBy === null,
    undoBlockedBy: blockedBy,
  };
};

export async function listMerges(deps: Deps, scope: Scope): Promise<MergeRecord[]> {
  const rows = await deps.db.tenant(scope.workspaceId, (q) =>
    q.query<MergeRow>(`${MERGE_SELECT} order by g.merged_at desc, g.id limit 50`),
  );
  return rows.map(toMergeRecord);
}

/**
 * Reverses a merge exactly, using its journal entry. Organizers only.
 * Refused when the kept record has changed since, because then the journal no
 * longer describes the present and replaying it could lose those changes.
 */
export async function undoMerge(deps: Deps, scope: Scope, mergeId: string): Promise<MergeRecord> {
  assertRole(scope, 'organizer');
  if (!isUuid(mergeId)) throw notFound('Merge');
  const now = deps.now();

  return deps.db.tenant(scope.workspaceId, async (q) => {
    const locked = await q.query<{ survivor_id: string; absorbed_id: string }>(
      'select survivor_id, absorbed_id from merges where id = $1 for update',
      [mergeId],
    );
    const pair = locked[0];
    if (!pair) throw notFound('Merge');
    await lockPair(q, [pair.survivor_id, pair.absorbed_id]);

    const rows = await q.query<MergeRow>(`${MERGE_SELECT} where g.id = $1`, [mergeId]);
    const merge = rows[0];
    if (!merge) throw notFound('Merge');
    const blockedBy = undoBlock(merge);
    if (blockedBy !== null) throw conflict(blockedBy);

    const { snapshot } = merge;
    const before = snapshot.survivorBefore;
    const derived = derivedColumns(before);
    await q.query(
      `update members
          set first_name = $1, last_name = $2, email = $3, phone = $4, notes = $5,
              email_key = $6, phone_key = $7, sort_name = $8,
              revision = revision + 1, updated_at = $9
        where id = $10`,
      [
        before.firstName,
        before.lastName,
        before.email,
        before.phone,
        before.notes,
        derived.emailKey,
        derived.phoneKey,
        derived.sortName,
        now,
        merge.survivor_id,
      ],
    );
    await q.query(
      'update members set merged_into_id = null, revision = revision + 1, updated_at = $1 where id = $2',
      [now, merge.absorbed_id],
    );

    await q.query('update trip_signups set attended = false where id = any($1::uuid[])', [
      snapshot.raisedAttendanceIds,
    ]);
    await q.query('update trip_signups set member_id = $1 where id = any($2::uuid[])', [
      merge.absorbed_id,
      snapshot.movedSignupIds,
    ]);
    for (const signup of snapshot.droppedSignups) {
      await q.query(
        `insert into trip_signups (id, workspace_id, member_id, trip_id, attended, created_at)
         values ($1, $2, $3, $4, $5, $6)`,
        [
          signup.id,
          scope.workspaceId,
          merge.absorbed_id,
          signup.tripId,
          signup.attended,
          signup.createdAt,
        ],
      );
    }
    await q.query('update payments set member_id = $1 where id = any($2::uuid[])', [
      merge.absorbed_id,
      snapshot.movedPaymentIds,
    ]);
    await q.query('update activity_events set member_id = $1 where id = any($2::bigint[])', [
      merge.absorbed_id,
      snapshot.movedActivityIds,
    ]);

    await q.query('update merges set undone_at = $1, undone_by = $2 where id = $3', [
      now,
      scope.userId,
      mergeId,
    ]);
    const summary = `Undid the merge with a second record of ${snapshot.absorbedName}`;
    await logActivity(q, scope, merge.survivor_id, 'merge_undone', summary, now);
    await logActivity(
      q,
      scope,
      merge.absorbed_id,
      'merge_undone',
      'Restored by undoing a merge',
      now,
    );

    const after = await q.query<MergeRow>(`${MERGE_SELECT} where g.id = $1`, [mergeId]);
    if (!after[0]) throw notFound('Merge');
    return toMergeRecord(after[0]);
  });
}
