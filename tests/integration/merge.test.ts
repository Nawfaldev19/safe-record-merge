import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { dismissDuplicate, listDuplicates } from '../../src/server/services/duplicate-service';
import {
  getMember,
  listActivity,
  listPayments,
  listSignups,
  updateMember,
} from '../../src/server/services/member-service';
import {
  listMerges,
  mergeMembers,
  previewMerge,
  undoMerge,
} from '../../src/server/services/merge-service';
import type { MemberRecord, Scope } from '../../src/server/services/records';
import { addMember, addTrip, createHarness, pay, seedWorld, signUp } from '../helpers/harness';
import type { Harness, World } from '../helpers/harness';

const KEEP_ALL = {
  firstName: 'survivor',
  lastName: 'survivor',
  email: 'survivor',
  phone: 'survivor',
  notes: 'survivor',
} as const;

describe('duplicates, merging and undo', () => {
  let harness: Harness;
  let world: World;
  let scope: Scope;
  let trips: { ridge: string; coast: string; tarns: string };

  /** Two records of one person, with overlapping trips and a payment each side. */
  interface Pair {
    kept: MemberRecord;
    folded: MemberRecord;
    signups: { keptRidge: string; foldedRidge: string; foldedCoast: string; keptTarns: string };
  }
  let serial = 0;
  async function makePair(): Promise<Pair> {
    serial += 1;
    const email = `zoe${String(serial)}@example.com`;
    const kept = await addMember(harness.deps, scope, 'Zoë', `Brandt${String(serial)}`, {
      email,
      phone: '07700 900131',
      notes: 'Leads the evening walks.',
    });
    const folded = await addMember(harness.deps, scope, 'Zoe', `Brandt${String(serial)}`, {
      email: email.toUpperCase(),
      notes: 'Has a first aid certificate.',
    });
    const signups = {
      keptRidge: await signUp(harness.deps, scope, kept.id, trips.ridge, false),
      keptTarns: await signUp(harness.deps, scope, kept.id, trips.tarns, true),
      foldedRidge: await signUp(harness.deps, scope, folded.id, trips.ridge, true),
      foldedCoast: await signUp(harness.deps, scope, folded.id, trips.coast, true),
    };
    await pay(harness.deps, scope, kept.id, '2024-03-01', '2025-02-28');
    await pay(harness.deps, scope, folded.id, '2025-03-01', '2026-02-28');
    return { kept, folded, signups };
  }

  const merge = (
    pair: Pair,
    choices: Partial<Record<keyof typeof KEEP_ALL, string>> = {},
    as = scope,
  ) =>
    mergeMembers(harness.deps, as, {
      survivorId: pair.kept.id,
      absorbedId: pair.folded.id,
      expectedSurvivorRevision: pair.kept.revision,
      expectedAbsorbedRevision: pair.folded.revision,
      ...KEEP_ALL,
      ...choices,
    });

  const signupsOf = async (id: string) =>
    (await listSignups(harness.deps, scope, id))
      .map((signup) => `${signup.tripTitle}:${signup.attended ? 'attended' : 'signed up'}`)
      .sort();

  /** Everything about a member that a merge may touch, for before-and-after comparison. */
  async function stateOf(id: string) {
    const rows = await harness.deps.db.admin.query<Record<string, unknown>>(
      `select first_name, last_name, email, phone, notes, email_key, phone_key, sort_name,
              merged_into_id from members where id = $1`,
      [id],
    );
    const signups = await harness.deps.db.admin.query(
      'select id, trip_id, attended, created_at from trip_signups where member_id = $1 order by id',
      [id],
    );
    const payments = await harness.deps.db.admin.query(
      'select id from payments where member_id = $1 order by id',
      [id],
    );
    return { fields: rows[0], signups, payments };
  }

  beforeAll(async () => {
    harness = await createHarness();
    world = await seedWorld(harness.deps);
    scope = world.alpha.volunteer;
    trips = {
      ridge: await addTrip(harness.deps, scope, 'Ridge walk', '2025-05-01'),
      coast: await addTrip(harness.deps, scope, 'Coast path', '2025-04-01'),
      tarns: await addTrip(harness.deps, scope, 'Three tarns', '2025-03-01'),
    };
  });

  beforeEach(() => {
    harness.advance(60_000);
  });

  afterAll(async () => {
    await harness.close();
  });

  describe('finding duplicates', () => {
    it('suggests a pair with its score and reasons, and offers both records', async () => {
      const pair = await makePair();
      const report = await listDuplicates(harness.deps, world.alpha.reader);
      const found = report.pairs.find((item) => item.id.includes(pair.kept.id));

      expect(found).toMatchObject({ score: 1, reasons: ['Same email address', 'Same name'] });
      expect([found?.left.id, found?.right.id].sort()).toEqual(
        [pair.kept.id, pair.folded.id].sort(),
      );
      expect(report.membersChecked).toBeGreaterThanOrEqual(2);
      expect(report.comparisons).toBeGreaterThanOrEqual(1);
    });

    it('stops suggesting a pair that was marked as two different people', async () => {
      const anna = await addMember(harness.deps, scope, 'Anna', 'Lindgren', {
        phone: '07700 900140',
      });
      const anne = await addMember(harness.deps, scope, 'Anne', 'Lindgren', {
        phone: '07700 900140',
      });
      const suggested = async () =>
        (await listDuplicates(harness.deps, scope)).pairs.some((pair) => pair.id.includes(anna.id));

      expect(await suggested()).toBe(true);
      expect(await dismissDuplicate(harness.deps, scope, anne.id, anna.id)).toBe(true);
      expect(await suggested()).toBe(false);
      // Dismissing twice, either way round, is harmless.
      expect(await dismissDuplicate(harness.deps, scope, anna.id, anne.id)).toBe(true);
    });

    it('is not open to readers, and needs two different, existing records', async () => {
      const pair = await makePair();
      await expect(
        dismissDuplicate(harness.deps, world.alpha.reader, pair.kept.id, pair.folded.id),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(
        dismissDuplicate(harness.deps, scope, pair.kept.id, pair.kept.id),
      ).rejects.toMatchObject({ code: 'VALIDATION' });
      await expect(
        dismissDuplicate(harness.deps, scope, pair.kept.id, '00000000-0000-4000-8000-000000000000'),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });

  describe('previewing a merge', () => {
    it('counts what would be combined', async () => {
      const pair = await makePair();
      expect(await previewMerge(harness.deps, scope, pair.kept.id, pair.folded.id)).toMatchObject({
        sharedTrips: 1,
        leftOnlyTrips: 1,
        rightOnlyTrips: 1,
        leftPayments: 1,
        rightPayments: 1,
      });
    });
  });

  describe('merging', () => {
    it('keeps the chosen value for each field, and can join the notes', async () => {
      const pair = await makePair();
      const { survivor } = await merge(pair, {
        firstName: 'absorbed',
        email: 'absorbed',
        notes: 'both',
      });

      expect(survivor).toMatchObject({
        id: pair.kept.id,
        firstName: 'Zoe',
        lastName: pair.kept.lastName,
        email: pair.folded.email,
        phone: '07700 900131',
        notes: 'Leads the evening walks.\n\nHas a first aid certificate.',
        revision: 2,
        mergedIntoId: null,
      });
    });

    it('unions the trips without doubling one, and keeps "attended" from either side', async () => {
      const pair = await makePair();
      await merge(pair);
      expect(await signupsOf(pair.kept.id)).toEqual([
        'Coast path:attended',
        'Ridge walk:attended',
        'Three tarns:attended',
      ]);
      expect(await signupsOf(pair.folded.id)).toEqual([]);
    });

    it('moves payments and history, so the stage reflects both records', async () => {
      const pair = await makePair();
      expect((await getMember(harness.deps, scope, pair.kept.id)).member.stage).toBe('LAPSED');

      const { survivor } = await merge(pair);
      expect(survivor).toMatchObject({
        stage: 'MEMBER',
        duesPaidUntil: '2026-02-28',
        tripCount: 3,
      });
      expect(await listPayments(harness.deps, scope, pair.kept.id)).toHaveLength(2);

      const activity = await listActivity(harness.deps, scope, pair.kept.id);
      expect(activity[0]?.summary).toBe(
        `Merged with a second record of Zoe ${pair.folded.lastName}`,
      );
      expect(activity.filter((event) => event.kind === 'created')).toHaveLength(2);
    });

    it('leaves a signpost: the old id now leads to the kept record', async () => {
      const pair = await makePair();
      await merge(pair);
      const found = await getMember(harness.deps, world.alpha.reader, pair.folded.id);
      expect(found.member.id).toBe(pair.kept.id);
      expect(found.mergedFrom?.id).toBe(pair.folded.id);
    });

    it('follows a chain of merges to the end', async () => {
      const first = await makePair();
      await merge(first);
      const third = await addMember(harness.deps, scope, 'Zoe', 'Brandt-Final');
      const kept = (await getMember(harness.deps, scope, first.kept.id)).member;
      await mergeMembers(harness.deps, scope, {
        survivorId: third.id,
        absorbedId: kept.id,
        expectedSurvivorRevision: third.revision,
        expectedAbsorbedRevision: kept.revision,
        ...KEEP_ALL,
      });

      const found = await getMember(harness.deps, scope, first.folded.id);
      expect(found.member.id).toBe(third.id);
      expect(found.member.tripCount).toBe(3);
    });

    it('takes merged records out of the roster and out of the duplicate list', async () => {
      const pair = await makePair();
      await merge(pair);
      const report = await listDuplicates(harness.deps, scope);
      expect(report.pairs.some((item) => item.id.includes(pair.folded.id))).toBe(false);

      const active = await harness.deps.db.admin.query(
        'select id from members where id = $1 and merged_into_id is null',
        [pair.folded.id],
      );
      expect(active).toEqual([]);
    });

    it('refuses a record that changed while it was being compared', async () => {
      const pair = await makePair();
      await updateMember(harness.deps, scope, pair.folded.id, {
        firstName: 'Zoe',
        lastName: pair.folded.lastName,
        email: pair.folded.email,
        notes: 'Edited meanwhile',
        expectedRevision: 1,
      });
      await expect(merge(pair)).rejects.toMatchObject({ code: 'CONFLICT' });
      expect((await stateOf(pair.folded.id)).fields?.merged_into_id).toBeNull();
    });

    it('refuses to merge a record with itself, twice, or by a reader', async () => {
      const pair = await makePair();
      await expect(merge({ ...pair, folded: pair.kept })).rejects.toMatchObject({
        code: 'VALIDATION',
      });
      await expect(merge(pair, {}, world.alpha.reader)).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });

      await merge(pair);
      await expect(merge(pair)).rejects.toMatchObject({
        code: 'CONFLICT',
        message: 'One of these records has already been merged.',
      });
    });

    it('lets exactly one of two simultaneous merges of the same pair win', async () => {
      const pair = await makePair();
      const results = await Promise.allSettled([
        merge(pair),
        mergeMembers(harness.deps, scope, {
          survivorId: pair.folded.id,
          absorbedId: pair.kept.id,
          expectedSurvivorRevision: 1,
          expectedAbsorbedRevision: 1,
          ...KEEP_ALL,
        }),
      ]);
      expect(results.map((result) => result.status).sort()).toEqual(['fulfilled', 'rejected']);

      const journal = await harness.deps.db.admin.query(
        'select id from merges where survivor_id = any($1::uuid[])',
        [[pair.kept.id, pair.folded.id]],
      );
      expect(journal).toHaveLength(1);
    });

    it('changes nothing at all when it fails part-way', async () => {
      const pair = await makePair();
      const before = [await stateOf(pair.kept.id), await stateOf(pair.folded.id)];
      // Make the very last step, writing the journal entry, fail. By then the
      // sign-ups, payments and both records have already been changed.
      const admin = harness.deps.db.admin;
      await admin.query(
        'alter table merges add constraint test_only_block check (false) not valid',
      );

      await expect(merge(pair, { firstName: 'absorbed', notes: 'both' })).rejects.toThrow(
        /test_only_block/,
      );
      expect([await stateOf(pair.kept.id), await stateOf(pair.folded.id)]).toEqual(before);

      await admin.query('alter table merges drop constraint test_only_block');
      await expect(merge(pair)).resolves.toMatchObject({ survivor: { id: pair.kept.id } });
    });
  });

  describe('undoing a merge', () => {
    it('puts both records back exactly as they were', async () => {
      const pair = await makePair();
      const before = { kept: await stateOf(pair.kept.id), folded: await stateOf(pair.folded.id) };
      const { mergeId } = await merge(pair, {
        firstName: 'absorbed',
        email: 'absorbed',
        notes: 'both',
      });
      expect(await stateOf(pair.kept.id)).not.toEqual(before.kept);

      const undone = await undoMerge(harness.deps, world.alpha.organizer, mergeId);
      expect(undone).toMatchObject({
        canUndo: false,
        undoBlockedBy: 'This merge has already been undone.',
      });
      expect(undone.undoneAt).toEqual(harness.deps.now());

      expect(await stateOf(pair.kept.id)).toEqual(before.kept);
      expect(await stateOf(pair.folded.id)).toEqual(before.folded);
      expect(await signupsOf(pair.kept.id)).toEqual([
        'Ridge walk:signed up',
        'Three tarns:attended',
      ]);
      expect(await signupsOf(pair.folded.id)).toEqual([
        'Coast path:attended',
        'Ridge walk:attended',
      ]);
    });

    it('makes the pair a suggested duplicate again, and both records findable', async () => {
      const pair = await makePair();
      const { mergeId } = await merge(pair);
      await undoMerge(harness.deps, world.alpha.organizer, mergeId);

      const report = await listDuplicates(harness.deps, scope);
      expect(report.pairs.some((item) => item.id.includes(pair.folded.id))).toBe(true);
      const found = await getMember(harness.deps, scope, pair.folded.id);
      expect(found).toMatchObject({ member: { id: pair.folded.id }, mergedFrom: null });
    });

    it('records the undo in both histories, keeping the earlier entries', async () => {
      const pair = await makePair();
      const { mergeId } = await merge(pair);
      await undoMerge(harness.deps, world.alpha.organizer, mergeId);

      const kinds = async (id: string) =>
        (await listActivity(harness.deps, scope, id)).map((event) => event.kind);
      expect(await kinds(pair.kept.id)).toEqual(['merge_undone', 'merged', 'created']);
      expect(await kinds(pair.folded.id)).toEqual(['merge_undone', 'created']);
    });

    it('is for organizers only, and only once', async () => {
      const pair = await makePair();
      const { mergeId } = await merge(pair);
      await expect(undoMerge(harness.deps, scope, mergeId)).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
      await undoMerge(harness.deps, world.alpha.organizer, mergeId);
      await expect(undoMerge(harness.deps, world.alpha.organizer, mergeId)).rejects.toMatchObject({
        code: 'CONFLICT',
        message: 'This merge has already been undone.',
      });
    });

    it('is refused once the kept record has been edited, and says why', async () => {
      const pair = await makePair();
      const { mergeId, survivor } = await merge(pair);
      await updateMember(harness.deps, scope, survivor.id, {
        firstName: survivor.firstName,
        lastName: survivor.lastName,
        email: survivor.email,
        phone: '07700 900999',
        notes: survivor.notes,
        expectedRevision: survivor.revision,
      });

      await expect(undoMerge(harness.deps, world.alpha.organizer, mergeId)).rejects.toMatchObject({
        code: 'CONFLICT',
        message:
          'The kept record was changed after this merge, so it cannot be undone automatically.',
      });
      expect((await getMember(harness.deps, scope, pair.kept.id)).member.phone).toBe(
        '07700 900999',
      );
    });

    it('must happen in reverse order when merges were stacked', async () => {
      const pair = await makePair();
      const first = await merge(pair);
      const third = await addMember(harness.deps, scope, 'Zo', pair.kept.lastName);
      const second = await mergeMembers(harness.deps, scope, {
        survivorId: pair.kept.id,
        absorbedId: third.id,
        expectedSurvivorRevision: first.survivor.revision,
        expectedAbsorbedRevision: 1,
        ...KEEP_ALL,
      });

      await expect(
        undoMerge(harness.deps, world.alpha.organizer, first.mergeId),
      ).rejects.toMatchObject({
        code: 'CONFLICT',
      });
      await undoMerge(harness.deps, world.alpha.organizer, second.mergeId);
      // Undoing the second merge was itself a change to the kept record, so the
      // first can no longer be replayed blindly. That is the safe answer.
      await expect(
        undoMerge(harness.deps, world.alpha.organizer, first.mergeId),
      ).rejects.toMatchObject({
        code: 'CONFLICT',
      });
    });

    it('is refused while the kept record is itself merged into another', async () => {
      const pair = await makePair();
      const first = await merge(pair);
      const other = await addMember(harness.deps, scope, 'Zoe', 'Elsewhere');
      await mergeMembers(harness.deps, scope, {
        survivorId: other.id,
        absorbedId: pair.kept.id,
        expectedSurvivorRevision: 1,
        expectedAbsorbedRevision: first.survivor.revision,
        ...KEEP_ALL,
      });
      await expect(
        undoMerge(harness.deps, world.alpha.organizer, first.mergeId),
      ).rejects.toMatchObject({
        code: 'CONFLICT',
        message: 'The kept record has since been merged into another. Undo that merge first.',
      });
    });

    it('answers not found for an unknown merge', async () => {
      await expect(
        undoMerge(harness.deps, world.alpha.organizer, '00000000-0000-4000-8000-000000000000'),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(undoMerge(harness.deps, world.alpha.organizer, 'nope')).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    });
  });

  describe('the merge history', () => {
    it('lists merges newest first, with who did them and whether undo is possible', async () => {
      const pair = await makePair();
      const { mergeId } = await merge(pair);
      const [latest] = await listMerges(harness.deps, world.alpha.reader);
      expect(latest).toMatchObject({
        id: mergeId,
        survivorId: pair.kept.id,
        absorbedId: pair.folded.id,
        survivorName: `Zoë ${pair.kept.lastName}`,
        absorbedName: `Zoe ${pair.folded.lastName}`,
        mergedByName: 'volunteer',
        canUndo: true,
        undoBlockedBy: null,
        undoneAt: null,
      });
    });

    it('works through the API, including the reason undo is blocked', async () => {
      const pair = await makePair();
      const cookie = await harness.signIn('organizer@alpha.example');
      const merged = await harness.gql<{
        mergeMembers: { mergeId: string; survivor: { tripCount: number } };
      }>(
        `mutation ($ws: ID!, $input: MergeInput!) {
          mergeMembers(workspaceId: $ws, input: $input) { mergeId survivor { tripCount stage } }
        }`,
        {
          ws: world.alpha.id,
          input: {
            survivorId: pair.kept.id,
            absorbedId: pair.folded.id,
            expectedSurvivorRevision: 1,
            expectedAbsorbedRevision: 1,
            firstName: 'SURVIVOR',
            lastName: 'SURVIVOR',
            email: 'ABSORBED',
            phone: 'SURVIVOR',
            notes: 'BOTH',
          },
        },
        cookie,
      );
      expect(merged.errors).toEqual([]);
      expect(merged.data?.mergeMembers.survivor.tripCount).toBe(3);

      const undo = `mutation ($ws: ID!, $id: ID!) {
        undoMerge(workspaceId: $ws, mergeId: $id) { canUndo undoBlockedBy undoneAt }
      }`;
      const variables = { ws: world.alpha.id, id: merged.data?.mergeMembers.mergeId };
      const first = await harness.gql<{ undoMerge: { canUndo: boolean; undoBlockedBy: string } }>(
        undo,
        variables,
        cookie,
      );
      expect(first.data?.undoMerge).toMatchObject({
        canUndo: false,
        undoBlockedBy: 'This merge has already been undone.',
      });
      const second = await harness.gql(undo, variables, cookie);
      expect(second.errors[0]?.extensions?.code).toBe('CONFLICT');
    });
  });
});
