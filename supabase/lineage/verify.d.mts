/**
 * Tipos del verificador de linaje. Mismo patrón que `tests/db/scripts/scripts.d.ts`:
 * el módulo se escribe en `.mjs` porque también se ejecuta como CLI, y el `.d.mts`
 * le da tipos al harness sin obligar a compilarlo.
 */

export declare const APPLIED_REMOTE_ARCHIVE: readonly string[];

/** Regla cerrada del nombre de archivo de migración. */
export declare const FILENAME_RE: RegExp;

/** `null` si el nombre es válido; el motivo del rechazo si no. */
export declare function motivoFilenameInvalido(nombre: unknown): string | null;

export interface EntradaCatalogo {
  id: string;
  filename: string;
  sha256: string;
  orden: number;
  requires: string[];
  estado: "active" | "corrective" | "superseded" | "rollback";
  ledger_version: string;
  ledger_name: string;
  provenance: string;
  superseded_by?: string;
  motivo?: string;
}

export interface Catalogo {
  ejecutables: number;
  no_ejecutables: number;
  entries: EntradaCatalogo[];
  [k: string]: unknown;
}

export interface Violacion {
  codigo: string;
  detalle: string;
}

export declare function cargarCatalogo(ruta?: string): Catalogo;

export declare function verificarCatalogo(opts?: {
  catalogo?: Catalogo;
  dirMigraciones?: string;
}): Violacion[];
