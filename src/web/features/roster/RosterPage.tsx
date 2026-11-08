import { useState } from 'react';
import { Download, Plus } from 'lucide-react';
import { Link, useNavigate } from 'react-router';
import { useMutation, useQuery } from 'urql';
import { STAGES, STAGE_LABELS } from '../../../shared/stage';
import type { Stage } from '../../../shared/stage';
import { StageBadge } from '../../components/StageBadge';
import { Dialog } from '../../components/overlays';
import {
  Badge,
  Banner,
  Button,
  EmptyState,
  ErrorState,
  Field,
  Segmented,
  Skeleton,
} from '../../components/ui';
import { CreateMemberMutation, RosterQuery, StageCountsQuery } from '../../graphql/operations';
import { issuesByField, readFailure } from '../../lib/errors';
import type { ApiFailure } from '../../lib/errors';
import { useDebounced } from '../../lib/hooks';
import { useWorkspace } from '../auth/session';

type Sort = 'NAME' | 'NEWEST';
const NEW_FOR_DAYS = 14;

function isNew(createdAt: string): boolean {
  return Date.now() - Date.parse(createdAt) < NEW_FOR_DAYS * 86_400_000;
}

/** One page of the roster. The parent renders one per cursor, so "Load more" appends. */
function RosterRows({
  after,
  stage,
  search,
  sort,
  isLast,
  onLoadMore,
}: {
  after: string | null;
  stage: Stage | null;
  search: string;
  sort: Sort;
  isLast: boolean;
  onLoadMore: (cursor: string) => void;
}) {
  const workspace = useWorkspace();
  const [{ data, fetching, error }, refetch] = useQuery({
    query: RosterQuery,
    variables: { workspaceId: workspace.id, after, stage, search: search || null, sort },
  });
  const page = data?.workspace.members;

  if (fetching && !page) {
    return (
      <li className="list__item">
        <Skeleton lines={4} label="Loading the roster" />
      </li>
    );
  }
  if (error && !page) {
    return (
      <li>
        <ErrorState
          message={readFailure(error)?.message ?? 'Please try again.'}
          onRetry={() => {
            refetch({ requestPolicy: 'network-only' });
          }}
        />
      </li>
    );
  }
  if (!page) return null;
  if (page.items.length === 0 && after === null) {
    return (
      <li>
        <EmptyState title={search || stage ? 'Nobody matches' : 'The roster is empty'}>
          {search || stage
            ? 'Try another stage or a shorter search.'
            : 'Add the first person to get started.'}
        </EmptyState>
      </li>
    );
  }

  return (
    <>
      {page.items.map((member) => (
        <li key={member.id} className="list__item">
          <span
            className={member.isRead ? 'unread-dot unread-dot--read' : 'unread-dot'}
            role="img"
            aria-label={member.isRead ? 'Opened before' : 'Not opened yet'}
          />
          <div className="grow stack stack--tight">
            <Link
              className="list__link"
              style={member.isRead ? { fontWeight: 400 } : undefined}
              to={`/w/${workspace.id}/members/${member.id}`}
            >
              {member.firstName} {member.lastName}
            </Link>
            <span className="small muted">
              {[member.email, member.phone].filter(Boolean).join(' · ') || 'No contact details'}
            </span>
          </div>
          <div className="row">
            {isNew(member.createdAt) ? <Badge tone="primary">New</Badge> : null}
            <span className="small muted">
              {member.tripCount === 1 ? '1 trip' : `${String(member.tripCount)} trips`}
            </span>
            <StageBadge stage={member.stage} fixed={member.stagePin !== null} />
          </div>
        </li>
      ))}
      {isLast && page.hasNextPage && page.endCursor ? (
        <li className="list__item row--end">
          <Button
            onClick={() => {
              if (page.endCursor) onLoadMore(page.endCursor);
            }}
          >
            Load more
          </Button>
        </li>
      ) : null}
    </>
  );
}

function AddPersonForm({ onClose }: { onClose: () => void }) {
  const workspace = useWorkspace();
  const navigate = useNavigate();
  const [creating, createMember] = useMutation(CreateMemberMutation);
  const [fields, setFields] = useState({ firstName: '', lastName: '', email: '', phone: '' });
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const issues = issuesByField(failure?.issues ?? []);

  const submit = async (event: { preventDefault(): void }): Promise<void> => {
    event.preventDefault();
    setFailure(null);
    const result = await createMember({ workspaceId: workspace.id, input: fields });
    const problem = readFailure(result.error);
    if (problem) {
      setFailure(problem);
      return;
    }
    if (result.data) await navigate(`/w/${workspace.id}/members/${result.data.createMember.id}`);
  };

  const input = (key: keyof typeof fields, label: string, type = 'text') => (
    <Field label={label} errors={(issues.get(key) ?? []).map((message) => `This ${message}.`)}>
      {(control) => (
        <input
          {...control}
          className="input"
          type={type}
          value={fields[key]}
          onChange={(event) => {
            setFields((current) => ({ ...current, [key]: event.target.value }));
          }}
        />
      )}
    </Field>
  );

  return (
    <form
      className="stack"
      noValidate
      onSubmit={(event) => {
        void submit(event);
      }}
    >
      {failure && failure.issues.length === 0 ? (
        <Banner tone="danger" role="alert">
          {failure.message}
        </Banner>
      ) : null}
      {input('firstName', 'First name')}
      {input('lastName', 'Last name')}
      {input('email', 'Email (optional)', 'email')}
      {input('phone', 'Phone (optional)', 'tel')}
      <div className="row row--end">
        <Button onClick={onClose}>Cancel</Button>
        <Button type="submit" variant="primary" busy={creating.fetching}>
          Add to the roster
        </Button>
      </div>
    </form>
  );
}

export function RosterPage() {
  const workspace = useWorkspace();
  const [stage, setStage] = useState<Stage | null>(null);
  const [searchText, setSearchText] = useState('');
  const [sort, setSort] = useState<Sort>('NAME');
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const [adding, setAdding] = useState(false);
  const search = useDebounced(searchText.trim());
  const [{ data: countData }] = useQuery({
    query: StageCountsQuery,
    variables: { workspaceId: workspace.id },
  });

  const counts = countData?.workspace.stageCounts ?? [];
  const total = counts.reduce((sum, count) => sum + count.total, 0);
  const unread = counts.reduce((sum, count) => sum + count.unread, 0);
  const restart = (): void => {
    setCursors([null]);
  };
  const exportUrl = `/files/${workspace.id}/members.csv?${new URLSearchParams({
    ...(stage ? { stage } : {}),
    ...(search ? { search } : {}),
  }).toString()}`;

  return (
    <div className="stack stack--loose">
      <div className="row row--between">
        <div className="stack stack--tight">
          <h1>Roster</h1>
          <p className="muted">
            {countData
              ? `${String(total)} people in ${workspace.name}, ${String(unread)} you have not opened yet.`
              : `Everyone on the list of ${workspace.name}.`}
          </p>
        </div>
        {workspace.canEdit ? (
          <div className="row">
            <a className="button" href={exportUrl} download>
              <Download aria-hidden="true" />
              Export CSV
            </a>
            <Button
              variant="primary"
              onClick={() => {
                setAdding(true);
              }}
            >
              <Plus aria-hidden="true" />
              Add a person
            </Button>
          </div>
        ) : null}
      </div>

      <Segmented
        label="Filter by stage"
        value={stage ?? 'ALL'}
        options={[
          { value: 'ALL', label: countData ? `Everyone (${String(total)})` : 'Everyone' },
          ...STAGES.map((item) => {
            const count = counts.find((entry) => entry.stage === item);
            return {
              value: item,
              label: count ? `${STAGE_LABELS[item]} (${String(count.total)})` : STAGE_LABELS[item],
            };
          }),
        ]}
        onChange={(next) => {
          setStage(next === 'ALL' ? null : next);
          restart();
        }}
      />

      <div className="toolbar">
        <div className="grow">
          <Field label="Search by name or email">
            {(control) => (
              <input
                {...control}
                className="input"
                type="search"
                value={searchText}
                onChange={(event) => {
                  setSearchText(event.target.value);
                  restart();
                }}
              />
            )}
          </Field>
        </div>
        <Field label="Sort by">
          {(control) => (
            <select
              {...control}
              className="select"
              value={sort}
              onChange={(event) => {
                setSort(event.target.value === 'NEWEST' ? 'NEWEST' : 'NAME');
                restart();
              }}
            >
              <option value="NAME">Last name</option>
              <option value="NEWEST">Newest first</option>
            </select>
          )}
        </Field>
      </div>

      <div className="card card--flush">
        <ul className="list" aria-label="People">
          {cursors.map((cursor, index) => (
            <RosterRows
              key={`${stage ?? 'all'}-${search}-${sort}-${cursor ?? 'first'}`}
              after={cursor}
              stage={stage}
              search={search}
              sort={sort}
              isLast={index === cursors.length - 1}
              onLoadMore={(next) => {
                setCursors((current) => [...current, next]);
              }}
            />
          ))}
        </ul>
      </div>

      <Dialog
        open={adding}
        title="Add a person"
        onClose={() => {
          setAdding(false);
        }}
      >
        <AddPersonForm
          onClose={() => {
            setAdding(false);
          }}
        />
      </Dialog>
    </div>
  );
}
