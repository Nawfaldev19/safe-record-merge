import { describe, expect, it } from 'vitest';
import type { CombinedError } from 'urql';
import { issuesByField, readFailure } from '../../src/web/lib/errors';
import { formatDate, formatDateTime } from '../../src/web/lib/format';

const graphQLFailure = (extensions: Record<string, unknown>, message = 'Nope'): CombinedError =>
  ({ graphQLErrors: [{ message, extensions }] }) as unknown as CombinedError;

describe('readFailure', () => {
  it('returns null when nothing failed', () => {
    expect(readFailure(undefined)).toBeNull();
  });

  it('reports a network failure when no GraphQL error arrived', () => {
    expect(readFailure({ graphQLErrors: [] } as unknown as CombinedError)).toMatchObject({
      code: 'NETWORK',
      issues: [],
    });
  });

  it('reads the code, message and well-formed issues', () => {
    const failure = readFailure(
      graphQLFailure({
        code: 'VALIDATION',
        issues: [
          { field: 'firstName', message: 'is needed' },
          { field: null, message: 'General.' },
          { field: 7, message: 'Wrong field type.' },
          'not an issue',
          null,
        ],
      }),
    );
    expect(failure).toEqual({
      code: 'VALIDATION',
      message: 'Nope',
      issues: [
        { field: 'firstName', message: 'is needed' },
        { field: null, message: 'General.' },
      ],
    });
  });

  it('falls back to INTERNAL when the code is missing or malformed', () => {
    expect(readFailure(graphQLFailure({}))).toMatchObject({ code: 'INTERNAL', issues: [] });
    expect(readFailure(graphQLFailure({ code: 42, issues: 'oops' }))).toMatchObject({
      code: 'INTERNAL',
      issues: [],
    });
  });
});

describe('issuesByField', () => {
  it('groups messages per field and leaves out general issues', () => {
    const grouped = issuesByField([
      { field: 'firstName', message: 'One.' },
      { field: null, message: 'General.' },
      { field: 'firstName', message: 'Two.' },
      { field: 'email', message: 'Three.' },
    ]);
    expect([...grouped.entries()]).toEqual([
      ['firstName', ['One.', 'Two.']],
      ['email', ['Three.']],
    ]);
  });
});

describe('formatting', () => {
  it('formats dates in the reader locale, with or without a time', () => {
    expect(formatDate('2025-03-14')).toMatch(/2025/);
    expect(formatDateTime('2025-03-14T10:30:00Z').length).toBeGreaterThan(
      formatDate('2025-03-14T10:30:00Z').length,
    );
  });
});
