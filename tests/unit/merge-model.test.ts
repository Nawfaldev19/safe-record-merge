import { describe, expect, it } from 'vitest';
import {
  FIELD_LABELS,
  MERGE_FIELDS,
  defaultChoices,
  differs,
  mergedResult,
  toMergeInput,
} from '../../src/web/features/merge/merge-model';
import type { MergeSubject } from '../../src/web/features/merge/merge-model';

const subject = (overrides: Partial<MergeSubject>): MergeSubject => ({
  id: 'a',
  firstName: 'Zoë',
  lastName: 'Brandt',
  email: 'zoe@example.com',
  phone: '07700 900131',
  notes: '',
  revision: 1,
  tripCount: 2,
  createdAt: '2025-01-10T00:00:00.000Z',
  ...overrides,
});

describe('defaultChoices', () => {
  it('keeps the record with more trips', () => {
    const left = subject({ id: 'l', tripCount: 1 });
    const right = subject({ id: 'r', tripCount: 4 });
    expect(defaultChoices(left, right).keep).toBe('right');
    expect(defaultChoices(right, left).keep).toBe('left');
  });

  it('keeps the older record when the trips are equal', () => {
    const older = subject({ id: 'l', createdAt: '2024-01-01T00:00:00.000Z' });
    const newer = subject({ id: 'r', createdAt: '2025-01-01T00:00:00.000Z' });
    expect(defaultChoices(older, newer).keep).toBe('left');
    expect(defaultChoices(newer, older).keep).toBe('right');
  });

  it('starts each field on the kept record, unless that value is empty', () => {
    const left = subject({ id: 'l', tripCount: 5, phone: null, email: '  ' });
    const right = subject({ id: 'r', tripCount: 0, phone: '07700 900132', email: 'z@example.com' });
    expect(defaultChoices(left, right)).toMatchObject({
      keep: 'left',
      fields: { firstName: 'left', lastName: 'left', email: 'right', phone: 'right' },
    });
  });

  it('joins the notes when both sides have different ones', () => {
    const left = subject({ notes: 'Leads walks.' });
    const right = subject({ notes: 'First aider.' });
    expect(defaultChoices(left, right).notes).toBe('both');
  });

  it('takes the only notes there are, and does not double identical ones', () => {
    expect(defaultChoices(subject({ notes: '' }), subject({ notes: 'First aider.' })).notes).toBe(
      'right',
    );
    expect(defaultChoices(subject({ notes: 'Same.' }), subject({ notes: 'Same.' })).notes).toBe(
      'left',
    );
    expect(defaultChoices(subject({ notes: '' }), subject({ notes: '' })).notes).toBe('left');
  });
});

describe('differs', () => {
  it('treats null and empty as the same, and is exact otherwise', () => {
    expect(differs(subject({ phone: null }), subject({ phone: '' }), 'phone')).toBe(false);
    expect(
      differs(subject({ email: 'a@example.com' }), subject({ email: 'A@example.com' }), 'email'),
    ).toBe(true);
    expect(differs(subject({}), subject({}), 'firstName')).toBe(false);
  });
});

describe('mergedResult', () => {
  const left = subject({
    id: 'l',
    firstName: 'Zoë',
    email: 'zoe@example.com',
    notes: 'Leads walks.',
  });
  const right = subject({ id: 'r', firstName: 'Zoe', email: null, notes: 'First aider.' });

  it('takes each field from the chosen side', () => {
    const result = mergedResult(left, right, {
      keep: 'left',
      fields: { firstName: 'right', lastName: 'left', email: 'left', phone: 'left' },
      notes: 'right',
    });
    expect(result).toEqual({
      firstName: 'Zoe',
      lastName: 'Brandt',
      email: 'zoe@example.com',
      phone: '07700 900131',
      notes: 'First aider.',
    });
  });

  it('puts the kept record’s notes first when joining', () => {
    const fields = { firstName: 'left', lastName: 'left', email: 'left', phone: 'left' } as const;
    expect(mergedResult(left, right, { keep: 'left', fields, notes: 'both' }).notes).toBe(
      'Leads walks.\n\nFirst aider.',
    );
    expect(mergedResult(left, right, { keep: 'right', fields, notes: 'both' }).notes).toBe(
      'First aider.\n\nLeads walks.',
    );
  });

  it('does not leave a gap when one side has no notes', () => {
    const fields = { firstName: 'left', lastName: 'left', email: 'left', phone: 'left' } as const;
    const empty = subject({ id: 'r', notes: '  ' });
    expect(mergedResult(left, empty, { keep: 'left', fields, notes: 'both' }).notes).toBe(
      'Leads walks.',
    );
  });
});

describe('toMergeInput', () => {
  const left = subject({ id: 'left-id', revision: 3 });
  const right = subject({ id: 'right-id', revision: 7 });
  const fields = { firstName: 'left', lastName: 'right', email: 'right', phone: 'left' } as const;

  it('names the kept record as the survivor and translates each side', () => {
    expect(toMergeInput(left, right, { keep: 'right', fields, notes: 'left' })).toEqual({
      survivorId: 'right-id',
      absorbedId: 'left-id',
      expectedSurvivorRevision: 7,
      expectedAbsorbedRevision: 3,
      firstName: 'ABSORBED',
      lastName: 'SURVIVOR',
      email: 'SURVIVOR',
      phone: 'ABSORBED',
      notes: 'ABSORBED',
    });
  });

  it('gives the mirror image when the other record is kept', () => {
    expect(toMergeInput(left, right, { keep: 'left', fields, notes: 'both' })).toMatchObject({
      survivorId: 'left-id',
      absorbedId: 'right-id',
      firstName: 'SURVIVOR',
      lastName: 'ABSORBED',
      notes: 'BOTH',
    });
  });

  it('labels every field it offers', () => {
    expect(Object.keys(FIELD_LABELS)).toEqual([...MERGE_FIELDS]);
  });
});
