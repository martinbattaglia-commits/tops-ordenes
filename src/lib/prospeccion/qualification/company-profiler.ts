import type { CompanyProfile, EmployeeBand, GrowthSignal } from './types';

type StructuredFields = {
  company_name: string | null;
  cargo: string | null;
  email: string | null;
  website: string | null;
};

function str(raw: Record<string, unknown>, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = raw[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

function parseEmployeeCount(val: unknown): number | null {
  if (val === null || val === undefined) return null;

  if (typeof val === 'number' && Number.isFinite(val)) return Math.round(val);

  if (typeof val === 'string') {
    const s = val.replace(/,/g, '').trim();

    const rangeMatch = s.match(/^(\d+)\s*[-–]\s*(\d+)/);
    if (rangeMatch) {
      const lo = parseInt(rangeMatch[1]!, 10);
      const hi = parseInt(rangeMatch[2]!, 10);
      return Math.round((lo + hi) / 2);
    }

    const plusMatch = s.match(/^(\d+)\+/);
    if (plusMatch) return parseInt(plusMatch[1]!, 10) + 1;

    const plain = parseInt(s, 10);
    if (!isNaN(plain)) return plain;
  }

  return null;
}

function bandFromCount(n: number): EmployeeBand {
  if (n <= 10) return 'XS';
  if (n <= 50) return 'S';
  if (n <= 200) return 'M';
  if (n <= 500) return 'L';
  return 'XL';
}

function bandFromString(s: string): EmployeeBand | null {
  const clean = s.replace(/,/g, '').toLowerCase().trim();

  if (/^1\s*[-–]\s*10$/.test(clean) || /^self.employed/i.test(clean)) return 'XS';
  if (/^11\s*[-–]\s*50$/.test(clean)) return 'S';
  if (/^51\s*[-–]\s*200$/.test(clean)) return 'M';
  if (/^201\s*[-–]\s*500$/.test(clean)) return 'L';
  if (/^501/.test(clean) || /^1001/.test(clean) || /^1000\+/.test(clean) || /^5001/.test(clean) || /^10001/.test(clean)) return 'XL';

  const count = parseEmployeeCount(s);
  if (count !== null) return bandFromCount(count);
  return null;
}

const IDEAL_INDUSTRY = [
  'farmacéutica', 'farmaceutica', 'pharma', 'pharmaceutical',
  'cosmética', 'cosmetica', 'cosmetic', 'beauty',
  'dispositivo médico', 'dispositivo medico', 'medical device', 'medical equipment',
  'alimentos', 'food', 'beverage', 'bebida',
  'tecnología', 'tecnologia', 'technology', 'tech', 'software', 'hardware',
  'distribución', 'distribucion', 'distribution',
  'logistics', 'logística', 'logistica',
  'importación', 'importacion', 'import', 'export', 'comercio exterior',
  'automotive', 'automotriz',
  'chemical', 'química', 'quimica',
  'retail b2b', 'wholesale', 'mayorista',
  'electrónica', 'electronica', 'electronics',
];

const INCOMPATIBLE_INDUSTRY = [
  'supermarket', 'supermercado',
  'restaurante', 'restaurant',
  'hotel', 'turismo', 'tourism',
  'educación primaria', 'educacion primaria', 'school',
  'healthcare consumer', 'personal services',
];

const COMPATIBLE_INDUSTRY = [
  'manufactura', 'manufacturing',
  'construcción', 'construccion', 'construction',
  'minería', 'mineria', 'mining',
  'agro', 'agriculture',
  'servicios profesionales', 'professional services',
  'fintech', 'finance', 'banking',
];

function normalizeIndustry(industry: string | null): CompanyProfile['industryNormalized'] {
  if (!industry) return null;
  const lower = industry.toLowerCase();

  if (INCOMPATIBLE_INDUSTRY.some(k => lower.includes(k))) return 'incompatible';
  if (IDEAL_INDUSTRY.some(k => lower.includes(k))) return 'ideal';
  if (COMPATIBLE_INDUSTRY.some(k => lower.includes(k))) return 'compatible';
  return 'neutral';
}

function hasKeyword(texts: (string | null)[], ...keywords: string[]): boolean {
  const combined = texts.filter(Boolean).join(' ').toLowerCase();
  return keywords.some(k => combined.includes(k.toLowerCase()));
}

const LATAM_COUNTRIES = [
  'brasil', 'brazil', 'chile', 'uruguay', 'paraguay', 'bolivia', 'peru', 'perú',
  'colombia', 'venezuela', 'ecuador', 'mexico', 'méxico', 'costa rica', 'panama', 'panamá',
];

function extractCountry(raw: Record<string, unknown>): string | null {
  const candidates = [
    raw['Company Country'],
    raw['Country'],
    raw['country'],
    raw['Location'],
    raw['location'],
  ];

  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) {
      const s = c.trim();
      // "City, State, Country" — take last segment
      const parts = s.split(',').map(p => p.trim()).filter(Boolean);
      if (parts.length >= 2) {
        return parts[parts.length - 1]!;
      }
      return s;
    }
  }
  return null;
}

function isLatam(country: string): boolean {
  const lower = country.toLowerCase();
  return LATAM_COUNTRIES.some(c => lower.includes(c));
}

export function extractCompanyProfile(
  raw: Record<string, unknown>,
  structured: StructuredFields,
): CompanyProfile {
  const industry = str(
    raw,
    'Industry',
    'company_industry',
    'Company Industry',
    'industry',
  );

  const employeesRawStr = str(
    raw,
    'Company Headcount',
    'Number of Employees',
    'Employees',
    'company_size',
    'headcount',
  );
  const employeesRaw = parseEmployeeCount(employeesRawStr ?? raw['Company Headcount'] ?? raw['headcount']);

  let employeeBand: EmployeeBand | null = null;
  if (employeesRaw !== null) {
    employeeBand = bandFromCount(employeesRaw);
  } else if (employeesRawStr) {
    employeeBand = bandFromString(employeesRawStr);
  }

  const country = extractCountry(raw);

  const isArgentina =
    (country !== null &&
      (country.toLowerCase().includes('argentina') || country.toUpperCase() === 'AR')) ||
    hasKeyword([str(raw, 'Location', 'location')], 'argentina');

  const industryNormalized = normalizeIndustry(industry);
  const isB2B = industryNormalized !== 'incompatible';

  const textBag = [
    structured.company_name,
    industry,
    str(raw, 'Description', 'description', 'Company Description', 'about'),
  ];

  const hasDepositos = hasKeyword(
    textBag,
    'depósito', 'deposito', 'warehouse', 'almacén', 'almacen',
    'bodega', 'storage', 'fulfillment', '3pl', 'operador logístico', 'logistic operator',
  );

  const hasImportExport = hasKeyword(
    textBag,
    'import', 'export', 'comercio exterior', 'aduana', 'customs', 'despacho', 'despachante',
  );

  const hasDistribucionNacional = hasKeyword(
    textBag,
    'distribución', 'distribucion', 'distribution', 'delivery', 'entrega',
    'ruta', 'transporte', 'transport', 'courier', 'last mile', 'última milla', 'ultima milla',
  );

  const hasCds = hasKeyword(
    textBag,
    'centro de distribución', 'centro de distribucion', 'distribution center',
    'cross-dock', 'crossdock',
  );

  const tercerizaAlmacenamiento = hasKeyword(
    textBag,
    'terceriza', 'tercerizamos', 'outsource', 'externaliza',
    'operador externo', 'logística tercerizada', 'logistica tercerizada',
  );

  const dentroMercadoObjetivo =
    isArgentina &&
    isB2B &&
    (hasDepositos ||
      hasImportExport ||
      hasDistribucionNacional ||
      tercerizaAlmacenamiento ||
      industryNormalized === 'ideal');

  let growthSignal: GrowthSignal = 'none';
  if (employeeBand === 'XL') {
    growthSignal = 'high';
  } else if (employeeBand === 'L') {
    growthSignal = 'mid';
  } else if (employeeBand === 'M') {
    growthSignal = 'low';
  }

  const profileInputs: Record<string, unknown> = {
    company_name: structured.company_name,
    cargo: structured.cargo,
    email: structured.email,
    website: structured.website,
    industry_raw: industry,
    employees_raw: employeesRawStr ?? raw['Company Headcount'] ?? null,
    country_raw: country,
  };

  return {
    industry,
    industryNormalized,
    employeesRaw,
    employeeBand,
    country,
    isArgentina,
    isB2B,
    hasDepositos,
    hasImportExport,
    hasDistribucionNacional,
    hasCds,
    tercerizaAlmacenamiento,
    dentroMercadoObjetivo,
    growthSignal,
    evidenceSource: 'csv',
    profileInputs,
  };
}

export { isLatam };
