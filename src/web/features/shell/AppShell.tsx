import type { ReactNode } from 'react';
import { LogOut } from 'lucide-react';
import { Link, NavLink, useNavigate } from 'react-router';
import { ThemeToggle } from '../../components/ThemeToggle';
import { Badge, Button } from '../../components/ui';
import { useSession, useWorkspace } from '../auth/session';

const ROLE_LABELS = { ORGANIZER: 'Organizer', VOLUNTEER: 'Volunteer', READER: 'Reader' } as const;

export function Brand() {
  return (
    <Link to="/" className="brand">
      <img src="/favicon.svg" alt="" />
      Record Merge
    </Link>
  );
}

/** The frame around every signed-in page: brand, club switcher, navigation. */
export function AppShell({ children }: { children: ReactNode }) {
  const workspace = useWorkspace();
  const { signOut } = useSession();
  const navigate = useNavigate();
  const base = `/w/${workspace.id}`;

  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="shell__header">
        <div className="shell__bar">
          <Brand />
          <label className="row">
            <span className="sr-only">Club</span>
            <select
              className="select"
              value={workspace.id}
              onChange={(event) => {
                void navigate(`/w/${event.target.value}/roster`);
              }}
            >
              {workspace.viewer.memberships.map((membership) => (
                <option key={membership.workspace.id} value={membership.workspace.id}>
                  {membership.workspace.name}
                </option>
              ))}
            </select>
          </label>
          <nav className="nav grow" aria-label="Main">
            <NavLink className="nav__link" to={`${base}/roster`}>
              Roster
            </NavLink>
            <NavLink className="nav__link" to={`${base}/duplicates`}>
              Duplicates
            </NavLink>
            <NavLink className="nav__link" to={`${base}/merges`}>
              Merge history
            </NavLink>
          </nav>
          <div className="row">
            <Badge tone="primary">{ROLE_LABELS[workspace.role]}</Badge>
            <span className="small muted">{workspace.viewer.name}</span>
            <ThemeToggle />
            <Button
              variant="quiet"
              onClick={() => {
                // Leave the workspace pages first. Signing out while still on one
                // would make the route guard send the visitor to the sign-in page.
                void Promise.resolve(navigate('/')).then(signOut);
              }}
            >
              <LogOut aria-hidden="true" />
              Sign out
            </Button>
          </div>
        </div>
      </header>
      <main id="main" className="page rise-in">
        {children}
      </main>
    </>
  );
}
