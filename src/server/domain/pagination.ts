import { invalid } from './errors';

/**
 * Keyset ("cursor") pagination. A cursor holds the sort value and the id of the
 * last row of a page; the next page asks for rows after that pair. Unlike
 * OFFSET, the cost of a page does not grow with its position, and rows added
 * while someone is paging do not shift later pages.
 */

export interface PageRequest {
  first: number;
  after: string | null;
}

export interface Page<T> {
  items: T[];
  endCursor: string | null;
  hasNextPage: boolean;
}

export interface CursorPosition {
  /** The value the list is sorted by, as text (a timestamp or a name). */
  sortValue: string;
  id: string;
}

export const MAX_PAGE_SIZE = 50;
export const DEFAULT_PAGE_SIZE = 25;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID.test(value);
}

export function encodeCursor(position: CursorPosition): string {
  return Buffer.from(JSON.stringify([position.sortValue, position.id])).toString('base64url');
}

export function decodeCursor(cursor: string): CursorPosition {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (Array.isArray(parsed) && parsed.length === 2) {
      const [sortValue, id] = parsed as unknown[];
      if (typeof sortValue === 'string' && typeof id === 'string' && isUuid(id)) {
        return { sortValue, id };
      }
    }
  } catch {
    // Fall through to the error below: any unreadable cursor gets the same answer.
  }
  throw invalid('The paging cursor is not valid.');
}

export function normalizePageRequest(
  first: number | null | undefined,
  after: string | null | undefined,
): PageRequest {
  const size = first ?? DEFAULT_PAGE_SIZE;
  if (!Number.isInteger(size) || size < 1 || size > MAX_PAGE_SIZE) {
    throw invalid(`"first" must be a whole number from 1 to ${MAX_PAGE_SIZE}.`);
  }
  return { first: size, after: after ?? null };
}

/**
 * Builds a page from rows fetched with LIMIT first + 1. The extra row only tells
 * whether another page exists and is not returned.
 */
export function toPage<T>(rows: T[], first: number, position: (row: T) => CursorPosition): Page<T> {
  const items = rows.slice(0, first);
  const last = items.at(-1);
  return {
    items,
    endCursor: last ? encodeCursor(position(last)) : null,
    hasNextPage: rows.length > first,
  };
}
