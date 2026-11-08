import { z } from 'zod';
import { STAGES } from '../../shared/stage';
import { invalid } from '../domain/errors';

/**
 * Input schemas for everything that crosses the API edge. GraphQL already checks
 * types; these check meaning (lengths, formats) before any query runs.
 */

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => (value === undefined || value === null || value === '' ? null : value));

export const memberSchema = z.object({
  firstName: z.string().trim().min(1, 'is needed').max(60),
  lastName: z.string().trim().min(1, 'is needed').max(60),
  email: optionalText(200).refine(
    (value) => value === null || z.email().safeParse(value).success,
    'is not an email address',
  ),
  phone: optionalText(40).refine(
    (value) => value === null || /^[0-9 +()./-]{3,}$/.test(value),
    'may only contain digits, spaces and + ( ) . / -',
  ),
  notes: z.string().trim().max(4000).default(''),
});

export const newMemberSchema = memberSchema.extend({
  source: z.enum(['paper', 'web', 'event']).default('web'),
});

export const memberUpdateSchema = memberSchema.extend({
  expectedRevision: z.number().int().positive(),
});

export const stagePinSchema = z.object({ pin: z.enum(STAGES).nullable() });

const side = z.enum(['survivor', 'absorbed']);

export const mergeSchema = z.object({
  survivorId: z.uuid(),
  absorbedId: z.uuid(),
  expectedSurvivorRevision: z.number().int().positive(),
  expectedAbsorbedRevision: z.number().int().positive(),
  firstName: side,
  lastName: side,
  email: side,
  phone: side,
  notes: z.enum(['survivor', 'absorbed', 'both']),
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().min(3).max(200),
  password: z.string().min(1).max(200),
});

/** Parses input or throws a VALIDATION error with one issue per failing field. */
export function parseInput<Schema extends z.ZodType>(
  schema: Schema,
  input: unknown,
): z.infer<Schema> {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  throw invalid(
    'Some of the input is not valid.',
    result.error.issues.map((issue) => {
      const field = issue.path.join('.');
      return { field: field === '' ? null : field, message: issue.message };
    }),
  );
}
