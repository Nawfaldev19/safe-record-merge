import { useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery } from 'urql';
import { useToast } from '../../components/overlays';
import { Banner, Button, EmptyState, ErrorState, Skeleton } from '../../components/ui';
import { DismissDuplicateMutation, DuplicatesQuery } from '../../graphql/operations';
import { readFailure } from '../../lib/errors';
import { useWorkspace } from '../auth/session';

/** A score from 0 to 1 as a whole percentage, which reads more naturally. */
export const percent = (score: number): string => `${String(Math.round(score * 100))}%`;

export function DuplicatesPage() {
  const workspace = useWorkspace();
  const toast = useToast();
  const [{ data, fetching, error }, refetch] = useQuery({
    query: DuplicatesQuery,
    variables: { workspaceId: workspace.id },
    requestPolicy: 'network-only',
  });
  const [, dismiss] = useMutation(DismissDuplicateMutation);
  const [failure, setFailure] = useState<string | null>(null);

  if (fetching && !data) return <Skeleton lines={6} label="Looking for duplicates" />;
  if (error && !data) {
    return (
      <ErrorState
        message={readFailure(error)?.message ?? 'Please try again.'}
        onRetry={() => {
          refetch({ requestPolicy: 'network-only' });
        }}
      />
    );
  }
  const report = data?.workspace.duplicates;
  if (!report) return null;

  const notADuplicate = async (firstId: string, secondId: string): Promise<void> => {
    setFailure(null);
    const result = await dismiss({ workspaceId: workspace.id, firstId, secondId });
    const problem = readFailure(result.error);
    if (problem) {
      setFailure(problem.message);
      return;
    }
    toast('Noted. This pair will not be suggested again.');
    refetch({ requestPolicy: 'network-only' });
  };

  return (
    <div className="stack stack--loose">
      <div className="stack stack--tight">
        <h1>Likely duplicates</h1>
        <p className="muted">
          Checked {report.membersChecked} people by comparing {report.comparisons}{' '}
          {report.comparisons === 1 ? 'pair' : 'pairs'} that share an email, a phone number or a
          similar name.
        </p>
      </div>
      {failure ? (
        <Banner tone="danger" role="alert">
          {failure}
        </Banner>
      ) : null}

      <div className="card card--flush">
        {report.pairs.length === 0 ? (
          <EmptyState title="No duplicates found">
            Nobody on the roster looks like anybody else right now.
          </EmptyState>
        ) : (
          <ul className="list" aria-label="Likely duplicates">
            {report.pairs.map((pair) => (
              <li key={pair.id} className="list__item">
                <div className="grow stack stack--tight">
                  <strong>
                    {pair.left.firstName} {pair.left.lastName}
                    <span className="muted"> and </span>
                    {pair.right.firstName} {pair.right.lastName}
                  </strong>
                  <span className="small muted">{pair.reasons.join(' · ')}</span>
                </div>
                <div className="row">
                  <span className="score" aria-label={`${percent(pair.score)} alike`}>
                    {percent(pair.score)}
                  </span>
                  {workspace.canEdit ? (
                    <Button
                      aria-label={`${pair.left.firstName} ${pair.left.lastName} and ${pair.right.firstName} ${pair.right.lastName} are not the same person`}
                      onClick={() => {
                        void notADuplicate(pair.left.id, pair.right.id);
                      }}
                    >
                      Not the same person
                    </Button>
                  ) : null}
                  <Link
                    className="button button--primary"
                    to={`/w/${workspace.id}/merge/${pair.left.id}/${pair.right.id}`}
                  >
                    Compare
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
