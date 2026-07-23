import type { QualDecision, IcpThresholds } from './types';

export function computeDecision(
  score: number,
  hardFails: ReadonlyArray<string>,
  thresholds: IcpThresholds,
): QualDecision {
  if (hardFails.length > 0) return 'discard';
  if (score >= thresholds.import) return 'import';
  if (score >= thresholds.review) return 'review';
  return 'discard';
}
