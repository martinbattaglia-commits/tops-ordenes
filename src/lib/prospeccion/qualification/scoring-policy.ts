import type { CompanyProfile, ScoreFactors, Penalty, IcpConfig, ScoreDimension } from './types';

const GENERIC_DOMAINS = new Set([
  'gmail.com', 'gmail.com.ar',
  'hotmail.com', 'hotmail.com.ar',
  'yahoo.com', 'yahoo.com.ar',
  'outlook.com', 'outlook.com.ar',
  'icloud.com',
  'live.com', 'live.com.ar',
]);

const DECISION_MAKER_KEYWORDS = [
  'ceo', 'cfo', 'coo', 'cto', 'director', 'presidente', 'gerente',
  'founder', 'owner', 'head', 'vp', 'vice president', 'jefe', 'socio', 'principal',
];

const INFLUENCER_KEYWORDS = [
  'supervisor', 'coordinador', 'coordinadora', 'manager',
  'analista senior', 'jefe de', 'encargado',
];

const LATAM_COUNTRIES = [
  'brasil', 'brazil', 'chile', 'uruguay', 'paraguay', 'bolivia', 'peru', 'perú',
  'colombia', 'venezuela', 'ecuador', 'mexico', 'méxico', 'costa rica', 'panama', 'panamá',
];

function isLatam(country: string): boolean {
  const lower = country.toLowerCase();
  return LATAM_COUNTRIES.some(c => lower.includes(c));
}

function dim(raw: number, weight: number, label: string): ScoreDimension {
  return {
    raw,
    weighted: parseFloat(((raw * weight) / 100).toFixed(4)),
    max: weight,
    label,
  };
}

export function isGenericEmail(email: string | null): boolean {
  if (!email) return false;
  const domain = email.split('@')[1]?.toLowerCase().trim();
  if (!domain) return false;
  return GENERIC_DOMAINS.has(domain);
}

export function isDecisionMaker(cargo: string | null): boolean {
  if (!cargo) return false;
  const lower = cargo.toLowerCase();
  return DECISION_MAKER_KEYWORDS.some(k => lower.includes(k));
}

export function isInfluencer(cargo: string | null): boolean {
  if (!cargo) return false;
  const lower = cargo.toLowerCase();
  return INFLUENCER_KEYWORDS.some(k => lower.includes(k));
}

function scoreIndustria(profile: CompanyProfile, weight: number): ScoreDimension {
  const scores: Record<string, number> = {
    ideal: 100,
    compatible: 60,
    neutral: 30,
    incompatible: 0,
  };
  const raw = profile.industryNormalized !== null ? (scores[profile.industryNormalized] ?? 30) : 30;
  return dim(raw, weight, 'industria');
}

function scoreTamano(profile: CompanyProfile, weight: number): ScoreDimension {
  const scores: Record<string, number> = {
    XL: 100,
    L: 87,
    M: 67,
    S: 40,
    XS: 13,
  };
  const raw = profile.employeeBand !== null ? (scores[profile.employeeBand] ?? 40) : 40;
  return dim(raw, weight, 'tamano');
}

function scoreActividadLogistica(profile: CompanyProfile, weight: number): ScoreDimension {
  let total = 0;
  if (profile.hasDepositos) total += 40;
  if (profile.hasImportExport) total += 32;
  if (profile.hasDistribucionNacional) total += 20;
  if (profile.hasCds) total += 16;
  if (profile.tercerizaAlmacenamiento) total += 32;
  if (profile.dentroMercadoObjetivo) total += 20;
  const raw = Math.min(100, total);
  return dim(raw, weight, 'actividadLogistica');
}

function scorePresenciaArgentina(profile: CompanyProfile, weight: number): ScoreDimension {
  let raw: number;
  if (profile.isArgentina) {
    raw = 100;
  } else if (profile.country !== null && isLatam(profile.country)) {
    raw = 60;
  } else if (profile.country === null) {
    raw = 40;
  } else {
    raw = 20;
  }
  return dim(raw, weight, 'presenciaArgentina');
}

function scorePotencialEconomico(
  profile: CompanyProfile,
  weight: number,
  structured: { email: string | null; cargo: string | null; website: string | null },
): ScoreDimension {
  let raw = 0;
  if (structured.email && !isGenericEmail(structured.email)) raw += 25;
  if (structured.website) raw += 25;
  if (isDecisionMaker(structured.cargo)) {
    raw += 50;
  } else if (isInfluencer(structured.cargo)) {
    raw += 25;
  }
  raw = Math.min(100, raw);
  return dim(raw, weight, 'potencialEconomico');
}

function scoreCrecimiento(profile: CompanyProfile, weight: number): ScoreDimension {
  const scores: Record<string, number> = {
    high: 100,
    mid: 70,
    low: 40,
    none: 0,
  };
  const raw = scores[profile.growthSignal] ?? 0;
  return dim(raw, weight, 'crecimiento');
}

export interface ScoreFactorsInput {
  email: string | null;
  cargo: string | null;
  website: string | null;
  linkedin_url?: string | null;
  cuit?: string | null;
}

export function computeScoreFactors(
  profile: CompanyProfile,
  icp: IcpConfig,
  structured: ScoreFactorsInput,
  raw: Record<string, unknown> = {},
): { factors: ScoreFactors; penalties: Penalty[]; hardFails: string[] } {
  const { weights } = icp;

  const factors: ScoreFactors = {
    industria: scoreIndustria(profile, weights.industria),
    tamano: scoreTamano(profile, weights.tamano),
    actividadLogistica: scoreActividadLogistica(profile, weights.actividadLogistica),
    presenciaArgentina: scorePresenciaArgentina(profile, weights.presenciaArgentina),
    potencialEconomico: scorePotencialEconomico(profile, weights.potencialEconomico, structured),
    crecimiento: scoreCrecimiento(profile, weights.crecimiento),
  };

  const penalties: Penalty[] = [];

  const hasLinkedin =
    typeof structured.linkedin_url === 'string' && !!structured.linkedin_url ||
    typeof raw['linkedin_url'] === 'string' && !!(raw['linkedin_url'] as string);

  if (!structured.email && !hasLinkedin) {
    penalties.push({ code: 'SOLO_PHONE', points: -10, reason: 'Sin email ni LinkedIn.' });
  }

  if (isGenericEmail(structured.email)) {
    penalties.push({ code: 'EMAIL_GENERICO', points: -5, reason: 'Email de dominio genérico.' });
  }

  if (profile.employeeBand === 'XS' && !profile.isArgentina) {
    penalties.push({ code: 'MICRO_EXTRANJERO', points: -5, reason: 'Empresa micro sin presencia argentina.' });
  }

  const hasAnyLogistica =
    profile.hasDepositos ||
    profile.hasImportExport ||
    profile.hasDistribucionNacional ||
    profile.hasCds ||
    profile.tercerizaAlmacenamiento;

  if (!hasAnyLogistica && (profile.employeeBand === 'XS' || profile.employeeBand === 'S')) {
    penalties.push({ code: 'SIN_ACTIVIDAD_LOGISTICA', points: -10, reason: 'Sin señales de actividad logística.' });
  }

  const hasCuit =
    typeof structured.cuit === 'string' && !!structured.cuit ||
    typeof raw['cuit'] === 'string' && !!(raw['cuit'] as string);

  if (!structured.email && !hasCuit && !hasLinkedin) {
    penalties.push({ code: 'DATOS_INSUFICIENTES', points: -5, reason: 'Datos insuficientes para calificación completa.' });
  }

  const hardFails: string[] = [];
  if (profile.industryNormalized === 'incompatible') {
    hardFails.push('FUERA_MERCADO');
  }

  return { factors, penalties, hardFails };
}
