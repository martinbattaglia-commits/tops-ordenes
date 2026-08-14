/**
 * Tipos del simulador de backfill. El módulo se escribe en `.mjs` porque
 * también corre como CLI; el `.d.mts` le da tipos al harness sin compilarlo.
 */

export declare const EVIDENCIA_LEDGER: string;

export declare const ESTADO_LEDGER: {
  readonly OBSERVADA: "OBSERVED_REGISTERED";
  readonly INFERIDA: "INFERRED_NOT_REGISTERED";
  readonly SIN_EVIDENCIA: "LEDGER_EVIDENCE_ABSENT";
};

export interface FilaBackfill {
  ledger_version: string;
  ledger_name: string;
  estado_ledger: "OBSERVED_REGISTERED" | "INFERRED_NOT_REGISTERED" | "LEDGER_EVIDENCE_ABSENT";
  evidencia: string;
  /** Siempre `PROBE_REQUIRED_NOT_EXECUTED` mientras no haya sondas autorizadas. */
  schema_probe: "PROBE_REQUIRED_NOT_EXECUTED";
  authorized_for_write: false;
}

export interface PlanBackfill {
  $schema: string;
  naturaleza: string;
  generado_por: string;
  determinista: string;
  fuente_ledger: { archivo: string; presente: boolean; sha256: string | null; alcance: string };
  conteos: {
    ejecutables_en_catalogo: number;
    observadas_en_ledger: number;
    inferidas_no_registradas: number;
    filas_autorizadas_a_escritura: number;
    sondas_ejecutadas: number;
  };
  advertencia: string;
  escritura: {
    sentencia_prevista: string;
    idempotencia: string;
    precondicion: string;
    ejecutada: boolean;
  };
  filas: FilaBackfill[];
}

export declare function matchearLedger(
  filename: string,
  registrados: ReadonlySet<string>,
): { match: boolean; via: string | null };

export declare function construirPlan(opts?: {
  catalogo?: unknown;
  evidencia?: unknown;
  evidenciaSha?: string | null;
}): PlanBackfill;

export declare function serializar(plan: PlanBackfill): string;

/** ¿Está disponible la evidencia del ledger en este entorno? */
export declare function hayEvidenciaLedger(): boolean;
