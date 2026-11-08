import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/server/config';
import { csvCell, csvRow } from '../../src/server/domain/csv';
import { AppError, conflict, forbidden, invalid, notFound } from '../../src/server/domain/errors';
import {
  decodeCursor,
  encodeCursor,
  isUuid,
  normalizePageRequest,
  toPage,
} from '../../src/server/domain/pagination';
import { createRateLimiter } from '../../src/server/domain/rate-limit';
import {
  generateToken,
  hashPassword,
  hashToken,
  verifyPassword,
} from '../../src/server/domain/secrets';
import { createLogger, describeError } from '../../src/server/logger';
import { isoDay, roleAtLeast } from '../../src/server/services/records';
import { mergeSchema, newMemberSchema, parseInput } from '../../src/server/services/validation';
import { STAGES, STAGE_DESCRIPTIONS, STAGE_LABELS, deriveStage } from '../../src/shared/stage';

const ID = '11111111-1111-4111-8111-111111111111';

describe('deriveStage', () => {
  const today = '2025-06-02';
  const facts = { pin: null, duesPaidUntil: null, tripCount: 0 };

  it('starts as an enquiry and becomes a trial with the first trip', () => {
    expect(deriveStage(facts, today)).toBe('ENQUIRY');
    expect(deriveStage({ ...facts, tripCount: 1 }, today)).toBe('TRIAL');
  });

  it('is a member while dues are paid, through the last covered day', () => {
    expect(deriveStage({ ...facts, duesPaidUntil: '2025-12-31' }, today)).toBe('MEMBER');
    expect(deriveStage({ ...facts, duesPaidUntil: today }, today)).toBe('MEMBER');
  });

  it('lapses the day after dues run out, whatever the trips', () => {
    expect(deriveStage({ ...facts, duesPaidUntil: '2025-06-01' }, today)).toBe('LAPSED');
    expect(deriveStage({ ...facts, duesPaidUntil: '2025-06-01', tripCount: 9 }, today)).toBe(
      'LAPSED',
    );
  });

  it('lets a fixed stage win over the facts', () => {
    expect(deriveStage({ pin: 'MEMBER', duesPaidUntil: null, tripCount: 0 }, today)).toBe('MEMBER');
    expect(deriveStage({ pin: 'ENQUIRY', duesPaidUntil: '2030-01-01', tripCount: 5 }, today)).toBe(
      'ENQUIRY',
    );
  });

  it('has a label and a description for every stage', () => {
    expect(Object.keys(STAGE_LABELS)).toEqual([...STAGES]);
    expect(Object.keys(STAGE_DESCRIPTIONS)).toEqual([...STAGES]);
  });
});

describe('CSV', () => {
  it('leaves plain values alone', () => {
    expect(csvCell('Ada Fenwick')).toBe('Ada Fenwick');
    expect(csvCell(42)).toBe('42');
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
  });

  it('quotes values with commas, quotes and line breaks', () => {
    expect(csvCell('Fenwick, Ada')).toBe('"Fenwick, Ada"');
    expect(csvCell('She said "hello"')).toBe('"She said ""hello"""');
    expect(csvCell('line one\nline two')).toBe('"line one\nline two"');
  });

  it('defuses values a spreadsheet would run as a formula', () => {
    expect(csvCell('=HYPERLINK("http://evil.example","click")')).toBe(
      '"\'=HYPERLINK(""http://evil.example"",""click"")"',
    );
    expect(csvCell('+44 7700 900123')).toBe("'+44 7700 900123");
    expect(csvCell('-1+1')).toBe("'-1+1");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvCell('\tcmd')).toBe("'\tcmd");
  });

  it('does not alter numbers, which cannot carry a formula', () => {
    expect(csvCell(-5)).toBe('-5');
  });

  it('ends rows with CRLF', () => {
    expect(csvRow(['a', 'b,c', null, 3])).toBe('a,"b,c",,3\r\n');
  });
});

describe('pagination', () => {
  it('round-trips a cursor, including values with separators in them', () => {
    for (const sortValue of ['2025-06-01T12:00:00.123Z', 'o|brien, "zoe"', '']) {
      expect(decodeCursor(encodeCursor({ sortValue, id: ID }))).toEqual({ sortValue, id: ID });
    }
  });

  it('rejects cursors that were tampered with', () => {
    const bad = [
      '',
      'garbage',
      Buffer.from('["x","not-a-uuid"]').toString('base64url'),
      Buffer.from('{"sortValue":"x"}').toString('base64url'),
      Buffer.from(`[1,"${ID}"]`).toString('base64url'),
    ];
    for (const cursor of bad) expect(() => decodeCursor(cursor)).toThrow(AppError);
  });

  it('applies defaults and limits to the page size', () => {
    expect(normalizePageRequest(null, undefined)).toEqual({ first: 25, after: null });
    expect(normalizePageRequest(50, 'abc')).toEqual({ first: 50, after: 'abc' });
    for (const size of [0, 51, -1, 2.5])
      expect(() => normalizePageRequest(size, null)).toThrow(AppError);
  });

  it('uses the extra row only to detect another page', () => {
    const rows = ['a', 'b', 'c'].map((name, index) => ({
      name,
      id: ID.replace(/1$/, String(index)),
    }));
    const position = (row: (typeof rows)[number]) => ({ sortValue: row.name, id: row.id });
    const page = toPage(rows, 2, position);
    expect(page.items.map((row) => row.name)).toEqual(['a', 'b']);
    expect(page.hasNextPage).toBe(true);
    expect(decodeCursor(page.endCursor ?? '')).toEqual({ sortValue: 'b', id: rows[1]?.id });
    expect(toPage(rows, 3, position).hasNextPage).toBe(false);
    expect(toPage([], 3, position)).toEqual({ items: [], endCursor: null, hasNextPage: false });
  });

  it('recognises UUIDs', () => {
    expect(isUuid(ID)).toBe(true);
    expect(isUuid('1111')).toBe(false);
    expect(isUuid(`${ID}'; --`)).toBe(false);
  });
});

describe('input parsing', () => {
  it('trims, and turns empty optional values into null', () => {
    expect(
      parseInput(newMemberSchema, {
        firstName: ' Ada ',
        lastName: 'Fenwick',
        email: '  ',
        phone: '',
      }),
    ).toEqual({
      firstName: 'Ada',
      lastName: 'Fenwick',
      email: null,
      phone: null,
      notes: '',
      source: 'web',
    });
  });

  it('names each failing field', () => {
    expect(() =>
      parseInput(newMemberSchema, {
        firstName: '',
        lastName: 'x'.repeat(61),
        email: 'nope',
        phone: 'call me',
      }),
    ).toThrow(
      expect.objectContaining({
        code: 'VALIDATION',
        issues: [
          { field: 'firstName', message: 'is needed' },
          expect.objectContaining({ field: 'lastName' }),
          { field: 'email', message: 'is not an email address' },
          { field: 'phone', message: 'may only contain digits, spaces and + ( ) . / -' },
        ],
      }) as Error,
    );
  });

  it('requires real ids and a side for every field of a merge', () => {
    expect(() => parseInput(mergeSchema, { survivorId: 'x', absorbedId: ID })).toThrow(AppError);
  });
});

describe('secrets', () => {
  it('generates unguessable, URL-safe tokens and hashes them deterministically', () => {
    const tokens = new Set(Array.from({ length: 50 }, generateToken));
    expect(tokens.size).toBe(50);
    for (const token of tokens) expect(token).toMatch(/^[\w-]{43}$/);
    expect(hashToken('abc')).toBe(hashToken('abc'));
    expect(hashToken('abc')).not.toBe(hashToken('abd'));
  });

  it('verifies the right password only, with a fresh salt each time', async () => {
    const first = await hashPassword('open sesame', 1024);
    expect(first).not.toBe(await hashPassword('open sesame', 1024));
    expect(await verifyPassword('open sesame', first)).toBe(true);
    expect(await verifyPassword('open sesame ', first)).toBe(false);
  });

  it('rejects malformed stored hashes instead of throwing', async () => {
    for (const stored of [
      '',
      'plain-text',
      'bcrypt$10$salt$key',
      'scrypt$x$salt$key',
      'scrypt$1024$$',
    ]) {
      expect(await verifyPassword('anything', stored)).toBe(false);
    }
  });
});

describe('rate limiter', () => {
  it('allows up to the limit per key and window, then resets', () => {
    let time = 0;
    const limiter = createRateLimiter({ limit: 2, windowMs: 1000, now: () => time });
    expect([limiter.hit('a'), limiter.hit('a'), limiter.hit('a')]).toEqual([true, true, false]);
    expect(limiter.hit('b')).toBe(true);
    time = 1000;
    expect(limiter.hit('a')).toBe(true);
    limiter.reset('a');
    expect([limiter.hit('a'), limiter.hit('a')]).toEqual([true, true]);
  });

  it('forgets expired keys when it is full', () => {
    let time = 0;
    const limiter = createRateLimiter({ limit: 1, windowMs: 10, now: () => time, maxKeys: 2 });
    limiter.hit('a');
    limiter.hit('b');
    time = 20;
    limiter.hit('c');
    expect(limiter.hit('a')).toBe(true);
  });
});

describe('errors, roles, configuration and logging', () => {
  it('builds errors with stable codes', () => {
    expect(notFound('Member')).toMatchObject({ code: 'NOT_FOUND', message: 'Member not found.' });
    expect(forbidden().code).toBe('FORBIDDEN');
    expect(conflict('x').code).toBe('CONFLICT');
    expect(invalid('x', [{ field: 'a', message: 'b' }]).issues).toHaveLength(1);
  });

  it('orders roles reader < volunteer < organizer', () => {
    expect(roleAtLeast('organizer', 'volunteer')).toBe(true);
    expect(roleAtLeast('volunteer', 'volunteer')).toBe(true);
    expect(roleAtLeast('reader', 'volunteer')).toBe(false);
    expect(roleAtLeast('volunteer', 'organizer')).toBe(false);
  });

  it('formats a day in UTC', () => {
    expect(isoDay(new Date('2025-06-02T23:59:59Z'))).toBe('2025-06-02');
  });

  it('uses safe configuration defaults and fails fast on a bad setting', () => {
    expect(loadConfig({})).toMatchObject({ PORT: 4100, DATA_DIR: '.data/pglite', SEED_DEMO: true });
    expect(loadConfig({ PORT: '8080', SEED_DEMO: 'false' })).toMatchObject({
      PORT: 8080,
      SEED_DEMO: false,
    });
    expect(() => loadConfig({ PORT: 'eighty' })).toThrow(/Invalid configuration\. PORT/);
  });

  it('writes JSON log lines at or above the chosen level', () => {
    const lines: string[] = [];
    const logger = createLogger('warn', (line) => lines.push(line));
    logger.debug('hidden');
    logger.info('hidden');
    logger.warn('careful', { memberId: 'm1' });
    logger.error('broken', describeError(new RangeError('too far')));
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0] ?? '')).toMatchObject({ level: 'warn', memberId: 'm1' });
    expect(JSON.parse(lines[1] ?? '')).toMatchObject({ errorName: 'RangeError' });
    expect(describeError('plain')).toEqual({ errorMessage: 'plain' });
  });
});
