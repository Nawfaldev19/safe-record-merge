import type { CombinedError } from 'urql';

/** One problem with one input, as the API reports it. */
export interface Issue {
  field: string | null;
  message: string;
}

export interface ApiFailure {
  /** A stable code from the API, or NETWORK when the request never arrived. */
  code: string;
  message: string;
  issues: Issue[];
}

function isIssue(value: unknown): value is Issue {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.message === 'string' &&
    (candidate.field === null || typeof candidate.field === 'string')
  );
}

/** Turns whatever urql reports into one shape the UI can show. */
export function readFailure(error: CombinedError | undefined): ApiFailure | null {
  if (!error) return null;
  const first = error.graphQLErrors[0];
  if (!first) {
    return {
      code: 'NETWORK',
      message: 'The server could not be reached. Check your connection and try again.',
      issues: [],
    };
  }
  const code = typeof first.extensions.code === 'string' ? first.extensions.code : 'INTERNAL';
  const rawIssues: unknown = first.extensions.issues;
  return {
    code,
    message: first.message,
    issues: Array.isArray(rawIssues) ? rawIssues.filter(isIssue) : [],
  };
}

export function issuesByField(issues: readonly Issue[]): Map<string, string[]> {
  const grouped = new Map<string, string[]>();
  for (const issue of issues) {
    if (issue.field === null) continue;
    grouped.set(issue.field, [...(grouped.get(issue.field) ?? []), issue.message]);
  }
  return grouped;
}
