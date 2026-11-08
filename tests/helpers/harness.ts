import { createDeps } from '../../src/server/app';
import { hashPassword } from '../../src/server/domain/secrets';
import { createGraphQLServer } from '../../src/server/graphql/yoga';
import { createLogger } from '../../src/server/logger';
import { createMember } from '../../src/server/services/member-service';
import type { Deps, MemberRecord, Role, Scope } from '../../src/server/services/records';

/** Shared setup for integration tests: a real database, a clock we control, and the API. */

export const PASSWORD = 'correct horse battery staple';

export interface GraphQLResult<Data> {
  data: Data | null;
  errors: {
    message: string;
    extensions?: { code?: string; issues?: { field: string | null; message: string }[] };
  }[];
  setCookies: string[];
}

export interface Harness {
  deps: Deps;
  setNow(date: Date): void;
  advance(ms: number): void;
  logLines: string[];
  gql<Data = Record<string, unknown>>(
    query: string,
    variables?: Record<string, unknown>,
    cookie?: string,
  ): Promise<GraphQLResult<Data>>;
  signIn(email: string): Promise<string>;
  close(): Promise<void>;
}

export async function createHarness(): Promise<Harness> {
  let now = new Date('2025-06-02T09:00:00.000Z');
  const deps = await createDeps({ dataDir: 'memory', sessionTtlHours: 12, now: () => now });
  const logLines: string[] = [];
  const yoga = createGraphQLServer({
    deps,
    logger: createLogger('debug', (line) => logLines.push(line)),
    secureCookies: false,
    graphiql: false,
  });

  async function gql<Data>(
    query: string,
    variables: Record<string, unknown> = {},
    cookie?: string,
  ): Promise<GraphQLResult<Data>> {
    const response = await yoga.fetch('http://record-merge.test/graphql', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
      body: JSON.stringify({ query, variables }),
    });
    const body = (await response.json()) as {
      data?: Data | null;
      errors?: GraphQLResult<Data>['errors'];
    };
    return {
      data: body.data ?? null,
      errors: body.errors ?? [],
      setCookies: response.headers.getSetCookie(),
    };
  }

  return {
    deps,
    logLines,
    setNow(date) {
      now = date;
    },
    advance(ms) {
      now = new Date(now.getTime() + ms);
    },
    gql,
    async signIn(email) {
      const result = await gql(
        'mutation ($email: String!, $password: String!) { login(email: $email, password: $password) { id } }',
        { email, password: PASSWORD },
      );
      const cookie = result.setCookies[0]?.split(';')[0];
      if (!cookie) throw new Error(`Sign-in failed for ${email}: ${JSON.stringify(result.errors)}`);
      return cookie;
    },
    async close() {
      await deps.db.close();
    },
  };
}

export interface World {
  alpha: { id: string; organizer: Scope; volunteer: Scope; reader: Scope };
  beta: { id: string; organizer: Scope };
}

/**
 * Two clubs with separate people:
 *   alpha: organizer@alpha.example, volunteer@alpha.example, reader@alpha.example
 *   beta:  organizer@beta.example
 */
export async function seedWorld(deps: Deps): Promise<World> {
  const admin = deps.db.admin;
  const passwordHash = await hashPassword(PASSWORD, 1024);
  const one = async (sql: string, params: unknown[]): Promise<string> => {
    const rows = await admin.query<{ id: string }>(sql, params);
    return rows[0]?.id ?? '';
  };
  const user = (email: string) =>
    one('insert into users (email, name, password_hash) values ($1, $2, $3) returning id', [
      email,
      email.split('@')[0] ?? email,
      passwordHash,
    ]);
  const workspace = (name: string) =>
    one('insert into workspaces (name) values ($1) returning id', [name]);
  const join = async (workspaceId: string, userId: string, role: Role): Promise<Scope> => {
    await admin.query('insert into memberships (workspace_id, user_id, role) values ($1, $2, $3)', [
      workspaceId,
      userId,
      role,
    ]);
    return { workspaceId, userId, role };
  };

  const alpha = await workspace('Alpha Walkers');
  const beta = await workspace('Beta Ramblers');
  return {
    alpha: {
      id: alpha,
      organizer: await join(alpha, await user('organizer@alpha.example'), 'organizer'),
      volunteer: await join(alpha, await user('volunteer@alpha.example'), 'volunteer'),
      reader: await join(alpha, await user('reader@alpha.example'), 'reader'),
    },
    beta: {
      id: beta,
      organizer: await join(beta, await user('organizer@beta.example'), 'organizer'),
    },
  };
}

/** Adds a person to a roster through the real service. */
export function addMember(
  deps: Deps,
  scope: Scope,
  firstName: string,
  lastName: string,
  extra: { email?: string; phone?: string; notes?: string } = {},
): Promise<MemberRecord> {
  return createMember(deps, scope, { firstName, lastName, ...extra });
}

export async function addTrip(
  deps: Deps,
  scope: Scope,
  title: string,
  day: string,
): Promise<string> {
  const rows = await deps.db.admin.query<{ id: string }>(
    'insert into trips (workspace_id, title, happens_on) values ($1, $2, $3) returning id',
    [scope.workspaceId, title, day],
  );
  return rows[0]?.id ?? '';
}

export async function signUp(
  deps: Deps,
  scope: Scope,
  memberId: string,
  tripId: string,
  attended = false,
): Promise<string> {
  const rows = await deps.db.admin.query<{ id: string }>(
    `insert into trip_signups (workspace_id, member_id, trip_id, attended)
     values ($1, $2, $3, $4) returning id`,
    [scope.workspaceId, memberId, tripId, attended],
  );
  return rows[0]?.id ?? '';
}

export async function pay(
  deps: Deps,
  scope: Scope,
  memberId: string,
  paidOn: string,
  coversUntil: string,
): Promise<string> {
  const rows = await deps.db.admin.query<{ id: string }>(
    `insert into payments (workspace_id, member_id, amount_cents, paid_on, covers_until)
     values ($1, $2, 3000, $3, $4) returning id`,
    [scope.workspaceId, memberId, paidOn, coversUntil],
  );
  return rows[0]?.id ?? '';
}
