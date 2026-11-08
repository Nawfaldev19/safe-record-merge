import { invalid, notFound } from '../domain/errors';
import { findCandidates, pairId } from '../domain/matching';
import type { Matchable } from '../domain/matching';
import { isUuid } from '../domain/pagination';
import { assertRole } from './auth-service';
import { membersById } from './member-service';
import type { Deps, MemberRecord, Scope } from './records';

export interface DuplicatePair {
  /** "lowId:highId": stable for a pair whichever way round it is asked for. */
  id: string;
  score: number;
  reasons: string[];
  left: MemberRecord;
  right: MemberRecord;
}

export interface DuplicateReport {
  pairs: DuplicatePair[];
  /** How many active records were looked at, and how many pairs were scored. */
  membersChecked: number;
  comparisons: number;
}

const MAX_PAIRS = 50;

/**
 * Finds likely duplicates among the active records of a workspace. Only the
 * few columns needed for matching are loaded for everyone; full records are
 * then fetched for just the pairs that are shown.
 */
export async function listDuplicates(deps: Deps, scope: Scope): Promise<DuplicateReport> {
  const { members, dismissed } = await deps.db.tenant(scope.workspaceId, async (q) => ({
    members: await q.query<{
      id: string;
      first_name: string;
      last_name: string;
      email_key: string | null;
      phone_key: string | null;
    }>(
      'select id, first_name, last_name, email_key, phone_key from members where merged_into_id is null',
    ),
    dismissed: await q.query<{ low_id: string; high_id: string }>(
      'select low_id, high_id from duplicate_dismissals',
    ),
  }));

  const matchable: Matchable[] = members.map((row) => ({
    id: row.id,
    firstName: row.first_name,
    lastName: row.last_name,
    emailKey: row.email_key,
    phoneKey: row.phone_key,
  }));
  const search = findCandidates(matchable, {
    dismissed: new Set(dismissed.map((row) => `${row.low_id}:${row.high_id}`)),
  });

  const shown = search.pairs.slice(0, MAX_PAIRS);
  const records = await membersById(deps, scope, [
    ...new Set(shown.flatMap((pair) => [pair.lowId, pair.highId])),
  ]);
  const pairs = shown.flatMap((pair) => {
    const left = records.get(pair.lowId);
    const right = records.get(pair.highId);
    return left && right
      ? [
          {
            id: `${pair.lowId}:${pair.highId}`,
            score: pair.score,
            reasons: pair.reasons,
            left,
            right,
          },
        ]
      : [];
  });
  return { pairs, membersChecked: members.length, comparisons: search.comparisons };
}

/** Records that two records are different people, so the pair is not suggested again. */
export async function dismissDuplicate(
  deps: Deps,
  scope: Scope,
  firstId: string,
  secondId: string,
): Promise<boolean> {
  assertRole(scope, 'volunteer');
  if (!isUuid(firstId) || !isUuid(secondId)) throw notFound('Member');
  if (firstId === secondId) throw invalid('Choose two different records.');
  const { lowId, highId } = pairId(firstId, secondId);

  return deps.db.tenant(scope.workspaceId, async (q) => {
    const found = await q.query('select id from members where id = any($1::uuid[])', [
      [lowId, highId],
    ]);
    if (found.length !== 2) throw notFound('Member');
    await q.query(
      `insert into duplicate_dismissals (workspace_id, low_id, high_id, dismissed_by, dismissed_at)
       values ($1, $2, $3, $4, $5)
       on conflict (low_id, high_id) do nothing`,
      [scope.workspaceId, lowId, highId, scope.userId, deps.now()],
    );
    return true;
  });
}
