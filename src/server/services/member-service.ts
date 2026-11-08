import { STAGE_LABELS } from '../../shared/stage';
import type { Stage } from '../../shared/stage';
import type { Queryable } from '../db/database';
import { conflict, notFound } from '../domain/errors';
import { emailKey, phoneKey, plainName } from '../domain/matching';
import { decodeCursor, isUuid, toPage } from '../domain/pagination';
import type { Page, PageRequest } from '../domain/pagination';
import { assertRole } from './auth-service';
import type {
  ActivityRecord,
  Deps,
  MemberRecord,
  MemberRow,
  PaymentRecord,
  Scope,
  SignupRecord,
} from './records';
import { isoDay, toMember } from './records';
import { memberUpdateSchema, newMemberSchema, parseInput, stagePinSchema } from './validation';

/**
 * A roster row with the facts its stage is derived from. $1 is the asking user
 * (for "have they opened it?") and $2 is today's date. The CASE repeats the
 * rules of deriveStage in shared/stage.ts; a test asserts that both agree.
 */
export function memberQuery(where: string): string {
  return /* sql */ `
    select f.*,
           case when f.stage_pin is not null then f.stage_pin
                when f.dues_until >= $2 then 'MEMBER'
                when f.dues_until is not null then 'LAPSED'
                when f.trip_count > 0 then 'TRIAL'
                else 'ENQUIRY' end as stage
      from (
        select m.id, m.workspace_id, m.first_name, m.last_name, m.email, m.phone, m.notes,
               m.source, m.stage_pin, m.merged_into_id, m.revision, m.sort_name,
               m.created_at, m.updated_at,
               (select max(p.covers_until)::text from payments p where p.member_id = m.id)
                 as dues_until,
               (select count(*)::int from trip_signups s where s.member_id = m.id) as trip_count,
               exists (select 1 from member_reads r
                        where r.member_id = m.id and r.user_id = $1) as is_read
          from members m
         ${where}
      ) f`;
}

export type MemberSort = 'NEWEST' | 'NAME';

export interface MemberFilter {
  stage: Stage | null;
  search: string | null;
  sort: MemberSort;
}

const likePattern = (text: string): string => `%${text.replace(/[\\%_]/g, '\\$&')}%`;

/**
 * Turns a search into one pair of LIKE patterns per word. A word may match the
 * name (compared without accents, case or punctuation) or the email (compared
 * as typed, in lower case). Wildcard characters are escaped, so they only ever
 * match themselves.
 */
function searchPatterns(search: string | null): { name: string | null; email: string }[] {
  return (search ?? '')
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 5)
    .map((word) => {
      const plain = plainName(word);
      return { name: plain === '' ? null : likePattern(plain), email: likePattern(word) };
    });
}

/** Fetches up to `limit` roster rows after a cursor. Shared by the list and the export. */
export async function fetchMembers(
  q: Queryable,
  scope: Scope,
  today: string,
  filter: MemberFilter,
  after: string | null,
  limit: number,
): Promise<MemberRecord[]> {
  const params: unknown[] = [scope.userId, today, filter.stage];
  const conditions = ['($3::text is null or g.stage = $3)'];

  for (const pattern of searchPatterns(filter.search)) {
    params.push(pattern.name, pattern.email);
    const [name, email] = [`$${String(params.length - 1)}`, `$${String(params.length)}`];
    conditions.push(
      `(g.sort_name like ${name}::text escape '\\' or lower(coalesce(g.email, '')) like ${email} escape '\\')`,
    );
  }

  if (after !== null) {
    const cursor = decodeCursor(after);
    params.push(cursor.sortValue, cursor.id);
    const [value, id] = [`$${String(params.length - 1)}`, `$${String(params.length)}`];
    conditions.push(
      filter.sort === 'NAME'
        ? `(g.sort_name, g.id) > (${value}, ${id}::uuid)`
        : `(g.created_at, g.id) < (${value}::timestamptz, ${id}::uuid)`,
    );
  }

  params.push(limit);
  const order = filter.sort === 'NAME' ? 'g.sort_name, g.id' : 'g.created_at desc, g.id desc';
  const rows = await q.query<MemberRow>(
    `select g.* from (${memberQuery('where m.merged_into_id is null')}) g
      where ${conditions.join(' and ')}
      order by ${order}
      limit $${String(params.length)}`,
    params,
  );
  return rows.map(toMember);
}

export function cursorOf(member: MemberRecord, sort: MemberSort) {
  return {
    sortValue: sort === 'NAME' ? member.sortName : member.createdAt.toISOString(),
    id: member.id,
  };
}

export async function listMembers(
  deps: Deps,
  scope: Scope,
  page: PageRequest,
  filter: MemberFilter,
): Promise<Page<MemberRecord>> {
  const rows = await deps.db.tenant(scope.workspaceId, (q) =>
    fetchMembers(q, scope, isoDay(deps.now()), filter, page.after, page.first + 1),
  );
  return toPage(rows, page.first, (member) => cursorOf(member, filter.sort));
}

export interface StageCount {
  stage: Stage;
  total: number;
  unread: number;
}

/** How many people are in each stage, and how many of those the user has not opened. */
export async function stageCounts(deps: Deps, scope: Scope): Promise<StageCount[]> {
  const rows = await deps.db.tenant(scope.workspaceId, (q) =>
    q.query<StageCount>(
      `select g.stage, count(*)::int as total,
              (count(*) filter (where not g.is_read))::int as unread
         from (${memberQuery('where m.merged_into_id is null')}) g
        group by g.stage`,
      [scope.userId, isoDay(deps.now())],
    ),
  );
  const byStage = new Map(rows.map((row) => [row.stage, row]));
  return (Object.keys(STAGE_LABELS) as Stage[]).map(
    (stage) => byStage.get(stage) ?? { stage, total: 0, unread: 0 },
  );
}

export async function findMember(
  q: Queryable,
  scope: Scope,
  today: string,
  id: string,
): Promise<MemberRecord | null> {
  const rows = await q.query<MemberRow>(memberQuery('where m.id = $3'), [scope.userId, today, id]);
  return rows[0] ? toMember(rows[0]) : null;
}

export async function membersById(
  deps: Deps,
  scope: Scope,
  ids: readonly string[],
): Promise<Map<string, MemberRecord>> {
  const rows = await deps.db.tenant(scope.workspaceId, (q) =>
    q.query<MemberRow>(memberQuery('where m.id = any($3::uuid[])'), [
      scope.userId,
      isoDay(deps.now()),
      ids,
    ]),
  );
  return new Map(rows.map((row) => [row.id, toMember(row)]));
}

export interface ResolvedMember {
  member: MemberRecord;
  /** Set when the id asked for was merged away: the record that was asked for. */
  mergedFrom: MemberRecord | null;
}

const MAX_HOPS = 25;

/**
 * Finds a member by id. If that record was merged into another (possibly
 * several times over), follows the signposts to the record that exists now, so
 * an old link still leads to the right person.
 */
export async function getMember(deps: Deps, scope: Scope, id: string): Promise<ResolvedMember> {
  if (!isUuid(id)) throw notFound('Member');
  return deps.db.tenant(scope.workspaceId, async (q) => {
    const today = isoDay(deps.now());
    const asked = await findMember(q, scope, today, id);
    if (!asked) throw notFound('Member');

    let current = asked;
    for (let hop = 0; current.mergedIntoId !== null && hop < MAX_HOPS; hop += 1) {
      const next = await findMember(q, scope, today, current.mergedIntoId);
      if (!next) break;
      current = next;
    }
    return { member: current, mergedFrom: current.id === asked.id ? null : asked };
  });
}

/** The normalized columns that go with a set of member fields. */
export function derivedColumns(fields: {
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
}) {
  return {
    emailKey: emailKey(fields.email),
    phoneKey: phoneKey(fields.phone),
    sortName: plainName(`${fields.lastName} ${fields.firstName}`),
  };
}

export async function logActivity(
  q: Queryable,
  scope: Scope,
  memberId: string,
  kind: string,
  summary: string,
  occurredAt: Date,
): Promise<void> {
  await q.query(
    `insert into activity_events (workspace_id, member_id, kind, summary, actor_id, occurred_at)
     values ($1, $2, $3, $4, $5, $6)`,
    [scope.workspaceId, memberId, kind, summary, scope.userId, occurredAt],
  );
}

async function markReadIn(q: Queryable, scope: Scope, memberId: string, at: Date): Promise<void> {
  await q.query(
    `insert into member_reads (workspace_id, user_id, member_id, read_at)
     values ($1, $2, $3, $4)
     on conflict (user_id, member_id) do update set read_at = excluded.read_at`,
    [scope.workspaceId, scope.userId, memberId, at],
  );
}

export async function createMember(
  deps: Deps,
  scope: Scope,
  input: unknown,
): Promise<MemberRecord> {
  assertRole(scope, 'volunteer');
  const fields = parseInput(newMemberSchema, input);
  const derived = derivedColumns(fields);
  const now = deps.now();

  return deps.db.tenant(scope.workspaceId, async (q) => {
    const rows = await q.query<{ id: string }>(
      `insert into members (workspace_id, first_name, last_name, email, phone, notes, source,
                            email_key, phone_key, sort_name, created_at, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11)
       returning id`,
      [
        scope.workspaceId,
        fields.firstName,
        fields.lastName,
        fields.email,
        fields.phone,
        fields.notes,
        fields.source,
        derived.emailKey,
        derived.phoneKey,
        derived.sortName,
        now,
      ],
    );
    const id = rows[0]?.id ?? '';
    await logActivity(q, scope, id, 'created', 'Added to the roster', now);
    // The person who typed the record in has, by definition, seen it.
    await markReadIn(q, scope, id, now);
    const member = await findMember(q, scope, isoDay(now), id);
    if (!member) throw notFound('Member');
    return member;
  });
}

const FIELD_NAMES = {
  firstName: 'first name',
  lastName: 'last name',
  email: 'email',
  phone: 'phone',
  notes: 'notes',
} as const;

/**
 * Saves edits. The caller sends the revision it started from; if the record
 * changed in the meantime the save is refused, not silently merged over.
 */
export async function updateMember(
  deps: Deps,
  scope: Scope,
  id: string,
  input: unknown,
): Promise<MemberRecord> {
  assertRole(scope, 'volunteer');
  if (!isUuid(id)) throw notFound('Member');
  const fields = parseInput(memberUpdateSchema, input);
  const derived = derivedColumns(fields);
  const now = deps.now();

  return deps.db.tenant(scope.workspaceId, async (q) => {
    const before = await findMember(q, scope, isoDay(now), id);
    if (!before || before.mergedIntoId !== null) throw notFound('Member');

    const updated = await q.query(
      `update members
          set first_name = $1, last_name = $2, email = $3, phone = $4, notes = $5,
              email_key = $6, phone_key = $7, sort_name = $8,
              revision = revision + 1, updated_at = $9
        where id = $10 and revision = $11 and merged_into_id is null
        returning id`,
      [
        fields.firstName,
        fields.lastName,
        fields.email,
        fields.phone,
        fields.notes,
        derived.emailKey,
        derived.phoneKey,
        derived.sortName,
        now,
        id,
        fields.expectedRevision,
      ],
    );
    if (updated.length === 0) {
      throw conflict('Someone else changed this record. Reload to see their version.');
    }

    const changed = (Object.keys(FIELD_NAMES) as (keyof typeof FIELD_NAMES)[])
      .filter((key) => before[key] !== fields[key])
      .map((key) => FIELD_NAMES[key]);
    if (changed.length > 0) {
      await logActivity(q, scope, id, 'edited', `Changed ${changed.join(', ')}`, now);
    }
    const member = await findMember(q, scope, isoDay(now), id);
    if (!member) throw notFound('Member');
    return member;
  });
}

/** Pins a stage by hand, or removes the pin so the facts decide again. Organizers only. */
export async function setStagePin(
  deps: Deps,
  scope: Scope,
  id: string,
  input: unknown,
): Promise<MemberRecord> {
  assertRole(scope, 'organizer');
  if (!isUuid(id)) throw notFound('Member');
  const { pin } = parseInput(stagePinSchema, input);
  const now = deps.now();

  return deps.db.tenant(scope.workspaceId, async (q) => {
    const updated = await q.query(
      `update members set stage_pin = $1, revision = revision + 1, updated_at = $2
        where id = $3 and merged_into_id is null
        returning id`,
      [pin, now, id],
    );
    if (updated.length === 0) throw notFound('Member');
    await logActivity(
      q,
      scope,
      id,
      'stage',
      pin === null ? 'Removed the fixed stage' : `Fixed the stage as ${STAGE_LABELS[pin]}`,
      now,
    );
    const member = await findMember(q, scope, isoDay(now), id);
    if (!member) throw notFound('Member');
    return member;
  });
}

/** Records that the asking user has opened a record. Returns whether it was unread. */
export async function markRead(deps: Deps, scope: Scope, id: string): Promise<boolean> {
  if (!isUuid(id)) throw notFound('Member');
  const now = deps.now();
  return deps.db.tenant(scope.workspaceId, async (q) => {
    const member = await findMember(q, scope, isoDay(now), id);
    if (!member) throw notFound('Member');
    await markReadIn(q, scope, id, now);
    return !member.isRead;
  });
}

export async function listSignups(
  deps: Deps,
  scope: Scope,
  memberId: string,
): Promise<SignupRecord[]> {
  const rows = await deps.db.tenant(scope.workspaceId, (q) =>
    q.query<{ id: string; trip_id: string; title: string; happens_on: string; attended: boolean }>(
      `select s.id, s.trip_id, t.title, t.happens_on::text as happens_on, s.attended
         from trip_signups s join trips t on t.id = s.trip_id
        where s.member_id = $1
        order by t.happens_on desc, t.title`,
      [memberId],
    ),
  );
  return rows.map((row) => ({
    id: row.id,
    tripId: row.trip_id,
    tripTitle: row.title,
    happensOn: row.happens_on,
    attended: row.attended,
  }));
}

export async function listPayments(
  deps: Deps,
  scope: Scope,
  memberId: string,
): Promise<PaymentRecord[]> {
  const rows = await deps.db.tenant(scope.workspaceId, (q) =>
    q.query<{ id: string; amount_cents: number; paid_on: string; covers_until: string }>(
      `select id, amount_cents, paid_on::text as paid_on, covers_until::text as covers_until
         from payments where member_id = $1 order by paid_on desc, id`,
      [memberId],
    ),
  );
  return rows.map((row) => ({
    id: row.id,
    amountCents: row.amount_cents,
    paidOn: row.paid_on,
    coversUntil: row.covers_until,
  }));
}

export async function listActivity(
  deps: Deps,
  scope: Scope,
  memberId: string,
): Promise<ActivityRecord[]> {
  const rows = await deps.db.tenant(scope.workspaceId, (q) =>
    q.query<{
      id: number;
      kind: string;
      summary: string;
      actor_name: string | null;
      occurred_at: Date;
    }>(
      `select a.id, a.kind, a.summary, u.name as actor_name, a.occurred_at
         from activity_events a left join users u on u.id = a.actor_id
        where a.member_id = $1
        order by a.id desc
        limit 100`,
      [memberId],
    ),
  );
  return rows.map((row) => ({
    id: String(row.id),
    kind: row.kind,
    summary: row.summary,
    actorName: row.actor_name,
    occurredAt: row.occurred_at,
  }));
}
