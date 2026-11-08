import { describe, expect, it } from 'vitest';
import {
  blockingKeys,
  editDistance,
  emailKey,
  findCandidates,
  nameKey,
  nameSimilarity,
  pairId,
  phoneKey,
  plainName,
  scorePair,
} from '../../src/server/domain/matching';
import type { Matchable } from '../../src/server/domain/matching';

let nextId = 0;
const person = (
  firstName: string,
  lastName: string,
  email: string | null = null,
  phone: string | null = null,
): Matchable => {
  nextId += 1;
  return {
    id: `id-${String(nextId).padStart(5, '0')}`,
    firstName,
    lastName,
    emailKey: emailKey(email),
    phoneKey: phoneKey(phone),
  };
};

describe('normalizing', () => {
  it('compares emails without case or surrounding spaces', () => {
    expect(emailKey('  Zoe.Brandt@Example.COM ')).toBe('zoe.brandt@example.com');
    expect(emailKey('')).toBeNull();
    expect(emailKey('   ')).toBeNull();
    expect(emailKey(null)).toBeNull();
  });

  it('compares phone numbers by their last nine digits', () => {
    const forms = [
      '+44 7700 900123',
      '07700 900123',
      '(07700) 900-123',
      '7700900123',
      '0044 7700 900 123',
    ];
    expect(new Set(forms.map(phoneKey))).toEqual(new Set(['700900123']));
    expect(phoneKey('555 0100')).toBe('5550100');
  });

  it('treats very short numbers as no evidence', () => {
    expect(phoneKey('12345')).toBeNull();
    expect(phoneKey('ext. 12')).toBeNull();
    expect(phoneKey(undefined)).toBeNull();
  });

  it('strips accents, case and punctuation from names', () => {
    expect(plainName("  Zoë  O'Brien-Smith ")).toBe('zoe obrien smith');
    expect(plainName('ENGSTRÖM')).toBe('engstrom');
    expect(plainName('José María')).toBe('jose maria');
  });

  it('makes a name key that ignores word order', () => {
    expect(nameKey('Jun', 'Ito')).toBe(nameKey('Ito', 'Jun'));
    expect(nameKey('Katarzyna', 'Wolska')).toBe('katarzyna wolska');
    expect(nameKey('', '')).toBe('');
  });
});

describe('edit distance', () => {
  it('counts insertions, deletions and substitutions', () => {
    expect(editDistance('kitten', 'sitting')).toBe(3);
    expect(editDistance('', 'abc')).toBe(3);
    expect(editDistance('abc', '')).toBe(3);
    expect(editDistance('same', 'same')).toBe(0);
  });

  it('counts a swap of neighbouring letters as one step', () => {
    expect(editDistance('mattias', 'mattais')).toBe(1);
    expect(editDistance('ab', 'ba')).toBe(1);
    expect(editDistance('abcd', 'badc')).toBe(2);
  });

  it('is symmetric', () => {
    expect(editDistance('engstrom', 'engstrm')).toBe(editDistance('engstrm', 'engstrom'));
  });

  it('gives a similarity between 0 and 1', () => {
    expect(nameSimilarity('abc', 'abc')).toBe(1);
    expect(nameSimilarity('abc', 'xyz')).toBe(0);
    expect(nameSimilarity('', '')).toBe(0);
    expect(nameSimilarity('engstrom mattias', 'engstrom matias')).toBeGreaterThan(0.9);
  });
});

describe('scorePair', () => {
  it('scores an exact match on everything as certain', () => {
    const a = person('Priya', 'Raman', 'priya@example.com', '07700 900134');
    const b = person('Priya', 'Raman', 'PRIYA@example.com', '+44 7700 900134');
    expect(scorePair(a, b)).toEqual({
      score: 1,
      reasons: ['Same email address', 'Same phone number', 'Same name'],
    });
  });

  it('explains a swapped name', () => {
    const a = person('Katarzyna', 'Wolska', null, '07700 900132');
    const b = person('Wolska', 'Katarzyna', null, '+44 7700 900132');
    expect(scorePair(a, b)).toEqual({
      score: 0.95,
      reasons: ['Same phone number', 'Same name with first and last name swapped'],
    });
  });

  it('recognises a typing mistake in a name', () => {
    const a = person('Mattias', 'Engstrom', null, '07700 900133');
    const b = person('Matias', 'Engström', null, '(07700) 900-133');
    expect(scorePair(a, b).reasons).toEqual(['Same phone number', 'Very similar name']);
    expect(scorePair(a, b).score).toBe(0.8);
  });

  it('does not treat a shared surname as evidence on its own', () => {
    const a = person('Anna', 'Lindgren');
    const b = person('Oskar', 'Lindgren');
    expect(scorePair(a, b)).toEqual({ score: 0, reasons: [] });
  });

  it('does not count two missing emails or phones as a match', () => {
    expect(scorePair(person('Ada', 'Fenwick'), person('Bao', 'Tran'))).toEqual({
      score: 0,
      reasons: [],
    });
  });

  it('scores a name alone below the default threshold', () => {
    const a = person('Sam', 'Okoye', 'sam@example.com');
    const b = person('Sam', 'Okoye', 'samuel@example.com');
    expect(scorePair(a, b).score).toBeLessThan(0.5);
  });
});

describe('blocking', () => {
  it('gives a member one key per kind of evidence it has', () => {
    expect(blockingKeys(person('Zoë', 'Brandt', 'zoe@example.com', '07700 900131'))).toEqual([
      'e:zoe@example.com',
      'p:700900131',
      'n:bra|zoe',
    ]);
    expect(blockingKeys(person('Ada', 'Fenwick'))).toEqual(['n:ada|fen']);
  });

  it('puts swapped and slightly misspelled names in the same block', () => {
    const key = (first: string, last: string) => blockingKeys(person(first, last)).at(-1);
    expect(key('Katarzyna', 'Wolska')).toBe(key('Wolska', 'Katarzyna'));
    expect(key('Mattias', 'Engstrom')).toBe(key('Matias', 'Engström'));
  });

  it('orders a pair of ids the same way whichever comes first', () => {
    expect(pairId('b', 'a')).toEqual({ lowId: 'a', highId: 'b' });
    expect(pairId('a', 'b')).toEqual({ lowId: 'a', highId: 'b' });
  });
});

describe('findCandidates', () => {
  const zoe = person('Zoë', 'Brandt', 'zoe.brandt@example.com', '07700 900131');
  const zoeAgain = person('Zoe', 'Brandt', 'Zoe.Brandt@Example.com');
  const kasia = person('Katarzyna', 'Wolska', 'kasia@example.com', '+44 7700 900132');
  const kasiaSwapped = person('Wolska', 'Katarzyna', null, '07700 900132');
  const anna = person('Anna', 'Lindgren', 'anna@example.com', '07700 900140');
  const anne = person('Anne', 'Lindgren', 'anne@example.com', '07700 900140');
  const others = [
    person('Ada', 'Fenwick', 'ada@example.com'),
    person('Bao', 'Tran', 'bao@example.com'),
  ];
  const roster = [zoe, zoeAgain, kasia, kasiaSwapped, anna, anne, ...others];

  it('finds each duplicate pair once, best first, and nothing else', () => {
    const { pairs } = findCandidates(roster);
    expect(pairs.map((pair) => [pair.lowId, pair.highId])).toEqual([
      [zoe.id, zoeAgain.id],
      [kasia.id, kasiaSwapped.id],
      [anna.id, anne.id],
    ]);
    expect(pairs.map((pair) => pair.score)).toEqual([1, 0.95, 0.8]);
  });

  it('leaves out pairs a person has dismissed', () => {
    const { pairs } = findCandidates(roster, { dismissed: new Set([`${anna.id}:${anne.id}`]) });
    expect(pairs).toHaveLength(2);
    expect(pairs.some((pair) => pair.lowId === anna.id)).toBe(false);
  });

  it('respects the threshold', () => {
    expect(findCandidates(roster, { threshold: 0.9 }).pairs).toHaveLength(2);
    expect(findCandidates(roster, { threshold: 1.01 }).pairs).toEqual([]);
  });

  it('scores a pair once even when it shares several blocks', () => {
    const a = person('Priya', 'Raman', 'priya@example.com', '07700 900134');
    const b = person('Priya', 'Raman', 'priya@example.com', '07700 900134');
    expect(findCandidates([a, b])).toMatchObject({ comparisons: 1, pairs: [{ score: 1 }] });
  });

  it('returns nothing for an empty or single-person roster', () => {
    expect(findCandidates([])).toEqual({ pairs: [], comparisons: 0 });
    expect(findCandidates([zoe])).toEqual({ pairs: [], comparisons: 0 });
  });

  it('compares far fewer pairs than every-with-every on a large roster, and stays fast', () => {
    const syllables = [
      'ka',
      'lo',
      'mi',
      'ne',
      'ru',
      'sa',
      'ti',
      'vo',
      'za',
      'be',
      'di',
      'fu',
      'ge',
      'ho',
    ];
    const word = (n: number): string =>
      [0, 1, 2].map((place) => syllables[Math.floor(n / 14 ** place) % 14]).join('');
    const size = 3000;
    const big: Matchable[] = Array.from({ length: size }, (_, index) =>
      person(
        word(index),
        word(index * 7 + 3),
        `person${String(index)}@example.com`,
        `07${String(100000000 + index)}`,
      ),
    );
    // Plant 30 true duplicates among them.
    const planted = Array.from({ length: 30 }, (_, index) => {
      const original = big[index * 97];
      if (!original) throw new Error('fixture too small');
      return { ...original, id: `dup-${String(index).padStart(3, '0')}` };
    });

    const started = performance.now();
    const { pairs, comparisons } = findCandidates([...big, ...planted]);
    const elapsed = performance.now() - started;

    const everyWithEvery = ((size + 30) * (size + 29)) / 2;
    expect(comparisons).toBeLessThan(everyWithEvery / 50);
    expect(pairs.filter((pair) => pair.score === 1)).toHaveLength(30);
    expect(elapsed).toBeLessThan(2000);
  });
});
