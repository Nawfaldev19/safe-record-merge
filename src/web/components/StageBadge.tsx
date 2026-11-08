import { STAGE_LABELS } from '../../shared/stage';
import type { Stage } from '../../shared/stage';
import { Badge } from './ui';

const TONES = {
  ENQUIRY: 'neutral',
  TRIAL: 'accent',
  MEMBER: 'success',
  LAPSED: 'warning',
} as const satisfies Record<Stage, string>;

/** The stage in words, with a colour that only supports the words. */
export function StageBadge({ stage, fixed = false }: { stage: Stage; fixed?: boolean }) {
  return (
    <Badge tone={TONES[stage]}>
      {STAGE_LABELS[stage]}
      {fixed ? ' (fixed)' : ''}
    </Badge>
  );
}
