// Estándar visual 2026-07-07 · Adaptadores DETERMINÍSTICOS tool → tablero ejecutivo.
//
// Cada adaptador transforma las FILAS CRUDAS de una tool analítica en un
// CopilotVisual (KPIs + tabla + chart-ready + insights + warnings). Los números
// vienen del SQL/código — el modelo solo narra. Módulo PURO (sin IO, sin DB):
// testeable unitariamente y compartido server/cliente. Formato de montos con
// separador de miles POR COMA (igual que to_char FM999G999G990D00 de las RPC):
// además de consistencia, evita el redactor de PII (que enmascara tripletes con
// PUNTO estilo CUIT/DNI, no con coma).
//
// 'Sin clasificar' y toda brecha de datos se muestran como WARNING: nunca se
// esconden, nunca se reparten entre categorías, nunca se inventan.

import type { CopilotVisual, ToolName } from "./types";

type RawRow = Record<string, unknown>;
type Args = Record<string, unknown>;

const s = (v: unknown): string => (v == null ? "" : String(v));
const num = (v: unknown): number => {
  const n = Number(String(v ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
};
const fmtMonto = (n: number): string =>
  "ARS " + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const PERIODO_LABEL: Record<string, string> = {
  ultimo_mes: "último mes cerrado",
  mes_actual: "mes en curso",
  ultimos_30_dias: "últimos 30 días",
  todo: "todo el período",
};

function periodoLabel(row: RawRow | undefined): string | null {
  if (!row) return null;
  const p = PERIODO_LABEL[s(row.periodo)] ?? s(row.periodo);
  const rango =
    row.desde && row.hasta ? ` (${s(row.desde)} → ${s(row.hasta)})` : "";
  return p ? `${p}${rango}` : null;
}

/** Registro de adaptadores. Tool sin entrada = sin tablero (texto compacto). */
export const TOOL_VISUALS: Partial<
  Record<ToolName, (rows: RawRow[], args: Args) => CopilotVisual | null>
> = {
  // ── Ingresos por categoría: reporte completo (KPIs + tabla + donut) ────────
  revenue_by_category_report: (rows) => {
    if (rows.length === 0) return null;
    const total = num(rows[0].total_periodo);
    const facturas = rows.reduce((a, r) => a + num(r.cantidad), 0);
    const lider = rows[0];
    const sinClasif = rows.find((r) => s(r.categoria) === "Sin clasificar");
    return {
      kind: "report",
      title: "Ingresos por categoría",
      period: periodoLabel(rows[0]),
      kpis: [
        { label: "Total facturado", value: fmtMonto(total), hint: `${facturas} facturas` },
        {
          label: "Categoría líder",
          value: `${s(lider.categoria)} · ${s(lider.porcentaje)}%`,
          hint: fmtMonto(num(lider.monto)),
        },
      ],
      table: {
        columns: ["Categoría", "Monto", "%", "Facturas", "Método"],
        rows: rows.map((r) => [
          s(r.categoria),
          fmtMonto(num(r.monto)),
          `${s(r.porcentaje)}%`,
          s(r.cantidad),
          s(r.metodo) || "—",
        ]),
      },
      chart: {
        type: "donut",
        labels: rows.map((r) => s(r.categoria)),
        values: rows.map((r) => num(r.monto)),
        unit: "ARS",
      },
      insights: [
        `${s(lider.categoria)} concentró el ${s(lider.porcentaje)}% de la facturación del período.`,
      ],
      warnings: sinClasif
        ? [
            `${s(sinClasif.porcentaje)}% del total (${fmtMonto(num(sinClasif.monto))}) quedó Sin clasificar — clientes sin tag de unidad de negocio.`,
          ]
        : [],
    };
  },

  // ── Facturación por cliente: kpi compacto (top-1) o ranking con barras ─────
  customer_revenue_overview: (rows, args) => rankingVisual(rows, {
    entidad: "cliente",
    nameKey: "cliente",
    title: "Facturación por cliente",
    // Slice B: peso del top sobre el total listado (hint del router, no del RPC).
    focoTop: args.focoTop === true,
  }),

  // ── Gasto/presupuesto por proveedor: mismo patrón ──────────────────────────
  supplier_spend_overview: (rows, args) => rankingVisual(rows, {
    entidad: s(rows[0]?.base) === "compromiso" ? "proveedor (presupuesto comprometido)" : "proveedor (gasto)",
    nameKey: "proveedor",
    title: s(rows[0]?.base) === "compromiso" ? "Presupuesto comprometido por proveedor" : "Gasto por proveedor",
    focoTop: args.focoTop === true,
  }),

  // ── Saldos de Tesorería: tarjetas por banco + total + composición ──────────
  bank_balances_overview: (rows) => {
    if (rows.length === 0) return null;
    const total = rows.reduce((a, r) => a + num(r.balance), 0);
    return {
      kind: "kpi",
      title: "Saldos de Tesorería",
      period: "saldo actual (derivado de movimientos)",
      kpis: [
        { label: "Total en bancos y caja", value: fmtMonto(total), hint: `${rows.length} cuentas` },
        ...rows.slice(0, 4).map((r) => ({
          label: s(r.bank_name),
          value: fmtMonto(num(r.balance)),
          hint: s(r.account_name) || null,
        })),
      ],
      chart:
        rows.length > 1
          ? {
              type: "donut" as const,
              labels: rows.map((r) => s(r.bank_name)),
              values: rows.map((r) => num(r.balance)),
              unit: "ARS",
            }
          : null,
      insights: [],
      warnings: [],
    };
  },

  // ── Total facturado por período: KPI · varios meses = COMPARACIÓN m/m ──────
  // Slice B (aceptación 2026-07-07): con ≥2 meses el tablero calcula la
  // variación absoluta y porcentual vs el mes anterior (delta cards con tono).
  // Los totales vienen de la RPC; acá solo se restan — nunca se estiman.
  billing_summary: (rows, args) => {
    if (rows.length === 0) return null;
    if (rows.length === 1) {
      const r = rows[0];
      return {
        kind: "kpi",
        title: "Facturación del período",
        period: periodoLabel(r) ?? s(r.periodo),
        kpis: [
          { label: `Total ${s(r.periodo)}`, value: fmtMonto(num(r.total)), hint: `${s(r.cantidad)} facturas` },
        ],
        chart: null,
        insights: [],
        // Pidieron comparar (ultimos_meses) y solo hay UN mes con datos → se
        // declara: no se inventa el mes anterior.
        warnings:
          s(args.mode) === "ultimos_meses"
            ? ["Solo hay un mes con datos: no encontré un mes anterior para comparar."]
            : [],
      };
    }
    // Orden defensivo por período desc (la RPC ya ordena así; no se asume).
    const sorted = [...rows].sort((a, b) => s(b.periodo).localeCompare(s(a.periodo)));
    const ultimo = sorted[0];
    const anterior = sorted[1];
    const delta = num(ultimo.total) - num(anterior.total);
    const deltaPct =
      num(anterior.total) > 0 ? Math.round((1000 * delta) / num(anterior.total)) / 10 : null;
    const subio = delta >= 0;
    // Review adversarial (Slice B): honestidad de la comparación.
    // (1) Si el último período es el MES EN CURSO, es un mes PARCIAL: la
    //     variación contra un mes completo se declara siempre — jamás se vende
    //     una "caída" que es un artefacto de comparar días contra un mes.
    // (2) Si los períodos comparados NO son meses calendario consecutivos (hay
    //     meses sin datos en el medio), se dice "mes anterior CON DATOS".
    const hoy = new Date();
    const mesActual = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, "0")}`;
    const parcial = s(ultimo.periodo) === mesActual;
    const mesPrevioCalendario = (p: string): string => {
      const [y, m] = p.split("-").map(Number);
      const d = new Date(y, m - 2, 1);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    };
    const adyacentes = s(anterior.periodo) === mesPrevioCalendario(s(ultimo.periodo));
    const warnings: string[] = [];
    if (parcial) {
      warnings.push(
        `El mes ${s(ultimo.periodo)} está EN CURSO: la variación compara un mes parcial contra ${s(anterior.periodo)} completo — no es una caída/suba real hasta que cierre el mes.`
      );
    }
    if (!adyacentes) {
      warnings.push(
        `Entre ${s(anterior.periodo)} y ${s(ultimo.periodo)} hay meses sin datos: la comparación es contra el mes anterior CON DATOS, no el mes calendario previo.`
      );
    }
    return {
      kind: "report",
      title: "Facturación por mes · comparación",
      period: `${s(sorted[sorted.length - 1].periodo)} → ${s(ultimo.periodo)}`,
      kpis: [
        {
          label: `Mes ${s(ultimo.periodo)}${parcial ? " (en curso, parcial)" : ""}`,
          value: fmtMonto(num(ultimo.total)),
          hint: `${s(ultimo.cantidad)} facturas`,
          tone: "brand",
        },
        {
          label: `Mes ${s(anterior.periodo)}`,
          value: fmtMonto(num(anterior.total)),
          hint: `${s(anterior.cantidad)} facturas`,
          tone: "brand",
        },
        {
          label: parcial
            ? "Variación (mes parcial vs mes completo)"
            : adyacentes
              ? "Variación vs mes anterior"
              : `Variación vs mes anterior con datos (${s(anterior.periodo)})`,
          value: `${subio ? "+" : "−"}${fmtMonto(Math.abs(delta))}${deltaPct != null ? ` · ${subio ? "+" : ""}${deltaPct}%` : ""}`,
          hint: `${s(anterior.periodo)} → ${s(ultimo.periodo)}`,
          // Mes parcial: tono neutro de advertencia — ni verde ni rojo, porque
          // el signo es un artefacto del corte, no una tendencia real.
          tone: parcial ? "warn" : subio ? "ok" : "danger",
        },
      ],
      table: {
        columns: ["Mes", "Total", "Facturas"],
        rows: sorted.map((r) => [
          `${s(r.periodo)}${s(r.periodo) === mesActual ? " (parcial)" : ""}`,
          fmtMonto(num(r.total)),
          s(r.cantidad),
        ]),
      },
      chart: {
        type: "bar",
        labels: [...sorted].reverse().map((r) => s(r.periodo)),
        values: [...sorted].reverse().map((r) => num(r.total)),
        unit: "ARS",
      },
      insights: [
        parcial
          ? `${s(ultimo.periodo)} está en curso (parcial): lleva ${fmtMonto(num(ultimo.total))} contra ${fmtMonto(num(anterior.total))} de ${s(anterior.periodo)} completo — la comparación definitiva es al cierre del mes.`
          : `La facturación ${subio ? "subió" : "bajó"}${deltaPct != null ? ` ${Math.abs(deltaPct)}%` : ` ${fmtMonto(Math.abs(delta))}`} en ${s(ultimo.periodo)} respecto de ${s(anterior.periodo)}${adyacentes ? "" : " (mes anterior con datos)"}.`,
      ],
      warnings,
    };
  },

  // ── Slice B: comparador de compras/liquidez (spend_comparison_report) ──────
  spend_comparison_report: (rows, args) => {
    if (rows.length === 0) return null;
    const mode = s(args.mode) || "gasto_vs_compromiso";
    if (mode === "periodo_anterior") {
      const comps = rows.filter((r) => s(r.kind) === "comparacion");
      const notas = rows.filter((r) => s(r.kind) === "nota").map((r) => s(r.detalle));
      // Review adversarial: "Mayor suba" SOLO si de verdad hubo una suba — con
      // todo en baja (estado normal a principios de mes: mes parcial vs mes
      // completo), el KPI dice caída, nunca una "suba" con signo negativo.
      const top = comps[0];
      const huboSuba = top != null && num(top.variacion) > 0;
      const totalActual = comps.reduce((a, r) => a + num(r.actual), 0);
      const totalAnterior = comps.reduce((a, r) => a + num(r.anterior), 0);
      return {
        kind: "report",
        title: "Variación de gasto por proveedor (mes en curso vs último mes)",
        period: "gasto de facturas de proveedor · el mes en curso es PARCIAL",
        kpis: [
          huboSuba
            ? {
                label: "Mayor suba",
                value: s(top.proveedor),
                hint: `+${fmtMonto(num(top.variacion))}`,
                tone: "warn" as const,
              }
            : {
                label: "Sin subas — menor caída",
                value: s(top?.proveedor) || "—",
                hint: top ? `−${fmtMonto(Math.abs(num(top.variacion)))}` : null,
                tone: "brand" as const,
              },
          { label: "Gasto mes en curso (parcial)", value: fmtMonto(totalActual), hint: null, tone: "brand" },
          { label: "Gasto último mes", value: fmtMonto(totalAnterior), hint: null, tone: "brand" },
        ],
        table: {
          columns: ["Proveedor", "Mes en curso", "Último mes", "Δ", "Δ%", "Estado"],
          rows: comps.map((r) => [
            s(r.proveedor),
            fmtMonto(num(r.actual)),
            fmtMonto(num(r.anterior)),
            `${num(r.variacion) >= 0 ? "+" : "−"}${fmtMonto(Math.abs(num(r.variacion)))}`,
            r.variacion_pct == null ? "—" : `${num(r.variacion_pct) >= 0 ? "+" : ""}${s(r.variacion_pct)}%`,
            s(r.estado) === "nuevo" ? "🆕 nuevo" : s(r.estado) === "suba" ? "🔺 suba" : s(r.estado) === "baja" ? "🔻 baja" : s(r.estado),
          ]),
          rowLinks: comps.map((r) => (s(r.url) ? { url: s(r.url), label: "Ver" } : null)),
        },
        chart: {
          type: "bar",
          title: "Variación por proveedor",
          labels: comps.map((r) => s(r.proveedor)),
          values: comps.map((r) => Math.abs(num(r.variacion))),
          unit: "ARS (valor absoluto de la variación)",
        },
        insights: top
          ? [
              huboSuba
                ? `${s(top.proveedor)} lidera las subas: +${fmtMonto(num(top.variacion))}${top.variacion_pct != null ? ` (+${s(top.variacion_pct)}%)` : " (nuevo en el período)"}.`
                : `No hubo subas de gasto: todos los proveedores cayeron o se mantuvieron (recordá que el mes en curso es parcial). La menor caída fue de ${s(top.proveedor)} (−${fmtMonto(Math.abs(num(top.variacion)))}).`,
            ]
          : [],
        warnings: [
          "El mes en curso es PARCIAL: las bajas pueden ser un artefacto del corte, no una tendencia.",
          ...(comps.some((r) => s(r.estado) === "nuevo")
            ? ["Los proveedores 'nuevo' no tienen gasto en el mes anterior: la variación % no aplica."]
            : []),
          ...notas,
        ],
      };
    }
    if (mode === "saldo_vs_compromisos") {
      const conceptos = rows.filter((r) => s(r.kind) === "comparacion");
      const resumen = rows.find((r) => s(r.kind) === "resumen");
      const notas = rows.filter((r) => s(r.kind) === "nota").map((r) => s(r.detalle));
      const tension = resumen ? num(resumen.monto) < 0 : false;
      return {
        kind: "report",
        title: "Liquidez · saldo disponible vs pendiente de compras",
        period: "saldos actuales vs pendiente estimado por OC (método declarado)",
        kpis: [
          ...conceptos.map((r) => ({
            label: s(r.concepto),
            value: fmtMonto(num(r.monto)),
            hint: null,
            tone: "brand" as const,
            url: s(r.url) || null,
            actionLabel: "Ver módulo",
          })),
          ...(resumen
            ? [
                {
                  label: "Diferencia (saldo − pendiente estimado)",
                  value: `${num(resumen.monto) >= 0 ? "+" : "−"}${fmtMonto(Math.abs(num(resumen.monto)))}`,
                  hint: null,
                  tone: (tension ? "danger" : "ok") as "danger" | "ok",
                },
              ]
            : []),
        ],
        table: null,
        chart:
          conceptos.length > 1
            ? {
                type: "bar",
                labels: conceptos.map((r) => s(r.concepto)),
                values: conceptos.map((r) => num(r.monto)),
                unit: "ARS",
              }
            : null,
        insights: resumen ? [s(resumen.detalle)] : [],
        warnings: [
          ...(tension
            ? ["Posible tensión de liquidez: validar contra las OC reales antes de decidir."]
            : []),
          ...notas,
        ],
      };
    }
    // gasto_vs_compromiso (default)
    const comps = rows.filter((r) => s(r.kind) === "comparacion");
    const totalGasto = comps.reduce((a, r) => a + num(r.gasto), 0);
    const totalComp = comps.reduce((a, r) => a + num(r.compromiso), 0);
    const unLado = comps.filter((r) => num(r.gasto) === 0 || num(r.compromiso) === 0).length;
    return {
      kind: "report",
      title: "Gasto real vs compromiso por proveedor",
      period: "facturas de proveedor vs OC firmadas/activas (todo el período)",
      kpis: [
        { label: "Compromiso total (OC)", value: fmtMonto(totalComp), hint: null, tone: "brand" },
        { label: "Gasto real total", value: fmtMonto(totalGasto), hint: null, tone: "brand" },
        {
          label: "Pendiente de ejecución",
          value: fmtMonto(totalComp - totalGasto),
          hint: totalComp > 0 ? `${Math.round((1000 * totalGasto) / totalComp) / 10}% ejecutado` : null,
          tone: "warn",
        },
      ],
      table: {
        columns: ["Proveedor", "Gasto", "Compromiso", "Diferencia", "% ejecutado"],
        rows: comps.map((r) => [
          s(r.proveedor),
          fmtMonto(num(r.gasto)),
          fmtMonto(num(r.compromiso)),
          fmtMonto(num(r.diferencia)),
          r.pct_ejecutado == null ? "—" : `${s(r.pct_ejecutado)}%`,
        ]),
        rowLinks: comps.map((r) => (s(r.url) ? { url: s(r.url), label: "Ver" } : null)),
      },
      chart: null,
      // Review adversarial: el "mayor pendiente" se elige por DIFERENCIA real
      // (no por volumen), y solo si existe un pendiente positivo — nunca se
      // afirma un superlativo con ARS 0.00 o negativo.
      insights: (() => {
        const conPendiente = comps.filter((r) => num(r.diferencia) > 0);
        if (conPendiente.length === 0)
          return ["No hay pendientes de ejecución positivos: el gasto igualó o superó los compromisos listados."];
        const mayor = conPendiente.reduce((a, b) =>
          num(b.diferencia) > num(a.diferencia) ? b : a
        );
        return [
          `El mayor pendiente de ejecución es de ${s(mayor.proveedor)} (${fmtMonto(num(mayor.diferencia))}).`,
        ];
      })(),
      warnings: [
        ...(unLado > 0
          ? [`${unLado} proveedor(es) aparecen en una sola base (gasto sin OC, o OC sin gasto) — se muestran con 0 en el otro lado.`]
          : []),
        ...rows.filter((r) => s(r.kind) === "nota").map((r) => s(r.detalle)),
      ],
    };
  },

  // ── Slice B: adaptadores de OPERACIÓN y COMPRAS (datos sin sábana de texto) ─
  workflows_stuck: (rows) => {
    if (rows.length === 0) return null;
    const peor = [...rows].sort((a, b) => num(b.idle_days) - num(a.idle_days))[0];
    const sem = (d: number) => (d >= 5 ? "🔴" : d >= 3 ? "🟡" : "🟢");
    return {
      kind: "report",
      title: "Workflows trabados",
      period: "sin actividad en el paso actual",
      kpis: [
        {
          label: "Workflows trabados",
          value: String(rows.length),
          hint: `el más antiguo: ${s(peor.idle_days)} días sin actividad`,
          tone: num(peor.idle_days) >= 5 ? "danger" : "warn",
          url: "/connect/tareas",
          actionLabel: "Ver tareas",
        },
      ],
      table: {
        columns: ["Workflow", "Paso", "Días sin actividad", "Tarea", "Estado"],
        rows: rows.map((r) => [
          s(r.workflow),
          `${s(r.current_step)}${r.step_titulo ? ` (${s(r.step_titulo)})` : ""}`,
          `${sem(num(r.idle_days))} ${s(r.idle_days)}`,
          s(r.task_public_id) || "—",
          s(r.task_estado) || "sin tarea",
        ]),
        rowLinks: rows.map(() => ({ url: "/connect/tareas", label: "Ver" })),
      },
      chart: null,
      insights: [
        `Destrabar primero ${s(peor.workflow)} (paso ${s(peor.current_step)}, ${s(peor.idle_days)} días sin actividad).`,
      ],
      warnings: [],
    };
  },

  tasks_overview: (rows, args) => {
    if (rows.length === 0) return null;
    const scope = s(args.scope);
    const rank = (p: string) =>
      p === "urgente" ? 0 : p === "alta" ? 1 : p === "media" ? 2 : 3;
    const sorted = [...rows].sort((a, b) => rank(s(a.prioridad)) - rank(s(b.prioridad)));
    const urgentes = rows.filter((r) => s(r.prioridad) === "urgente").length;
    return {
      kind: "report",
      title:
        scope === "vencidas"
          ? "Tareas vencidas"
          : scope === "mias"
            ? "Mis tareas"
            : "Tareas abiertas",
      period: "priorizadas por urgencia",
      kpis: [
        {
          label: scope === "vencidas" ? "Tareas vencidas" : "Tareas listadas",
          value: String(rows.length),
          hint: urgentes > 0 ? `${urgentes} urgentes` : null,
          tone: scope === "vencidas" || urgentes > 0 ? "warn" : "brand",
          url: "/connect/tareas",
          actionLabel: "Ver tareas",
        },
      ],
      table: {
        columns: ["Tarea", "Título", "Prioridad", "Vence", "Asignado"],
        rows: sorted.slice(0, 12).map((r) => [
          s(r.public_id),
          s(r.titulo),
          s(r.prioridad) || "normal",
          s(r.due_at).slice(0, 10) || "—",
          s(r.asignado) || "vacante",
        ]),
        rowLinks: sorted.slice(0, 12).map(() => ({ url: "/connect/tareas", label: "Ver" })),
      },
      chart: null,
      insights: [],
      warnings: [],
    };
  },

  incidents_overview: (rows) => {
    if (rows.length === 0) return null;
    const criticos = rows.filter((r) => s(r.severidad) === "critica").length;
    const altos = rows.filter((r) => s(r.severidad) === "alta").length;
    return {
      kind: "report",
      title: "Incidentes",
      period: "estado actual",
      kpis: [
        {
          label: "Incidentes críticos",
          value: String(criticos),
          hint: criticos > 0 ? "requieren acción inmediata" : null,
          tone: criticos > 0 ? "danger" : "ok",
          url: "/connect/incidentes",
          actionLabel: "Ver incidentes",
        },
        { label: "Listados", value: String(rows.length), hint: altos > 0 ? `${altos} de severidad alta` : null, tone: "brand" },
      ],
      table: {
        columns: ["ID", "Título", "Severidad", "Estado", "Sector", "Asignado"],
        rows: rows.slice(0, 12).map((r) => [
          s(r.public_id),
          s(r.titulo),
          s(r.severidad) === "critica" ? "🔴 crítica" : s(r.severidad),
          s(r.estado),
          s(r.sector) || "—",
          s(r.asignado) || "sin asignar",
        ]),
        rowLinks: rows.slice(0, 12).map(() => ({ url: "/connect/incidentes", label: "Ver" })),
      },
      chart: null,
      insights: [],
      warnings: [],
    };
  },

  purchase_orders_overview: (rows) => {
    if (rows.length === 0) return null;
    const total = rows.reduce((a, r) => a + num(r.total), 0);
    return {
      kind: "report",
      title: "Órdenes de compra",
      period: "más recientes primero",
      kpis: [
        { label: "OC listadas", value: String(rows.length), hint: null, tone: "brand", url: "/compras/ordenes", actionLabel: "Ver OC" },
        { label: "Monto total listado", value: fmtMonto(total), hint: null, tone: "brand" },
      ],
      table: {
        columns: ["OC", "Proveedor", "Total", "Fecha", "Estado"],
        rows: rows.slice(0, 12).map((r) => [
          s(r.public_id),
          s(r.proveedor) || "—",
          fmtMonto(num(r.total)),
          s(r.fecha),
          s(r.estado),
        ]),
        rowLinks: rows.slice(0, 12).map(() => ({ url: "/compras/ordenes", label: "Ver" })),
      },
      chart: null,
      insights: [],
      warnings: [],
    };
  },

  supplier_invoices_overview: (rows, args) => {
    if (rows.length === 0) return null;
    const pendientes = s(args.mode) === "pendientes_aprobacion";
    const total = rows.reduce((a, r) => a + num(r.total), 0);
    return {
      kind: "report",
      title: pendientes ? "Facturas de proveedor pendientes de aprobación" : "Facturas de proveedor",
      period: "más recientes primero",
      kpis: [
        {
          label: pendientes ? "Pendientes de aprobación" : "Facturas listadas",
          value: String(rows.length),
          hint: `total ${fmtMonto(total)}`,
          tone: pendientes ? "warn" : "brand",
          url: "/compras/facturas",
          actionLabel: "Ver facturas",
        },
      ],
      table: {
        columns: ["Comprobante", "Proveedor", "Total", "Fecha", "Estado"],
        rows: rows.slice(0, 12).map((r) => [
          s(r.public_id),
          s(r.proveedor) || "—",
          fmtMonto(num(r.total)),
          s(r.fecha),
          s(r.estado),
        ]),
        rowLinks: rows.slice(0, 12).map(() => ({ url: "/compras/facturas", label: "Ver" })),
      },
      chart: null,
      insights: [],
      warnings: [],
    };
  },

  ops_digest: (rows) => {
    if (rows.length === 0) return null;
    return {
      kind: "report",
      title: "Actividad operativa",
      period: "eventos más recientes",
      kpis: [{ label: "Eventos", value: String(rows.length), hint: null, tone: "brand" }],
      table: {
        columns: ["Hora", "Evento", "Detalle", "Actor"],
        rows: rows.slice(0, 12).map((r) => [
          s(r.occurred_at).slice(11, 16) || s(r.occurred_at).slice(0, 10),
          s(r.event_type),
          s(r.summary),
          s(r.actor_label) || "—",
        ]),
      },
      chart: null,
      insights: [],
      warnings: [],
    };
  },

  // ── Compliance pendientes: tabla legible por tipo/estado ───────────────────
  compliance_pending: (rows) => {
    if (rows.length === 0) return null;
    const docs = rows.filter((r) => s(r.kind) !== "caso").length;
    const casos = rows.length - docs;
    return {
      kind: "report",
      title: "Compliance · vencidos y por vencer",
      period: "próximos 90 días",
      kpis: [
        { label: "Documentos", value: String(docs), hint: "vencidos o por vencer" },
        ...(casos > 0 ? [{ label: "Casos activos", value: String(casos), hint: null }] : []),
      ],
      table: {
        columns: ["Tipo", "Título", "Estado", "Fecha clave"],
        rows: rows.slice(0, 12).map((r) => [
          s(r.kind) === "caso" ? "Caso" : "Documento",
          s(r.titulo),
          s(r.estado) || "—",
          s(r.fecha_clave) || "—",
        ]),
      },
      chart: null,
      insights: [],
      warnings: [],
    };
  },

  // ── Vacancia / capacidad / cubículos: tablero estilo Cockpit ───────────────
  // INTENCIÓN PUNTUAL (smoke 2026-07-07): `focus` reordena — si preguntan
  // "cuántos" el PRIMER KPI es el número pedido, no el dashboard genérico.
  vacancy_overview: (rows, args) => {
    const corp = rows.find((r) => s(r.alcance) === "Corporativo") ?? rows[0];
    if (!corp) return null;
    const cats = rows.filter((r) => s(r.alcance) !== "Corporativo");
    const vac = num(corp.vacancia_pct);
    const cubTotal = num(corp.cubiculos_total);
    // alquilados = total − disponibles (determinístico; usa el campo si viene).
    const alquilados =
      num(corp.cubiculos_alquilados) || cubTotal - num(corp.cubiculos_disponibles);
    const focus = s(args.focus);
    const catKey = s(args.categoria); // anmat | general | oficina
    const CAT_NAME: Record<string, string> = {
      anmat: "ANMAT",
      general: "Cargas Generales",
      oficina: "Oficinas",
    };
    const vacUrl = "/comercial/dashboard-vacancia";

    // KPI principal según el foco de la pregunta (número primero).
    const primary: import("./types").CopilotVisualKpi[] = [];
    if (focus === "cubiculos" && cubTotal > 0) {
      primary.push(
        {
          label: "Cubículos ANMAT alquilados",
          value: String(alquilados),
          hint: `criterio: total − disponibles (Twin Luján + compromisos CRM)`,
          pct: Math.round((10000 * alquilados) / cubTotal) / 100,
          tone: "brand",
          url: vacUrl,
          actionLabel: "Ver en Vacancia",
        },
        { label: "Total / disponibles", value: `${cubTotal} / ${s(corp.cubiculos_disponibles)}`, hint: null }
      );
    } else if (focus === "vacancia") {
      primary.push({
        label: "Vacancia corporativa",
        value: `${s(corp.vacancia_pct)}%`,
        pct: vac,
        tone: vac > 40 ? "warn" : "ok",
        url: vacUrl,
        actionLabel: "Ver en Vacancia",
      });
    } else if (focus === "disponible") {
      const cat = catKey ? cats.find((r) => s(r.alcance) === CAT_NAME[catKey]) : null;
      if (cat) {
        primary.push({
          label: `${s(cat.alcance)} · disponible`,
          value: `${num(cat.disponible_m2).toLocaleString("en-US")} m²`,
          hint: `capacidad ${num(cat.capacidad_m2).toLocaleString("en-US")} m² · vacancia ${s(cat.vacancia_pct)}%`,
          pct: num(cat.vacancia_pct),
          tone: "brand",
          url: vacUrl,
          actionLabel: "Ver en Vacancia",
        });
      } else {
        primary.push({
          label: "Disponible corporativo",
          value: `${num(corp.disponible_m2).toLocaleString("en-US")} m²`,
          pct: vac,
          tone: "brand",
          url: vacUrl,
          actionLabel: "Ver en Vacancia",
        });
      }
    }

    return {
      kind: "report",
      title:
        focus === "cubiculos"
          ? "Cubículos ANMAT"
          : "Capacidad y vacancia corporativa",
      period: "estado actual (Twins Luján 3159 + Magaldi 1765 + compromisos CRM)",
      kpis: [
        ...primary,
        // Contexto general — sin duplicar lo que el foco ya puso primero.
        ...(focus === "cubiculos"
          ? []
          : [
              {
                label: "Capacidad comercializable",
                value: `${num(corp.capacidad_m2).toLocaleString("en-US")} m²`,
                hint: null,
                tone: "brand" as const,
              },
              {
                label: "Ocupado",
                value: `${num(corp.ocupado_m2).toLocaleString("en-US")} m²`,
                pct:
                  num(corp.capacidad_m2) > 0
                    ? Math.round((10000 * num(corp.ocupado_m2)) / num(corp.capacidad_m2)) / 100
                    : null,
                tone: "ok" as const,
              },
              ...(focus === "disponible"
                ? []
                : [
                    {
                      label: "Disponible",
                      value: `${num(corp.disponible_m2).toLocaleString("en-US")} m²`,
                      hint: null,
                      tone: "brand" as const,
                    },
                  ]),
              ...(focus === "vacancia"
                ? []
                : [
                    {
                      label: "Vacancia corporativa",
                      value: `${s(corp.vacancia_pct)}%`,
                      pct: vac,
                      tone: (vac > 40 ? "warn" : "ok") as "warn" | "ok",
                    },
                  ]),
              ...(cubTotal > 0
                ? [
                    {
                      label: "Cubículos ANMAT",
                      value: `${alquilados} alquilados`,
                      hint: `${s(corp.cubiculos_disponibles)} disponibles de ${cubTotal}`,
                      pct: Math.round((10000 * alquilados) / cubTotal) / 100,
                      tone: "brand" as const,
                    },
                  ]
                : []),
            ]),
      ],
      table:
        cats.length > 0
          ? {
              columns: ["Unidad de negocio", "Capacidad m²", "Disponible m²", "Vacancia"],
              rows: cats.map((r) => [
                s(r.alcance),
                num(r.capacidad_m2).toLocaleString("en-US"),
                num(r.disponible_m2).toLocaleString("en-US"),
                `${s(r.vacancia_pct)}%`,
              ]),
            }
          : null,
      chart:
        cats.length > 0
          ? {
              type: "bar",
              labels: cats.map((r) => s(r.alcance)),
              values: cats.map((r) => num(r.disponible_m2)),
              unit: "m² disponibles",
            }
          : null,
      insights: [
        `Vacancia corporativa ${s(corp.vacancia_pct)}%: ${num(corp.disponible_m2).toLocaleString("en-US")} m² disponibles de ${num(corp.capacidad_m2).toLocaleString("en-US")} m² comercializables.`,
      ],
      warnings: [],
    };
  },

  // ── Contratos: dashboard contractual + ESCALERA DE LINKS documentales ───────
  // Prioridad de fuente por fila (smoke 2026-07-07): 1) archivo REAL del contrato
  // (contract_documents.url → "Abrir contrato") · 2) carpeta Drive del contrato
  // (drive_folder_id → "Carpeta Drive") · 3) fallback HONESTO "Sin PDF vinculado"
  // (kind fallback: navega al módulo pero JAMÁS se presenta como fuente documental).
  contracts_overview: (rows, args) => {
    if (rows.length === 0) return null;
    const mode = s(args.mode);
    const link = contractRowLink; // escalera por fila

    // ── SINGULAR (smoke 2026-07-07): "el último contrato firmado" = UNA card.
    // El router pide limit=1 (la RPC ordena firmados_recientes por firma desc);
    // acá se renderiza la entidad principal, nunca una tabla.
    if (num(args.limit) === 1 && rows.length >= 1) {
      const r = rows[0];
      const l = link(r);
      const sinDoc = l.kind === "fallback";
      return {
        kind: "document",
        title: "Último contrato firmado",
        period: r.fecha_firma ? `firmado el ${s(r.fecha_firma)}` : null,
        kpis: [
          {
            label: "Cliente",
            value: s(r.razon_social) || "Contrato",
            hint: s(r.public_id) || null,
            tone: "brand",
            url: l.url,
            // Honestidad: sin documento real la acción es la ficha, con su nombre.
            actionLabel: sinDoc ? "Ver ficha CRM" : l.label,
          },
          { label: "Tipo", value: s(r.tipo) || "—", hint: null },
          { label: "Firma", value: s(r.fecha_firma) || "—", hint: null },
          {
            label: "Vencimiento",
            value: s(r.fecha_fin) || "—",
            hint: r.dias_para_vencer != null ? `${s(r.dias_para_vencer)} días restantes` : null,
          },
          { label: "Estado", value: s(r.estado) || "—", hint: null },
        ],
        table: null,
        chart: null,
        insights: [
          `Último contrato firmado: ${s(r.razon_social)}${r.tipo ? ` (${s(r.tipo)})` : ""}${
            r.fecha_firma ? `, el ${s(r.fecha_firma)}` : ""
          }.`,
        ],
        warnings: sinDoc
          ? ["Este contrato no tiene archivo Drive vinculado — solo ficha en el módulo de Contratos."]
          : [],
      };
    }
    if (mode === "por_vencer") {
      const urgentes = rows.filter((r) => num(r.dias_para_vencer) <= 30).length;
      return {
        kind: "report",
        title: "Contratos próximos a vencer",
        period: "próximos 90 días",
        kpis: [
          {
            label: "Contratos por vencer",
            value: String(rows.length),
            hint: urgentes > 0 ? `${urgentes} con ≤30 días` : null,
            tone: urgentes > 0 ? "danger" : "warn",
            url: "/comercial/contratos",
            actionLabel: "Ver cartera",
          },
        ],
        table: {
          columns: ["Cliente", "Tipo", "Vence", "Días restantes"],
          rows: rows.map((r) => [
            s(r.razon_social),
            s(r.tipo),
            s(r.fecha_fin),
            `${num(r.dias_para_vencer) <= 30 ? "🔴" : num(r.dias_para_vencer) <= 60 ? "🟡" : "🟢"} ${s(r.dias_para_vencer)} días`,
          ]),
          rowLinks: rows.map((r) => link(r)),
        },
        chart: {
          type: "bar",
          labels: rows.map((r) => s(r.razon_social)),
          values: rows.map((r) => num(r.dias_para_vencer)),
          unit: "días restantes",
        },
        insights: [
          `${rows.length} contratos vencen en la ventana analizada${urgentes > 0 ? `; ${urgentes} requieren acción en 30 días` : ""}.`,
        ],
        warnings: [],
      };
    }
    if (mode === "firmados_recientes") {
      // El KPI de "último mes calendario" SOLO cuando el usuario acotó el período
      // (args.periodo, hint del router que no viaja al RPC). Preguntar "contratos
      // firmados" sin período NO debe responder "Firmados último mes: 0" (smoke).
      const pidioMes = s(args.periodo) === "ultimo_mes";
      const hoy = new Date();
      const ini = new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1);
      const fin = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
      const enMes = rows.filter((r) => {
        const f = new Date(s(r.fecha_firma));
        return f >= ini && f < fin;
      });
      const sinVinculo = rows.filter((r) => link(r).kind === "fallback").length;
      return {
        kind: "report",
        title: "Contratos firmados",
        period: pidioMes
          ? `último mes calendario (${ini.toISOString().slice(0, 7)})`
          : "más recientes primero (por fecha de firma)",
        kpis: [
          pidioMes
            ? {
                label: "Firmados último mes",
                value: String(enMes.length),
                hint: `${rows.length} firmados recientes listados`,
                tone: "brand",
                url: "/comercial/contratos",
                actionLabel: "Ver cartera",
              }
            : {
                label: "Firmados recientes",
                value: String(rows.length),
                hint: "ordenados por fecha de firma (más nuevo primero)",
                tone: "brand",
                url: "/comercial/contratos",
                actionLabel: "Ver cartera",
              },
        ],
        table: {
          columns: ["Cliente", "Tipo", "Firma", "Vencimiento", "Estado", "Documento"],
          rows: rows.map((r) => [
            s(r.razon_social),
            s(r.tipo),
            s(r.fecha_firma) || "—",
            s(r.fecha_fin) || "—",
            s(r.estado) || "—",
            docBadge(r),
          ]),
          rowLinks: rows.map((r) => link(r)),
        },
        chart: null,
        insights: pidioMes
          ? enMes.length > 0
            ? [`${enMes.length} contratos firmados en el último mes calendario.`]
            : ["Ningún contrato firmado en el último mes calendario; se listan los más recientes."]
          : [
              `${rows.length} contratos firmados listados; el más reciente: ${s(rows[0].razon_social)} (${s(rows[0].fecha_firma) || "sin fecha"}).`,
            ],
        warnings:
          sinVinculo > 0
            ? [`${sinVinculo} de ${rows.length} contratos listados no tienen archivo Drive vinculado.`]
            : [],
      };
    }
    // vigentes / todos → DASHBOARD contractual (no tabla sábana):
    // orden inteligente (críticos primero), KPIs por tipo/vencimiento/documental,
    // donut por tipo + barras por estado + disponibilidad documental, tabla acotada.
    const sorted = [...rows].sort((a, b) => {
      const da = a.dias_para_vencer == null ? Number.POSITIVE_INFINITY : num(a.dias_para_vencer);
      const db = b.dias_para_vencer == null ? Number.POSITIVE_INFINITY : num(b.dias_para_vencer);
      return da - db;
    });
    const porTipo = new Map<string, number>();
    for (const r of rows) porTipo.set(s(r.tipo) || "Sin tipo", (porTipo.get(s(r.tipo) || "Sin tipo") ?? 0) + 1);
    const porEstado = new Map<string, number>();
    for (const r of rows) porEstado.set(s(r.estado) || "Sin estado", (porEstado.get(s(r.estado) || "Sin estado") ?? 0) + 1);
    const proximos90 = rows.filter((r) => r.dias_para_vencer != null && num(r.dias_para_vencer) >= 0 && num(r.dias_para_vencer) <= 90).length;
    const vencidos = rows.filter((r) => r.dias_para_vencer != null && num(r.dias_para_vencer) < 0).length;
    const tipoLider = [...porTipo.entries()].sort((a, b) => b[1] - a[1])[0];
    // Calidad documental (FASE 4): la brecha se MUESTRA, nunca se esconde.
    const conArchivo = rows.filter((r) => link(r).kind === "drive").length;
    const conCarpeta = rows.filter((r) => link(r).kind === "folder").length;
    const sinVinculo = rows.length - conArchivo - conCarpeta;
    const badge = (r: Record<string, unknown>) =>
      r.dias_para_vencer == null
        ? s(r.estado) || "—"
        : num(r.dias_para_vencer) < 0
          ? `🔴 vencido`
          : num(r.dias_para_vencer) <= 30
            ? `🔴 ${s(r.dias_para_vencer)} días`
            : num(r.dias_para_vencer) <= 90
              ? `🟡 ${s(r.dias_para_vencer)} días`
              : `🟢 ${s(r.dias_para_vencer)} días`;
    // Tabla acotada (no sábana): los 12 más críticos; el resto queda contado.
    const TABLE_CAP = 12;
    const visibles = sorted.slice(0, TABLE_CAP);
    const resto = sorted.length - visibles.length;
    // Cap de la tool visible: si las filas llegan al límite pedido, la cartera
    // completa puede ser mayor (p.ej. 57 vigentes reales con p_limit 50).
    const capAlcanzado = rows.length >= num(args.limit ?? 30);
    const warnings: string[] = [];
    if (sinVinculo > 0) {
      warnings.push(
        `${sinVinculo} de ${rows.length} contratos listados están sin archivo Drive vinculado — brecha documental visible.`
      );
    }
    if (resto > 0 || capAlcanzado) {
      warnings.push(
        [
          resto > 0 ? `La tabla muestra los ${TABLE_CAP} más críticos; ${resto} más en este listado.` : "",
          capAlcanzado
            ? `La consulta lista hasta ${num(args.limit ?? 30)} contratos — la cartera completa está en el módulo de Contratos.`
            : "",
        ]
          .filter(Boolean)
          .join(" ")
      );
    }
    return {
      kind: "report",
      title: mode === "vigentes" ? "Cartera de contratos vigentes" : "Cartera de contratos",
      period: "estado actual",
      kpis: [
        {
          label: mode === "vigentes" ? "Contratos vigentes" : "Contratos listados",
          value: String(rows.length),
          hint: tipoLider ? `mayoría ${tipoLider[0]} (${tipoLider[1]})` : null,
          tone: "brand",
          url: "/comercial/contratos",
          actionLabel: "Ver cartera",
        },
        ...[...porTipo.entries()].slice(0, 3).map(([tipo, n]) => ({
          label: tipo,
          value: String(n),
          hint: null,
          pct: rows.length > 0 ? Math.round((10000 * n) / rows.length) / 100 : null,
          tone: "brand" as const,
        })),
        ...(proximos90 > 0
          ? [{ label: "Vencen en 90 días", value: String(proximos90), hint: null, tone: "warn" as const }]
          : []),
        ...(vencidos > 0
          ? [{ label: "Vencidos", value: String(vencidos), hint: null, tone: "danger" as const }]
          : []),
        {
          label: "Con contrato en Drive",
          value: String(conArchivo),
          hint: conCarpeta > 0 ? `${conCarpeta} más con carpeta Drive` : null,
          tone: "ok" as const,
        },
        ...(sinVinculo > 0
          ? [
              {
                label: "Sin vínculo documental",
                value: String(sinVinculo),
                hint: "sin PDF ni carpeta Drive",
                tone: "danger" as const,
              },
            ]
          : []),
      ],
      table: {
        columns: ["Cliente", "Tipo", "Firma", "Vence", "Días / Estado", "Documento"],
        rows: visibles.map((r) => [
          s(r.razon_social),
          s(r.tipo),
          s(r.fecha_firma) || "—",
          s(r.fecha_fin) || "—",
          badge(r),
          docBadge(r),
        ]),
        rowLinks: visibles.map((r) => link(r)),
      },
      chart: {
        type: "donut",
        title: "Por tipo de contrato",
        labels: [...porTipo.keys()],
        values: [...porTipo.values()],
        unit: "contratos",
      },
      charts: [
        {
          type: "bar",
          title: "Por estado",
          labels: [...porEstado.keys()],
          values: [...porEstado.values()],
          unit: "contratos",
        },
        {
          type: "donut",
          title: "Disponibilidad documental",
          labels: ["Archivo Drive", "Carpeta Drive", "Sin vínculo"],
          values: [conArchivo, conCarpeta, sinVinculo],
          unit: "contratos",
        },
      ],
      insights: [
        `${rows.length} contratos listados${tipoLider ? `; la mayoría es ${tipoLider[0]}` : ""}${proximos90 > 0 ? `; ${proximos90} vencen dentro de 90 días` : ""}${vencidos > 0 ? `; ${vencidos} ya vencidos` : ""}${sinVinculo > 0 ? `; ${sinVinculo} sin archivo Drive` : ""}.`,
      ],
      warnings,
    };
  },

  // ── Copiloto de gestión (2026-07-07): dashboard ejecutivo multi-dominio ────
  // Renderiza las filas del management brief: KPI por sección (tono semántico
  // según estado), charts desde los datos de sección, tabla de RIESGOS con
  // acción recomendada y fuente por fila, insights = oportunidades +
  // recomendaciones, warnings = brechas de cobertura (nunca se esconden).
  management_brief: (rows, args) => {
    if (rows.length === 0) return null;
    const secciones = rows.filter((r) => s(r.kind) === "seccion");
    const riesgos = rows.filter((r) => s(r.kind) === "riesgo");
    const oportunidades = rows.filter((r) => s(r.kind) === "oportunidad");
    const brechas = rows.filter((r) => s(r.kind) === "brecha");
    const focus = s(args.focus);

    const TONE: Record<string, "ok" | "warn" | "danger" | "brand"> = {
      ok: "ok",
      atencion: "warn",
      critico: "danger",
      sin_datos: "brand",
    };

    const kpis = secciones.slice(0, 8).map((r) => ({
      label: s(r.titulo),
      value: s(r.valor),
      hint: s(r.hint) || null,
      pct: r.pct == null ? null : num(r.pct),
      tone: TONE[s(r.estado)] ?? "brand",
      url: s(r.url) || null,
      actionLabel: "Ver módulo",
    }));

    // Charts chart-ready desde las filas de sección (composición de ingresos +
    // m² disponibles por unidad). Los datos vienen calculados por las tools.
    const charts: NonNullable<CopilotVisual["charts"]> = [];
    const fact = secciones.find((r) => s(r.seccion) === "facturacion");
    if (Array.isArray(fact?.chart_labels) && Array.isArray(fact?.chart_values)) {
      charts.push({
        type: "donut",
        title: "Ingresos por categoría (último mes)",
        labels: (fact.chart_labels as unknown[]).map(s),
        values: (fact.chart_values as unknown[]).map(num),
        unit: "ARS",
      });
    }
    const vaca = secciones.find((r) => s(r.seccion) === "vacancia");
    if (Array.isArray(vaca?.chart_labels) && Array.isArray(vaca?.chart_values)) {
      charts.push({
        type: "bar",
        title: "m² disponibles por unidad de negocio",
        labels: (vaca.chart_labels as unknown[]).map(s),
        values: (vaca.chart_values as unknown[]).map(num),
        unit: "m² disponibles",
      });
    }

    // Recomendaciones accionables: primero las acciones de los riesgos top,
    // después las oportunidades — cada una con su evidencia (nunca sin ella).
    const insights: string[] = [];
    riesgos.slice(0, 4).forEach((r, i) => {
      insights.push(`Recomendación ${i + 1} — ${s(r.accion)} (${s(r.evidencia)}).`);
    });
    for (const o of oportunidades.slice(0, 3)) {
      insights.push(`Oportunidad — ${s(o.titulo)}: ${s(o.accion)} (${s(o.evidencia)}).`);
    }

    const criticos = secciones.filter((r) => s(r.estado) === "critico").length;
    return {
      kind: "report",
      title:
        focus === "riesgos"
          ? "Riesgos priorizados · Nexus"
          : focus === "prioridades"
            ? "Prioridades de gestión · Resumen ejecutivo Nexus"
            : focus === "oportunidades"
              ? "Oportunidades · Resumen ejecutivo Nexus"
              : "Resumen ejecutivo · Nexus",
      period: "estado actual · facturación del último mes cerrado",
      kpis,
      table:
        riesgos.length > 0
          ? {
              columns: ["#", "Riesgo", "Área", "Impacto", "Urgencia", "Acción recomendada"],
              rows: riesgos.map((r, i) => [
                String(i + 1),
                s(r.titulo),
                s(r.area),
                s(r.impacto) === "alto" ? "🔴 alto" : s(r.impacto) === "medio" ? "🟡 medio" : "🟢 bajo",
                s(r.urgencia),
                s(r.accion),
              ]),
              rowLinks: riesgos.map((r) =>
                s(r.url) ? { url: s(r.url), label: "Ver" } : null
              ),
            }
          : null,
      chart: charts[0] ?? null,
      charts: charts.slice(1),
      insights,
      warnings: [
        ...(criticos > 0
          ? [`${criticos} área(s) en estado crítico — revisar la tabla de riesgos.`]
          : []),
        ...brechas.map((b) => s(b.detalle)),
      ],
    };
  },

  // ── Slice A (aceptación 2026-07-07): matriz de cobertura del Copilot ───────
  coverage_overview: (rows) => {
    if (rows.length === 0) return null;
    const conectados = rows.filter((r) => s(r.estado) === "conectado");
    const brechas = rows.filter((r) => s(r.estado) === "brecha");
    const badge = (e: string) =>
      e === "conectado" ? "🟢 conectado" : e === "parcial" ? "🟡 parcial" : "🔴 brecha";
    return {
      kind: "report",
      title: "Cobertura del Copilot por módulo",
      period: "estado actual del catálogo de fuentes",
      kpis: [
        { label: "Módulos conectados", value: String(conectados.length), hint: "con fuente real consultable", tone: "ok" },
        ...(brechas.length > 0
          ? [{ label: "Brechas declaradas", value: String(brechas.length), hint: "sin fuente conectada", tone: "danger" as const }]
          : []),
      ],
      table: {
        columns: ["Módulo", "Estado", "Fuente"],
        rows: rows.map((r) => [s(r.modulo), badge(s(r.estado)), s(r.fuente)]),
        rowLinks: rows.map((r) =>
          s(r.ruta) ? { url: s(r.ruta), label: "Abrir" } : null
        ),
      },
      chart: null,
      insights: [],
      warnings: brechas.map((b) => s(b.detalle)),
    };
  },

  // ── Búsqueda documental: PRINCIPAL única + relacionados separados ──────────
  // FIX Drive Docs 2026-07-08: card documental — título + SEDE (código) + TIPO +
  // fecha + "Abrir en Drive" (link REAL del PDF, aunque sea escaneado). Los
  // candidatos van en tabla compacta con su sede y su link de Drive.
  docs_browse: (rows) => {
    if (rows.length === 0) return null;
    const SEDE_LABEL: Record<string, string> = {
      MAGALDI: "Magaldi 1765",
      MAGALDI_1765: "Magaldi 1765",
      LUJAN: "Pedro de Luján 3159",
      PEDRO_LUJAN_3159: "Pedro de Luján 3159",
    };
    const sedeLabel = (v: unknown): string | null => {
      const raw = s(v);
      return raw ? (SEDE_LABEL[raw.toUpperCase()] ?? raw) : null;
    };
    const principal = rows[0];
    const relacionados = rows.slice(1, 8);
    const pSede = sedeLabel(principal.source_sede);
    const pTipo = s(principal.source_tipo) || null;
    const pFecha = principal.entity_date ? s(principal.entity_date).slice(0, 10) : null;
    const hasUrl = !!s(principal.source_url);
    return {
      kind: "document",
      title: "Documentación · Drive",
      period: [pSede, pTipo].filter(Boolean).join(" · ") || null,
      kpis: [
        {
          label: "Documento",
          value: s(principal.title),
          hint: [pSede, pTipo, pFecha ? `fecha: ${pFecha}` : null].filter(Boolean).join(" · ") || null,
          // Acción REAL: si el enrichment trajo la URL de Drive, abrir el PDF; si
          // no, fallback explícito a la ficha del módulo (nunca fingir un link).
          url: s(principal.source_url) || "/anmat",
          actionLabel: hasUrl ? "Abrir en Drive ↗" : "Ver ficha (solo metadata)",
          tone: "brand",
        },
      ],
      table:
        relacionados.length > 0
          ? {
              columns: ["Documento", "Sede", "Fecha"],
              rows: relacionados.map((r) => [
                s(r.title),
                sedeLabel(r.source_sede) ?? "—",
                s(r.entity_date).slice(0, 10) || "—",
              ]),
              rowLinks: relacionados.map((r) =>
                s(r.source_url)
                  ? { url: s(r.source_url), label: "Drive", kind: "drive" as const }
                  : { url: "/anmat", label: "Ficha", kind: "fallback" as const }
              ),
            }
          : null,
      chart: null,
      insights: [],
      warnings: [
        ...(hasUrl
          ? []
          : ["La mejor coincidencia no tiene link de Drive vinculado: se cita por ficha de metadata."]),
        ...(relacionados.length > 0
          ? [`${relacionados.length} documento(s) relacionado(s) — verificá que la mejor coincidencia sea el pedido.`]
          : []),
      ],
    };
  },

  // ── C1 · Conocimiento institucional v2 (UX ejecutivo 2026-07-07 · round UI) ──
  // NO es un bloque documental: una CARD por UNIDAD de negocio cubierta (área →
  // qué ofrece → link a la fuente), como un dashboard. La tabla de documentos se
  // ELIMINA del tablero (peso documental); la trazabilidad va a la sección de
  // fuentes colapsable del render. Links SOLO reales (área sin URL → card sin
  // acción). Sin filas → sin tablero (no se maquilla el vacío).
  company_knowledge_search: (rows) => {
    if (rows.length === 0) return null;
    // C1.5 · Ayuda Interna: si las fuentes son del Manual (SISTEMA_NEXUS), la card
    // es por SECCIÓN/MÓDULO del manual con "Abrir en Drive" — no el marco institucional.
    if (rows.some((r) => s(r.business_unit) === "SISTEMA_NEXUS")) {
      const cards: NonNullable<CopilotVisual["kpis"]> = rows.slice(0, 4).map((r) => {
        const snip = s(r.summary).replace(/\s+/g, " ").trim();
        return {
          label: "Manual Nexus",
          value: s(r.title).replace(/^manual tops nexus\s*[—·-]\s*/i, "") || "Sección del Manual",
          hint: snip ? (snip.length > 140 ? snip.slice(0, 140) + "…" : snip) : null,
          url: s(r.url) || null,
          actionLabel: s(r.url) ? "Abrir en Drive ↗" : null,
          tone: "brand" as const,
        };
      });
      return {
        kind: "document",
        title: "Manual Nexus · Ayuda Interna",
        period: `${rows.length} sección${rows.length === 1 ? "" : "es"} del Manual de Usuario`,
        kpis: cards,
        table: null,
        chart: null,
        insights: [],
        warnings: [],
      };
    }
    const UNIT_LABEL: Record<string, string> = {
      ANMAT: "ANMAT / RNE",
      REGULADOS: "Productos regulados",
      CARGAS_GENERALES: "Cargas Generales",
      CORPORATIVO: "Institucional · 3PL",
      NEXUS: "TOPS Nexus / Connect",
      OTRO: "Institucional",
    };
    const UNIT_TONE: Record<string, "brand" | "ok" | "warn"> = {
      ANMAT: "warn",
      REGULADOS: "warn",
      CARGAS_GENERALES: "brand",
      CORPORATIVO: "ok",
      NEXUS: "brand",
      OTRO: "ok",
    };
    const seen = new Set<string>();
    const cards: NonNullable<CopilotVisual["kpis"]> = [];
    for (const r of rows) {
      const u = s(r.business_unit) || "OTRO";
      if (seen.has(u)) continue;
      seen.add(u);
      const snip = s(r.summary).replace(/\s+/g, " ").trim();
      cards.push({
        label: "Área institucional",
        value: UNIT_LABEL[u] ?? u,
        hint: snip ? (snip.length > 140 ? snip.slice(0, 140) + "…" : snip) : null,
        url: s(r.url) || null,
        actionLabel: s(r.url) ? "Ver fuente ↗" : null,
        tone: UNIT_TONE[u] ?? "brand",
      });
      if (cards.length >= 4) break;
    }
    return {
      kind: "document",
      title: "Conocimiento institucional · Logística TOPS",
      period: `${rows.length} fuente${rows.length === 1 ? "" : "s"} · ${cards.length} área${
        cards.length === 1 ? "" : "s"
      }`,
      kpis: cards,
      table: null,
      chart: null,
      insights: [],
      warnings: [],
    };
  },
};

/** Escalera de links documentales de contratos (smoke 2026-07-07):
 *  archivo real → carpeta Drive → fallback HONESTO. El fallback dice "Sin PDF
 *  vinculado" (kind fallback): navega al módulo pero jamás se vende como fuente
 *  documental — "Ir a contratos" a secas queda PROHIBIDO como etiqueta de fuente. */
function contractRowLink(
  r: Record<string, unknown>
): { url: string; label: string; kind: "drive" | "folder" | "fallback" } {
  const file = s(r.file_url);
  if (file) return { url: file, label: "Abrir contrato", kind: "drive" };
  const folder = s(r.folder_url);
  if (folder) return { url: folder, label: "Carpeta Drive", kind: "folder" };
  return { url: "/comercial/contratos", label: "Sin PDF vinculado", kind: "fallback" };
}

/** Badge honesto de disponibilidad documental por fila (columna "Documento"). */
function docBadge(r: Record<string, unknown>): string {
  const k = contractRowLink(r).kind;
  return k === "drive" ? "📄 Drive" : k === "folder" ? "📁 Carpeta" : "— Sin PDF";
}

/** Patrón compartido ranking/top-1 (clientes, proveedores). */
function rankingVisual(
  rows: RawRow[],
  cfg: { entidad: string; nameKey: string; title: string; focoTop?: boolean }
): CopilotVisual | null {
  if (rows.length === 0) return null;
  const period = periodoLabel(rows[0]) ?? s(rows[0].periodo) ?? null;
  // Slice B · focoTop: la pregunta pide EL top y su PESO. Entidad principal
  // primero + participación calculada SOBRE EL TOP LISTADO (calificador
  // honesto: el % no es sobre el total global, y se dice).
  if (cfg.focoTop && rows.length > 1) {
    const top = rows[0];
    const totalListado = rows.reduce((a, r) => a + num(r.total), 0);
    const share = totalListado > 0 ? Math.round((1000 * num(top.total)) / totalListado) / 10 : 0;
    return {
      kind: "kpi",
      title: cfg.title,
      period,
      kpis: [
        {
          label: `Top ${cfg.entidad}`,
          value: s(top[cfg.nameKey]),
          hint: `${fmtMonto(num(top.total))} · ${s(top.cantidad)} comprobantes`,
          tone: "brand",
        },
        {
          label: `Participación (del top ${rows.length} listado)`,
          value: `${share}%`,
          hint: `sobre los ${rows.length} mayores listados, no el total global`,
          pct: share,
          tone: "brand",
        },
      ],
      table: {
        columns: ["#", cfg.nameKey === "cliente" ? "Cliente" : "Proveedor", "Monto"],
        rows: rows.slice(0, 5).map((r, i) => [String(i + 1), s(r[cfg.nameKey]), fmtMonto(num(r.total))]),
      },
      chart: null,
      insights: [
        `${s(top[cfg.nameKey])} concentra el ${share}% del top ${rows.length} listado.`,
      ],
      warnings: [],
    };
  }
  if (rows.length === 1) {
    const r = rows[0];
    return {
      kind: "kpi",
      title: cfg.title,
      period,
      kpis: [
        { label: `Top ${cfg.entidad}`, value: s(r[cfg.nameKey]), hint: null },
        { label: "Monto", value: fmtMonto(num(r.total)), hint: `${s(r.cantidad)} comprobantes` },
      ],
      chart: null,
      insights: [],
      warnings: [],
    };
  }
  const totalSum = rows.reduce((a, r) => a + num(r.total), 0);
  const topPct = totalSum > 0 ? Math.round((1000 * num(rows[0].total)) / totalSum) / 10 : 0;
  return {
    kind: "ranking",
    title: cfg.title,
    period,
    kpis: [
      { label: `Top ${cfg.entidad}`, value: s(rows[0][cfg.nameKey]), hint: fmtMonto(num(rows[0].total)) },
    ],
    table: {
      columns: ["#", cfg.nameKey === "cliente" ? "Cliente" : "Proveedor", "Monto", "Comprobantes"],
      rows: rows.map((r, i) => [String(i + 1), s(r[cfg.nameKey]), fmtMonto(num(r.total)), s(r.cantidad)]),
    },
    chart: {
      type: "bar",
      labels: rows.map((r) => s(r[cfg.nameKey])),
      values: rows.map((r) => num(r.total)),
      unit: "ARS",
    },
    insights: [`${s(rows[0][cfg.nameKey])} lidera con el ${topPct}% del total listado.`],
    warnings: [],
  };
}

/** Aplica una función de redacción a TODOS los strings del visual (defensa PII,
 *  misma política que chunks/answer). Los montos con coma no se ven afectados. */
export function redactVisual(
  v: CopilotVisual,
  redact: (t: string) => string
): CopilotVisual {
  return {
    ...v,
    title: redact(v.title),
    period: v.period ? redact(v.period) : v.period,
    kpis: v.kpis?.map((k) => ({
      ...k, // preserva pct/tone (progress y color semántico)
      label: redact(k.label),
      value: redact(k.value),
      hint: k.hint ? redact(k.hint) : k.hint,
    })),
    table: v.table
      ? {
          ...v.table, // preserva rowLinks (URLs no se redactan: son rutas/links, no PII)
          columns: v.table.columns.map(redact),
          rows: v.table.rows.map((row) => row.map(redact)),
        }
      : v.table,
    chart: v.chart ? { ...v.chart, labels: v.chart.labels.map(redact) } : v.chart,
    charts: v.charts?.map((c) => ({ ...c, labels: c.labels.map(redact) })),
    insights: v.insights?.map(redact),
    warnings: v.warnings?.map(redact),
  };
}
