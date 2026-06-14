/**
 * Motor de matching — Conciliación Bancaria IA (Sprint 2). PURO, centavos enteros.
 *
 * Concilia las líneas del extracto (`NormalizedLine[]`) contra los movimientos
 * de Nexus (`treasury_movements` → `MovimientoNexus[]`) por PRIORIDAD:
 *
 *   1 SISTÉMICO   (resuelto en S1 por regla determinística · score 100 · sin IA)
 *   2 EXACTO      importe== ∧ fecha==                              · score 100
 *   3 APROXIMADO  importe== ∧ |fecha|≤ventanaDías                  · 95−3·días
 *   4 IA          importe±tol ∧ CORROBORACIÓN de entidad (OB6)     · ≥bandaIa
 *   5 N:M         Σ movimientos == línea, acotado (OB9)            · ~90
 *
 * Pasadas SECUENCIALES con asignación 1:1 (un movimiento se usa una sola vez).
 * OB5: empates en exacto/aprox NO se auto-asignan → quedan "posible" para humano.
 * OB6: la IA nunca matchea sin coincidencia de CUIT o similitud de texto fuerte.
 * El score de texto IA se INYECTA (`simTexto`) → el motor no llama a ningún LLM.
 */
import type { NormalizedLine, TipoMovimiento } from "./types";
import { deterministicSimTexto, type SimTextoFn } from "./iaMatch";

export interface MovimientoNexus {
  id: string;
  fecha: string; // ISO YYYY-MM-DD
  importe: number; // centavos enteros, ABSOLUTO
  tipo: TipoMovimiento; // credito = ingreso/cobranza · debito = egreso/pago
  descripcion: string;
  contraparte: string | null;
  cuit: string | null;
}

export type MetodoMatch = "sistemico" | "exacto" | "aproximado" | "ia" | "n_m" | "ninguno";
export type EstadoLinea = "sistemico" | "conciliado" | "posible" | "no_conciliado";

export interface MatchLinea {
  linea: NormalizedLine;
  estado: EstadoLinea;
  metodo: MetodoMatch;
  score: number; // 0..100
  movimientoIds: string[]; // 1 (exacto/aprox/ia) · N (n_m) · 0 (sistémico/sin match)
  motivo: string;
}

export interface ResumenConciliacion {
  total: number;
  sistemico: number;
  conciliado: number;
  posible: number;
  noConciliado: number;
  usoIa: number; // líneas que requirieron la Capa 4 (IA)
  movimientosUsados: number;
}

export interface ResultadoConciliacion {
  matches: MatchLinea[];
  resumen: ResumenConciliacion;
}

export interface ConciliarOpts {
  ventanaDias?: number; // OB8 · default 3
  tolIaPct?: number; // tolerancia de importe para Capa 4 (comisiones) · default 0,5 %
  tolIaAbsCents?: number; // TOPE ABSOLUTO de la tolerancia IA (AJUSTE 1) · default $2.000
  bandaIa?: number; // umbral mínimo IA · default 70
  bandaConciliado?: number; // ≥ → CONCILIADO · default 95
  maxNM?: number; // OB9 · máx movimientos por combinación · default 6
  maxPoolNM?: number; // OB9 · tamaño máx del pool N:M · default 40
  simTextoMin?: number; // corroboración mínima de texto (sin CUIT) · default 0,5
  simTexto?: SimTextoFn; // inyectable; default determinista (sin red)
}

const DEFAULTS: Required<Omit<ConciliarOpts, "simTexto">> & { simTexto: SimTextoFn } = {
  ventanaDias: 3,
  tolIaPct: 0.005,
  tolIaAbsCents: 200_000, // $2.000 — evita tolerancias enormes en montos grandes (AJUSTE 1)
  bandaIa: 70,
  bandaConciliado: 95,
  maxNM: 6,
  maxPoolNM: 40,
  simTextoMin: 0.5,
  simTexto: deterministicSimTexto,
};

function diffDias(a: string, b: string): number {
  const ms = Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

function extractCuit(s: string | null): string | null {
  if (!s) return null;
  const m = s.match(/\b(\d{11})\b/);
  return m ? m[1] : null;
}

function cuitLinea(l: NormalizedLine): string | null {
  return extractCuit(l.referencia) ?? extractCuit(l.contraparte);
}

/** True si línea y movimiento tienen CUIT y NO coinciden (conflicto de entidad). */
function conflictoEntidad(l: NormalizedLine, m: MovimientoNexus): boolean {
  const lc = cuitLinea(l);
  return !!(lc && m.cuit && lc !== m.cuit);
}

/**
 * Elige un único candidato (OB5/OB6). Resultado:
 *  - { pick }            → asignar
 *  - { motivo }          → NO auto-asignar (ambiguo o conflicto de entidad) → "posible"
 */
function elegirCandidato(
  cands: MovimientoNexus[],
  l: NormalizedLine,
  simTexto: SimTextoFn,
  simMin: number
): { pick?: MovimientoNexus; motivo?: string } {
  if (cands.length === 1) {
    const m = cands[0];
    if (conflictoEntidad(l, m)) return { motivo: "importe/fecha coinciden pero CUIT distinto" };
    return { pick: m };
  }
  const cuit = cuitLinea(l);
  if (cuit) {
    const porCuit = cands.filter((m) => m.cuit === cuit);
    if (porCuit.length === 1) return { pick: porCuit[0] };
    if (porCuit.length > 1) return { motivo: `ambiguo: ${porCuit.length} candidatos con mismo CUIT` };
  }
  const fuertes = cands.filter((m) => simTexto(l.descripcion, `${m.descripcion} ${m.contraparte ?? ""}`) >= simMin);
  if (fuertes.length === 1) return { pick: fuertes[0] };
  return { motivo: `ambiguo: ${cands.length} candidatos sin desambiguar` };
}

/** Búsqueda ACOTADA de subconjunto que suma `target` (OB9: pool y profundidad limitados). */
function buscarSubsetNM(pool: MovimientoNexus[], target: number, maxK: number): MovimientoNexus[] | null {
  const sorted = [...pool].sort((a, b) => b.importe - a.importe);
  let found: MovimientoNexus[] | null = null;
  const acc: MovimientoNexus[] = [];
  function dfs(start: number, remaining: number): void {
    if (found) return;
    if (remaining === 0 && acc.length >= 2) {
      found = acc.slice();
      return;
    }
    if (acc.length >= maxK || remaining < 0) return;
    for (let i = start; i < sorted.length; i++) {
      if (sorted[i].importe > remaining) continue;
      acc.push(sorted[i]);
      dfs(i + 1, remaining - sorted[i].importe);
      acc.pop();
      if (found) return;
    }
  }
  dfs(0, target);
  return found;
}

export function conciliar(
  lineas: NormalizedLine[],
  movimientos: MovimientoNexus[],
  opts: ConciliarOpts = {}
): ResultadoConciliacion {
  const cfg = { ...DEFAULTS, ...opts };
  const matches: (MatchLinea | null)[] = new Array(lineas.length).fill(null);
  const used = new Set<string>();
  const disponibles = () => movimientos.filter((m) => !used.has(m.id));
  let usoIa = 0;

  // Capa 1 — sistémicos (pre-resueltos en S1).
  const pendientes: number[] = [];
  lineas.forEach((l, i) => {
    if (l.categoria === "sistemico") {
      matches[i] = {
        linea: l,
        estado: "sistemico",
        metodo: "sistemico",
        score: 100,
        movimientoIds: [],
        motivo: `sistémico: ${l.subtipo ?? "—"}`,
      };
    } else {
      pendientes.push(i);
    }
  });

  const resolver = (i: number, m: MatchLinea) => {
    matches[i] = m;
  };
  const sigue = (i: number) => matches[i] === null;

  // Capa 2 — EXACTO.
  for (const i of pendientes) {
    if (!sigue(i)) continue;
    const l = lineas[i];
    const cands = disponibles().filter((m) => m.tipo === l.tipo && m.importe === l.importe && m.fecha === l.fecha);
    if (cands.length === 0) continue;
    const { pick, motivo } = elegirCandidato(cands, l, cfg.simTexto, cfg.simTextoMin);
    if (pick) {
      used.add(pick.id);
      resolver(i, { linea: l, estado: "conciliado", metodo: "exacto", score: 100, movimientoIds: [pick.id], motivo: "importe + fecha exactos" });
    } else {
      resolver(i, { linea: l, estado: "posible", metodo: "exacto", score: 90, movimientoIds: cands.map((c) => c.id), motivo: motivo ?? "ambiguo" });
    }
  }

  // Capa 3 — APROXIMADO.
  for (const i of pendientes) {
    if (!sigue(i)) continue;
    const l = lineas[i];
    const cands = disponibles().filter((m) => m.tipo === l.tipo && m.importe === l.importe && Math.abs(diffDias(l.fecha, m.fecha)) <= cfg.ventanaDias);
    if (cands.length === 0) continue;
    const { pick, motivo } = elegirCandidato(cands, l, cfg.simTexto, cfg.simTextoMin);
    if (pick) {
      used.add(pick.id);
      const dias = Math.abs(diffDias(l.fecha, pick.fecha));
      const score = Math.max(70, 95 - 3 * dias);
      resolver(i, { linea: l, estado: score >= cfg.bandaConciliado ? "conciliado" : "posible", metodo: "aproximado", score, movimientoIds: [pick.id], motivo: `importe exacto, ${dias} día(s) de diferencia` });
    } else {
      resolver(i, { linea: l, estado: "posible", metodo: "aproximado", score: 85, movimientoIds: cands.map((c) => c.id), motivo: motivo ?? `ambiguo en ±${cfg.ventanaDias}d` });
    }
  }

  // Capa 4 — IA (con corroboración de entidad obligatoria · OB6).
  for (const i of pendientes) {
    if (!sigue(i)) continue;
    const l = lineas[i];
    const cuit = cuitLinea(l);
    // AJUSTE 1: tolerancia IA = min(importe·tolIaPct, tope absoluto) → nunca
    // tolerancias enormes en movimientos grandes (0,5 % de $40M serían $200k).
    const tol = Math.min(Math.round(l.importe * cfg.tolIaPct), cfg.tolIaAbsCents);
    const pool = disponibles().filter((m) => m.tipo === l.tipo && Math.abs(m.importe - l.importe) <= tol && Math.abs(diffDias(l.fecha, m.fecha)) <= cfg.ventanaDias);
    let best: { m: MovimientoNexus; score: number } | null = null;
    for (const m of pool) {
      const cuitMatch = !!(cuit && m.cuit && cuit === m.cuit);
      const simTxt = cuitMatch ? 1 : cfg.simTexto(l.descripcion, `${m.descripcion} ${m.contraparte ?? ""}`);
      if (!cuitMatch && simTxt < cfg.simTextoMin) continue; // OB6: sin corroboración, no hay match
      const simImp = 1 - Math.abs(m.importe - l.importe) / Math.max(l.importe, 1);
      const dias = Math.abs(diffDias(l.fecha, m.fecha));
      const simFch = 1 - Math.min(dias, cfg.ventanaDias) / cfg.ventanaDias;
      const score = Math.round(100 * (0.5 * simImp + 0.3 * simTxt + 0.2 * simFch));
      if (score >= cfg.bandaIa && (!best || score > best.score)) best = { m, score };
    }
    if (best) {
      used.add(best.m.id);
      usoIa++;
      resolver(i, { linea: l, estado: best.score >= cfg.bandaConciliado ? "conciliado" : "posible", metodo: "ia", score: best.score, movimientoIds: [best.m.id], motivo: "corroboración de entidad + IA" });
    }
  }

  // Capa 5 — N:M (acotado · OB9).
  for (const i of pendientes) {
    if (!sigue(i)) continue;
    const l = lineas[i];
    const pool = disponibles()
      .filter((m) => m.tipo === l.tipo && Math.abs(diffDias(l.fecha, m.fecha)) <= cfg.ventanaDias)
      .slice(0, cfg.maxPoolNM);
    const subset = buscarSubsetNM(pool, l.importe, cfg.maxNM);
    if (subset && subset.length >= 2) {
      subset.forEach((m) => used.add(m.id));
      resolver(i, { linea: l, estado: "posible", metodo: "n_m", score: 90, movimientoIds: subset.map((m) => m.id), motivo: `${subset.length} movimientos suman la línea` });
    }
  }

  // Resto → no conciliado (diferencia).
  for (const i of pendientes) {
    if (sigue(i)) {
      resolver(i, { linea: lineas[i], estado: "no_conciliado", metodo: "ninguno", score: 0, movimientoIds: [], motivo: "sin contraparte en Nexus" });
    }
  }

  const final = matches as MatchLinea[];
  const resumen: ResumenConciliacion = {
    total: final.length,
    sistemico: final.filter((m) => m.estado === "sistemico").length,
    conciliado: final.filter((m) => m.estado === "conciliado").length,
    posible: final.filter((m) => m.estado === "posible").length,
    noConciliado: final.filter((m) => m.estado === "no_conciliado").length,
    usoIa,
    movimientosUsados: used.size,
  };
  return { matches: final, resumen };
}
