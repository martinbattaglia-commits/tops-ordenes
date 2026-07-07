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
  customer_revenue_overview: (rows) => rankingVisual(rows, {
    entidad: "cliente",
    nameKey: "cliente",
    title: "Facturación por cliente",
  }),

  // ── Gasto/presupuesto por proveedor: mismo patrón ──────────────────────────
  supplier_spend_overview: (rows) => rankingVisual(rows, {
    entidad: s(rows[0]?.base) === "compromiso" ? "proveedor (presupuesto comprometido)" : "proveedor (gasto)",
    nameKey: "proveedor",
    title: s(rows[0]?.base) === "compromiso" ? "Presupuesto comprometido por proveedor" : "Gasto por proveedor",
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

  // ── Total facturado por período: KPI (o barras si son varios meses) ────────
  billing_summary: (rows) => {
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
        warnings: [],
      };
    }
    return {
      kind: "report",
      title: "Facturación por mes",
      period: null,
      kpis: [],
      table: {
        columns: ["Mes", "Total", "Facturas"],
        rows: rows.map((r) => [s(r.periodo), fmtMonto(num(r.total)), s(r.cantidad)]),
      },
      chart: {
        type: "bar",
        labels: rows.map((r) => s(r.periodo)),
        values: rows.map((r) => num(r.total)),
        unit: "ARS",
      },
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

  // ── Búsqueda documental: PRINCIPAL única + relacionados separados ──────────
  docs_browse: (rows) => {
    if (rows.length === 0) return null;
    const principal = rows[0];
    const relacionados = rows.slice(1, 8);
    return {
      kind: "document",
      title: "Búsqueda documental",
      period: null,
      kpis: [
        {
          label: "Mejor coincidencia",
          value: s(principal.title),
          hint: principal.entity_date ? `fecha clave: ${s(principal.entity_date).slice(0, 10)}` : null,
          // Acción REAL: si el enrichment trajo la URL de Drive, abrir el
          // documento; si no, fallback explícito a la ficha (nunca fingir).
          url: s(principal.source_url) || "/anmat",
          actionLabel: s(principal.source_url)
            ? "Abrir documento (Drive)"
            : "Ver ficha (solo metadata disponible)",
        },
      ],
      table:
        relacionados.length > 0
          ? {
              columns: ["Documentos relacionados", "Fecha"],
              rows: relacionados.map((r) => [s(r.title), s(r.entity_date).slice(0, 10) || "—"]),
              rowLinks: relacionados.map((r) =>
                s(r.source_url)
                  ? { url: s(r.source_url), label: "Drive" }
                  : { url: "/anmat", label: "Ficha" }
              ),
            }
          : null,
      chart: null,
      insights: [],
      warnings:
        relacionados.length > 0
          ? [
              `Se muestran además ${relacionados.length} documentos relacionados — verificá que la mejor coincidencia sea el documento pedido.`,
            ]
          : [],
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
  cfg: { entidad: string; nameKey: string; title: string }
): CopilotVisual | null {
  if (rows.length === 0) return null;
  const period = periodoLabel(rows[0]) ?? s(rows[0].periodo) ?? null;
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
