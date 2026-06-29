import type { QualDecision, CompanyProfile, ScoreFactors, Penalty } from './types';
import { isDecisionMaker, isGenericEmail } from './scoring-policy';

export function buildExplanation(
  decision: QualDecision,
  score: number,
  profile: CompanyProfile,
  factors: ScoreFactors,
  penalties: ReadonlyArray<Penalty>,
  hardFails: ReadonlyArray<string>,
  structured: { cargo: string | null; email: string | null },
): string {
  const positives: string[] = [];
  const observations: string[] = [];

  if (profile.dentroMercadoObjetivo) {
    positives.push('Empresa dentro del mercado objetivo.');
  }
  if (profile.industryNormalized === 'ideal') {
    positives.push('Industria ideal para TOPS.');
  }
  if (isDecisionMaker(structured.cargo)) {
    positives.push('Cargo directivo.');
  }
  if (profile.employeeBand === 'XL') {
    positives.push('Empresa grande (500+ empleados).');
  } else if (profile.employeeBand === 'L') {
    positives.push('Empresa mediana-grande.');
  }
  if (structured.email && !isGenericEmail(structured.email)) {
    positives.push('Email corporativo.');
  }
  if (profile.hasImportExport) {
    positives.push('Actividad de importación/exportación.');
  }
  if (profile.hasDepositos) {
    positives.push('Operaciones de depósito/almacenamiento.');
  }

  const penaltyCodes = new Set(penalties.map(p => p.code));

  if (hardFails.includes('FUERA_MERCADO')) {
    observations.push('Empresa fuera del mercado objetivo de TOPS.');
  }
  if (penaltyCodes.has('EMAIL_GENERICO')) {
    observations.push('Email genérico (no corporativo).');
  }
  if (penaltyCodes.has('MICRO_EXTRANJERO')) {
    observations.push('Empresa pequeña sin presencia argentina.');
  }
  if (penaltyCodes.has('SIN_ACTIVIDAD_LOGISTICA')) {
    observations.push('Sin señales de actividad logística.');
  }
  if (penaltyCodes.has('DATOS_INSUFICIENTES')) {
    observations.push('Datos insuficientes para calificación completa.');
  }
  if (penaltyCodes.has('SOLO_PHONE')) {
    observations.push('Solo teléfono disponible, sin email ni LinkedIn.');
  }

  const decisionLabel: Record<QualDecision, string> = {
    import: 'Prospecto calificado.',
    review: 'Prospecto para revisar.',
    discard: 'Prospecto descartado.',
  };

  const parts: string[] = [`${decisionLabel[decision]} Score ${score}/100.`];

  if (positives.length > 0) {
    parts.push(`Puntos fuertes: ${positives.join(' ')}`);
  }
  if (observations.length > 0) {
    parts.push(`Observaciones: ${observations.join(' ')}`);
  }

  return parts.join(' ');
}
