export type EmployeeBand = 'XS' | 'S' | 'M' | 'L' | 'XL';
export type GrowthSignal = 'none' | 'low' | 'mid' | 'high';
export type PriorityTier = 'alta' | 'media' | 'baja';
export type QualDecision = 'import' | 'review' | 'discard';
export type BusinessUnit = 'general' | 'anmat' | 'cargas_generales' | 'fulfillment' | 'cross_dock' | 'ultima_milla';

export interface CompanyProfile {
  industry: string | null;
  industryNormalized: 'ideal' | 'compatible' | 'neutral' | 'incompatible' | null;
  employeesRaw: number | null;
  employeeBand: EmployeeBand | null;
  country: string | null;
  isArgentina: boolean;
  isB2B: boolean;
  hasDepositos: boolean;
  hasImportExport: boolean;
  hasDistribucionNacional: boolean;
  hasCds: boolean;
  tercerizaAlmacenamiento: boolean;
  dentroMercadoObjetivo: boolean;
  growthSignal: GrowthSignal;
  evidenceSource: 'csv';
  profileInputs: Record<string, unknown>;
}

export interface ScoreDimension {
  raw: number;
  weighted: number;
  max: number;
  label: string;
}

export interface ScoreFactors {
  industria: ScoreDimension;
  tamano: ScoreDimension;
  actividadLogistica: ScoreDimension;
  presenciaArgentina: ScoreDimension;
  potencialEconomico: ScoreDimension;
  crecimiento: ScoreDimension;
}

export interface Penalty {
  code: string;
  points: number;
  reason: string;
}

export interface IcpWeights {
  industria: number;
  tamano: number;
  actividadLogistica: number;
  presenciaArgentina: number;
  potencialEconomico: number;
  crecimiento: number;
}

export interface IcpThresholds {
  import: number;
  review: number;
}

export interface IcpConfig {
  businessUnit: BusinessUnit;
  version: string;
  weights: IcpWeights;
  thresholds: IcpThresholds;
}

export interface QualificationResult {
  profile: CompanyProfile;
  score: number;
  confidence: number;
  priority: { tier: PriorityTier; value: number };
  factors: ScoreFactors;
  penalties: ReadonlyArray<Penalty>;
  hardFails: ReadonlyArray<string>;
  decision: QualDecision;
  explanation: string;
  businessUnit: BusinessUnit;
  modelVersion: string;
  strategyId: string;
  icpConfigVersion: string;
  confidenceVersion: string;
}

export interface DecisionTrace {
  icpConfigVersion: string;
  businessUnit: BusinessUnit;
  modelVersion: string;
  strategyId: string;
  confidenceVersion: string;
  profileInputs: Record<string, unknown>;
  factors: ScoreFactors;
  penalties: ReadonlyArray<Penalty>;
  hardFails: ReadonlyArray<string>;
  score: number;
  confidence: number;
  priority: { tier: PriorityTier; value: number };
  decision: QualDecision;
  explanation: string;
}
