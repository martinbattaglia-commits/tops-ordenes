/**
 * Catálogo OFICIAL de Movimientos Sistémicos — Conciliación Bancaria IA (S1).
 *
 * Un movimiento sistémico (impuesto/percepción/comisión/interés generado por el
 * banco) se resuelve por REGLA DETERMINÍSTICA → score 100, método "sistemico",
 * NUNCA por IA. Reduce ~60-70 % del volumen de líneas (medido en los extractos
 * reales de Galicia y Santander) que de otro modo iría al matching IA.
 *
 * Clasificación: (1) por CÓDIGO DE CONCEPTO de Santander (primario, exacto) y
 * (2) por REGEX de descripción (ambos bancos). El primer subtipo que matchea
 * gana — el ORDEN del catálogo importa (p.ej. SIRCREB antes que Ing. Brutos,
 * Percep. IVA antes que IVA).
 *
 * Catálogo derivado de los extractos reales (referencia oficial V1).
 */
import type { CategoriaLinea, SubtipoSistemico, SystemicRule } from "./types";

/** Orden significativo: el primer match gana (reglas más específicas primero). */
export const SYSTEMIC_RULES: SystemicRule[] = [
  // Ley 25.413 (impuesto al débito/crédito). Débito vs crédito se distingue por
  // la palabra "cre/credito" cerca de "25413"; default = débito.
  { subtipo: "ley_25413_credito", codigos: ["4637"], regex: /(?:cre|cr[eé]dito).{0,8}25\.?413|25\.?413.{0,8}(?:cre|cr[eé]dito)/i },
  { subtipo: "ley_25413_debito", codigos: ["4633"], regex: /25\.?413/i },
  // SIRCREB (recaudación IIBB sobre acreditaciones). Antes que Ing. Brutos:
  // "ING. BRUTOS S/ CRED REG.RECAU.SIRCREB" debe caer en SIRCREB.
  { subtipo: "sircreb", codigos: ["1743"], regex: /sircreb/i },
  // Percepción de IVA. Antes que IVA a secas.
  { subtipo: "percep_iva", codigos: ["3253", "4760"], regex: /percep.{0,6}iva|iva\s*percep/i },
  { subtipo: "iva", codigos: ["3254", "4600"], regex: /\biva\b/i },
  { subtipo: "ing_brutos", codigos: ["1922"], regex: /ing\.?\s*brutos|ingresos\s*brutos/i },
  { subtipo: "sellos", codigos: ["3662"], regex: /sellos/i },
  { subtipo: "interes", codigos: ["3631"], regex: /inter[eé]s|intereses/i },
  { subtipo: "comision", codigos: ["0960", "0434"], regex: /comisi[oó]n|^com\./i },
];

const CODE_INDEX: Map<string, SubtipoSistemico> = (() => {
  const m = new Map<string, SubtipoSistemico>();
  for (const r of SYSTEMIC_RULES) for (const c of r.codigos) m.set(c, r.subtipo);
  return m;
})();

export interface Clasificacion {
  categoria: CategoriaLinea;
  subtipo: SubtipoSistemico | null;
}

/**
 * Clasifica una línea como sistémica (con subtipo) u operativa.
 * Prioridad: código de concepto (Santander) → regex de descripción (ambos).
 */
export function classify(descripcion: string, codigoConcepto: string | null): Clasificacion {
  // 1) Código de concepto Santander (exacto, primario).
  if (codigoConcepto) {
    const sub = CODE_INDEX.get(codigoConcepto.trim());
    if (sub) return { categoria: "sistemico", subtipo: sub };
  }
  // 2) Regex de descripción (primer match del catálogo ordenado).
  const desc = descripcion ?? "";
  for (const r of SYSTEMIC_RULES) {
    if (r.regex.test(desc)) return { categoria: "sistemico", subtipo: r.subtipo };
  }
  return { categoria: "operativo", subtipo: null };
}
