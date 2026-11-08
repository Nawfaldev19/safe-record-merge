/**
 * Schema migrations, applied in order and recorded in schema_migrations.
 * They live in code (not .sql files) so the bundled server needs no file lookup.
 */

export interface Migration {
  id: string;
  sql: string;
}

const initialSchema = /* sql */ `
  -- Two roles with no login. The application switches into one of them at the
  -- start of every transaction; it never runs request queries as the owner.
  --   app_tenant     works inside exactly one workspace, fenced in by policies
  --   app_directory  signs people in and lists the workspaces they belong to
  create role app_tenant nologin;
  create role app_directory nologin;

  create function app_workspace_id() returns uuid
    language sql stable
    as $$ select nullif(current_setting('app.workspace_id', true), '')::uuid $$;

  create function now_ms() returns timestamptz
    language sql stable
    as $$ select date_trunc('milliseconds', now()) $$;

  create type member_role as enum ('organizer', 'volunteer', 'reader');

  create table users (
    id uuid primary key default gen_random_uuid(),
    email text not null unique check (email = lower(email)),
    name text not null check (char_length(name) between 1 and 80),
    password_hash text not null,
    created_at timestamptz not null default now_ms()
  );

  create table workspaces (
    id uuid primary key default gen_random_uuid(),
    name text not null check (char_length(name) between 1 and 80),
    created_at timestamptz not null default now_ms()
  );

  create table memberships (
    workspace_id uuid not null references workspaces (id),
    user_id uuid not null references users (id),
    role member_role not null,
    created_at timestamptz not null default now_ms(),
    primary key (workspace_id, user_id)
  );
  create index memberships_user_idx on memberships (user_id);

  create table sessions (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references users (id),
    token_hash text not null unique,
    expires_at timestamptz not null,
    created_at timestamptz not null default now_ms()
  );

  -- The roster. "members" here are people on a club's list, not users of this
  -- application. Every tenant table carries workspace_id, and child tables point
  -- at their parent with (workspace_id, id), so a row can never hang off a
  -- parent in another workspace.
  create table members (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references workspaces (id),
    first_name text not null check (char_length(first_name) between 1 and 60),
    last_name text not null check (char_length(last_name) between 1 and 60),
    email text check (email is null or char_length(email) between 3 and 200),
    phone text check (phone is null or char_length(phone) between 3 and 40),
    notes text not null default '' check (char_length(notes) <= 4000),
    source text not null default 'web' check (source in ('paper', 'web', 'event')),
    stage_pin text check (stage_pin in ('ENQUIRY', 'TRIAL', 'MEMBER', 'LAPSED')),
    -- Normalized copies of the fields above, written by the application, used
    -- to find duplicates and to sort.
    email_key text,
    phone_key text,
    sort_name text not null,
    -- Set when this record was merged into another. The row stays as a
    -- signpost, so old links still lead somewhere and the merge can be undone.
    merged_into_id uuid,
    -- Goes up by one on every change. Edits and undo use it to detect that
    -- someone else changed the record in the meantime.
    revision integer not null default 1 check (revision > 0),
    created_at timestamptz not null default now_ms(),
    updated_at timestamptz not null default now_ms(),
    unique (workspace_id, id),
    foreign key (workspace_id, merged_into_id) references members (workspace_id, id),
    constraint not_merged_into_itself check (merged_into_id is null or merged_into_id <> id)
  );
  create index members_newest_idx on members (workspace_id, created_at desc, id desc)
    where merged_into_id is null;
  create index members_name_idx on members (workspace_id, sort_name, id)
    where merged_into_id is null;
  create index members_email_key_idx on members (workspace_id, email_key);
  create index members_phone_key_idx on members (workspace_id, phone_key);

  create table trips (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references workspaces (id),
    title text not null check (char_length(title) between 1 and 120),
    happens_on date not null,
    unique (workspace_id, id)
  );

  create table trip_signups (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null,
    member_id uuid not null,
    trip_id uuid not null,
    attended boolean not null default false,
    created_at timestamptz not null default now_ms(),
    -- One person, one place on a trip. Merging two records must respect this.
    unique (member_id, trip_id),
    foreign key (workspace_id, member_id) references members (workspace_id, id),
    foreign key (workspace_id, trip_id) references trips (workspace_id, id)
  );
  create index trip_signups_trip_idx on trip_signups (trip_id);

  create table payments (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null,
    member_id uuid not null,
    amount_cents integer not null check (amount_cents > 0),
    paid_on date not null,
    covers_until date not null,
    foreign key (workspace_id, member_id) references members (workspace_id, id),
    constraint covers_after_payment check (covers_until >= paid_on)
  );
  create index payments_member_idx on payments (member_id);

  create table activity_events (
    id bigint generated always as identity primary key,
    workspace_id uuid not null,
    member_id uuid not null,
    kind text not null,
    summary text not null,
    actor_id uuid references users (id),
    occurred_at timestamptz not null default now_ms(),
    foreign key (workspace_id, member_id) references members (workspace_id, id)
  );
  create index activity_events_member_idx on activity_events (member_id, id desc);

  -- Who has opened which record. No row means "unread" for that user.
  create table member_reads (
    workspace_id uuid not null,
    user_id uuid not null references users (id),
    member_id uuid not null,
    read_at timestamptz not null default now_ms(),
    primary key (user_id, member_id),
    foreign key (workspace_id, member_id) references members (workspace_id, id)
  );

  -- Pairs a person has looked at and judged to be two different people.
  create table duplicate_dismissals (
    workspace_id uuid not null,
    low_id uuid not null,
    high_id uuid not null,
    dismissed_by uuid not null references users (id),
    dismissed_at timestamptz not null default now_ms(),
    primary key (low_id, high_id),
    foreign key (workspace_id, low_id) references members (workspace_id, id),
    foreign key (workspace_id, high_id) references members (workspace_id, id),
    constraint ordered_pair check (low_id < high_id)
  );

  -- The merge journal: one row per merge, holding everything needed to undo it.
  create table merges (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null,
    survivor_id uuid not null,
    absorbed_id uuid not null,
    merged_by uuid not null references users (id),
    merged_at timestamptz not null default now_ms(),
    -- The survivor's revision right after the merge. Undo is only allowed
    -- while the survivor still has this revision.
    survivor_revision integer not null,
    snapshot jsonb not null,
    undone_at timestamptz,
    undone_by uuid references users (id),
    foreign key (workspace_id, survivor_id) references members (workspace_id, id),
    foreign key (workspace_id, absorbed_id) references members (workspace_id, id),
    constraint two_different_records check (survivor_id <> absorbed_id)
  );
  create index merges_recent_idx on merges (workspace_id, merged_at desc);

  -- Row-level security. FORCE makes the policies apply to the table owner too,
  -- so a forgotten "set role" fails closed instead of reading everything.
  do $$
  declare tenant_table text;
  begin
    foreach tenant_table in array array[
      'members', 'trips', 'trip_signups', 'payments', 'activity_events',
      'member_reads', 'duplicate_dismissals', 'merges'
    ] loop
      execute format('alter table %I enable row level security', tenant_table);
      execute format('alter table %I force row level security', tenant_table);
      execute format(
        'create policy tenant_rows on %I for all to app_tenant
           using (workspace_id = app_workspace_id())
           with check (workspace_id = app_workspace_id())',
        tenant_table
      );
    end loop;
  end
  $$;

  alter table workspaces enable row level security;
  alter table memberships enable row level security;
  alter table users enable row level security;

  create policy own_workspace on workspaces for select to app_tenant
    using (id = app_workspace_id());
  create policy own_members on memberships for select to app_tenant
    using (workspace_id = app_workspace_id());
  create policy fellow_members on users for select to app_tenant
    using (exists (
      select 1 from memberships m
      where m.user_id = users.id and m.workspace_id = app_workspace_id()
    ));

  create policy directory_reads on workspaces for select to app_directory using (true);
  create policy directory_reads on memberships for select to app_directory using (true);
  create policy directory_reads on users for select to app_directory using (true);

  grant select, insert, update on members, trip_signups, payments, merges to app_tenant;
  grant delete on trip_signups to app_tenant;
  grant select, insert on trips, activity_events to app_tenant;
  grant update on activity_events to app_tenant;
  grant select, insert, update on member_reads to app_tenant;
  grant select, insert, delete on duplicate_dismissals to app_tenant;
  grant select on workspaces, memberships to app_tenant;
  -- Column grant: the tenant role can show who did something, never a password hash.
  grant select (id, email, name) on users to app_tenant;

  grant select on users, workspaces, memberships to app_directory;
  grant select, insert, delete on sessions to app_directory;
`;

export const migrations: readonly Migration[] = [{ id: '001_initial_schema', sql: initialSchema }];
