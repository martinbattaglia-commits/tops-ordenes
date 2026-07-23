// Lógica PURA del histórico de planilla de Caja Chica (sin IO ni React):
// agregaciones para los gráficos y filtros de la tabla legada.
// Separada para poder unit-testearla.
//
// El módulo NATIVO usa `native-logic.ts`; esto sólo alimenta la solapa
// «Histórico (planilla)», de sólo lectura.

import type { MovRow } from "./data";

const round2 = (n: number): number => Math.round(n * 100) / 100;

export const MESES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

export interface MonthBar {
  mes: number; // 1..12
  label: string;
  total: number;
}

/** Gasto total por mes (1..12) a partir de los movimientos 'gasto' con fecha. */
export function monthlyGasto(movs: MovRow[]): MonthBar[] {
  const acc = new Array(12).fill(0);
  for (const r of movs) {
    if (r.direction !== "gasto" || !r.tx_date) continue;
    const m = Number(r.tx_date.slice(5, 7)); // yyyy-MM-dd → MM
    if (m >= 1 && m <= 12) acc[m - 1] += r.importe;
  }
  return acc.map((total, i) => ({ mes: i + 1, label: MESES[i], total: round2(total) }));
}

export interface CategoriaSlice {
  categoria: string;
  total: number;
  pct: number;
}

/** Distribución del gasto por categoría (desc), con % sobre el total de gastos. */
export function categoriaDistribution(movs: MovRow[]): CategoriaSlice[] {
  const acc: Record<string, number> = {};
  let total = 0;
  for (const r of movs) {
    if (r.direction !== "gasto") continue;
    const k = r.categoria || "Otros";
    acc[k] = (acc[k] ?? 0) + r.importe;
    total += r.importe;
  }
  const slices = Object.entries(acc).map(([categoria, t]) => ({
    categoria,
    total: round2(t),
    pct: total > 0 ? Math.round((t / total) * 1000) / 10 : 0,
  }));
  return slices.sort((a, b) => b.total - a.total);
}

/** Categorías presentes (para el filtro), ordenadas alfabéticamente. */
export function distinctCategorias(movs: MovRow[]): string[] {
  return Array.from(new Set(movs.map((r) => r.categoria || "Otros"))).sort((a, b) => a.localeCompare(b));
}

export interface MovFilters {
  categoria?: string;
  desde?: string; // yyyy-MM-dd
  hasta?: string; // yyyy-MM-dd
}

/** Filtra movimientos por categoría y rango de fechas (server-side). */
export function filterMovimientos(movs: MovRow[], f: MovFilters): MovRow[] {
  const cat = f.categoria && f.categoria !== "" ? f.categoria : null;
  const desde = f.desde && f.desde !== "" ? f.desde : null;
  const hasta = f.hasta && f.hasta !== "" ? f.hasta : null;
  return movs.filter((r) => {
    if (cat && (r.categoria || "Otros") !== cat) return false;
    if (desde && (!r.tx_date || r.tx_date < desde)) return false;
    if (hasta && (!r.tx_date || r.tx_date > hasta)) return false;
    return true;
  });
}

// El tono del banner de conciliación se eliminó junto con el ConciliacionBanner
// (Dirección 2026-07-22): al dejar de ser un espejo de Drive, Caja Chica no
// concilia contra la planilla. La pantalla arranca en el encabezado y los KPIs.
