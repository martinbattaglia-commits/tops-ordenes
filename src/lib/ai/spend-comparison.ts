// Slice B (aceptación 2026-07-07) · COMPARADOR de compras/liquidez.
//
// Tres comparaciones que el examen de aceptación marcó como brecha y que SÍ
// tienen fuente (ai_supplier_spend_overview / ai_bank_balances_overview, sin
// migración):
//   - gasto_vs_compromiso: facturas de proveedor vs OC firmadas, por proveedor.
//   - periodo_anterior: gasto del mes en curso vs último mes cerrado (variación).
//   - saldo_vs_compromisos: liquidez — saldo en bancos/caja vs compromisos de OC.
// Todo determinístico: los montos vienen de las tools; acá solo se cruzan y se
// restan. Un proveedor presente en una sola base/período NO se esconde: aparece
// con 0 en el otro lado y estado declarado ("nuevo", "sin gasto", etc.).

import { fetchToolRows } from "./data";

type RawRow = Record<string, unknown>;

const s = (v: unknown): string => (v == null ? "" : String(v));
const num = (v: unknown): number => {
  const n = Number(String(v ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
};
const fmt = (n: number): string =>
  "ARS " + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct1 = (n: number): number => Math.round(n * 10) / 10;

async function spend(base: "gasto" | "compromiso", periodo: string): Promise<RawRow[]> {
  return fetchToolRows({
    tool: "supplier_spend_overview",
    args: { base, periodo, limit: 50 },
  });
}

/** Merge por proveedor: mapa proveedor → total de cada lado. */
function totalsBy(rows: RawRow[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) m.set(s(r.proveedor), num(r.total));
  return m;
}

export async function composeSpendComparisonRows(
  args: Record<string, unknown>
): Promise<RawRow[]> {
  const mode = s(args.mode) || "gasto_vs_compromiso";

  if (mode === "periodo_anterior") {
    const [actualRows, anteriorRows] = await Promise.all([
      spend("gasto", "mes_actual"),
      spend("gasto", "ultimo_mes"),
    ]);
    const actual = totalsBy(actualRows);
    const anterior = totalsBy(anteriorRows);
    const proveedores = [...new Set([...actual.keys(), ...anterior.keys()])];
    if (proveedores.length === 0) return [];
    const rows: RawRow[] = proveedores.map((p) => {
      const a = actual.get(p) ?? 0;
      const b = anterior.get(p) ?? 0;
      const variacion = a - b;
      const variacion_pct = b > 0 ? pct1((100 * variacion) / b) : null;
      const estado = b === 0 ? "nuevo" : a === 0 ? "sin_gasto" : variacion > 0 ? "suba" : variacion < 0 ? "baja" : "estable";
      return {
        kind: "comparacion",
        proveedor: p,
        actual: a,
        anterior: b,
        variacion,
        variacion_pct,
        estado,
        url: "/compras/facturas",
        detalle:
          `Variación de gasto · ${p} · mes en curso ${fmt(a)} vs último mes ${fmt(b)} · ` +
          `${variacion >= 0 ? "+" : "−"}${fmt(Math.abs(variacion))}` +
          `${variacion_pct != null ? ` (${variacion_pct >= 0 ? "+" : ""}${variacion_pct}%)` : " (sin gasto en el mes anterior)"}` +
          ` · estado: ${estado}`,
      };
    });
    rows.sort((a, b) => num(b.variacion) - num(a.variacion));
    // Review adversarial: un slice(0,20) tras el sort desc OCULTA las mayores
    // caídas. Truncación BALANCEADA: 10 mayores subas + 10 mayores caídas, con
    // nota declarada de lo que quedó afuera.
    if (rows.length > 20) {
      const recortadas = rows.length - 20;
      const balanceadas = [...rows.slice(0, 10), ...rows.slice(-10)];
      balanceadas.push({
        kind: "nota",
        detalle: `Se muestran las 10 mayores subas y las 10 mayores caídas; ${recortadas} proveedor(es) con variaciones intermedias quedaron fuera del listado.`,
      });
      return balanceadas;
    }
    return rows;
  }

  if (mode === "saldo_vs_compromisos") {
    // Review adversarial (hallazgo ALTO): la RPC de compromiso suma OC
    // firmadas/activas HISTÓRICAS (incluye OC ya facturadas) — comparar eso
    // contra el saldo ACTUAL sobreestima la tensión. Comparación honesta:
    // saldo vs PENDIENTE ESTIMADO de ejecución = Σ max(compromiso − gasto, 0)
    // por proveedor, con el método DECLARADO (es una aproximación: el gasto
    // sin OC asociada no descuenta, y la RPC no cruza factura↔OC).
    const [bancos, compromisos, gastos] = await Promise.all([
      fetchToolRows({ tool: "bank_balances_overview", args: { limit: 15 } }),
      spend("compromiso", "todo"),
      spend("gasto", "todo"),
    ]);
    const saldo = bancos.reduce((a, r) => a + num(r.balance), 0);
    const comp = compromisos.reduce((a, r) => a + num(r.total), 0);
    if (bancos.length === 0 && compromisos.length === 0) return [];
    const gastoPor = totalsBy(gastos);
    const pendiente = compromisos.reduce((a, r) => {
      const g = gastoPor.get(s(r.proveedor)) ?? 0;
      return a + Math.max(num(r.total) - g, 0);
    }, 0);
    const diferencia = saldo - pendiente;
    return [
      {
        kind: "comparacion",
        concepto: "Saldo disponible (bancos y caja)",
        monto: saldo,
        url: "/tesoreria/bancos",
        detalle: `Saldo disponible en bancos y caja: ${fmt(saldo)} (${bancos.length} cuentas).`,
      },
      {
        kind: "comparacion",
        concepto: "Compromiso bruto por OC (histórico)",
        monto: comp,
        url: "/compras/ordenes",
        detalle: `Compromiso bruto por OC firmadas/activas: ${fmt(comp)} (${compromisos.length} proveedores). Incluye OC ya facturadas — NO es la obligación futura neta.`,
      },
      {
        kind: "comparacion",
        concepto: "Pendiente estimado de ejecución",
        monto: pendiente,
        url: "/compras/ordenes",
        detalle: `Pendiente estimado de ejecución: ${fmt(pendiente)} — calculado como Σ max(compromiso − gasto, 0) por proveedor (aproximación: la fuente no cruza factura↔OC).`,
      },
      {
        kind: "resumen",
        concepto: "Cobertura",
        monto: diferencia,
        url: "/tesoreria/bancos",
        detalle:
          pendiente === 0
            ? "Sin pendiente estimado de ejecución: el saldo no tiene compromisos de OC por ejecutar según la aproximación disponible."
            : diferencia >= 0
              ? `El saldo disponible cubre el pendiente estimado de compras (diferencia ${fmt(diferencia)}; cobertura ${pct1(saldo / pendiente)}×).`
              : `POSIBLE TENSIÓN: el pendiente estimado de compras supera el saldo disponible en ${fmt(-diferencia)} (cobertura ${pct1(saldo / pendiente)}×) — validar contra las OC reales antes de decidir.`,
      },
      {
        kind: "nota",
        detalle:
          "Método declarado: 'pendiente estimado' aproxima la obligación futura restando el gasto acumulado por proveedor del compromiso por OC; el gasto sin OC asociada no descuenta y la fuente no cruza factura↔OC (cruce exacto = Slice C).",
      },
    ];
  }

  // gasto_vs_compromiso (default)
  const [gastoRows, compromisoRows] = await Promise.all([
    spend("gasto", "todo"),
    spend("compromiso", "todo"),
  ]);
  const gasto = totalsBy(gastoRows);
  const compromiso = totalsBy(compromisoRows);
  const proveedores = [...new Set([...gasto.keys(), ...compromiso.keys()])];
  if (proveedores.length === 0) return [];
  const rows: RawRow[] = proveedores.map((p) => {
    const g = gasto.get(p) ?? 0;
    const c = compromiso.get(p) ?? 0;
    const diferencia = c - g;
    const pct_ejecutado = c > 0 ? pct1((100 * g) / c) : null;
    return {
      kind: "comparacion",
      proveedor: p,
      gasto: g,
      compromiso: c,
      diferencia,
      pct_ejecutado,
      url: "/compras/facturas",
      detalle:
        `Gasto vs compromiso · ${p} · gasto ${fmt(g)} vs compromiso ${fmt(c)} · ` +
        `pendiente de ejecutar ${fmt(diferencia)}` +
        `${pct_ejecutado != null ? ` (${pct_ejecutado}% ejecutado)` : c === 0 ? " (gasto sin OC firmada asociada)" : ""}`,
    };
  });
  rows.sort((a, b) => Math.max(num(b.gasto), num(b.compromiso)) - Math.max(num(a.gasto), num(a.compromiso)));
  if (rows.length > 20) {
    const recortadas = rows.length - 20;
    const top = rows.slice(0, 20);
    top.push({
      kind: "nota",
      detalle: `Se listan los 20 proveedores de mayor volumen; ${recortadas} más quedaron fuera (las fuentes listan hasta 50 por lado).`,
    });
    return top;
  }
  return rows;
}
