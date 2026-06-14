/**
 * Conciliación Bancaria IA — Tipos base (Sprint 1).
 *
 * Pipeline: Extracto (PDF/TSV) → parser por banco → ParsedLine[] → normalize →
 * NormalizedLine[] (canónico, centavos enteros) → clasificador → matching (S2).
 *
 * NINGÚN módulo de S1 hace I/O ni toca Supabase: los parsers reciben el
 * contenido ya extraído (texto del PDF / texto TSV del XLS) y son PUROS.
 */

export type Banco = "galicia" | "santander";

export type CategoriaLinea = "sistemico" | "operativo";

export type TipoMovimiento = "credito" | "debito";

/**
 * Subtipos sistémicos oficiales (catálogo único `systemic.ts`). Los movimientos
 * sistémicos se resuelven por REGLA DETERMINÍSTICA (score 100), nunca por IA.
 */
export type SubtipoSistemico =
  | "ley_25413_debito"
  | "ley_25413_credito"
  | "sircreb"
  | "iva"
  | "percep_iva"
  | "ing_brutos"
  | "sellos"
  | "interes"
  | "comision";

/** Salida del parser por banco: importes en PESOS con signo (sin normalizar). */
export interface ParsedLine {
  /** Orden original dentro del archivo (0..n-1). */
  ordenArchivo: number;
  /** Fecha ISO `YYYY-MM-DD`. */
  fecha: string;
  /** Importe del movimiento en PESOS, con signo (+ crédito / − débito). */
  importe: number;
  /** Saldo posterior al movimiento, en PESOS con signo. */
  saldo: number;
  /** Concepto/descripción principal. */
  descripcion: string;
  /** Nombre de la contraparte si el extracto lo trae. */
  contraparte: string | null;
  /** CUIT / nº de operación / referencia. */
  referencia: string | null;
  /** Código de concepto del banco (Santander lo trae; Galicia no). */
  codigoConcepto: string | null;
}

/** Línea canónica: centavos ENTEROS, tipo explícito y clasificación. */
export interface NormalizedLine {
  fecha: string; // ISO
  /** Importe ABSOLUTO en centavos enteros (el signo vive en `tipo`). */
  importe: number;
  tipo: TipoMovimiento;
  descripcion: string;
  contraparte: string | null;
  referencia: string | null;
  /** Saldo posterior, en centavos enteros (con signo). */
  saldo: number;
  categoria: CategoriaLinea;
  subtipo: SubtipoSistemico | null;
  codigoConcepto: string | null;
}

/** Regla del catálogo sistémico: códigos (Santander) + patrón (ambos bancos). */
export interface SystemicRule {
  subtipo: SubtipoSistemico;
  /** Códigos de concepto Santander que mapean a este subtipo. */
  codigos: string[];
  /** Patrón de descripción (case-insensitive) para ambos bancos. */
  regex: RegExp;
}

/** Resultado de la validación de continuidad de saldo (cruce duro). */
export interface SaldoValidation {
  ok: boolean;
  /** Δ acumulado en centavos: debe ser 0. */
  deltaCents: number;
  /** Saldo de apertura derivado (centavos). */
  openingCents: number;
  /** Saldo de cierre (centavos). */
  closingCents: number;
  /** Índices donde `saldo[i] − saldo[i-1] ≠ signed[i]`. */
  rupturas: number[];
}
