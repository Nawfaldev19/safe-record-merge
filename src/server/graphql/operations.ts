import { notFound } from '../domain/errors';
import { login, logout } from '../services/auth-service';
import { dismissDuplicate } from '../services/duplicate-service';
import { createMember, markRead, setStagePin, updateMember } from '../services/member-service';
import { mergeMembers, undoMerge } from '../services/merge-service';
import type { MemberRecord, Scope, WorkspaceRecord } from '../services/records';
import { builder } from './builder';
import { SESSION_COOKIE } from './context';
import type { GraphQLContext } from './context';
import { MemberRef, MergeRef, SourceEnum, StageEnum, ViewerRef, WorkspaceRef } from './types';

async function workspaceRecord(ctx: GraphQLContext, scope: Scope): Promise<WorkspaceRecord> {
  const rows = await ctx.deps.db.tenant(scope.workspaceId, (q) =>
    q.query<WorkspaceRecord>('select id, name from workspaces'),
  );
  const record = rows[0];
  if (!record) throw notFound('Workspace');
  return record;
}

builder.queryFields((t) => ({
  viewer: t.field({
    type: ViewerRef,
    nullable: true,
    description: 'The signed-in user, or null when nobody is signed in.',
    resolve: (_root, _args, ctx) => ctx.user,
  }),
  workspace: t.field({
    type: WorkspaceRef,
    args: { id: t.arg.id() },
    description: 'A workspace the signed-in user belongs to.',
    resolve: async (_root, args, ctx) => {
      const scope = await ctx.scope(args.id);
      return { scope, record: await workspaceRecord(ctx, scope) };
    },
  }),
}));

const MemberInput = builder.inputType('MemberInput', {
  fields: (t) => ({
    firstName: t.string(),
    lastName: t.string(),
    email: t.string({ required: false }),
    phone: t.string({ required: false }),
    notes: t.string({ required: false }),
    source: t.field({ type: SourceEnum, required: false }),
  }),
});

const MergeSideEnum = builder.enumType('MergeSide', {
  description: 'Which of the two records a value is taken from.',
  values: { SURVIVOR: { value: 'survivor' }, ABSORBED: { value: 'absorbed' } } as const,
});

const NotesChoiceEnum = builder.enumType('NotesChoice', {
  values: {
    SURVIVOR: { value: 'survivor' },
    ABSORBED: { value: 'absorbed' },
    BOTH: { value: 'both' },
  } as const,
});

const MergeInput = builder.inputType('MergeInput', {
  fields: (t) => ({
    survivorId: t.id({ description: 'The record that is kept.' }),
    absorbedId: t.id({ description: 'The record that is folded into the other.' }),
    expectedSurvivorRevision: t.int(),
    expectedAbsorbedRevision: t.int(),
    firstName: t.field({ type: MergeSideEnum }),
    lastName: t.field({ type: MergeSideEnum }),
    email: t.field({ type: MergeSideEnum }),
    phone: t.field({ type: MergeSideEnum }),
    notes: t.field({ type: NotesChoiceEnum }),
  }),
});

const MergeResultRef = builder
  .objectRef<{ mergeId: string; survivor: MemberRecord }>('MergeResult')
  .implement({
    fields: (t) => ({
      mergeId: t.exposeID('mergeId'),
      survivor: t.field({ type: MemberRef, resolve: (result) => result.survivor }),
    }),
  });

builder.mutationFields((t) => ({
  login: t.field({
    type: ViewerRef,
    args: { email: t.arg.string(), password: t.arg.string() },
    resolve: async (_root, args, ctx) => {
      const result = await login(ctx.deps, args, ctx.clientKey);
      ctx.cookies.set(SESSION_COOKIE, result.token, result.expiresAt);
      return result.user;
    },
  }),
  logout: t.boolean({
    resolve: async (_root, _args, ctx) => {
      if (ctx.sessionToken !== null) await logout(ctx.deps, ctx.sessionToken);
      ctx.cookies.clear(SESSION_COOKIE);
      return true;
    },
  }),

  createMember: t.field({
    type: MemberRef,
    args: { workspaceId: t.arg.id(), input: t.arg({ type: MemberInput }) },
    resolve: async (_root, args, ctx) =>
      createMember(ctx.deps, await ctx.scope(args.workspaceId), args.input),
  }),
  updateMember: t.field({
    type: MemberRef,
    args: {
      workspaceId: t.arg.id(),
      memberId: t.arg.id(),
      input: t.arg({ type: MemberInput }),
      expectedRevision: t.arg.int({
        description: 'The revision the edit started from. A mismatch is a CONFLICT.',
      }),
    },
    resolve: async (_root, args, ctx) =>
      updateMember(ctx.deps, await ctx.scope(args.workspaceId), args.memberId, {
        ...args.input,
        expectedRevision: args.expectedRevision,
      }),
  }),
  setStagePin: t.field({
    type: MemberRef,
    args: {
      workspaceId: t.arg.id(),
      memberId: t.arg.id(),
      pin: t.arg({ type: StageEnum, required: false }),
    },
    description: 'Organizers only. Pass null to let dues and trips decide again.',
    resolve: async (_root, args, ctx) =>
      setStagePin(ctx.deps, await ctx.scope(args.workspaceId), args.memberId, {
        pin: args.pin ?? null,
      }),
  }),
  markMemberRead: t.boolean({
    args: { workspaceId: t.arg.id(), memberId: t.arg.id() },
    resolve: async (_root, args, ctx) =>
      markRead(ctx.deps, await ctx.scope(args.workspaceId), args.memberId),
  }),

  dismissDuplicate: t.boolean({
    args: { workspaceId: t.arg.id(), firstId: t.arg.id(), secondId: t.arg.id() },
    description: 'Marks two records as different people, so the pair is not suggested again.',
    resolve: async (_root, args, ctx) =>
      dismissDuplicate(ctx.deps, await ctx.scope(args.workspaceId), args.firstId, args.secondId),
  }),
  mergeMembers: t.field({
    type: MergeResultRef,
    args: { workspaceId: t.arg.id(), input: t.arg({ type: MergeInput }) },
    resolve: async (_root, args, ctx) =>
      mergeMembers(ctx.deps, await ctx.scope(args.workspaceId), args.input),
  }),
  undoMerge: t.field({
    type: MergeRef,
    args: { workspaceId: t.arg.id(), mergeId: t.arg.id() },
    description: 'Organizers only. Reverses a merge exactly, from its journal entry.',
    resolve: async (_root, args, ctx) =>
      undoMerge(ctx.deps, await ctx.scope(args.workspaceId), args.mergeId),
  }),
}));
