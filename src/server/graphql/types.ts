import { STAGES } from '../../shared/stage';
import type { Page } from '../domain/pagination';
import { normalizePageRequest } from '../domain/pagination';
import { listMemberships } from '../services/auth-service';
import type { MembershipView } from '../services/auth-service';
import { listDuplicates } from '../services/duplicate-service';
import type { DuplicatePair, DuplicateReport } from '../services/duplicate-service';
import {
  getMember,
  listActivity,
  listMembers,
  listPayments,
  listSignups,
  stageCounts,
} from '../services/member-service';
import type { ResolvedMember, StageCount } from '../services/member-service';
import { listMerges, previewMerge } from '../services/merge-service';
import type { MergePreview, MergeRecord } from '../services/merge-service';
import type {
  ActivityRecord,
  MemberRecord,
  PaymentRecord,
  Scope,
  SignupRecord,
  UserRecord,
  WorkspaceRecord,
} from '../services/records';
import { builder } from './builder';

export const RoleEnum = builder.enumType('Role', {
  values: {
    ORGANIZER: { value: 'organizer' },
    VOLUNTEER: { value: 'volunteer' },
    READER: { value: 'reader' },
  } as const,
});

export const StageEnum = builder.enumType('Stage', { values: STAGES });

export const MemberSortEnum = builder.enumType('MemberSort', {
  values: ['NEWEST', 'NAME'] as const,
});

export const SourceEnum = builder.enumType('MemberSource', {
  values: { PAPER: { value: 'paper' }, WEB: { value: 'web' }, EVENT: { value: 'event' } } as const,
});

const WorkspaceSummaryRef = builder.objectRef<WorkspaceRecord>('WorkspaceSummary').implement({
  fields: (t) => ({ id: t.exposeID('id'), name: t.exposeString('name') }),
});

const MembershipRef = builder.objectRef<MembershipView>('Membership').implement({
  fields: (t) => ({
    role: t.field({ type: RoleEnum, resolve: (membership) => membership.role }),
    workspace: t.field({
      type: WorkspaceSummaryRef,
      resolve: (membership) => membership.workspace,
    }),
  }),
});

export const ViewerRef = builder.objectRef<UserRecord>('Viewer').implement({
  description: 'The signed-in user.',
  fields: (t) => ({
    id: t.exposeID('id'),
    name: t.exposeString('name'),
    email: t.exposeString('email'),
    memberships: t.field({
      type: [MembershipRef],
      resolve: (user, _args, ctx) => listMemberships(ctx.deps, user.id),
    }),
  }),
});

const SignupRef = builder.objectRef<SignupRecord>('TripSignup').implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    tripTitle: t.exposeString('tripTitle'),
    happensOn: t.exposeString('happensOn', { description: 'A date as YYYY-MM-DD.' }),
    attended: t.exposeBoolean('attended'),
  }),
});

const PaymentRef = builder.objectRef<PaymentRecord>('Payment').implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    amountCents: t.exposeInt('amountCents'),
    paidOn: t.exposeString('paidOn'),
    coversUntil: t.exposeString('coversUntil'),
  }),
});

const ActivityRef = builder.objectRef<ActivityRecord>('Activity').implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    kind: t.exposeString('kind'),
    summary: t.exposeString('summary'),
    actorName: t.exposeString('actorName', { nullable: true }),
    occurredAt: t.expose('occurredAt', { type: 'DateTime' }),
  }),
});

export const MemberRef = builder.objectRef<MemberRecord>('Member').implement({
  description: 'One person on the roster.',
  fields: (t) => ({
    id: t.exposeID('id'),
    firstName: t.exposeString('firstName'),
    lastName: t.exposeString('lastName'),
    email: t.exposeString('email', { nullable: true }),
    phone: t.exposeString('phone', { nullable: true }),
    notes: t.exposeString('notes'),
    source: t.field({ type: SourceEnum, resolve: (member) => member.source }),
    stage: t.field({
      type: StageEnum,
      description: 'Derived from dues and trips, unless a stage was fixed by hand.',
      resolve: (member) => member.stage,
    }),
    stagePin: t.field({ type: StageEnum, nullable: true, resolve: (member) => member.stagePin }),
    duesPaidUntil: t.exposeString('duesPaidUntil', { nullable: true }),
    tripCount: t.exposeInt('tripCount'),
    isRead: t.exposeBoolean('isRead', {
      description: 'Whether the signed-in user has opened this record.',
    }),
    revision: t.exposeInt('revision'),
    createdAt: t.expose('createdAt', { type: 'DateTime' }),
    updatedAt: t.expose('updatedAt', { type: 'DateTime' }),
    signups: t.field({
      type: [SignupRef],
      resolve: async (member, _args, ctx) =>
        listSignups(ctx.deps, await ctx.scope(member.workspaceId), member.id),
    }),
    payments: t.field({
      type: [PaymentRef],
      resolve: async (member, _args, ctx) =>
        listPayments(ctx.deps, await ctx.scope(member.workspaceId), member.id),
    }),
    activity: t.field({
      type: [ActivityRef],
      resolve: async (member, _args, ctx) =>
        listActivity(ctx.deps, await ctx.scope(member.workspaceId), member.id),
    }),
  }),
});

const ResolvedMemberRef = builder.objectRef<ResolvedMember>('MemberLookup').implement({
  description: 'The record behind an id, following any merges it has been through.',
  fields: (t) => ({
    member: t.field({ type: MemberRef, resolve: (found) => found.member }),
    mergedFrom: t.field({
      type: MemberRef,
      nullable: true,
      description: 'Set when the id asked for was merged into `member`.',
      resolve: (found) => found.mergedFrom,
    }),
  }),
});

const MemberPageRef = builder.objectRef<Page<MemberRecord>>('MemberPage').implement({
  fields: (t) => ({
    items: t.field({ type: [MemberRef], resolve: (page) => page.items }),
    endCursor: t.exposeString('endCursor', { nullable: true }),
    hasNextPage: t.exposeBoolean('hasNextPage'),
  }),
});

const StageCountRef = builder.objectRef<StageCount>('StageCount').implement({
  fields: (t) => ({
    stage: t.field({ type: StageEnum, resolve: (count) => count.stage }),
    total: t.exposeInt('total'),
    unread: t.exposeInt('unread'),
  }),
});

const DuplicatePairRef = builder.objectRef<DuplicatePair>('DuplicatePair').implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    score: t.exposeFloat('score', { description: '0 to 1. Higher means more alike.' }),
    reasons: t.exposeStringList('reasons'),
    left: t.field({ type: MemberRef, resolve: (pair) => pair.left }),
    right: t.field({ type: MemberRef, resolve: (pair) => pair.right }),
  }),
});

const DuplicateReportRef = builder.objectRef<DuplicateReport>('DuplicateReport').implement({
  fields: (t) => ({
    pairs: t.field({ type: [DuplicatePairRef], resolve: (report) => report.pairs }),
    membersChecked: t.exposeInt('membersChecked'),
    comparisons: t.exposeInt('comparisons'),
  }),
});

const MergePreviewRef = builder.objectRef<MergePreview>('MergePreview').implement({
  description: 'What merging two records would combine.',
  fields: (t) => ({
    left: t.field({ type: MemberRef, resolve: (preview) => preview.left }),
    right: t.field({ type: MemberRef, resolve: (preview) => preview.right }),
    sharedTrips: t.exposeInt('sharedTrips'),
    leftOnlyTrips: t.exposeInt('leftOnlyTrips'),
    rightOnlyTrips: t.exposeInt('rightOnlyTrips'),
    leftPayments: t.exposeInt('leftPayments'),
    rightPayments: t.exposeInt('rightPayments'),
  }),
});

export const MergeRef = builder.objectRef<MergeRecord>('Merge').implement({
  description: 'A journal entry for one merge.',
  fields: (t) => ({
    id: t.exposeID('id'),
    survivorId: t.exposeID('survivorId'),
    absorbedId: t.exposeID('absorbedId'),
    survivorName: t.exposeString('survivorName'),
    absorbedName: t.exposeString('absorbedName'),
    mergedByName: t.exposeString('mergedByName'),
    mergedAt: t.expose('mergedAt', { type: 'DateTime' }),
    undoneAt: t.expose('undoneAt', { type: 'DateTime', nullable: true }),
    canUndo: t.exposeBoolean('canUndo'),
    undoBlockedBy: t.exposeString('undoBlockedBy', { nullable: true }),
  }),
});

export interface WorkspaceShape {
  scope: Scope;
  record: WorkspaceRecord;
}

export const WorkspaceRef = builder.objectRef<WorkspaceShape>('Workspace').implement({
  description: 'One club. Everything below it belongs to this workspace only.',
  fields: (t) => ({
    id: t.id({ resolve: (workspace) => workspace.record.id }),
    name: t.string({ resolve: (workspace) => workspace.record.name }),
    role: t.field({
      type: RoleEnum,
      description: 'The role of the signed-in user in this workspace.',
      resolve: (workspace) => workspace.scope.role,
    }),
    stageCounts: t.field({
      type: [StageCountRef],
      resolve: (workspace, _args, ctx) => stageCounts(ctx.deps, workspace.scope),
    }),
    members: t.field({
      type: MemberPageRef,
      args: {
        first: t.arg.int({ required: false }),
        after: t.arg.string({ required: false }),
        stage: t.arg({ type: StageEnum, required: false }),
        search: t.arg.string({ required: false }),
        sort: t.arg({ type: MemberSortEnum, required: false }),
      },
      resolve: (workspace, args, ctx) =>
        listMembers(ctx.deps, workspace.scope, normalizePageRequest(args.first, args.after), {
          stage: args.stage ?? null,
          search: args.search ?? null,
          sort: args.sort ?? 'NAME',
        }),
    }),
    member: t.field({
      type: ResolvedMemberRef,
      args: { id: t.arg.id() },
      resolve: (workspace, args, ctx) => getMember(ctx.deps, workspace.scope, args.id),
    }),
    duplicates: t.field({
      type: DuplicateReportRef,
      resolve: (workspace, _args, ctx) => listDuplicates(ctx.deps, workspace.scope),
    }),
    mergePreview: t.field({
      type: MergePreviewRef,
      args: { leftId: t.arg.id(), rightId: t.arg.id() },
      resolve: (workspace, args, ctx) =>
        previewMerge(ctx.deps, workspace.scope, args.leftId, args.rightId),
    }),
    merges: t.field({
      type: [MergeRef],
      resolve: (workspace, _args, ctx) => listMerges(ctx.deps, workspace.scope),
    }),
  }),
});
