import type { Stage } from '../../shared/stage';
import type { Database } from '../db/database';
import type { RateLimiter } from '../domain/rate-limit';

/** Shapes the services hand to the API layer, and the row mappers that build them. */

export const ROLES = ['reader', 'volunteer', 'organizer'] as const;
export type Role = (typeof ROLES)[number];

export function roleAtLeast(role: Role, minimum: Role): boolean {
  return ROLES.indexOf(role) >= ROLES.indexOf(minimum);
}

/** Proof that a signed-in user is in a workspace, and with which role. */
export interface Scope {
  workspaceId: string;
  userId: string;
  role: Role;
}

/** What every service needs. Passed in, never imported, so tests can swap parts. */
export interface Deps {
  db: Database;
  now: () => Date;
  sessionTtlHours: number;
  loginLimiter: RateLimiter;
}

export interface UserRecord {
  id: string;
  email: string;
  name: string;
}

export interface WorkspaceRecord {
  id: string;
  name: string;
}

export type MemberSource = 'paper' | 'web' | 'event';

/** One person on a club's roster, with the facts their stage is derived from. */
export interface MemberRecord {
  id: string;
  workspaceId: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  notes: string;
  source: MemberSource;
  stagePin: Stage | null;
  stage: Stage;
  duesPaidUntil: string | null;
  tripCount: number;
  /** Whether the asking user has opened this record. */
  isRead: boolean;
  mergedIntoId: string | null;
  revision: number;
  sortName: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface MemberRow {
  id: string;
  workspace_id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  notes: string;
  source: MemberSource;
  stage_pin: Stage | null;
  stage: Stage;
  dues_until: string | null;
  trip_count: number;
  is_read: boolean;
  merged_into_id: string | null;
  revision: number;
  sort_name: string;
  created_at: Date;
  updated_at: Date;
}

export function toMember(row: MemberRow): MemberRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    firstName: row.first_name,
    lastName: row.last_name,
    email: row.email,
    phone: row.phone,
    notes: row.notes,
    source: row.source,
    stagePin: row.stage_pin,
    stage: row.stage,
    duesPaidUntil: row.dues_until,
    tripCount: row.trip_count,
    isRead: row.is_read,
    mergedIntoId: row.merged_into_id,
    revision: row.revision,
    sortName: row.sort_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface SignupRecord {
  id: string;
  tripId: string;
  tripTitle: string;
  happensOn: string;
  attended: boolean;
}

export interface PaymentRecord {
  id: string;
  amountCents: number;
  paidOn: string;
  coversUntil: string;
}

export interface ActivityRecord {
  id: string;
  kind: string;
  summary: string;
  actorName: string | null;
  occurredAt: Date;
}

/** YYYY-MM-DD for a moment, in UTC. Dues and trips are whole days. */
export function isoDay(moment: Date): string {
  return moment.toISOString().slice(0, 10);
}
