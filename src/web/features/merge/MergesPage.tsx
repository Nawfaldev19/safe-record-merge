import { useState } from 'react';
import { Undo2 } from 'lucide-react';
import { Link } from 'react-router';
import { useMutation, useQuery } from 'urql';
import { Dialog, useToast } from '../../components/overlays';
import { Badge, Banner, Button, EmptyState, ErrorState, Skeleton } from '../../components/ui';
import { MergesQuery, UndoMergeMutation } from '../../graphql/operations';
import { readFailure } from '../../lib/errors';
import { formatDateTime } from '../../lib/format';
import { useWorkspace } from '../auth/session';

export function MergesPage() {
  const workspace = useWorkspace();
  const toast = useToast();
  const [{ data, fetching, error }, refetch] = useQuery({
    query: MergesQuery,
    variables: { workspaceId: workspace.id },
    requestPolicy: 'network-only',
  });
  const [undoing, undoMerge] = useMutation(UndoMergeMutation);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  if (fetching && !data) return <Skeleton lines={5} label="Loading the merge history" />;
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
  const merges = data?.workspace.merges ?? [];
  const pending = merges.find((merge) => merge.id === confirming);

  const undo = async (mergeId: string): Promise<void> => {
    setFailure(null);
    const result = await undoMerge({ workspaceId: workspace.id, mergeId });
    setConfirming(null);
    const problem = readFailure(result.error);
    if (problem) setFailure(problem.message);
    else toast('Undone. Both records are back as they were.');
    refetch({ requestPolicy: 'network-only' });
  };

  return (
    <div className="stack stack--loose">
      <div className="stack stack--tight">
        <h1>Merge history</h1>
        <p className="muted">
          Every merge is journalled, so it can be put back exactly. An organizer can undo a merge
          for as long as the kept record has not been changed since.
        </p>
      </div>
      {failure ? (
        <Banner tone="danger" role="alert">
          {failure}
        </Banner>
      ) : null}

      <div className="card card--flush">
        {merges.length === 0 ? (
          <EmptyState title="No merges yet">Merged records will be listed here.</EmptyState>
        ) : (
          <ul className="list" aria-label="Merges">
            {merges.map((merge) => (
              <li key={merge.id} className="list__item">
                <div className="grow stack stack--tight">
                  <span>
                    <Link
                      className="list__link"
                      to={`/w/${workspace.id}/members/${merge.survivorId}`}
                    >
                      {merge.survivorName}
                    </Link>{' '}
                    <span className="muted">absorbed a second record of {merge.absorbedName}</span>
                  </span>
                  <span className="small muted">
                    by {merge.mergedByName} · {formatDateTime(merge.mergedAt)}
                  </span>
                  {!merge.canUndo && !merge.undoneAt && merge.undoBlockedBy ? (
                    <span className="small muted">{merge.undoBlockedBy}</span>
                  ) : null}
                </div>
                {merge.undoneAt ? (
                  <Badge>Undone {formatDateTime(merge.undoneAt)}</Badge>
                ) : workspace.isOrganizer ? (
                  <Button
                    disabled={!merge.canUndo}
                    aria-label={`Undo the merge of ${merge.survivorName}`}
                    onClick={() => {
                      setConfirming(merge.id);
                    }}
                  >
                    <Undo2 aria-hidden="true" />
                    Undo
                  </Button>
                ) : (
                  <Badge tone="success">Merged</Badge>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <Dialog
        open={confirming !== null}
        title="Undo this merge?"
        onClose={() => {
          setConfirming(null);
        }}
      >
        <p>
          The two records of {pending?.absorbedName ?? 'this person'} become separate again, each
          with the details, trips and dues it had before the merge.
        </p>
        <div className="row row--end">
          <Button
            onClick={() => {
              setConfirming(null);
            }}
          >
            Keep the merge
          </Button>
          <Button
            variant="primary"
            busy={undoing.fetching}
            onClick={() => {
              if (confirming) void undo(confirming);
            }}
          >
            Undo the merge
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
