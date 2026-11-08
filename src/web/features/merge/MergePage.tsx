import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery } from 'urql';
import { StageBadge } from '../../components/StageBadge';
import { useToast } from '../../components/overlays';
import { Banner, Button, ErrorState, Skeleton } from '../../components/ui';
import { MergeMembersMutation, MergePreviewQuery } from '../../graphql/operations';
import { readFailure } from '../../lib/errors';
import { formatDate } from '../../lib/format';
import { useWorkspace } from '../auth/session';
import {
  FIELD_LABELS,
  MERGE_FIELDS,
  defaultChoices,
  differs,
  mergedResult,
  toMergeInput,
} from './merge-model';
import type { MergeChoices, NotesChoice, Side } from './merge-model';

const SIDES: readonly Side[] = ['left', 'right'];

const trips = (count: number): string => (count === 1 ? '1 trip' : `${String(count)} trips`);

/**
 * The comparison screen. Both records are shown side by side; for every field
 * that differs, a radio button picks the value to keep. Nothing is changed
 * until "Merge" is pressed, and the summary says exactly what will happen.
 */
export function MergePage() {
  const workspace = useWorkspace();
  const { leftId = '', rightId = '' } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [{ data, fetching, error }, refetch] = useQuery({
    query: MergePreviewQuery,
    variables: { workspaceId: workspace.id, leftId, rightId },
    requestPolicy: 'network-only',
  });
  const [merging, mergeMembers] = useMutation(MergeMembersMutation);
  const [choices, setChoices] = useState<MergeChoices | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const preview = data?.workspace.mergePreview;
  const revisions = preview
    ? `${String(preview.left.revision)}-${String(preview.right.revision)}`
    : '';
  useEffect(() => {
    if (preview) setChoices(defaultChoices(preview.left, preview.right));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only when the records themselves change
  }, [leftId, rightId, revisions]);

  if (fetching && !preview) return <Skeleton lines={8} label="Loading both records" />;
  if (error && !preview) {
    const problem = readFailure(error);
    return (
      <ErrorState
        title={problem?.code === 'CONFLICT' ? 'Already merged' : 'These records cannot be compared'}
        message={problem?.message ?? 'Please try again.'}
      />
    );
  }
  if (!preview || !choices) return null;

  const { left, right } = preview;
  const records = { left, right };
  const result = mergedResult(left, right, choices);
  const kept = records[choices.keep];
  const folded = records[choices.keep === 'left' ? 'right' : 'left'];
  const totalTrips = preview.sharedTrips + preview.leftOnlyTrips + preview.rightOnlyTrips;

  const merge = async (): Promise<void> => {
    setFailure(null);
    const outcome = await mergeMembers({
      workspaceId: workspace.id,
      input: toMergeInput(left, right, choices),
    });
    const problem = readFailure(outcome.error);
    if (problem) {
      setFailure(problem.message);
      if (problem.code === 'CONFLICT') refetch({ requestPolicy: 'network-only' });
      return;
    }
    toast('Merged. You can undo this from the merge history.');
    if (outcome.data)
      await navigate(`/w/${workspace.id}/members/${outcome.data.mergeMembers.survivor.id}`);
  };

  const cell = (chosen: boolean, extra = ''): string =>
    `compare__cell${chosen ? ' compare__cell--chosen' : ''}${extra}`;

  return (
    <div className="stack stack--loose">
      <div className="stack stack--tight">
        <p className="small">
          <Link to={`/w/${workspace.id}/duplicates`}>Likely duplicates</Link>
        </p>
        <h1>Compare and merge</h1>
        <p className="muted">
          Pick the record to keep and, where the two differ, the value to keep. Trips, dues and
          history from both are combined.
        </p>
      </div>
      {failure ? (
        <Banner tone="danger" role="alert">
          {failure}
        </Banner>
      ) : null}

      <div className="compare" role="group" aria-label="The two records">
        <div className="compare__cell compare__cell--head" />
        {SIDES.map((side) => (
          <div key={side} className={cell(choices.keep === side, ' compare__cell--head')}>
            <label className="compare__choice">
              <input
                type="radio"
                name="keep"
                checked={choices.keep === side}
                disabled={!workspace.canEdit}
                aria-label={`Keep the record of ${records[side].firstName} ${records[side].lastName}, added ${formatDate(records[side].createdAt)}, ${trips(records[side].tripCount)}`}
                onChange={() => {
                  setChoices({ ...choices, keep: side });
                }}
              />
              <span className="stack stack--tight">
                <span>Keep this record</span>
                <span className="small muted">
                  Added {formatDate(records[side].createdAt)} · {trips(records[side].tripCount)}
                </span>
                <span>
                  <StageBadge stage={records[side].stage} fixed={records[side].stagePin !== null} />
                </span>
              </span>
            </label>
          </div>
        ))}

        {MERGE_FIELDS.map((field) => {
          const same = !differs(left, right, field);
          return [
            <div key={`${field}-label`} className="compare__cell compare__cell--label">
              {FIELD_LABELS[field]}
            </div>,
            ...SIDES.map((side) => (
              <div
                key={`${field}-${side}`}
                className={cell(!same && choices.fields[field] === side)}
              >
                {same ? (
                  <span>{records[side][field] ?? <span className="muted">Empty</span>}</span>
                ) : (
                  <label className="compare__choice">
                    <input
                      type="radio"
                      name={field}
                      checked={choices.fields[field] === side}
                      disabled={!workspace.canEdit}
                      aria-label={`${FIELD_LABELS[field]}: ${records[side][field] ?? 'empty'}`}
                      onChange={() => {
                        setChoices({ ...choices, fields: { ...choices.fields, [field]: side } });
                      }}
                    />
                    <span>{records[side][field] ?? <span className="muted">Empty</span>}</span>
                  </label>
                )}
              </div>
            )),
          ];
        })}

        <div className="compare__cell compare__cell--label">Notes</div>
        {SIDES.map((side) => (
          <div
            key={`notes-${side}`}
            className={cell(choices.notes === side || choices.notes === 'both')}
            style={{ whiteSpace: 'pre-wrap' }}
          >
            {records[side].notes || <span className="muted">Empty</span>}
          </div>
        ))}
      </div>

      {left.notes !== right.notes ? (
        <fieldset className="card stack stack--tight">
          <legend className="field__label">Which notes to keep</legend>
          {(
            [
              ['left', 'Only the notes on the left'],
              ['right', 'Only the notes on the right'],
              ['both', 'Both, one after the other'],
            ] as const satisfies readonly (readonly [NotesChoice, string])[]
          ).map(([value, label]) => (
            <label key={value} className="check">
              <input
                type="radio"
                name="notes"
                checked={choices.notes === value}
                disabled={!workspace.canEdit}
                onChange={() => {
                  setChoices({ ...choices, notes: value });
                }}
              />
              <span>{label}</span>
            </label>
          ))}
        </fieldset>
      ) : null}

      <section className="card stack" aria-labelledby="result-heading">
        <h2 id="result-heading">What will happen</h2>
        <dl className="definition">
          <dt>Kept record</dt>
          <dd>
            <strong>
              {result.firstName} {result.lastName}
            </strong>
            {[result.email, result.phone].filter(Boolean).length > 0
              ? ` · ${[result.email, result.phone].filter(Boolean).join(' · ')}`
              : ''}
          </dd>
          <dt>Trips</dt>
          <dd>
            {totalTrips} in total
            {preview.sharedTrips > 0
              ? ` (${String(preview.sharedTrips)} ${preview.sharedTrips === 1 ? 'trip is' : 'trips are'} on both records and will be counted once)`
              : ''}
          </dd>
          <dt>Dues payments</dt>
          <dd>{preview.leftPayments + preview.rightPayments} in total</dd>
          <dt>Folded in</dt>
          <dd>
            The record of {folded.firstName} {folded.lastName} added {formatDate(folded.createdAt)}{' '}
            stops appearing in the roster. Links to it will lead to {kept.firstName} {kept.lastName}
            .
          </dd>
        </dl>
        {workspace.canEdit ? (
          <div className="row row--between">
            <p className="small muted grow">An organizer can undo this from the merge history.</p>
            <Button
              variant="primary"
              busy={merging.fetching}
              onClick={() => {
                void merge();
              }}
            >
              Merge these two records
            </Button>
          </div>
        ) : (
          <Banner tone="warning">Your role lets you compare records, but not merge them.</Banner>
        )}
      </section>
    </div>
  );
}
