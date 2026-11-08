import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dismissDuplicate } from '../../src/server/services/duplicate-service';
import { getMember, updateMember } from '../../src/server/services/member-service';
import { mergeMembers, previewMerge, undoMerge } from '../../src/server/services/merge-service';
import type { MemberRecord } from '../../src/server/services/records';
import { addMember, createHarness, seedWorld } from '../helpers/harness';
import type { Harness, World } from '../helpers/harness';

/**
 * The central promise: one club can never read or change another club's
 * roster. These tests attack it from three directions: raw SQL in the tenant
 * role, the service layer, and the API with ids that belong to someone else.
 */
describe('tenant isolation', () => {
  let harness: Harness;
  let world: World;
  let alphaMember: MemberRecord;
  let betaMember: MemberRecord;
  let betaTwin: MemberRecord;
  let betaMergeId: string;

  const tenantTables = [
    'activity_events',
    'duplicate_dismissals',
    'member_reads',
    'members',
    'merges',
    'payments',
    'trip_signups',
    'trips',
  ];

  beforeAll(async () => {
    harness = await createHarness();
    world = await seedWorld(harness.deps);
    alphaMember = await addMember(harness.deps, world.alpha.volunteer, 'Ada', 'Alpha', {
      email: 'ada@example.com',
    });
    betaMember = await addMember(harness.deps, world.beta.organizer, 'Bea', 'Beta', {
      email: 'bea@example.com',
      notes: 'Private note of the other club',
    });
    betaTwin = await addMember(harness.deps, world.beta.organizer, 'Bea', 'Beta', {
      email: 'bea@example.com',
    });
    const extra = await addMember(harness.deps, world.beta.organizer, 'Bo', 'Beta');
    const merged = await mergeMembers(harness.deps, world.beta.organizer, {
      survivorId: betaMember.id,
      absorbedId: extra.id,
      expectedSurvivorRevision: 1,
      expectedAbsorbedRevision: 1,
      firstName: 'survivor',
      lastName: 'survivor',
      email: 'survivor',
      phone: 'survivor',
      notes: 'survivor',
    });
    betaMergeId = merged.mergeId;
  });

  afterAll(async () => {
    await harness.close();
  });

  describe('in the database (row-level security)', () => {
    it('has forced row-level security on every table that carries a workspace id', async () => {
      const tables = await harness.deps.db.admin.query<{
        name: string;
        enabled: boolean;
        forced: boolean;
      }>(
        `select c.relname as name, c.relrowsecurity as enabled, c.relforcerowsecurity as forced
           from pg_class c
           join pg_attribute a on a.attrelid = c.oid
          where a.attname = 'workspace_id' and not a.attisdropped
            and c.relkind = 'r' and c.relnamespace = 'public'::regnamespace
          order by c.relname`,
      );
      // A new tenant table must be added to the list above, which makes its
      // author think about isolation for it.
      expect(tables.map((table) => table.name)).toEqual([...tenantTables, 'memberships'].sort());
      for (const table of tables) {
        expect(table.enabled, `${table.name} has row-level security enabled`).toBe(true);
        if (table.name !== 'memberships') {
          expect(table.forced, `${table.name} forces it for the owner too`).toBe(true);
        }
      }
    });

    it('shows only the current workspace in the roster and its history', async () => {
      for (const table of ['members', 'activity_events', 'member_reads']) {
        const rows = await harness.deps.db.tenant(world.alpha.id, (q) =>
          q.query<{ workspace_id: string }>(`select workspace_id from ${table}`),
        );
        expect(rows.length, table).toBeGreaterThan(0);
        expect(new Set(rows.map((row) => row.workspace_id)), table).toEqual(
          new Set([world.alpha.id]),
        );
      }
      const merges = await harness.deps.db.tenant(world.alpha.id, (q) =>
        q.query('select id from merges'),
      );
      expect(merges).toEqual([]);
    });

    it('shows nothing when the workspace does not exist (fails closed)', async () => {
      const rows = await harness.deps.db.tenant('00000000-0000-4000-8000-000000000000', (q) =>
        q.query('select id from members'),
      );
      expect(rows).toEqual([]);
    });

    it('refuses to insert a row that names another workspace', async () => {
      await expect(
        harness.deps.db.tenant(world.alpha.id, (q) =>
          q.query(
            `insert into members (workspace_id, first_name, last_name, sort_name)
             values ($1, 'Smuggled', 'In', 'in smuggled')`,
            [world.beta.id],
          ),
        ),
      ).rejects.toThrow(/row-level security/);
    });

    it('cannot update or delete another workspace by id', async () => {
      const updated = await harness.deps.db.tenant(world.alpha.id, (q) =>
        q.query("update members set notes = 'defaced' where id = $1 returning id", [betaMember.id]),
      );
      expect(updated).toEqual([]);
      const untouched = await harness.deps.db.admin.query<{ notes: string }>(
        'select notes from members where id = $1',
        [betaMember.id],
      );
      expect(untouched[0]?.notes).toBe('Private note of the other club');
    });

    it("cannot point one club's record at another club's record, even as the owner", async () => {
      await expect(
        harness.deps.db.admin.query('update members set merged_into_id = $1 where id = $2', [
          betaMember.id,
          alphaMember.id,
        ]),
      ).rejects.toThrow(/foreign key/);
    });

    it('sees only fellow users, and never a password hash', async () => {
      const users = await harness.deps.db.tenant(world.alpha.id, (q) =>
        q.query<{ email: string }>('select email from users order by email'),
      );
      expect(users.map((user) => user.email)).toEqual([
        'organizer@alpha.example',
        'reader@alpha.example',
        'volunteer@alpha.example',
      ]);
      await expect(
        harness.deps.db.tenant(world.alpha.id, (q) => q.query('select password_hash from users')),
      ).rejects.toThrow(/permission denied/);
    });

    it('keeps sessions from the tenant role and the roster from the directory role', async () => {
      await expect(
        harness.deps.db.tenant(world.alpha.id, (q) => q.query('select * from sessions')),
      ).rejects.toThrow(/permission denied/);
      await expect(
        harness.deps.db.directory((q) => q.query('select * from members')),
      ).rejects.toThrow(/permission denied/);
    });

    it('rejects a non-UUID workspace id before any SQL runs', async () => {
      await expect(
        harness.deps.db.tenant("x'; drop table users; --", (q) => q.query('select 1')),
      ).rejects.toThrow(TypeError);
    });
  });

  describe('in the service layer', () => {
    const scope = () => world.alpha.organizer;

    it("answers not found for another club's record", async () => {
      await expect(getMember(harness.deps, scope(), betaMember.id)).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
      await expect(
        updateMember(harness.deps, scope(), betaMember.id, {
          firstName: 'Hacked',
          lastName: 'Beta',
          expectedRevision: betaMember.revision,
        }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('cannot merge, compare or dismiss across clubs', async () => {
      const merge = {
        survivorId: alphaMember.id,
        absorbedId: betaTwin.id,
        expectedSurvivorRevision: 1,
        expectedAbsorbedRevision: 1,
        firstName: 'absorbed',
        lastName: 'absorbed',
        email: 'absorbed',
        phone: 'absorbed',
        notes: 'both',
      };
      await expect(mergeMembers(harness.deps, scope(), merge)).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
      await expect(
        previewMerge(harness.deps, scope(), alphaMember.id, betaTwin.id),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(
        dismissDuplicate(harness.deps, scope(), alphaMember.id, betaTwin.id),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it("cannot undo another club's merge", async () => {
      await expect(undoMerge(harness.deps, scope(), betaMergeId)).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    });
  });

  describe('through the API', () => {
    let cookie: string;

    beforeAll(async () => {
      cookie = await harness.signIn('organizer@alpha.example');
    });

    it('answers NOT_FOUND for a workspace the user is not in', async () => {
      const result = await harness.gql(
        'query ($id: ID!) { workspace(id: $id) { name } }',
        { id: world.beta.id },
        cookie,
      );
      expect(result.data).toBeNull();
      expect(result.errors[0]?.extensions?.code).toBe('NOT_FOUND');
    });

    it("lists only the club's own roster, duplicates and merges", async () => {
      const result = await harness.gql<{
        workspace: {
          members: { items: { firstName: string }[] };
          duplicates: { pairs: unknown[]; membersChecked: number };
          merges: unknown[];
        };
      }>(
        `query ($ws: ID!) {
          workspace(id: $ws) {
            members { items { firstName } }
            duplicates { pairs { id } membersChecked }
            merges { id }
          }
        }`,
        { ws: world.alpha.id },
        cookie,
      );
      expect(result.errors).toEqual([]);
      expect(result.data?.workspace.members.items).toEqual([{ firstName: 'Ada' }]);
      expect(result.data?.workspace.duplicates).toEqual({ pairs: [], membersChecked: 1 });
      expect(result.data?.workspace.merges).toEqual([]);
      expect(JSON.stringify(result)).not.toContain('Bea');
    });

    it.each([
      [
        'member lookup',
        'query ($ws: ID!, $id: ID!) { workspace(id: $ws) { member(id: $id) { member { notes } } } }',
        () => ({ ws: world.alpha.id, id: betaMember.id }),
      ],
      [
        'markMemberRead',
        'mutation ($ws: ID!, $id: ID!) { markMemberRead(workspaceId: $ws, memberId: $id) }',
        () => ({ ws: world.alpha.id, id: betaMember.id }),
      ],
      [
        'undoMerge',
        'mutation ($ws: ID!, $id: ID!) { undoMerge(workspaceId: $ws, mergeId: $id) { id } }',
        () => ({ ws: world.alpha.id, id: betaMergeId }),
      ],
      [
        'undoMerge in the other workspace',
        'mutation ($ws: ID!, $id: ID!) { undoMerge(workspaceId: $ws, mergeId: $id) { id } }',
        () => ({ ws: world.beta.id, id: betaMergeId }),
      ],
    ])('refuses %s aimed at another club', async (_name, operation, variables) => {
      const result = await harness.gql(operation, variables(), cookie);
      expect(result.errors[0]?.extensions?.code).toBe('NOT_FOUND');
      expect(JSON.stringify(result)).not.toContain('Private note');
    });

    it('requires a sign-in for workspace data', async () => {
      const result = await harness.gql('query ($id: ID!) { workspace(id: $id) { name } }', {
        id: world.alpha.id,
      });
      expect(result.errors[0]?.extensions?.code).toBe('UNAUTHENTICATED');
    });
  });
});
