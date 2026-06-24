// Lógica PURA del dashboard de Caja Chica (sin IO ni React): agregaciones para
// los gráficos, filtros de la tabla y tono del banner de conciliación.
// Separada para poder unit-testearla.

import type { MovRow, ResumenRow } from "./data";

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

export type ConciliacionTone = "ok" | "warn" | "error";

/** Tono del banner: error > warning > conciliado. */
export function conciliacionTone(resumen: ResumenRow | null): ConciliacionTone {
  if (!resumen) return "warn";
  if (resumen.last_status === "error") return "error";
  const warn =
    (resumen.last_warnings ?? 0) > 0 ||
    Number(resumen.saldo_delta ?? 0) !== 0 ||
    resumen.saldo_source === "calc_fallback" ||
    resumen.last_status === "partial";
  return warn ? "warn" : "ok";
}
