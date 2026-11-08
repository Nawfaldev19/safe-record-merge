import { useState } from 'react';
import { Building2, GitMerge, ScanSearch, Undo2 } from 'lucide-react';
import { useNavigate } from 'react-router';
import { ThemeToggle } from '../../components/ThemeToggle';
import { Banner, Button } from '../../components/ui';
import { homePath, isFailure, useSession } from '../auth/session';
import { Brand } from '../shell/AppShell';

/** Demo accounts seeded by the server. They are fictional and documented in the README. */
export const DEMO_PASSWORD = 'trailhead-demo';
export const DEMO_ACCOUNTS = [
  { role: 'Organizer', email: 'hollis@example.com', can: 'everything, including undoing merges' },
  { role: 'Volunteer', email: 'petra@example.com', can: 'add, edit, merge and export' },
  { role: 'Reader', email: 'jun@example.com', can: 'look, and nothing else' },
] as const;

const FEATURES = [
  {
    icon: ScanSearch,
    title: 'Finds likely duplicates',
    text: 'Matches on email, phone and name, tolerating accents, typing mistakes and swapped names, and says why each pair was suggested.',
  },
  {
    icon: GitMerge,
    title: 'Merges in one safe step',
    text: 'You choose the value to keep for each field. Trips, payments and history are combined in a single transaction, or not at all.',
  },
  {
    icon: Undo2,
    title: 'Every merge can be undone',
    text: 'A journal records exactly what a merge changed. Undo replays it backwards, and refuses when that would lose later edits.',
  },
  {
    icon: Building2,
    title: 'Clubs kept apart',
    text: 'Row-level security in the database keeps each club to its own roster, even if the application code makes a mistake.',
  },
] as const;

export function LandingPage() {
  const { viewer, signIn } = useSession();
  const navigate = useNavigate();
  const [busy, setBusy] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const open = async (email: string): Promise<void> => {
    setBusy(email);
    setFailure(null);
    const result = await signIn(email, DEMO_PASSWORD);
    setBusy(null);
    if (isFailure(result)) {
      setFailure(result.message);
      return;
    }
    await navigate(homePath(result));
  };

  return (
    <>
      <header className="shell__header">
        <div className="shell__bar row--between">
          <Brand />
          <div className="row">
            <ThemeToggle />
            {viewer ? (
              <Button
                variant="primary"
                onClick={() => {
                  void navigate(homePath(viewer));
                }}
              >
                Open the roster
              </Button>
            ) : (
              <Button
                onClick={() => {
                  void navigate('/login');
                }}
              >
                Sign in
              </Button>
            )}
          </div>
        </div>
      </header>
      <main id="main" className="page rise-in">
        <section className="hero">
          <p className="eyebrow">A portfolio demo</p>
          <h1 className="hero__title">One person, one record.</h1>
          <p className="hero__lead">
            Record Merge keeps the member roster of a fictional hiking club. People sign up on
            paper, on the web and at events, so the same person often ends up on the list twice.
            Record Merge finds those pairs and merges them safely. It exists to show how to design a
            destructive operation so that it is atomic, auditable and reversible.
          </p>
        </section>

        <section className="stack stack--loose" aria-labelledby="demo-heading">
          <div className="card stack">
            <h2 id="demo-heading">Open the demo</h2>
            <p className="muted">
              The data is seeded and fictional. Pick a role to sign in. Every account uses the
              password <code>{DEMO_PASSWORD}</code>.
            </p>
            {failure ? (
              <Banner tone="danger" role="alert">
                {failure}
              </Banner>
            ) : null}
            <div className="row">
              {DEMO_ACCOUNTS.map((account) => (
                <Button
                  key={account.email}
                  variant={account.role === 'Organizer' ? 'primary' : 'default'}
                  busy={busy === account.email}
                  disabled={busy !== null}
                  onClick={() => {
                    void open(account.email);
                  }}
                >
                  Continue as {account.role.toLowerCase()}
                </Button>
              ))}
            </div>
            <dl className="definition small">
              {DEMO_ACCOUNTS.map((account) => (
                <div key={account.email} style={{ display: 'contents' }}>
                  <dt>{account.role}</dt>
                  <dd>
                    <code>{account.email}</code>, can {account.can}
                  </dd>
                </div>
              ))}
            </dl>
          </div>

          <div className="feature-grid">
            {FEATURES.map((feature) => (
              <article key={feature.title} className="card stack stack--tight">
                <feature.icon aria-hidden="true" />
                <h3>{feature.title}</h3>
                <p className="muted small">{feature.text}</p>
              </article>
            ))}
          </div>
        </section>
      </main>
    </>
  );
}
