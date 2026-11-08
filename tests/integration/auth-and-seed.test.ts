import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDeps } from '../../src/server/app';
import { DEMO_PASSWORD, DEMO_USERS, isEmpty, seedDemoData } from '../../src/server/db/seed';
import { normalizePageRequest } from '../../src/server/domain/pagination';
import { listMemberships, login } from '../../src/server/services/auth-service';
import { listDuplicates } from '../../src/server/services/duplicate-service';
import { listMembers, stageCounts } from '../../src/server/services/member-service';
import { listMerges, undoMerge } from '../../src/server/services/merge-service';
import type { Deps, Scope } from '../../src/server/services/records';
import { PASSWORD, createHarness, seedWorld } from '../helpers/harness';
import type { Harness, World } from '../helpers/harness';

const LOGIN = `mutation ($email: String!, $password: String!) {
  login(email: $email, password: $password) { email memberships { role workspace { name } } }
}`;
const VIEWER = '{ viewer { email } }';

describe('sign-in and sessions', () => {
  let harness: Harness;
  let world: World;

  beforeAll(async () => {
    harness = await createHarness();
    world = await seedWorld(harness.deps);
  });

  afterAll(async () => {
    await harness.close();
  });

  it('signs in, sets an HttpOnly cookie and lists memberships', async () => {
    const result = await harness.gql<{
      login: { email: string; memberships: { role: string; workspace: { name: string } }[] };
    }>(LOGIN, { email: 'Organizer@Alpha.example ', password: PASSWORD });

    expect(result.errors).toEqual([]);
    expect(result.data?.login).toEqual({
      email: 'organizer@alpha.example',
      memberships: [{ role: 'ORGANIZER', workspace: { name: 'Alpha Walkers' } }],
    });
    expect(result.setCookies[0]).toMatch(/^record_merge_session=[\w-]{43}; Expires=/);
    expect(result.setCookies[0]).toContain('HttpOnly');
    expect(result.setCookies[0]).toContain('SameSite=Lax');
  });

  it('stores only a hash of the session token', async () => {
    const cookie = await harness.signIn('organizer@alpha.example');
    const rows = await harness.deps.db.admin.query<{ token_hash: string }>(
      'select token_hash from sessions',
    );
    expect(rows.map((row) => row.token_hash)).not.toContain(cookie.split('=')[1]);
  });

  it('gives the same answer for a wrong password and an unknown email', async () => {
    for (const attempt of [
      { email: 'organizer@alpha.example', password: 'nope' },
      { email: 'ghost@alpha.example', password: PASSWORD },
    ]) {
      const result = await harness.gql(LOGIN, attempt);
      expect(result.setCookies).toEqual([]);
      expect(result.errors[0]).toMatchObject({
        message: 'Email or password is wrong.',
        extensions: { code: 'UNAUTHENTICATED' },
      });
    }
  });

  it('locks out repeated guesses for one email, without locking out others', async () => {
    const guess = () => harness.gql(LOGIN, { email: 'organizer@beta.example', password: 'guess' });
    for (let attempt = 0; attempt < 8; attempt += 1) {
      expect((await guess()).errors[0]?.extensions?.code).toBe('UNAUTHENTICATED');
    }
    expect((await guess()).errors[0]?.extensions?.code).toBe('RATE_LIMITED');
    const someoneElse = await harness.gql(LOGIN, {
      email: 'volunteer@alpha.example',
      password: PASSWORD,
    });
    expect(someoneElse.errors).toEqual([]);
  });

  it('knows the viewer only while the session is valid, and ends it on logout', async () => {
    expect((await harness.gql(VIEWER)).data).toEqual({ viewer: null });
    expect((await harness.gql(VIEWER, {}, 'record_merge_session=forged')).data).toEqual({
      viewer: null,
    });

    const cookie = await harness.signIn('organizer@alpha.example');
    expect((await harness.gql(VIEWER, {}, cookie)).data).toEqual({
      viewer: { email: 'organizer@alpha.example' },
    });

    const start = harness.deps.now();
    harness.advance(12 * 3_600_000 + 1);
    expect((await harness.gql(VIEWER, {}, cookie)).data).toEqual({ viewer: null });
    harness.setNow(start);

    const logout = await harness.gql('mutation { logout }', {}, cookie);
    expect(logout.setCookies[0]).toContain('Expires=Thu, 01 Jan 1970');
    expect((await harness.gql(VIEWER, {}, cookie)).data).toEqual({ viewer: null });
  });

  it('refuses a mutation sent as a GET request', async () => {
    const { createGraphQLServer } = await import('../../src/server/graphql/yoga');
    const { createLogger } = await import('../../src/server/logger');
    const yoga = createGraphQLServer({
      deps: harness.deps,
      logger: createLogger('error', () => undefined),
      secureCookies: false,
      graphiql: false,
    });
    const url = `http://record-merge.test/graphql?query=${encodeURIComponent('mutation { logout }')}`;
    expect((await yoga.fetch(url, { method: 'GET' })).status).toBe(405);
  });

  it('enforces roles on mutations through the API', async () => {
    const cookie = await harness.signIn('reader@alpha.example');
    const result = await harness.gql(
      `mutation ($ws: ID!) {
        createMember(workspaceId: $ws, input: { firstName: "A", lastName: "B" }) { id }
      }`,
      { ws: world.alpha.id },
      cookie,
    );
    expect(result.errors[0]?.extensions?.code).toBe('FORBIDDEN');
  });

  it('reports malformed queries as the caller’s mistake, without logging an error', async () => {
    const before = harness.logLines.length;
    const result = await harness.gql('query { nonsense }');
    expect(result.errors[0]?.message).toContain('nonsense');
    expect(harness.logLines.length).toBe(before);
  });
});

describe('demo data', () => {
  let deps: Deps;
  let club: Scope;

  beforeAll(async () => {
    deps = await createDeps({ dataDir: 'memory', sessionTtlHours: 12 });
    expect(await isEmpty(deps)).toBe(true);
    await seedDemoData(deps);
    const { user } = await login(
      deps,
      { email: DEMO_USERS.organizer.email, password: DEMO_PASSWORD },
      'test',
    );
    const membership = (await listMemberships(deps, user.id)).find(
      (item) => item.workspace.name === 'Greywether Hiking Club',
    );
    if (!membership) throw new Error('The demo organizer is not in the demo club.');
    club = { workspaceId: membership.workspace.id, userId: user.id, role: membership.role };
  });

  afterAll(async () => {
    await deps.db.close();
  });

  it('is no longer empty, so a restart does not seed twice', async () => {
    expect(await isEmpty(deps)).toBe(false);
  });

  it('gives the demo organizer two clubs with different roles', async () => {
    const memberships = await listMemberships(deps, club.userId);
    expect(memberships.map((item) => [item.workspace.name, item.role])).toEqual([
      ['Greywether Hiking Club', 'organizer'],
      ['Saltmarsh Ramblers', 'reader'],
    ]);
  });

  it('has people in every stage, some of them unread', async () => {
    const counts = await stageCounts(deps, club);
    for (const count of counts) expect(count.total, count.stage).toBeGreaterThan(0);
    expect(counts.reduce((sum, count) => sum + count.total, 0)).toBe(31);
    expect(counts.reduce((sum, count) => sum + count.unread, 0)).toBeGreaterThan(0);
  });

  it('suggests the planted duplicates, one of each kind, plus the look-alike', async () => {
    const report = await listDuplicates(deps, club);
    const reasons = report.pairs.map((pair) => pair.reasons.join(' + ')).sort();
    expect(reasons).toEqual([
      'Same email address + Same name',
      'Same email address + Same name',
      'Same phone number + Same name with first and last name swapped',
      'Same phone number + Very similar name',
      'Same phone number + Very similar name',
    ]);
    expect(report.membersChecked).toBe(31);
    expect(report.comparisons).toBeLessThan(40);
  });

  it('includes one finished merge that can be undone', async () => {
    const merges = await listMerges(deps, club);
    expect(merges).toHaveLength(1);
    expect(merges[0]).toMatchObject({
      survivorName: 'Tobias Reinholt',
      absorbedName: 'Tobias Reinholt',
      mergedByName: 'Petra Nowak',
      canUndo: true,
    });
    await expect(undoMerge(deps, club, merges[0]?.id ?? '')).resolves.toMatchObject({
      canUndo: false,
    });
  });

  it('uses only reserved example addresses', async () => {
    const users = await deps.db.admin.query<{ email: string }>('select email from users');
    const members = await deps.db.admin.query<{ email: string }>(
      'select email from members where email is not null',
    );
    for (const { email } of [...users, ...members])
      expect(email.toLowerCase()).toMatch(/@example\.com$/);
  });

  it('keeps the second club separate', async () => {
    const page = await listMembers(deps, club, normalizePageRequest(50, null), {
      stage: null,
      search: 'menon',
      sort: 'NAME',
    });
    expect(page.items).toEqual([]);
  });
});
