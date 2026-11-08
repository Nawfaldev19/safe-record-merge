/**
 * The decisions behind the merge screen, as pure functions: which value each
 * field starts on, what the merged record will look like, and what to send to
 * the API. Kept apart from React so the rules can be tested directly.
 */

export const MERGE_FIELDS = ['firstName', 'lastName', 'email', 'phone'] as const;
export type MergeField = (typeof MERGE_FIELDS)[number];

export const FIELD_LABELS: Readonly<Record<MergeField, string>> = {
  firstName: 'First name',
  lastName: 'Last name',
  email: 'Email',
  phone: 'Phone',
};

export type Side = 'left' | 'right';
export type NotesChoice = Side | 'both';

export interface MergeSubject {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  notes: string;
  revision: number;
  tripCount: number;
  createdAt: string;
}

export interface MergeChoices {
  /** The record that is kept. The other one is folded into it. */
  keep: Side;
  fields: Record<MergeField, Side>;
  notes: NotesChoice;
}

const isBlank = (value: string | null): boolean => value === null || value.trim() === '';
const other = (side: Side): Side => (side === 'left' ? 'right' : 'left');

/**
 * Sensible starting choices. The record with more history is kept. Each field
 * starts on the kept record's value, unless that is empty and the other one is
 * not. Notes are joined when both sides have some, because notes are the one
 * field where both values are usually worth keeping.
 */
export function defaultChoices(left: MergeSubject, right: MergeSubject): MergeChoices {
  const keep: Side =
    right.tripCount > left.tripCount ||
    (right.tripCount === left.tripCount && right.createdAt < left.createdAt)
      ? 'right'
      : 'left';
  const kept = keep === 'left' ? left : right;
  const folded = keep === 'left' ? right : left;

  const fields = Object.fromEntries(
    MERGE_FIELDS.map((field) => [
      field,
      isBlank(kept[field]) && !isBlank(folded[field]) ? other(keep) : keep,
    ]),
  ) as Record<MergeField, Side>;

  let notes: NotesChoice = keep;
  if (!isBlank(left.notes) && !isBlank(right.notes) && left.notes !== right.notes) notes = 'both';
  else if (isBlank(kept.notes) && !isBlank(folded.notes)) notes = other(keep);
  return { keep, fields, notes };
}

/** Whether the two records hold different values for a field (so there is a choice to make). */
export function differs(left: MergeSubject, right: MergeSubject, field: MergeField): boolean {
  return (left[field] ?? '') !== (right[field] ?? '');
}

/** The record as it will be after the merge, for the summary before confirming. */
export function mergedResult(left: MergeSubject, right: MergeSubject, choices: MergeChoices) {
  const from = (side: Side): MergeSubject => (side === 'left' ? left : right);
  const kept = from(choices.keep);
  const folded = from(other(choices.keep));
  return {
    firstName: from(choices.fields.firstName).firstName,
    lastName: from(choices.fields.lastName).lastName,
    email: from(choices.fields.email).email,
    phone: from(choices.fields.phone).phone,
    notes:
      choices.notes === 'both'
        ? [kept.notes, folded.notes].filter((text) => !isBlank(text)).join('\n\n')
        : from(choices.notes).notes,
  };
}

type ApiSide = 'SURVIVOR' | 'ABSORBED';

/** Translates the screen's left and right into the API's "kept" and "folded in". */
export function toMergeInput(left: MergeSubject, right: MergeSubject, choices: MergeChoices) {
  const kept = choices.keep === 'left' ? left : right;
  const folded = choices.keep === 'left' ? right : left;
  const side = (chosen: Side): ApiSide => (chosen === choices.keep ? 'SURVIVOR' : 'ABSORBED');
  return {
    survivorId: kept.id,
    absorbedId: folded.id,
    expectedSurvivorRevision: kept.revision,
    expectedAbsorbedRevision: folded.revision,
    firstName: side(choices.fields.firstName),
    lastName: side(choices.fields.lastName),
    email: side(choices.fields.email),
    phone: side(choices.fields.phone),
    notes: choices.notes === 'both' ? ('BOTH' as const) : side(choices.notes),
  };
}
