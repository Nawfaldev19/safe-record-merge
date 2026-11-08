export type ErrorCode =
  'UNAUTHENTICATED' | 'FORBIDDEN' | 'NOT_FOUND' | 'VALIDATION' | 'CONFLICT' | 'RATE_LIMITED';

/** One problem with one input. `field` is null when it concerns the whole request. */
export interface Issue {
  field: string | null;
  message: string;
}

/**
 * An error the caller is allowed to see. Anything that is not an AppError is
 * treated as a bug: it is logged in full and reported to the caller only as
 * "something went wrong".
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly issues: readonly Issue[];

  constructor(code: ErrorCode, message: string, issues: readonly Issue[] = []) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.issues = issues;
  }
}

export const notFound = (what: string): AppError => new AppError('NOT_FOUND', `${what} not found.`);

export const forbidden = (message = 'Your role does not allow this.'): AppError =>
  new AppError('FORBIDDEN', message);

export const conflict = (message: string): AppError => new AppError('CONFLICT', message);

export const invalid = (message: string, issues: readonly Issue[] = []): AppError =>
  new AppError('VALIDATION', message, issues);
