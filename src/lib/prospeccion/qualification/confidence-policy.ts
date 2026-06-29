import type { CompanyProfile } from './types';

export function computeConfidence(
  profile: CompanyProfile,
  structured: {
    email: string | null;
    cuit: string | null;
    linkedin_url: string | null;
    cargo: string | null;
    website: string | null;
    company_name: string | null;
  },
  hardFails: ReadonlyArray<string> = [],
): number {
  let score = 0;

  if (structured.email) score += 15;
  if (structured.cuit) score += 15;
  if (structured.linkedin_url) score += 10;
  if (structured.company_name) score += 15;
  if (structured.cargo) score += 10;
  if (structured.website) score += 10;
  if (profile.industry) score += 10;
  if (profile.employeesRaw !== null) score += 10;
  if (profile.country !== null) score += 5;

  if (hardFails.length > 0) {
    return Math.min(score, 20);
  }

  return Math.min(100, score);
}
