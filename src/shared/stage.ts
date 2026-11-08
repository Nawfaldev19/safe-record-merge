/**
 * A person's stage in the club is derived from dated facts, not stored, so it
 * can never disagree with them: someone whose dues ran out yesterday is
 * "lapsed" today without any job having to run. An organizer may pin a stage
 * by hand, which then wins.
 *
 * The roster filters by stage in SQL with the same rules (see member-service).
 */

export const STAGES = ['ENQUIRY', 'TRIAL', 'MEMBER', 'LAPSED'] as const;
export type Stage = (typeof STAGES)[number];

export interface StageFacts {
  /** A stage set by hand, or null to let the facts decide. */
  pin: Stage | null;
  /** The last day covered by a dues payment, as YYYY-MM-DD, or null if never paid. */
  duesPaidUntil: string | null;
  /** How many trips the person has signed up for. */
  tripCount: number;
}

/** `today` is a YYYY-MM-DD date. Dates in that form compare correctly as text. */
export function deriveStage(facts: StageFacts, today: string): Stage {
  if (facts.pin !== null) return facts.pin;
  if (facts.duesPaidUntil !== null) return facts.duesPaidUntil >= today ? 'MEMBER' : 'LAPSED';
  return facts.tripCount > 0 ? 'TRIAL' : 'ENQUIRY';
}

export const STAGE_LABELS: Readonly<Record<Stage, string>> = {
  ENQUIRY: 'Enquiry',
  TRIAL: 'Trial',
  MEMBER: 'Member',
  LAPSED: 'Lapsed',
};

export const STAGE_DESCRIPTIONS: Readonly<Record<Stage, string>> = {
  ENQUIRY: 'Asked about the club, no trip yet',
  TRIAL: 'Has joined a trip, has not paid dues',
  MEMBER: 'Dues are paid up',
  LAPSED: 'Dues have run out',
};
