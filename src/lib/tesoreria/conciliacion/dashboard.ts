/**
 * Agregador de métricas del Dashboard de Conciliación — Sprint 3. PURO.
 *
 * Transforma el resultado del motor (`ResultadoConciliacion`) en los KPIs y el
 * desglose de **Movimientos Sistémicos** por subtipo (info de alto valor para
 * Finanzas: Ley 25.413, IVA, Percepciones, SIRCREB, Sellos, Intereses, Comisiones).
 * No recalcula matching: sólo agrega. Montos en centavos enteros.
 */
import type { SubtipoSistemico } from "./types";
import type { ResultadoConciliacion } from "./matching";

/** Etiqueta legible por subtipo sistémico (para el Dashboard). */
export const SUBTIPO_LABEL: Record<SubtipoSistemico, string> = {
  ley_25413_debito: "Ley 25.413 (débito)",
  ley_25413_credito: "Ley 25.413 (crédito)",
  sircreb: "SIRCREB",
  iva: "IVA",
  percep_iva: "Percepción IVA",
  ing_brutos: "Ingresos Brutos",
  sellos: "Sellos",
  interes: "Intereses",
  comision: "Comisiones",
};

export interface SistemicoMetric {
  subtipo: SubtipoSistemico;
  label: string;
  count: number;
  montoCents: number; // Σ importe absoluto del subtipo
  pctMonto: number; // % del monto sistémico total
}

export interface DashboardConciliacion {
  total: number;
  conciliados: number;
  posibles: number;
  noConciliados: number;
  sistemicos: number;
  usoIa: number;
  // montos (centavos)
  montoConciliadoCents: number; // resueltos (conciliado + sistémico)
  montoPendienteCents: number; // posible + no_conciliado
  montoSistemicoCents: number;
  deltaSaldoCents: number; // cruce de saldo (debe ser 0)
  // %
  pctConciliado: number; // resueltos / total · 0..100 (1 decimal)
  sistemicosPorSubtipo: SistemicoMetric[]; // ordenado por monto desc
}

export function dashboard(res: ResultadoConciliacion, deltaSaldoCents = 0): DashboardConciliacion {
  const m = res.matches;
  const total = m.length;
  const sumImp = (pred: (e: (typeof m)[number]) => boolean) =>
    m.reduce((s, e) => (pred(e) ? s + e.linea.importe : s), 0);

  const resuelto = (e: (typeof m)[number]) => e.estado === "conciliado" || e.estado === "sistemico";
  const pendiente = (e: (typeof m)[number]) => e.estado === "posible" || e.estado === "no_conciliado";

  // Desglose sistémico por subtipo.
  const bySub = new Map<SubtipoSistemico, SistemicoMetric>();
  let montoSistemicoCents = 0;
  for (const e of m) {
    if (e.estado === "sistemico" && e.linea.subtipo) {
      const cur =
        bySub.get(e.linea.subtipo) ??
        { subtipo: e.linea.subtipo, label: SUBTIPO_LABEL[e.linea.subtipo], count: 0, montoCents: 0, pctMonto: 0 };
      cur.count++;
      cur.montoCents += e.linea.importe;
      bySub.set(e.linea.subtipo, cur);
      montoSistemicoCents += e.linea.importe;
    }
  }
  const sistemicosPorSubtipo = Array.from(bySub.values())
    .map((s) => ({ ...s, pctMonto: montoSistemicoCents ? Math.round((s.montoCents / montoSistemicoCents) * 1000) / 10 : 0 }))
    .sort((a, b) => b.montoCents - a.montoCents);

  const resueltosCount = res.resumen.conciliado + res.resumen.sistemico;
  return {
    total,
    conciliados: res.resumen.conciliado,
    posibles: res.resumen.posible,
    noConciliados: res.resumen.noConciliado,
    sistemicos: res.resumen.sistemico,
    usoIa: res.resumen.usoIa,
    montoConciliadoCents: sumImp(resuelto),
    montoPendienteCents: sumImp(pendiente),
    montoSistemicoCents,
    deltaSaldoCents,
    pctConciliado: total ? Math.round((resueltosCount / total) * 1000) / 10 : 0,
    sistemicosPorSubtipo,
  };
}
