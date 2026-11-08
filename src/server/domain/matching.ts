/**
 * Finding likely duplicates in a roster.
 *
 * Two questions are kept apart:
 *   1. Which pairs are worth comparing at all? (blocking)
 *   2. How alike is a pair, and why? (scoring)
 *
 * Comparing every member with every other is quadratic: 3,000 members would be
 * 4.5 million comparisons. Blocking puts each member into a few small groups by
 * cheap keys (same email, same phone, similar-looking name) and only compares
 * within a group. A pair that shares no key is never compared, which is the
 * trade: far less work, and a small chance of missing a pair that differs in
 * every key at once.
 */

export interface Matchable {
  id: string;
  firstName: string;
  lastName: string;
  emailKey: string | null;
  phoneKey: string | null;
}

export interface CandidatePair {
  /** The two ids in a fixed order (lowId < highId), so a pair has one identity. */
  lowId: string;
  highId: string;
  /** 0 to 1. Higher means more likely the same person. */
  score: number;
  /** Sentences that explain the score to a person. */
  reasons: string[];
}

/** Lower-cases and trims an email. Null when there is nothing to compare. */
export function emailKey(email: string | null | undefined): string | null {
  const key = (email ?? '').trim().toLowerCase();
  return key === '' ? null : key;
}

/**
 * Reduces a phone number to its last nine digits, so that "+44 7700 900123",
 * "07700 900123" and "7700900123" all match. Shorter numbers are kept whole;
 * anything under six digits is too short to be evidence.
 */
export function phoneKey(phone: string | null | undefined): string | null {
  const digits = (phone ?? '').replace(/\D/g, '');
  if (digits.length < 6) return null;
  return digits.slice(-9);
}

/** Lower case, no accents, no punctuation, single spaces. "Zoë  O'Brien" becomes "zoe obrien". */
export function plainName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/[\s-]+/g, ' ')
    .trim();
}

/** The words of a full name in alphabetical order, so "Ito Jun" equals "Jun Ito". */
export function nameKey(firstName: string, lastName: string): string {
  return plainName(`${firstName} ${lastName}`).split(' ').filter(Boolean).sort().join(' ');
}

/**
 * Edit distance that counts a swap of two neighbouring letters as one step
 * (optimal string alignment). Swaps are the most common typing mistake in names.
 */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let beforePrevious: number[] = [];
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let best = Math.min(
        (previous[j] ?? 0) + 1,
        (current[j - 1] ?? 0) + 1,
        (previous[j - 1] ?? 0) + cost,
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        best = Math.min(best, (beforePrevious[j - 2] ?? 0) + 1);
      }
      current.push(best);
    }
    beforePrevious = previous;
    previous = current;
  }
  return previous[b.length] ?? 0;
}

/** 1 for identical name keys, falling towards 0 as more letters differ. */
export function nameSimilarity(a: string, b: string): number {
  const longest = Math.max(a.length, b.length);
  if (longest === 0) return 0;
  return 1 - editDistance(a, b) / longest;
}

const WEIGHTS = { email: 0.6, phone: 0.5, nameExact: 0.45, nameClose: 0.3 } as const;
const NAME_CLOSE = 0.82;
export const DEFAULT_THRESHOLD = 0.5;

/** Scores one pair and says why. Evidence adds up and is capped at 1. */
export function scorePair(a: Matchable, b: Matchable): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;

  if (a.emailKey !== null && a.emailKey === b.emailKey) {
    score += WEIGHTS.email;
    reasons.push('Same email address');
  }
  if (a.phoneKey !== null && a.phoneKey === b.phoneKey) {
    score += WEIGHTS.phone;
    reasons.push('Same phone number');
  }

  const keyA = nameKey(a.firstName, a.lastName);
  const keyB = nameKey(b.firstName, b.lastName);
  if (keyA !== '' && keyA === keyB) {
    score += WEIGHTS.nameExact;
    const sameOrder = plainName(a.firstName) === plainName(b.firstName);
    reasons.push(sameOrder ? 'Same name' : 'Same name with first and last name swapped');
  } else if (nameSimilarity(keyA, keyB) >= NAME_CLOSE) {
    score += WEIGHTS.nameClose;
    reasons.push('Very similar name');
  }

  return { score: Math.min(1, Number(score.toFixed(2))), reasons };
}

/**
 * The groups a member is compared within. Name keys use the first three letters
 * of each word of the name: close enough to catch a typo further along, coarse
 * enough to keep groups small.
 */
export function blockingKeys(member: Matchable): string[] {
  const keys: string[] = [];
  if (member.emailKey !== null) keys.push(`e:${member.emailKey}`);
  if (member.phoneKey !== null) keys.push(`p:${member.phoneKey}`);
  const words = nameKey(member.firstName, member.lastName).split(' ').filter(Boolean);
  if (words.length > 0) keys.push(`n:${words.map((word) => word.slice(0, 3)).join('|')}`);
  return keys;
}

export function pairId(a: string, b: string): { lowId: string; highId: string } {
  return a < b ? { lowId: a, highId: b } : { lowId: b, highId: a };
}

export interface CandidateSearch {
  pairs: CandidatePair[];
  /** How many pairs were actually scored, for judging the blocking. */
  comparisons: number;
}

/**
 * Finds every pair that scores at least `threshold`, best first.
 * `dismissed` holds pairs a person has marked as "not a duplicate" ("low:high").
 */
export function findCandidates(
  members: readonly Matchable[],
  options: { threshold?: number; dismissed?: ReadonlySet<string> } = {},
): CandidateSearch {
  const threshold = options.threshold ?? DEFAULT_THRESHOLD;
  const blocks = new Map<string, Matchable[]>();
  for (const member of members) {
    for (const key of blockingKeys(member)) {
      const block = blocks.get(key);
      if (block) block.push(member);
      else blocks.set(key, [member]);
    }
  }

  const seen = new Set<string>();
  const pairs: CandidatePair[] = [];
  let comparisons = 0;
  for (const block of blocks.values()) {
    for (let i = 0; i < block.length; i += 1) {
      for (let j = i + 1; j < block.length; j += 1) {
        const a = block[i];
        const b = block[j];
        if (!a || !b || a.id === b.id) continue;
        const ids = pairId(a.id, b.id);
        const key = `${ids.lowId}:${ids.highId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (options.dismissed?.has(key)) continue;

        comparisons += 1;
        const { score, reasons } = scorePair(a, b);
        if (score >= threshold) pairs.push({ ...ids, score, reasons });
      }
    }
  }
  pairs.sort((x, y) => y.score - x.score || x.lowId.localeCompare(y.lowId));
  return { pairs, comparisons };
}
