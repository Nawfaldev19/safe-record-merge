import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { normalizePageRequest } from '../../src/server/domain/pagination';
import {
  createMember,
  getMember,
  listActivity,
  listMembers,
  markRead,
  setStagePin,
  stageCounts,
  updateMember,
} from '../../src/server/services/member-service';
import type { MemberFilter } from '../../src/server/services/member-service';
import type { MemberRecord } from '../../src/server/services/records';
import { STAGES, deriveStage } from '../../src/shared/stage';
import { addMember, addTrip, createHarness, pay, seedWorld, signUp } from '../helpers/harness';
import type { Harness, World } from '../helpers/harness';

const ALL: MemberFilter = { stage: null, search: null, sort: 'NAME' };

describe('the roster', () => {
  let harness: Harness;
  let world: World;
  const people: Record<string, MemberRecord> = {};

  const list = (filter: Partial<MemberFilter> = {}, first = 50, after: string | null = null) =>
    listMembers(harness.deps, world.alpha.organizer, normalizePageRequest(first, after), {
      ...ALL,
      ...filter,
    });
  const names = async (filter: Partial<MemberFilter> = {}) =>
    (await list(filter)).items.map((member) => `${member.firstName} ${member.lastName}`);

  beforeAll(async () => {
    harness = await createHarness();
    world = await seedWorld(harness.deps);
    const scope = world.alpha.volunteer;
    const trip = await addTrip(harness.deps, scope, 'Ridge walk', '2025-05-01');

    // One person per stage. Today is 2025-06-02.
    for (const [key, first, last, email] of [
      ['enquiry', 'Esme', 'Hartley', 'esme@example.com'],
      ['trial', 'Dmitri', 'Volkov', 'dmitri@example.com'],
      ['member', 'Ada', 'Fenwick', 'ada@example.com'],
      ['lapsed', 'Bao', 'Tran', 'bao@example.com'],
      ['accent', 'Zoë', 'Åkesson', 'zoe@example.com'],
    ] as const) {
      harness.advance(1000);
      people[key] = await addMember(harness.deps, scope, first, last, { email });
    }
    const id = (key: string): string => people[key]?.id ?? '';
    await signUp(harness.deps, scope, id('trial'), trip, true);
    await signUp(harness.deps, scope, id('member'), trip, true);
    await pay(harness.deps, scope, id('member'), '2025-01-10', '2026-01-09');
    await pay(harness.deps, scope, id('lapsed'), '2024-01-10', '2025-01-09');
    await pay(harness.deps, scope, id('lapsed'), '2023-01-10', '2024-01-09');
  });

  afterAll(async () => {
    await harness.close();
  });

  describe('stages', () => {
    it('derives each stage from dues and trips', async () => {
      const stages = Object.fromEntries(
        (await list()).items.map((member) => [member.firstName, member.stage]),
      );
      expect(stages).toEqual({
        Esme: 'ENQUIRY',
        Dmitri: 'TRIAL',
        Ada: 'MEMBER',
        Bao: 'LAPSED',
        Zoë: 'ENQUIRY',
      });
    });

    it('gives the same answer in SQL as the shared function, for every person', async () => {
      for (const member of (await list()).items) {
        expect(member.stage, member.firstName).toBe(
          deriveStage(
            {
              pin: member.stagePin,
              duesPaidUntil: member.duesPaidUntil,
              tripCount: member.tripCount,
            },
            '2025-06-02',
          ),
        );
      }
    });

    it('uses the latest payment, and changes on the day dues run out', async () => {
      const bao = (await list({ search: 'bao' })).items[0];
      expect(bao?.duesPaidUntil).toBe('2025-01-09');

      const start = harness.deps.now();
      harness.setNow(new Date('2026-01-09T12:00:00Z'));
      expect((await list({ search: 'ada' })).items[0]?.stage).toBe('MEMBER');
      harness.setNow(new Date('2026-01-10T00:00:00Z'));
      expect((await list({ search: 'ada' })).items[0]?.stage).toBe('LAPSED');
      harness.setNow(start);
    });

    it('filters by stage', async () => {
      expect(await names({ stage: 'MEMBER' })).toEqual(['Ada Fenwick']);
      expect(await names({ stage: 'ENQUIRY' })).toEqual(['Zoë Åkesson', 'Esme Hartley']);
      expect(await names({ stage: 'LAPSED' })).toEqual(['Bao Tran']);
    });

    it('lets an organizer fix a stage by hand, and remove the fix', async () => {
      const id = people.enquiry?.id ?? '';
      const pinned = await setStagePin(harness.deps, world.alpha.organizer, id, { pin: 'MEMBER' });
      expect(pinned).toMatchObject({ stage: 'MEMBER', stagePin: 'MEMBER', revision: 2 });
      expect(await names({ stage: 'MEMBER' })).toEqual(['Ada Fenwick', 'Esme Hartley']);

      const freed = await setStagePin(harness.deps, world.alpha.organizer, id, { pin: null });
      expect(freed).toMatchObject({ stage: 'ENQUIRY', stagePin: null });

      await expect(
        setStagePin(harness.deps, world.alpha.volunteer, id, { pin: 'MEMBER' }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(
        setStagePin(harness.deps, world.alpha.organizer, id, { pin: 'CHAMPION' }),
      ).rejects.toMatchObject({ code: 'VALIDATION' });
    });

    it('counts people and unread records per stage', async () => {
      const counts = await stageCounts(harness.deps, world.alpha.reader);
      expect(counts.map((count) => count.stage)).toEqual([...STAGES]);
      expect(
        Object.fromEntries(counts.map((count) => [count.stage, [count.total, count.unread]])),
      ).toEqual({
        ENQUIRY: [2, 2],
        TRIAL: [1, 1],
        MEMBER: [1, 1],
        LAPSED: [1, 1],
      });
    });
  });

  describe('searching, sorting and paging', () => {
    it('sorts by name without regard to accents or case, or by newest first', async () => {
      expect(await names()).toEqual([
        'Zoë Åkesson',
        'Ada Fenwick',
        'Esme Hartley',
        'Bao Tran',
        'Dmitri Volkov',
      ]);
      expect(await names({ sort: 'NEWEST' })).toEqual([
        'Zoë Åkesson',
        'Bao Tran',
        'Ada Fenwick',
        'Dmitri Volkov',
        'Esme Hartley',
      ]);
    });

    it('finds people by any part of the name or email, ignoring accents', async () => {
      expect(await names({ search: 'zoe' })).toEqual(['Zoë Åkesson']);
      expect(await names({ search: 'AKESSON' })).toEqual(['Zoë Åkesson']);
      expect(await names({ search: 'volkov dmitri' })).toEqual(['Dmitri Volkov']);
      expect(await names({ search: 'esme@example' })).toEqual(['Esme Hartley']);
      expect(await names({ search: 'nobody' })).toEqual([]);
      expect(await names({ search: '   ' })).toHaveLength(5);
    });

    it('treats search wildcards as plain text', async () => {
      expect(await names({ search: '%' })).toEqual([]);
      // If "_" were a wildcard, this would match "zoe".
      expect(await names({ search: 'z_e' })).toEqual([]);
    });

    it.each(['NAME', 'NEWEST'] as const)('pages by %s without gaps or repeats', async (sort) => {
      const whole = await names({ sort });
      const seen: string[] = [];
      let after: string | null = null;
      for (let guard = 0; guard < 5; guard += 1) {
        const page = await list({ sort }, 2, after);
        seen.push(...page.items.map((member) => `${member.firstName} ${member.lastName}`));
        if (!page.hasNextPage) break;
        after = page.endCursor;
      }
      expect(seen).toEqual(whole);
    });

    it('combines a stage filter, a search and paging', async () => {
      const page = await list({ stage: 'ENQUIRY', search: 'e' }, 1);
      expect(page.items.map((member) => member.firstName)).toEqual(['Zoë']);
      expect(page.hasNextPage).toBe(true);
    });
  });

  describe('unread markers', () => {
    it('are per user: opening a record marks it read for that user only', async () => {
      const id = people.trial?.id ?? '';
      expect(await markRead(harness.deps, world.alpha.reader, id)).toBe(true);
      expect(await markRead(harness.deps, world.alpha.reader, id)).toBe(false);

      const forReader = (await getMember(harness.deps, world.alpha.reader, id)).member;
      const forOrganizer = (await getMember(harness.deps, world.alpha.organizer, id)).member;
      expect(forReader.isRead).toBe(true);
      expect(forOrganizer.isRead).toBe(false);
    });

    it('start as read for the person who typed the record in', async () => {
      const fresh = await addMember(harness.deps, world.alpha.volunteer, 'Nils', 'Aaltonen');
      expect(fresh.isRead).toBe(true);
      expect((await getMember(harness.deps, world.alpha.organizer, fresh.id)).member.isRead).toBe(
        false,
      );
    });
  });

  describe('adding and editing', () => {
    it('validates input and reports each problem with its field', async () => {
      await expect(
        createMember(harness.deps, world.alpha.volunteer, {
          firstName: ' ',
          lastName: 'X',
          email: 'nope',
        }),
      ).rejects.toMatchObject({
        code: 'VALIDATION',
        issues: [
          { field: 'firstName', message: 'is needed' },
          { field: 'email', message: 'is not an email address' },
        ],
      });
    });

    it('saves edits, bumps the revision and records what changed', async () => {
      const before = await addMember(harness.deps, world.alpha.volunteer, 'Greta', 'Lindqvist', {
        email: 'greta@example.com',
      });
      const after = await updateMember(harness.deps, world.alpha.volunteer, before.id, {
        firstName: 'Greta',
        lastName: 'Lindqvist-Holm',
        email: 'greta@example.com',
        phone: '07700 900107',
        notes: 'Prefers shorter walks.',
        expectedRevision: 1,
      });
      expect(after).toMatchObject({
        lastName: 'Lindqvist-Holm',
        phone: '07700 900107',
        revision: 2,
      });

      const activity = await listActivity(harness.deps, world.alpha.reader, before.id);
      expect(activity.map((event) => [event.kind, event.summary, event.actorName])).toEqual([
        ['edited', 'Changed last name, phone, notes', 'volunteer'],
        ['created', 'Added to the roster', 'volunteer'],
      ]);
      expect(await names({ search: 'lindqvist holm' })).toEqual(['Greta Lindqvist-Holm']);
    });

    it('refuses an edit that started from an outdated revision', async () => {
      const member = await addMember(harness.deps, world.alpha.volunteer, 'Hugo', 'Marchand');
      const edit = { firstName: 'Hugo', lastName: 'Marchand', notes: 'First', expectedRevision: 1 };
      await updateMember(harness.deps, world.alpha.volunteer, member.id, edit);
      await expect(
        updateMember(harness.deps, world.alpha.organizer, member.id, { ...edit, notes: 'Second' }),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
      expect((await getMember(harness.deps, world.alpha.reader, member.id)).member.notes).toBe(
        'First',
      );
    });

    it('is closed to readers', async () => {
      await expect(
        createMember(harness.deps, world.alpha.reader, { firstName: 'A', lastName: 'B' }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(
        updateMember(harness.deps, world.alpha.reader, people.member?.id ?? '', {
          firstName: 'A',
          lastName: 'B',
          expectedRevision: 1,
        }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });

    it('answers not found for unknown and malformed ids', async () => {
      await expect(
        getMember(harness.deps, world.alpha.reader, '00000000-0000-4000-8000-000000000000'),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(getMember(harness.deps, world.alpha.reader, 'nope')).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    });
  });

  describe('through the API', () => {
    it('serves the roster page in one request, with counts and a profile', async () => {
      const cookie = await harness.signIn('reader@alpha.example');
      const result = await harness.gql<{
        workspace: {
          role: string;
          stageCounts: { stage: string; total: number }[];
          members: {
            items: { firstName: string; stage: string; isRead: boolean }[];
            hasNextPage: boolean;
          };
          member: {
            member: { signups: { tripTitle: string; attended: boolean }[]; payments: unknown[] };
          };
        };
      }>(
        `query ($ws: ID!, $id: ID!) {
          workspace(id: $ws) {
            role
            stageCounts { stage total unread }
            members(first: 3, stage: MEMBER, sort: NAME) { items { firstName stage isRead } hasNextPage }
            member(id: $id) { mergedFrom { id } member { signups { tripTitle attended } payments { coversUntil } } }
          }
        }`,
        { ws: world.alpha.id, id: people.member?.id },
        cookie,
      );
      expect(result.errors).toEqual([]);
      expect(result.data?.workspace.role).toBe('READER');
      expect(result.data?.workspace.members.items).toEqual([
        { firstName: 'Ada', stage: 'MEMBER', isRead: false },
      ]);
      expect(result.data?.workspace.member.member.signups).toEqual([
        { tripTitle: 'Ridge walk', attended: true },
      ]);
      expect(result.data?.workspace.member.member.payments).toHaveLength(1);
    });

    it('returns field issues in the error extensions', async () => {
      const cookie = await harness.signIn('volunteer@alpha.example');
      const result = await harness.gql(
        `mutation ($ws: ID!) {
          createMember(workspaceId: $ws, input: { firstName: "", lastName: "Fenwick", phone: "abc" }) { id }
        }`,
        { ws: world.alpha.id },
        cookie,
      );
      expect(result.errors[0]?.extensions).toMatchObject({
        code: 'VALIDATION',
        issues: [
          { field: 'firstName', message: 'is needed' },
          { field: 'phone', message: 'may only contain digits, spaces and + ( ) . / -' },
        ],
      });
    });
  });
});
