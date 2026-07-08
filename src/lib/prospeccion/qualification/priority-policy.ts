import type { CompanyProfile, PriorityTier } from './types';
import { isDecisionMaker } from './scoring-policy';

export function computePriority(
  score: number,
  profile: CompanyProfile,
  structured: { cargo: string | null },
): { tier: PriorityTier; value: number } {
  let value = score;

  if (isDecisionMaker(structured.cargo)) value += 5;
  if (profile.dentroMercadoObjetivo) value += 5;
  if (profile.hasImportExport) value += 3;
  if (profile.employeeBand === 'XL' || profile.employeeBand === 'L') value += 2;

  value = Math.min(100, value);

  let tier: PriorityTier;
  if (value >= 75) {
    tier = 'alta';
  } else if (value >= 50) {
    tier = 'media';
  } else {
    tier = 'baja';
  }

  return { tier, value };
}
