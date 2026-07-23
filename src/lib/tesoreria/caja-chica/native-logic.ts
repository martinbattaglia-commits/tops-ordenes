// Lógica PURA del módulo nativo de Caja Chica (sin IO ni React): filtros de la
// tabla y agregaciones de los paneles. Separada para poder unit-testearla.
//
// El saldo AUTORITATIVO (Saldo ERP) llega desde la vista del motor; acá sólo se
// agregan filas ya devueltas por la base para alimentar KPIs y gráficos.

import type { CajaMovRow } from "./native-data";

const round2 = (n: number): number => Math.round(n * 100) / 100;

export const MESES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

/** Importe con signo según la dirección (ingreso suma, egreso resta). */
const signed = (r: CajaMovRow): number => (r.direction === "ingreso" ? r.amount : -r.amount);

/** Los anulados no computan en saldos, conteos ni gráficos. */
const vivos = (rows: CajaMovRow[]): CajaMovRow[] => rows.filter((r) => r.status !== "anulado");

export interface CajaFilters {
  tipo?: string; // "ingreso" | "egreso" | "" (todos)
  desde?: string; // yyyy-MM-dd
  hasta?: string; // yyyy-MM-dd
}

/** Filtra por tipo y rango de fechas (server-side, sobre lo que devolvió la vista). */
export function filterCajaMovimientos(rows: CajaMovRow[], f: CajaFilters): CajaMovRow[] {
  const tipo = f.tipo === "ingreso" || f.tipo === "egreso" ? f.tipo : null;
  const desde = f.desde && f.desde !== "" ? f.desde : null;
  const hasta = f.hasta && f.hasta !== "" ? f.hasta : null;
  return rows.filter((r) => {
    if (tipo && r.direction !== tipo) return false;
    if (desde && (!r.date || r.date < desde)) return false;
    if (hasta && (!r.date || r.date > hasta)) return false;
    return true;
  });
}

export interface MesBar {
  mes: number; // 1..12
  label: string;
  ingreso: number;
  egreso: number;
}

/** Ingresos y egresos por mes (1..12). Ignora anulados. */
export function monthlyIngresoEgreso(rows: CajaMovRow[]): MesBar[] {
  const ing = new Array(12).fill(0);
  const egr = new Array(12).fill(0);
  for (const r of vivos(rows)) {
    if (!r.date) continue;
    const m = Number(r.date.slice(5, 7)); // yyyy-MM-dd → MM
    if (m < 1 || m > 12) continue;
    if (r.direction === "ingreso") ing[m - 1] += r.amount;
    else egr[m - 1] += r.amount;
  }
  return MESES.map((label, i) => ({ mes: i + 1, label, ingreso: round2(ing[i]), egreso: round2(egr[i]) }));
}

export interface IngresoEgresoSplit {
  ingresos: number;
  egresos: number;
  pctIngresos: number;
  pctEgresos: number;
  movimientos: number;
}

/** Partición Ingresos vs Egresos del período (reemplaza la distribución por categorías). */
export function ingresoEgresoSplit(rows: CajaMovRow[]): IngresoEgresoSplit {
  const live = vivos(rows);
  let ingresos = 0;
  let egresos = 0;
  for (const r of live) {
    if (r.direction === "ingreso") ingresos += r.amount;
    else egresos += r.amount;
  }
  const total = ingresos + egresos;
  return {
    ingresos: round2(ingresos),
    egresos: round2(egresos),
    pctIngresos: total > 0 ? Math.round((ingresos / total) * 1000) / 10 : 0,
    pctEgresos: total > 0 ? Math.round((egresos / total) * 1000) / 10 : 0,
    movimientos: live.length,
  };
}

export interface CajaResumen {
  saldoActual: number | null;
  saldoErp: number | null;
  diferencia: number | null;
  cantidad: number;
  ultimaOperacion: string | null;
}

/**
 * KPIs aprobados por Dirección.
 *  · Saldo ERP    = vista del motor (opening + Σ confirmados). AUTORITATIVO.
 *  · Saldo Actual = Saldo ERP + Σ pendientes (lo cargado que aún no confirma).
 *  · Diferencia   = Saldo Actual − Saldo ERP = Σ pendientes (control de integridad;
 *                   con el alta confirmando en el acto, es 0,00).
 *  · Cantidad     = movimientos no anulados.
 *  · Última operación = fecha y hora del último movimiento registrado.
 */
export function resumenCaja(rows: CajaMovRow[], saldoErp: number | null): CajaResumen {
  const pendientes = rows.filter((r) => r.status === "pendiente").reduce((a, r) => a + signed(r), 0);
  const ultima = rows.reduce<string | null>(
    (max, r) => (r.created_at && (!max || r.created_at > max) ? r.created_at : max),
    null,
  );
  return {
    saldoErp,
    saldoActual: saldoErp == null ? null : round2(saldoErp + pendientes),
    diferencia: saldoErp == null ? null : round2(pendientes),
    cantidad: vivos(rows).length,
    ultimaOperacion: ultima,
  };
}
