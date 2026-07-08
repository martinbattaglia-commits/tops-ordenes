import type { QualificationResult, DecisionTrace, IcpConfig } from './types';
import { extractCompanyProfile } from './company-profiler';
import { computeScoreFactors } from './scoring-policy';
import { computeConfidence } from './confidence-policy';
import { computePriority } from './priority-policy';
import { computeDecision } from './decision-policy';
import { buildExplanation } from './explanation-policy';
import { ICP_GENERAL_V1 } from './icp-config';
import type { Result } from '../domain/result';

const MODEL_VERSION = 'qual-v1';
const STRATEGY_ID = 'csv-evidence-v1';
const CONFIDENCE_VERSION = 'conf-v1';

export interface QualifyInput {
  raw: Record<string, unknown>;
  company_name: string | null;
  cargo: string | null;
  email: string | null;
  website: string | null;
  cuit: string | null;
  linkedin_url: string | null;
}

export function qualify(
  input: QualifyInput,
  icp: IcpConfig = ICP_GENERAL_V1,
): Result<{ result: QualificationResult; trace: DecisionTrace }> {
  const structured = {
    company_name: input.company_name,
    cargo: input.cargo,
    email: input.email,
    website: input.website,
    cuit: input.cuit,
    linkedin_url: input.linkedin_url,
  };

  const profile = extractCompanyProfile(input.raw, structured);
  const { factors, penalties, hardFails } = computeScoreFactors(profile, icp, structured, input.raw);

  const baseScore = Object.values(factors).reduce((s, d) => s + d.weighted, 0);
  const penaltyTotal = penalties.reduce((s, p) => s + p.points, 0);
  const score = Math.max(0, Math.min(100, Math.round(baseScore + penaltyTotal)));

  const confidence = computeConfidence(profile, structured, hardFails);
  const priority = computePriority(score, profile, { cargo: input.cargo });
  const decision = computeDecision(score, hardFails, icp.thresholds);
  const explanation = buildExplanation(decision, score, profile, factors, penalties, hardFails, {
    cargo: input.cargo,
    email: input.email,
  });

  const result: QualificationResult = {
    profile,
    score,
    confidence,
    priority,
    factors,
    penalties,
    hardFails,
    decision,
    explanation,
    businessUnit: icp.businessUnit,
    modelVersion: MODEL_VERSION,
    strategyId: STRATEGY_ID,
    icpConfigVersion: icp.version,
    confidenceVersion: CONFIDENCE_VERSION,
  };

  const trace: DecisionTrace = {
    icpConfigVersion: icp.version,
    businessUnit: icp.businessUnit,
    modelVersion: MODEL_VERSION,
    strategyId: STRATEGY_ID,
    confidenceVersion: CONFIDENCE_VERSION,
    profileInputs: profile.profileInputs,
    factors,
    penalties,
    hardFails,
    score,
    confidence,
    priority,
    decision,
    explanation,
  };

  return { ok: true, value: { result, trace } };
}
