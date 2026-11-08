import { AppError } from '../domain/errors';
import { requireScope, resolveSession } from '../services/auth-service';
import type { Deps, Scope, UserRecord } from '../services/records';

export const SESSION_COOKIE = 'record_merge_session';

export interface CookieWriter {
  set(name: string, value: string, expires: Date): void;
  clear(name: string): void;
}

export interface GraphQLContext {
  deps: Deps;
  user: UserRecord | null;
  sessionToken: string | null;
  /** Identifies the caller for rate limiting (the network address when known). */
  clientKey: string;
  cookies: CookieWriter;
  /** The signed-in user's place in a workspace. Looked up once per request. */
  scope(workspaceId: string): Promise<Scope>;
}

export function readCookie(header: string | null, name: string): string | null {
  if (header === null) return null;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

export async function buildContext(
  deps: Deps,
  request: { headers: { get(name: string): string | null } },
  clientKey: string,
  cookies: CookieWriter,
): Promise<GraphQLContext> {
  const sessionToken = readCookie(request.headers.get('cookie'), SESSION_COOKIE);
  const user = sessionToken === null ? null : await resolveSession(deps, sessionToken);
  const scopes = new Map<string, Promise<Scope>>();

  return {
    deps,
    user,
    sessionToken,
    clientKey,
    cookies,
    scope(workspaceId) {
      if (user === null) {
        return Promise.reject(new AppError('UNAUTHENTICATED', 'Sign in to continue.'));
      }
      let scope = scopes.get(workspaceId);
      if (!scope) {
        scope = requireScope(deps, user.id, workspaceId, 'reader');
        scopes.set(workspaceId, scope);
      }
      return scope;
    },
  };
}
