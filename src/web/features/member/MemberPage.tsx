import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useMutation, useQuery } from 'urql';
import { STAGES, STAGE_DESCRIPTIONS, STAGE_LABELS } from '../../../shared/stage';
import type { Stage } from '../../../shared/stage';
import { StageBadge } from '../../components/StageBadge';
import { useToast } from '../../components/overlays';
import { Badge, Banner, Button, ErrorState, Field, Skeleton } from '../../components/ui';
import {
  MarkReadMutation,
  MemberQuery,
  SetStagePinMutation,
  UpdateMemberMutation,
} from '../../graphql/operations';
import { issuesByField, readFailure } from '../../lib/errors';
import type { ApiFailure } from '../../lib/errors';
import { formatDate, formatDateTime } from '../../lib/format';
import { useWorkspace } from '../auth/session';

const SOURCE_LABELS = { PAPER: 'a paper form', WEB: 'the web form', EVENT: 'an event' } as const;
const money = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'EUR' });

export function MemberPage() {
  const workspace = useWorkspace();
  const { memberId = '' } = useParams();
  const toast = useToast();
  const variables = { workspaceId: workspace.id, memberId };
  const [{ data, fetching, error }, refetch] = useQuery({ query: MemberQuery, variables });
  const [, markRead] = useMutation(MarkReadMutation);
  const [saving, updateMember] = useMutation(UpdateMemberMutation);
  const [pinning, setStagePin] = useMutation(SetStagePinMutation);
  const [draft, setDraft] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    notes: '',
  });
  const [failure, setFailure] = useState<ApiFailure | null>(null);

  const found = data?.workspace.member;
  const member = found?.member;
  const loadedId = member?.id;
  const loadedRevision = member?.revision;

  // Copy the record into the form when it arrives and whenever a newer revision loads.
  useEffect(() => {
    if (!member) return;
    setDraft({
      firstName: member.firstName,
      lastName: member.lastName,
      email: member.email ?? '',
      phone: member.phone ?? '',
      notes: member.notes,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload only for a new record or revision
  }, [loadedId, loadedRevision]);

  // Opening a record is what marks it as read for this user.
  useEffect(() => {
    if (loadedId) void markRead({ workspaceId: workspace.id, memberId: loadedId });
  }, [loadedId, workspace.id, markRead]);

  if (fetching && !member) return <Skeleton lines={8} label="Loading the record" />;
  if (error && !member) {
    return (
      <ErrorState
        title={readFailure(error)?.code === 'NOT_FOUND' ? 'Nobody here' : 'Something went wrong'}
        message={readFailure(error)?.message ?? 'Please try again.'}
      />
    );
  }
  if (!found || !member) return null;

  const issues = issuesByField(failure?.issues ?? []);
  const changed =
    draft.firstName !== member.firstName ||
    draft.lastName !== member.lastName ||
    draft.email !== (member.email ?? '') ||
    draft.phone !== (member.phone ?? '') ||
    draft.notes !== member.notes;

  const save = async (event: { preventDefault(): void }): Promise<void> => {
    event.preventDefault();
    setFailure(null);
    const result = await updateMember({
      workspaceId: workspace.id,
      memberId: member.id,
      input: draft,
      expectedRevision: member.revision,
    });
    const problem = readFailure(result.error);
    if (problem) {
      setFailure(problem);
      return;
    }
    toast('Saved');
    refetch({ requestPolicy: 'network-only' });
  };

  const pin = async (value: string): Promise<void> => {
    setFailure(null);
    const result = await setStagePin({
      workspaceId: workspace.id,
      memberId: member.id,
      pin: STAGES.find((stage) => stage === value) ?? null,
    });
    const problem = readFailure(result.error);
    if (problem) setFailure(problem);
    else refetch({ requestPolicy: 'network-only' });
  };

  const input = (key: keyof typeof draft, label: string, type = 'text') => (
    <Field label={label} errors={(issues.get(key) ?? []).map((message) => `This ${message}.`)}>
      {(control) => (
        <input
          {...control}
          className="input"
          type={type}
          disabled={!workspace.canEdit}
          value={draft[key]}
          onChange={(event) => {
            setDraft((current) => ({ ...current, [key]: event.target.value }));
          }}
        />
      )}
    </Field>
  );

  return (
    <div className="stack stack--loose">
      <div className="stack stack--tight">
        <p className="small">
          <Link to={`/w/${workspace.id}/roster`}>Roster</Link>
        </p>
        <h1>
          {member.firstName} {member.lastName}
        </h1>
        <div className="row">
          <StageBadge stage={member.stage} fixed={member.stagePin !== null} />
          <Badge>Added {formatDate(member.createdAt)}</Badge>
          <Badge>From {SOURCE_LABELS[member.source]}</Badge>
        </div>
      </div>

      {found.mergedFrom ? (
        <Banner tone="success">
          You followed a link to an older record of {found.mergedFrom.firstName}{' '}
          {found.mergedFrom.lastName}. It was merged into this one.
        </Banner>
      ) : null}
      {failure && failure.issues.length === 0 ? (
        <Banner tone="danger" role="alert">
          <span className="grow">{failure.message}</span>
          {failure.code === 'CONFLICT' ? (
            <Button
              onClick={() => {
                setFailure(null);
                refetch({ requestPolicy: 'network-only' });
              }}
            >
              Reload
            </Button>
          ) : null}
        </Banner>
      ) : null}

      <div className="two-columns">
        <form
          className="card stack"
          aria-labelledby="details-heading"
          noValidate
          onSubmit={(event) => {
            void save(event);
          }}
        >
          <h2 id="details-heading">Details</h2>
          {input('firstName', 'First name')}
          {input('lastName', 'Last name')}
          {input('email', 'Email', 'email')}
          {input('phone', 'Phone', 'tel')}
          <Field
            label="Notes"
            errors={(issues.get('notes') ?? []).map((message) => `This ${message}.`)}
          >
            {(control) => (
              <textarea
                {...control}
                className="textarea"
                disabled={!workspace.canEdit}
                value={draft.notes}
                onChange={(event) => {
                  setDraft((current) => ({ ...current, notes: event.target.value }));
                }}
              />
            )}
          </Field>
          {workspace.canEdit ? (
            <div className="row row--end">
              <Button type="submit" variant="primary" disabled={!changed} busy={saving.fetching}>
                Save changes
              </Button>
            </div>
          ) : null}
        </form>

        <div className="stack">
          <section className="card stack" aria-labelledby="stage-heading">
            <h2 id="stage-heading">Stage</h2>
            <p>
              <strong>{STAGE_LABELS[member.stage]}.</strong> {STAGE_DESCRIPTIONS[member.stage]}.
            </p>
            <p className="small muted">
              {member.duesPaidUntil
                ? `Dues are paid until ${formatDate(member.duesPaidUntil)}.`
                : 'No dues payment is recorded.'}{' '}
              The stage follows dues and trips on its own, unless it is fixed here.
            </p>
            {workspace.isOrganizer ? (
              <Field label="Fix the stage by hand">
                {(control) => (
                  <select
                    {...control}
                    className="select"
                    disabled={pinning.fetching}
                    value={member.stagePin ?? ''}
                    onChange={(event) => {
                      void pin(event.target.value);
                    }}
                  >
                    <option value="">Not fixed: follow dues and trips</option>
                    {STAGES.map((stage: Stage) => (
                      <option key={stage} value={stage}>
                        {STAGE_LABELS[stage]}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
            ) : null}
          </section>

          <section className="card stack" aria-labelledby="trips-heading">
            <h2 id="trips-heading">Trips ({member.signups.length})</h2>
            {member.signups.length === 0 ? (
              <p className="muted">No trips yet.</p>
            ) : (
              <ul className="list" aria-label="Trips">
                {member.signups.map((signup) => (
                  <li key={signup.id} className="list__item" style={{ paddingInline: 0 }}>
                    <span className="grow">{signup.tripTitle}</span>
                    <span className="small muted">{formatDate(signup.happensOn)}</span>
                    <Badge tone={signup.attended ? 'success' : 'neutral'}>
                      {signup.attended ? 'Attended' : 'Signed up'}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card stack" aria-labelledby="dues-heading">
            <h2 id="dues-heading">Dues ({member.payments.length})</h2>
            {member.payments.length === 0 ? (
              <p className="muted">No payments recorded.</p>
            ) : (
              <ul className="list" aria-label="Dues payments">
                {member.payments.map((payment) => (
                  <li key={payment.id} className="list__item" style={{ paddingInline: 0 }}>
                    <span className="grow">{money.format(payment.amountCents / 100)}</span>
                    <span className="small muted">
                      paid {formatDate(payment.paidOn)}, covers until{' '}
                      {formatDate(payment.coversUntil)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>

      <section className="stack" aria-labelledby="history-heading">
        <h2 id="history-heading">History</h2>
        <div className="card">
          <ol className="timeline" aria-label="History">
            {member.activity.map((event) => (
              <li key={event.id} className="timeline__item stack stack--tight">
                <span>{event.summary}</span>
                <span className="small muted">
                  {event.actorName ?? 'Record Merge'} · {formatDateTime(event.occurredAt)}
                </span>
              </li>
            ))}
          </ol>
        </div>
      </section>
    </div>
  );
}
