import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHttpServer } from '../../src/server/http/server';
import { createLogger } from '../../src/server/logger';
import { exportMembersCsv } from '../../src/server/services/export-service';
import {
  PASSWORD,
  addMember,
  addTrip,
  createHarness,
  pay,
  seedWorld,
  signUp,
} from '../helpers/harness';
import type { Harness, World } from '../helpers/harness';

describe('CSV export and the HTTP server', () => {
  let harness: Harness;
  let world: World;
  let server: Server;
  let base: string;
  let webRoot: string;
  const logLines: string[] = [];

  const signIn = async (email: string): Promise<string> => {
    const response = await fetch(`${base}/graphql`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        query: 'mutation ($e: String!, $p: String!) { login(email: $e, password: $p) { id } }',
        variables: { e: email, p: PASSWORD },
      }),
    });
    return response.headers.getSetCookie()[0]?.split(';')[0] ?? '';
  };
  const csvUrl = (workspaceId: string, query = '') =>
    `${base}/files/${workspaceId}/members.csv${query}`;

  beforeAll(async () => {
    harness = await createHarness();
    world = await seedWorld(harness.deps);
    const scope = world.alpha.volunteer;
    const trip = await addTrip(harness.deps, scope, 'Ridge walk', '2025-05-01');
    const ada = await addMember(harness.deps, scope, 'Ada', 'Fenwick', {
      email: 'ada@example.com',
      phone: '+44 7700 900101',
      notes: 'Brings a dog, "Biscuit".\nNeeds a lift.',
    });
    await signUp(harness.deps, scope, ada.id, trip, true);
    await pay(harness.deps, scope, ada.id, '2025-01-10', '2026-01-09');
    await addMember(harness.deps, scope, '=HYPERLINK("http://evil.example")', 'Mallory', {
      notes: '@SUM(1+1)',
    });
    await addMember(harness.deps, world.beta.organizer, 'Bea', 'Beta', {
      email: 'bea@example.com',
    });

    await mkdir('test-results', { recursive: true });
    webRoot = await mkdtemp(path.join('test-results', 'web-'));
    await mkdir(path.join(webRoot, 'assets'));
    await writeFile(path.join(webRoot, 'index.html'), '<!doctype html><title>Record Merge</title>');
    await writeFile(path.join(webRoot, 'assets', 'app.js'), 'export {};');

    server = createHttpServer({
      deps: harness.deps,
      logger: createLogger('debug', (line) => logLines.push(line)),
      webRoot,
      secureCookies: false,
      graphiql: false,
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(webRoot, { recursive: true, force: true });
    await harness.close();
  });

  describe('the export', () => {
    it('writes a header and one safely escaped row per person, sorted by name', async () => {
      const cookie = await signIn('volunteer@alpha.example');
      const response = await fetch(csvUrl(world.alpha.id), { headers: { cookie } });

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('text/csv; charset=utf-8');
      expect(response.headers.get('content-disposition')).toBe('attachment; filename="roster.csv"');
      expect(response.headers.get('cache-control')).toBe('private, no-store');

      const lines = (await response.text()).split('\r\n');
      expect(lines[0]).toBe(
        'Last name,First name,Email,Phone,Stage,Dues paid until,Trips,Source,Added on,Notes',
      );
      expect(lines[1]).toBe(
        'Fenwick,Ada,ada@example.com,\'+44 7700 900101,Member,2026-01-09,1,web,2025-06-02,"Brings a dog, ""Biscuit"".\nNeeds a lift."',
      );
      // A name and a note that a spreadsheet would run as formulas are defused.
      expect(lines[2]).toBe(
        'Mallory,"\'=HYPERLINK(""http://evil.example"")",,,Enquiry,,0,web,2025-06-02,\'@SUM(1+1)',
      );
      expect(lines.slice(3)).toEqual(['']);
    });

    it('applies the stage filter and the search from the address', async () => {
      const cookie = await signIn('volunteer@alpha.example');
      const rows = async (query: string) =>
        (await (await fetch(csvUrl(world.alpha.id, query), { headers: { cookie } })).text())
          .split('\r\n')
          .slice(1)
          .filter(Boolean);
      expect(await rows('?stage=MEMBER')).toHaveLength(1);
      expect(await rows('?stage=LAPSED')).toEqual([]);
      expect(await rows('?search=mallory')).toHaveLength(1);
      expect(await rows('?stage=NOT_A_STAGE')).toHaveLength(2);
    });

    it('needs a sign-in, a volunteer role and membership of that club', async () => {
      expect((await fetch(csvUrl(world.alpha.id))).status).toBe(401);

      const reader = await signIn('reader@alpha.example');
      expect((await fetch(csvUrl(world.alpha.id), { headers: { cookie: reader } })).status).toBe(
        403,
      );

      const outsider = await signIn('organizer@beta.example');
      const response = await fetch(csvUrl(world.alpha.id), { headers: { cookie: outsider } });
      expect(response.status).toBe(404);
      expect(await response.text()).not.toContain('Fenwick');
    });

    it('fetches in batches and writes as it goes, however long the roster is', async () => {
      const scope = world.beta.organizer;
      const rows = Array.from({ length: 450 }, (_, index) => {
        const name = `person${String(index).padStart(4, '0')}`;
        return `('${scope.workspaceId}', 'Test', '${name}', '${name} test')`;
      });
      await harness.deps.db.admin.query(
        `insert into members (workspace_id, first_name, last_name, sort_name) values ${rows.join(',')}`,
      );

      const chunks: string[] = [];
      let largestWrite = 0;
      const written = await exportMembersCsv(
        harness.deps,
        scope,
        { stage: null, search: 'person' },
        (chunk) => {
          chunks.push(chunk);
          largestWrite = Math.max(largestWrite, chunk.length);
        },
      );

      expect(written).toBe(450);
      expect(chunks).toHaveLength(451);
      expect(largestWrite).toBeLessThan(200);
      const lastNames = chunks.slice(1).map((chunk) => chunk.split(',')[0]);
      expect(lastNames).toEqual([...lastNames].sort());
      expect(new Set(lastNames).size).toBe(450);
    });

    it('is refused for readers before anything is written', async () => {
      const chunks: string[] = [];
      await expect(
        exportMembersCsv(
          harness.deps,
          world.alpha.reader,
          { stage: null, search: null },
          (chunk) => {
            chunks.push(chunk);
          },
        ),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      expect(chunks).toEqual([]);
    });
  });

  describe('the server', () => {
    it('answers the health check and sends security headers on every response', async () => {
      const response = await fetch(`${base}/healthz`);
      expect(await response.text()).toBe('ok');
      expect(response.headers.get('referrer-policy')).toBe('no-referrer');
      expect(response.headers.get('x-content-type-options')).toBe('nosniff');
      expect(response.headers.get('x-frame-options')).toBe('DENY');
      expect(response.headers.get('content-security-policy')).toContain("default-src 'self'");
    });

    it('serves the app shell for page routes and hashed assets with long caching', async () => {
      const page = await fetch(`${base}/w/some-id/roster`);
      expect(page.status).toBe(200);
      expect(page.headers.get('content-type')).toContain('text/html');
      expect(page.headers.get('cache-control')).toBe('no-cache');

      const asset = await fetch(`${base}/assets/app.js`);
      expect(asset.headers.get('cache-control')).toContain('immutable');
      expect((await fetch(`${base}/assets/missing.js`)).status).toBe(404);
    });

    it('does not serve files outside the web root', async () => {
      const response = await fetch(`${base}/..%2f..%2fpackage.json`);
      expect(response.status).toBe(404);
      expect(await response.text()).not.toContain('record_merge');
    });

    it('rejects methods other than GET outside the API', async () => {
      expect((await fetch(`${base}/healthz/x`, { method: 'POST' })).status).toBe(405);
    });

    it('never logs at error level for expected failures', () => {
      expect(logLines.filter((line) => line.includes('"level":"error"'))).toEqual([]);
    });
  });
});
