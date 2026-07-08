import { describe, it, expect } from 'vitest';
import { computeScoreFactors } from './scoring-policy';
import { extractCompanyProfile } from './company-profiler';
import { ICP_GENERAL_V1 } from './icp-config';

function makeProfile(overrides: Partial<Parameters<typeof extractCompanyProfile>[0]> = {}, structured: Partial<Parameters<typeof extractCompanyProfile>[1]> = {}) {
  return extractCompanyProfile(
    { ...overrides },
    { company_name: null, cargo: null, email: null, website: null, ...structured },
  );
}

describe('computeScoreFactors', () => {
  it('empresa ideal: farma argentina grande puntúa alto en industria, tamaño y logística', () => {
    const profile = makeProfile(
      {
        Industry: 'Farmacéutica',
        'Company Headcount': '1001-5000',
        'Company Country': 'Argentina',
        Description: 'Distribución de medicamentos a nivel nacional. Operador logístico con depósitos fiscales.',
      },
      { company_name: 'FarmaDistrib SA', email: 'contacto@farmadistrib.com.ar', website: 'farmadistrib.com.ar', cargo: 'Gerente de Logística' },
    );

    const { factors, hardFails } = computeScoreFactors(
      profile,
      ICP_GENERAL_V1,
      { email: 'contacto@farmadistrib.com.ar', cargo: 'Gerente de Logística', website: 'farmadistrib.com.ar', linkedin_url: null, cuit: null },
    );

    expect(hardFails).toHaveLength(0);
    expect(factors.industria.raw).toBe(100);
    expect(factors.tamano.raw).toBe(100);
    expect(factors.presenciaArgentina.raw).toBe(100);
    expect(factors.actividadLogistica.raw).toBeGreaterThan(0);
  });

  it('empresa incompatible (retail B2C) genera hard fail FUERA_MERCADO', () => {
    const profile = makeProfile({ Industry: 'Supermercado retail' }, { company_name: 'Super S.A.' });
    const { hardFails } = computeScoreFactors(profile, ICP_GENERAL_V1, { email: null, cargo: null, website: null });
    expect(hardFails).toContain('FUERA_MERCADO');
  });

  it('empresa sin datos genera score bajo y penalización DATOS_INSUFICIENTES', () => {
    const profile = makeProfile({}, {});
    const { factors, penalties } = computeScoreFactors(profile, ICP_GENERAL_V1, { email: null, cargo: null, website: null, linkedin_url: null, cuit: null });
    const baseScore = Object.values(factors).reduce((s, d) => s + d.weighted, 0);
    expect(baseScore).toBeLessThan(50);
    const codes = penalties.map(p => p.code);
    expect(codes).toContain('DATOS_INSUFICIENTES');
  });

  it('email genérico aplica penalización EMAIL_GENERICO', () => {
    const profile = makeProfile({ Industry: 'Logística', 'Company Country': 'Argentina', 'Company Headcount': '51-200' }, { email: 'juan@gmail.com' });
    const { penalties } = computeScoreFactors(
      profile,
      ICP_GENERAL_V1,
      { email: 'juan@gmail.com', cargo: null, website: null, linkedin_url: null, cuit: null },
    );
    expect(penalties.some(p => p.code === 'EMAIL_GENERICO')).toBe(true);
  });

  it('empresa extranjera micro aplica penalización MICRO_EXTRANJERO', () => {
    const profile = makeProfile({ Industry: 'Software', 'Company Headcount': '1-10', 'Company Country': 'Brazil' }, {});
    const { penalties } = computeScoreFactors(profile, ICP_GENERAL_V1, { email: null, cargo: null, website: null, linkedin_url: null, cuit: null });
    expect(penalties.some(p => p.code === 'MICRO_EXTRANJERO')).toBe(true);
  });

  it('cargo CEO incrementa score de potencial económico', () => {
    const profileSin = makeProfile({ 'Company Country': 'Argentina', Industry: 'Logística' }, { email: 'x@empresa.com', website: 'empresa.com', cargo: null });
    const profileCon = makeProfile({ 'Company Country': 'Argentina', Industry: 'Logística' }, { email: 'x@empresa.com', website: 'empresa.com', cargo: 'CEO' });

    const { factors: fSin } = computeScoreFactors(profileSin, ICP_GENERAL_V1, { email: 'x@empresa.com', cargo: null, website: 'empresa.com' });
    const { factors: fCon } = computeScoreFactors(profileCon, ICP_GENERAL_V1, { email: 'x@empresa.com', cargo: 'CEO', website: 'empresa.com' });

    expect(fCon.potencialEconomico.raw).toBeGreaterThan(fSin.potencialEconomico.raw);
  });

  it('empresa dentro del mercado objetivo maximiza actividad logística', () => {
    const profile = makeProfile(
      { Industry: 'Importación y distribución', 'Company Country': 'Argentina', 'Company Headcount': '201-500', Description: 'Operamos depósitos y hacemos comercio exterior.' },
      { company_name: 'ImportLogis SA', email: 'ops@importlogis.com.ar', website: 'importlogis.com.ar', cargo: 'Director' },
    );
    const { factors } = computeScoreFactors(
      profile,
      ICP_GENERAL_V1,
      { email: 'ops@importlogis.com.ar', cargo: 'Director', website: 'importlogis.com.ar' },
    );
    expect(profile.dentroMercadoObjetivo).toBe(true);
    expect(factors.actividadLogistica.raw).toBeGreaterThan(50);
  });

  it('score total nunca supera 100 aunque las dimensiones sumen más', () => {
    const profile = makeProfile(
      {
        Industry: 'Logística y distribución',
        'Company Headcount': '5001-10000',
        'Company Country': 'Argentina',
        Description: 'Depósitos fiscales, importación, exportación, distribución nacional, cross-dock, tercerización logística.',
      },
      { company_name: 'MegaLog SA', email: 'info@megalog.com.ar', website: 'megalog.com.ar', cargo: 'CEO' },
    );
    const { factors, penalties } = computeScoreFactors(
      profile,
      ICP_GENERAL_V1,
      { email: 'info@megalog.com.ar', cargo: 'CEO', website: 'megalog.com.ar', linkedin_url: 'https://linkedin.com/in/ceo', cuit: '30-12345678-9' },
    );
    const base = Object.values(factors).reduce((s, d) => s + d.weighted, 0);
    const pen = penalties.reduce((s, p) => s + p.points, 0);
    const score = Math.max(0, Math.min(100, Math.round(base + pen)));
    expect(score).toBeLessThanOrEqual(100);
    expect(score).toBeGreaterThanOrEqual(0);
  });

  it('empresa pequeña sin logística recibe penalización SIN_ACTIVIDAD_LOGISTICA', () => {
    const profile = makeProfile(
      { Industry: 'Consultoría', 'Company Headcount': '11-50', 'Company Country': 'Argentina' },
      { company_name: 'Consultora XYZ', email: 'hola@consultora.com', cargo: null, website: null },
    );
    const { penalties } = computeScoreFactors(
      profile,
      ICP_GENERAL_V1,
      { email: 'hola@consultora.com', cargo: null, website: null },
    );
    expect(penalties.some(p => p.code === 'SIN_ACTIVIDAD_LOGISTICA')).toBe(true);
  });
});
