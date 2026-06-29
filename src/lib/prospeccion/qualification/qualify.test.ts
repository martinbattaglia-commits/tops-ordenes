import { describe, it, expect } from 'vitest';
import { qualify } from './qualify';

describe('qualify()', () => {
  it('prospect LinkedIn Sales Navigator (ACME Logística, Argentina, 500+ empleados, Gerente de Logística): import, score >= 75', () => {
    const res = qualify({
      raw: {
        Industry: 'Logística y distribución',
        'Company Headcount': '501-1000',
        'Company Country': 'Argentina',
        Description: 'Empresa de logística con depósitos propios y distribución nacional. Operador logístico integral.',
      },
      company_name: 'ACME Logística SA',
      cargo: 'Gerente de Logística',
      email: 'gerente@acmelogistica.com.ar',
      website: 'acmelogistica.com.ar',
      cuit: '30-71234567-9',
      linkedin_url: 'https://www.linkedin.com/in/gerente-acme',
    });

    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const { result } = res.value;
    expect(result.decision).toBe('import');
    expect(result.score).toBeGreaterThanOrEqual(75);
  });

  it('prospect sin datos (solo phone): discard', () => {
    const res = qualify({
      raw: { phone: '+54 11 1234-5678' },
      company_name: null,
      cargo: null,
      email: null,
      website: null,
      cuit: null,
      linkedin_url: null,
    });

    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const { result } = res.value;
    expect(result.decision).toBe('discard');
  });

  it('prospect farmacéutica argentina grande: import', () => {
    const res = qualify({
      raw: {
        Industry: 'Farmacéutica',
        'Company Headcount': '1001-5000',
        'Company Country': 'Argentina',
        Description: 'Laboratorio farmacéutico con depósitos fiscales y distribución a farmacias.',
      },
      company_name: 'BioFarma Argentina SA',
      cargo: 'Director de Operaciones',
      email: 'dir.ops@biofarma.com.ar',
      website: 'biofarma.com.ar',
      cuit: '30-87654321-5',
      linkedin_url: 'https://www.linkedin.com/in/director-ops-biofarma',
    });

    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const { result } = res.value;
    expect(result.decision).toBe('import');
  });

  it('prospect retail B2C (supermercado): discard, hardFails includes FUERA_MERCADO', () => {
    const res = qualify({
      raw: {
        Industry: 'Supermercado retail',
        'Company Headcount': '201-500',
        'Company Country': 'Argentina',
      },
      company_name: 'SuperMarket SRL',
      cargo: 'Jefe de Compras',
      email: 'compras@supermarket.com.ar',
      website: 'supermarket.com.ar',
      cuit: '30-55555555-5',
      linkedin_url: null,
    });

    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const { result } = res.value;
    expect(result.decision).toBe('discard');
    expect(result.hardFails).toContain('FUERA_MERCADO');
  });

  it('prospect con email gmail: penalty EMAIL_GENERICO presente', () => {
    const res = qualify({
      raw: {
        Industry: 'Manufactura',
        'Company Headcount': '51-200',
        'Company Country': 'Argentina',
      },
      company_name: 'Fábrica Sur SA',
      cargo: 'Encargado de Logística',
      email: 'fabrica.sur@gmail.com',
      website: null,
      cuit: null,
      linkedin_url: null,
    });

    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const { result } = res.value;
    const codes = result.penalties.map(p => p.code);
    expect(codes).toContain('EMAIL_GENERICO');
  });

  it('prospect LATAM industria compatible con importación: review', () => {
    const res = qualify({
      raw: {
        Industry: 'Manufactura y comercio exterior',
        'Company Headcount': '51-200',
        'Company Country': 'Chile',
        Description: 'Empresa de manufactura que realiza importación y exportación de equipos industriales.',
      },
      company_name: 'FabriChile Ltda',
      cargo: 'Coordinadora de Operaciones',
      email: 'ops@fabrichile.cl',
      website: 'fabrichile.cl',
      cuit: null,
      linkedin_url: 'https://www.linkedin.com/in/coord-fabrichile',
    });

    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const { result } = res.value;
    expect(result.profile.isArgentina).toBe(false);
    expect(result.hardFails).toHaveLength(0);
    expect(result.decision).toBe('review');
  });
});
