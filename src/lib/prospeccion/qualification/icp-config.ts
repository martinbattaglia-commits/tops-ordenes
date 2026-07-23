import type { IcpConfig } from './types';

export const ICP_GENERAL_V1: IcpConfig = {
  businessUnit: 'general',
  version: 'general-v1',
  weights: {
    industria: 20,
    tamano: 15,
    actividadLogistica: 25,
    presenciaArgentina: 10,
    potencialEconomico: 20,
    crecimiento: 10,
  },
  thresholds: {
    import: 75,
    review: 50,
  },
};

export const ICP_CONFIGS: Record<string, IcpConfig> = {
  'general-v1': ICP_GENERAL_V1,
};

export function getIcpConfig(version: string): IcpConfig {
  return ICP_CONFIGS[version] ?? ICP_GENERAL_V1;
}
