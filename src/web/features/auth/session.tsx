import { createContext, use, useMemo } from 'react';
import type { ReactNode } from 'react';
import { Navigate, Outlet, useLocation, useParams } from 'react-router';
import { useClient, useQuery } from 'urql';
import { ErrorState, Skeleton } from '../../components/ui';
import { LoginMutation, LogoutMutation, ViewerQuery } from '../../graphql/operations';
import type { ResultOf } from '../../graphql/tada';
import { readFailure } from '../../lib/errors';
import type { ApiFailure } from '../../lib/errors';

type Viewer = NonNullable<ResultOf<typeof ViewerQuery>['viewer']>;
type Membership = Viewer['memberships'][number];

interface Session {
  viewer: Viewer | null;
  loading: boolean;
  failure: ApiFailure | null;
  signIn: (email: string, password: string) => Promise<Viewer | ApiFailure>;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<Session | null>(null);

/**
 * Holds "who is signed in" for the whole app, so every page and the route
 * guard read the same answer and see sign-in and sign-out at the same moment.
 */
export function SessionHost({ children }: { children: ReactNode }) {
  const client = useClient();
  const [{ data, fetching, error }] = useQuery({ query: ViewerQuery });

  const session = useMemo<Session>(() => {
    const refresh = async (): Promise<Viewer | null> => {
      const result = await client
        .query(ViewerQuery, {}, { requestPolicy: 'network-only' })
        .toPromise();
      return result.data?.viewer ?? null;
    };
    return {
      viewer: data?.viewer ?? null,
      loading: fetching && !data,
      failure: data ? null : readFailure(error),
      signIn: async (email, password) => {
        const result = await client.mutation(LoginMutation, { email, password }).toPromise();
        const failure = readFailure(result.error);
        if (failure) return failure;
        const viewer = await refresh();
        return viewer ?? { code: 'INTERNAL', message: 'Sign-in did not complete.', issues: [] };
      },
      signOut: async () => {
        await client.mutation(LogoutMutation, {}).toPromise();
        await refresh();
      },
    };
  }, [client, data, fetching, error]);

  return <SessionContext value={session}>{children}</SessionContext>;
}

export function useSession(): Session {
  const session = use(SessionContext);
  if (!session) throw new Error('useSession must be used inside SessionHost.');
  return session;
}

const ROLE_RANK = { ORGANIZER: 0, VOLUNTEER: 1, READER: 2 } as const;

/**
 * Where to take someone after signing in: the club in which they hold the most
 * responsibility, which is where they most likely have work to do.
 */
export function homePath(viewer: Viewer): string {
  const [home] = [...viewer.memberships].sort((a, b) => ROLE_RANK[a.role] - ROLE_RANK[b.role]);
  return home ? `/w/${home.workspace.id}/roster` : '/';
}

export function isFailure(value: Viewer | ApiFailure): value is ApiFailure {
  return 'code' in value;
}

export interface WorkspaceContextValue {
  id: string;
  name: string;
  role: Membership['role'];
  /** Volunteers and organizers may add, edit and merge. Readers may only look. */
  canEdit: boolean;
  isOrganizer: boolean;
  viewer: Viewer;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function useWorkspace(): WorkspaceContextValue {
  const workspace = use(WorkspaceContext);
  if (!workspace) throw new Error('useWorkspace must be used inside a workspace route.');
  return workspace;
}

/**
 * Guards every /w/:workspaceId page. Signed-out visitors go to the sign-in
 * page; a club the viewer does not belong to shows "not found". This is a
 * convenience for honest users: the API enforces both rules as well.
 */
export function WorkspaceRoute({ shell }: { shell: (content: ReactNode) => ReactNode }) {
  const { viewer, loading, failure } = useSession();
  const { workspaceId = '' } = useParams();
  const location = useLocation();

  if (loading) {
    return (
      <main className="page">
        <Skeleton lines={5} label="Checking your session" />
      </main>
    );
  }
  if (failure && !viewer) {
    return (
      <main className="page">
        <ErrorState message={failure.message} />
      </main>
    );
  }
  if (!viewer) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  const membership = viewer.memberships.find((item) => item.workspace.id === workspaceId);
  if (!membership) {
    return (
      <main className="page">
        <ErrorState
          title="Club not found"
          message="It does not exist, or you are not part of it."
        />
      </main>
    );
  }

  const value: WorkspaceContextValue = {
    id: membership.workspace.id,
    name: membership.workspace.name,
    role: membership.role,
    canEdit: membership.role !== 'READER',
    isOrganizer: membership.role === 'ORGANIZER',
    viewer,
  };
  return <WorkspaceContext value={value}>{shell(<Outlet />)}</WorkspaceContext>;
}
