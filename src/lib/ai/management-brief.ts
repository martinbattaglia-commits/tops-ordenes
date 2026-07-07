// Copiloto de gestión (paradigma 2026-07-07) · CAPA DE INTELIGENCIA DE GESTIÓN.
//
// Hasta acá el Copilot ruteaba 1 pregunta → 1 tool y el compositor listaba
// registros ("esto es lo que encontré"). Esta capa lo convierte en copiloto:
// interpreta la INTENCIÓN gerencial, planifica qué dominios consultar, ejecuta
// las tools de dominio EXISTENTES (mismas RPC/fuentes compartidas, mismo RLS),
// cruza los resultados y deriva riesgos, oportunidades, recomendaciones y
// brechas — todo DETERMINÍSTICO y con evidencia. El modelo después narra.
//
// Reglas duras que respeta por construcción:
// - Read-only: solo compone tools del catálogo cerrado (cero escritura).
// - No inventa: cada riesgo/oportunidad/recomendación lleva su evidencia; si un
//   dominio no tiene datos, la sección lo dice ("sin datos") y las brechas de
//   cobertura (p.ej. caja chica) se DECLARAN como filas 'brecha'.
// - Paridad demo/real: usa fetchToolRows (data.ts), que resuelve fixtures en
//   demo y RPC/fuente compartida con el cliente de sesión (RLS) en real.

import { fetchToolRows } from "./data";
import type { ToolCall, ToolName } from "./types";

type RawRow = Record<string, unknown>;

const s = (v: unknown): string => (v == null ? "" : String(v));
const num = (v: unknown): number => {
  const n = Number(String(v ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
};
const fmtMonto = (n: number): string =>
  "ARS " + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtM2 = (n: number): string => `${n.toLocaleString("en-US")} m²`;

// ── Fase 4 · Detección de intención gerencial ────────────────────────────────
// Detector CONSERVADOR a propósito: las preguntas de dominio puntual ("saldo del
// Santander", "último contrato ANMAT") siguen yendo a su tool específica. Solo
// las preguntas de GESTIÓN (resumen ejecutivo, dirección, riesgos del negocio,
// prioridades, oportunidades, estado general) activan el brief.

export type BriefFocus = "resumen" | "riesgos" | "prioridades" | "oportunidades";

const norm = (text: string): string =>
  text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

const MANAGEMENT_PATTERNS: Array<{ re: RegExp; focus: BriefFocus }> = [
  // Informe / resumen ejecutivo y reunión de dirección. Un "(reporte|resumen)
  // ejecutivo DE <un dominio>" (p.ej. "reporte ejecutivo de facturación") NO es
  // gerencial multi-dominio: sigue yendo a la tool del dominio (estándar v10).
  {
    re: /(resumen|informe|reporte) ejecutivo(?! de (la )?(facturacion|ingresos|ventas|compras|tesoreria|contratos|compliance|vacancia|proveedores|operacion(?! de nexus)))|lectura ejecutiva|analisis gerencial|informe de situacion|resumen de situacion|brief ejecutivo/,
    focus: "resumen",
  },
  {
    re: /reunion de (direccion|directorio)|comite de direccion|reunion directiva/,
    focus: "resumen",
  },
  // Tablero/dashboard SOLO con calificador ejecutivo (no canibaliza dashboards de dominio).
  {
    re: /(tablero|dashboard|panel) (ejecutivo|de gestion|gerencial|de direccion|para (la )?(reunion|direccion))/,
    focus: "resumen",
  },
  // Estado/visión general del negocio.
  {
    re: /como (esta|viene|anda) (nexus|la empresa|el negocio|la compania|todo)|estado general|vision general|situacion general|panorama general|que area esta mas comprometida|area mas comprometida|que me preocupa de (nexus|la empresa|el negocio)/,
    focus: "resumen",
  },
  // Riesgos del negocio (con calificador: no matchea "clientes en riesgo").
  {
    re: /(principales|mayores|top \d+|los \d+) riesgos|riesgos mas importantes|que riesgos (hay|tenemos|aparecen|existen)|donde estan los riesgos|mapa de riesgos|ranking de riesgos/,
    focus: "riesgos",
  },
  // Oportunidades de negocio.
  {
    re: /que oportunidades? (hay|tenemos|aparecen|existen|comercial)|oportunidades? (comerciales?|de negocio)/,
    focus: "oportunidades",
  },
  // Prioridades / decisiones / recomendaciones de gestión.
  {
    re: /que (deberia|tendria que|debo) mirar|que miro primero|que priorizar|que priorizamos|prioridades de (hoy|la semana)|que decision(es)? (tomarias|recomendas|tomamos)|decision(es)? recomendarias|recomendarias tomar|recomendame (acciones|que hacer|prioridades)/,
    focus: "prioridades",
  },
  // Slice A (manual de aceptación 2026-07-07): formulaciones gerenciales del
  // brief de Dirección que caían en search_knowledge.
  {
    re: /tablero de salud|salud de nexus|reporte financiero ejecutivo|lectura de (tesoreria|finanzas)|tablero para (el )?comite|board ?pack|reporte de gobernanza|gobernanza de (datos|nexus)/,
    focus: "resumen",
  },
  { re: /tension(es)? financier/, focus: "riesgos" },
  { re: /pipeline ejecutivo/, focus: "oportunidades" },
];

/** Devuelve el foco gerencial de la pregunta, o null si es de dominio puntual. */
export function detectManagementIntent(question: string): { focus: BriefFocus } | null {
  const q = norm(question);
  for (const { re, focus } of MANAGEMENT_PATTERNS) {
    if (re.test(q)) return { focus };
  }
  return null;
}

// ── Fase 3 · Contrato interno del brief ──────────────────────────────────────
// Las filas son el contrato: cada una se vuelve un chunk citable [S#] y el
// adaptador visual (visuals.ts) las convierte en el dashboard ejecutivo.

export type BriefRowKind = "seccion" | "riesgo" | "oportunidad" | "brecha";
export type BriefEstado = "ok" | "atencion" | "critico" | "sin_datos";

export interface BriefSeccionRow extends Record<string, unknown> {
  kind: "seccion";
  seccion: string;
  titulo: string;
  estado: BriefEstado;
  /** KPI principal ya formateado (los números vienen de las tools, no se recalculan). */
  valor: string;
  hint: string | null;
  pct: number | null;
  url: string;
  detalle: string;
  /** Datos chart-ready opcionales (composición por categoría / m² por unidad). */
  chart_labels?: string[];
  chart_values?: number[];
}

export interface BriefRiesgoRow extends Record<string, unknown> {
  kind: "riesgo";
  area: string;
  titulo: string;
  impacto: "alto" | "medio" | "bajo";
  urgencia: "alta" | "media" | "baja";
  evidencia: string;
  accion: string;
  url: string;
  detalle: string;
}

export interface BriefOportunidadRow extends Record<string, unknown> {
  kind: "oportunidad";
  titulo: string;
  evidencia: string;
  accion: string;
  url: string;
  detalle: string;
}

export interface BriefBrechaRow extends Record<string, unknown> {
  kind: "brecha";
  titulo: string;
  detalle: string;
}

export type BriefRow =
  | BriefSeccionRow
  | BriefRiesgoRow
  | BriefOportunidadRow
  | BriefBrechaRow;

// Tope de filas = tope de chunks citables por tool (MAX_CHUNKS_PER_TOOL en data.ts).
const MAX_ROWS = 20;
const MAX_RIESGOS = 6;
const MAX_OPORTUNIDADES = 3;
const MAX_BRECHAS = 4;

// ── Fase 2 · Plan de dominios del slice testigo ──────────────────────────────
// Cada consulta usa la tool EXISTENTE con args explícitos y acotados.

const PLAN: Record<string, ToolCall> = {
  billing: { tool: "billing_summary", args: { mode: "ultimo_mes" } },
  categorias: { tool: "revenue_by_category_report", args: { periodo: "ultimo_mes" } },
  clientes: { tool: "customer_revenue_overview", args: { periodo: "todo", limit: 5 } },
  bancos: { tool: "bank_balances_overview", args: { limit: 10 } },
  proveedores: {
    tool: "supplier_spend_overview",
    args: { base: "gasto", periodo: "todo", limit: 5 },
  },
  contratos: { tool: "contracts_overview", args: { mode: "por_vencer", dias: 90, limit: 50 } },
  compliance: { tool: "compliance_pending", args: { limit: 50 } },
  vacancia: { tool: "vacancy_overview", args: {} },
  workflows: { tool: "workflows_stuck", args: { limit: 20 } },
  tareas: { tool: "tasks_overview", args: { scope: "vencidas", limit: 50 } },
  incidentes: {
    tool: "incidents_overview",
    args: { estados: ["abierto", "en_progreso", "en_espera"], severidades: ["critica", "alta"], limit: 50 },
  },
};

async function fetchDomain(key: keyof typeof PLAN): Promise<RawRow[]> {
  try {
    return await fetchToolRows(PLAN[key]);
  } catch (err) {
    // fetchToolRows ya absorbe errores de RPC devolviendo []; acá solo caen
    // errores inesperados (p.ej. args). Nunca rompen el brief: dominio sin datos.
    console.error(`[ai/brief] dominio ${String(key)} error:`, err);
    return [];
  }
}

// ── Fase 5 · Composición del brief (determinística, con evidencia) ───────────

export async function composeManagementBriefRows(
  args: Record<string, unknown>
): Promise<RawRow[]> {
  const focus = s(args.focus) as BriefFocus | "";

  const keys = Object.keys(PLAN) as Array<keyof typeof PLAN>;
  const results = await Promise.all(keys.map((k) => fetchDomain(k)));
  const d = Object.fromEntries(keys.map((k, i) => [k, results[i]])) as Record<
    keyof typeof PLAN,
    RawRow[]
  >;

  const secciones: BriefSeccionRow[] = [];
  const riesgos: BriefRiesgoRow[] = [];
  const oportunidades: BriefOportunidadRow[] = [];
  const brechas: BriefBrechaRow[] = [];

  // ── Facturación (billing + categorías + cliente top) ──────────────────────
  {
    const bill = d.billing[0];
    const cats = d.categorias;
    const lider = cats[0];
    const sinClasif = cats.find((r) => s(r.categoria) === "Sin clasificar");
    const topCliente = d.clientes[0];
    if (bill) {
      const partes = [
        `Facturación ${s(bill.periodo)}: ${fmtMonto(num(bill.total))} (${s(bill.cantidad)} facturas autorizadas).`,
        lider
          ? `Categoría líder: ${s(lider.categoria)} ${s(lider.porcentaje)}% (${fmtMonto(num(lider.monto))}).`
          : "",
        topCliente
          ? `Cliente top: ${s(topCliente.cliente)} con ${fmtMonto(num(topCliente.total))} facturados (todo el período).`
          : "",
        sinClasif
          ? `Sin clasificar: ${s(sinClasif.porcentaje)}% (${fmtMonto(num(sinClasif.monto))}) — brecha de clasificación.`
          : "",
      ].filter(Boolean);
      secciones.push({
        kind: "seccion",
        seccion: "facturacion",
        titulo: "Facturación",
        estado: sinClasif && num(sinClasif.porcentaje) >= 10 ? "atencion" : "ok",
        valor: fmtMonto(num(bill.total)),
        hint: `${s(bill.periodo)} · ${s(bill.cantidad)} facturas${lider ? ` · líder ${s(lider.categoria)} ${s(lider.porcentaje)}%` : ""}`,
        pct: null,
        url: "/billing",
        detalle: partes.join(" "),
        ...(cats.length > 0
          ? {
              chart_labels: cats.map((r) => s(r.categoria)),
              chart_values: cats.map((r) => num(r.monto)),
            }
          : {}),
      });
      if (sinClasif && num(sinClasif.monto) > 0) {
        brechas.push({
          kind: "brecha",
          titulo: "Facturación sin clasificar",
          detalle: `Brecha de clasificación: ${s(sinClasif.porcentaje)}% de la facturación del período (${fmtMonto(num(sinClasif.monto))}) quedó Sin clasificar por falta de tag de unidad de negocio en clientes.`,
        });
      }
    } else {
      secciones.push(seccionSinDatos("facturacion", "Facturación", "/billing"));
    }
  }

  // ── Tesorería (saldos bancarios) ───────────────────────────────────────────
  {
    const bancos = d.bancos;
    if (bancos.length > 0) {
      const total = bancos.reduce((a, r) => a + num(r.balance), 0);
      const detalleBancos = bancos
        .slice(0, 4)
        .map((r) => `${s(r.bank_name)}: ${fmtMonto(num(r.balance))}`)
        .join(" · ");
      secciones.push({
        kind: "seccion",
        seccion: "tesoreria",
        titulo: "Tesorería",
        estado: total > 0 ? "ok" : "atencion",
        valor: fmtMonto(total),
        hint: `${bancos.length} cuentas (saldo derivado de movimientos)`,
        pct: null,
        url: "/tesoreria/bancos",
        detalle: `Saldo total en bancos y caja: ${fmtMonto(total)} (${bancos.length} cuentas). ${detalleBancos}.`,
      });
    } else {
      secciones.push(seccionSinDatos("tesoreria", "Tesorería", "/tesoreria/bancos"));
    }
  }

  // ── Compras / proveedores (gasto agregado) ─────────────────────────────────
  {
    const prov = d.proveedores;
    const top = prov[0];
    if (top) {
      const totalListado = prov.reduce((a, r) => a + num(r.total), 0);
      const topPct =
        totalListado > 0 ? Math.round((1000 * num(top.total)) / totalListado) / 10 : 0;
      secciones.push({
        kind: "seccion",
        seccion: "compras",
        titulo: "Compras · Proveedores",
        estado: "ok",
        valor: s(top.proveedor),
        hint: `mayor gasto: ${fmtMonto(num(top.total))} (${topPct}% del top ${prov.length} listado)`,
        pct: null,
        url: "/compras/facturas",
        detalle: `Proveedor con mayor gasto: ${s(top.proveedor)} con ${fmtMonto(num(top.total))} (${s(top.cantidad)} comprobantes); concentra el ${topPct}% del gasto del top ${prov.length} listado.`,
      });
    } else {
      secciones.push(seccionSinDatos("compras", "Compras · Proveedores", "/compras/facturas"));
    }
  }

  // ── Contratos (por vencer 90 días) ─────────────────────────────────────────
  {
    const cts = d.contratos;
    const urgentes = cts.filter((r) => num(r.dias_para_vencer) <= 30);
    const sinDoc = cts.filter((r) => !s(r.file_url) && !s(r.folder_url));
    if (cts.length > 0) {
      const masUrgente = [...cts].sort(
        (a, b) => num(a.dias_para_vencer) - num(b.dias_para_vencer)
      )[0];
      secciones.push({
        kind: "seccion",
        seccion: "contratos",
        titulo: "Contratos",
        estado: urgentes.length > 0 ? "critico" : "atencion",
        valor: `${cts.length} por vencer`,
        hint: urgentes.length > 0 ? `${urgentes.length} con ≤30 días` : "en 90 días",
        pct: null,
        url: "/comercial/contratos",
        detalle: `${cts.length} contratos vencen dentro de 90 días${urgentes.length > 0 ? `; ${urgentes.length} con ≤30 días (el más urgente: ${s(masUrgente.razon_social)}, vence ${s(masUrgente.fecha_fin)})` : ""}${sinDoc.length > 0 ? `; ${sinDoc.length} sin archivo Drive vinculado` : ""}.`,
      });
      riesgos.push({
        kind: "riesgo",
        area: "Contratos",
        titulo:
          urgentes.length > 0
            ? `${urgentes.length} contrato(s) vencen en ≤30 días`
            : `${cts.length} contrato(s) vencen dentro de 90 días`,
        impacto: urgentes.length > 0 ? "alto" : "medio",
        urgencia: urgentes.length > 0 ? "alta" : "media",
        evidencia: `${s(masUrgente.razon_social)} (${s(masUrgente.tipo)}) vence ${s(masUrgente.fecha_fin)} — ${s(masUrgente.dias_para_vencer)} días restantes`,
        accion: `Iniciar la renovación de ${s(masUrgente.razon_social)} y revisar el resto de la ventana de 90 días`,
        url: "/comercial/contratos",
        detalle: `Riesgo ${urgentes.length > 0 ? "alto/alta" : "medio/media"} · ${cts.length} contratos por vencer en 90 días; el más urgente es ${s(masUrgente.razon_social)} (vence ${s(masUrgente.fecha_fin)}). Acción: iniciar renovación.`,
      });
      if (sinDoc.length > 0) {
        oportunidades.push({
          kind: "oportunidad",
          titulo: `Regularizar ${sinDoc.length} contrato(s) sin archivo Drive vinculado`,
          evidencia: `${sinDoc.length} de ${cts.length} contratos por vencer no tienen PDF ni carpeta Drive`,
          accion: "Vincular los PDF firmados a la ficha del contrato antes de renegociar",
          url: "/comercial/contratos",
          detalle: `Oportunidad de mejora documental: ${sinDoc.length} de ${cts.length} contratos por vencer están sin archivo Drive vinculado.`,
        });
      }
    } else {
      secciones.push({
        kind: "seccion",
        seccion: "contratos",
        titulo: "Contratos",
        estado: "ok",
        valor: "0 por vencer",
        hint: "sin vencimientos en 90 días",
        pct: null,
        url: "/comercial/contratos",
        detalle: "Contratos: sin vencimientos dentro de los próximos 90 días.",
      });
    }
  }

  // ── Compliance (vencidos / por vencer) ─────────────────────────────────────
  {
    const comp = d.compliance;
    const vencidos = comp.filter((r) => /vencid/.test(norm(s(r.estado))));
    const altoRiesgo = comp.filter((r) => /alto|critic/.test(norm(s(r.riesgo))));
    if (comp.length > 0) {
      const top = altoRiesgo[0] ?? vencidos[0] ?? comp[0];
      secciones.push({
        kind: "seccion",
        seccion: "compliance",
        titulo: "Compliance",
        estado: vencidos.length > 0 ? "critico" : "atencion",
        valor: `${comp.length} pendientes`,
        hint:
          vencidos.length > 0
            ? `${vencidos.length} vencidos`
            : "vencidos o por vencer (90 días)",
        pct: null,
        url: "/anmat",
        detalle: `Compliance: ${comp.length} documentos/casos vencidos o por vencer en 90 días${vencidos.length > 0 ? ` (${vencidos.length} ya vencidos)` : ""}${altoRiesgo.length > 0 ? `; ${altoRiesgo.length} con riesgo alto` : ""}. Ej.: ${s(top.titulo)} (${s(top.estado)}${top.fecha_clave ? `, fecha clave ${s(top.fecha_clave)}` : ""}).`,
      });
      riesgos.push({
        kind: "riesgo",
        area: "Compliance",
        titulo:
          vencidos.length > 0
            ? `${vencidos.length} documento(s) de compliance vencidos`
            : `${comp.length} documento(s)/caso(s) de compliance por vencer`,
        impacto: vencidos.length > 0 || altoRiesgo.length > 0 ? "alto" : "medio",
        urgencia: vencidos.length > 0 ? "alta" : "media",
        evidencia: `${s(top.titulo)} · estado ${s(top.estado)}${top.fecha_clave ? ` · fecha clave ${s(top.fecha_clave)}` : ""}`,
        accion: `Regularizar la documentación de compliance empezando por ${s(top.titulo)}`,
        url: "/anmat",
        detalle: `Riesgo regulatorio: ${comp.length} pendientes de compliance${vencidos.length > 0 ? ` (${vencidos.length} vencidos)` : ""}. Acción: regularizar empezando por ${s(top.titulo)}.`,
      });
    } else {
      secciones.push({
        kind: "seccion",
        seccion: "compliance",
        titulo: "Compliance",
        estado: "ok",
        valor: "0 pendientes",
        hint: "sin vencidos ni por vencer (90 días)",
        pct: null,
        url: "/anmat",
        detalle: "Compliance: sin documentos ni casos vencidos o por vencer en 90 días.",
      });
    }
  }

  // ── Vacancia / capacidad (oportunidad comercial) ───────────────────────────
  {
    const corp = d.vacancia.find((r) => s(r.alcance) === "Corporativo") ?? d.vacancia[0];
    const cats = d.vacancia.filter((r) => s(r.alcance) !== "Corporativo");
    if (corp) {
      const vac = num(corp.vacancia_pct);
      const disponible = num(corp.disponible_m2);
      const cubDisp = num(corp.cubiculos_disponibles);
      const cubTotal = num(corp.cubiculos_total);
      secciones.push({
        kind: "seccion",
        seccion: "vacancia",
        titulo: "Vacancia · Capacidad",
        estado: vac > 40 ? "atencion" : "ok",
        valor: `${s(corp.vacancia_pct)}%`,
        hint: `${fmtM2(disponible)} disponibles de ${fmtM2(num(corp.capacidad_m2))}`,
        pct: vac,
        url: "/comercial/dashboard-vacancia",
        detalle: `Vacancia corporativa ${s(corp.vacancia_pct)}%: ${fmtM2(disponible)} disponibles de ${fmtM2(num(corp.capacidad_m2))} comercializables${cubTotal > 0 ? `; cubículos ANMAT: ${cubTotal - cubDisp} alquilados de ${cubTotal} (${cubDisp} disponibles)` : ""}.`,
        ...(cats.length > 0
          ? {
              chart_labels: cats.map((r) => s(r.alcance)),
              chart_values: cats.map((r) => num(r.disponible_m2)),
            }
          : {}),
      });
      if (disponible > 0) {
        const mayor = [...cats].sort((a, b) => num(b.disponible_m2) - num(a.disponible_m2))[0];
        oportunidades.push({
          kind: "oportunidad",
          titulo: `Comercializar ${fmtM2(disponible)} disponibles`,
          evidencia: `vacancia corporativa ${s(corp.vacancia_pct)}%${mayor ? `; mayor disponibilidad en ${s(mayor.alcance)} (${fmtM2(num(mayor.disponible_m2))})` : ""}`,
          accion: `Priorizar la comercialización de ${mayor ? s(mayor.alcance) : "la capacidad disponible"}${cubDisp > 0 ? ` y de los ${cubDisp} cubículos ANMAT libres` : ""}`,
          url: "/comercial/dashboard-vacancia",
          detalle: `Oportunidad comercial: ${fmtM2(disponible)} disponibles (vacancia ${s(corp.vacancia_pct)}%)${mayor ? `, concentrados en ${s(mayor.alcance)} (${fmtM2(num(mayor.disponible_m2))})` : ""}${cubDisp > 0 ? `; además ${cubDisp} cubículos ANMAT libres de ${cubTotal}` : ""}.`,
        });
      }
    } else {
      secciones.push(
        seccionSinDatos("vacancia", "Vacancia · Capacidad", "/comercial/dashboard-vacancia")
      );
    }
  }

  // ── Operación (incidentes críticos + workflows trabados + tareas vencidas) ─
  {
    const criticos = d.incidentes.filter((r) => norm(s(r.severidad)) === "critica");
    const wf = d.workflows;
    const tareas = d.tareas;
    const partes: string[] = [];
    if (criticos.length > 0) {
      partes.push(
        `${criticos.length} incidente(s) crítico(s) abierto(s) (ej.: ${s(criticos[0].public_id)} ${s(criticos[0].titulo)})`
      );
    }
    if (wf.length > 0) {
      const peor = [...wf].sort((a, b) => num(b.idle_days) - num(a.idle_days))[0];
      partes.push(
        `${wf.length} workflow(s) trabado(s) (ej.: ${s(peor.workflow)}, paso ${s(peor.current_step)}, ${s(peor.idle_days)} días sin actividad)`
      );
    }
    if (tareas.length > 0) partes.push(`${tareas.length} tarea(s) vencida(s)`);

    const estado: BriefEstado =
      criticos.length > 0 ? "critico" : wf.length + tareas.length > 0 ? "atencion" : "ok";
    secciones.push({
      kind: "seccion",
      seccion: "operacion",
      titulo: "Operación",
      estado,
      valor:
        criticos.length > 0
          ? `${criticos.length} incidente(s) crítico(s)`
          : wf.length + tareas.length > 0
            ? `${wf.length + tareas.length} pendiente(s) trabado(s)`
            : "Sin bloqueos",
      hint:
        wf.length + tareas.length > 0
          ? `${wf.length} workflows trabados · ${tareas.length} tareas vencidas`
          : null,
      pct: null,
      url: "/connect/tareas",
      detalle:
        partes.length > 0
          ? `Operación: ${partes.join("; ")}.`
          : "Operación: sin incidentes críticos, workflows trabados ni tareas vencidas.",
    });

    if (criticos.length > 0) {
      riesgos.push({
        kind: "riesgo",
        area: "Operación",
        titulo: `${criticos.length} incidente(s) crítico(s) abierto(s)`,
        impacto: "alto",
        urgencia: "alta",
        evidencia: `${s(criticos[0].public_id)} · ${s(criticos[0].titulo)}${criticos[0].sector ? ` · ${s(criticos[0].sector)}` : ""}`,
        accion: `Resolver ${s(criticos[0].public_id)} y verificar el plan de contención`,
        url: "/connect/incidentes",
        detalle: `Riesgo operativo alto/alta: ${criticos.length} incidente(s) crítico(s) abierto(s); el principal es ${s(criticos[0].public_id)} (${s(criticos[0].titulo)}). Acción: resolver y verificar contención.`,
      });
    }
    if (wf.length > 0) {
      const peor = [...wf].sort((a, b) => num(b.idle_days) - num(a.idle_days))[0];
      riesgos.push({
        kind: "riesgo",
        area: "Operación",
        titulo: `${wf.length} workflow(s) trabado(s)`,
        impacto: "medio",
        urgencia: num(peor.idle_days) >= 5 ? "alta" : "media",
        evidencia: `${s(peor.workflow)} · paso ${s(peor.current_step)}${peor.step_titulo ? ` (${s(peor.step_titulo)})` : ""} · ${s(peor.idle_days)} días sin actividad`,
        accion: `Destrabar ${s(peor.workflow)} (paso ${s(peor.current_step)})${peor.task_public_id ? ` — tarea ${s(peor.task_public_id)}` : ""}`,
        url: "/connect/tareas",
        detalle: `Riesgo de proceso: ${wf.length} workflow(s) sin actividad; el más antiguo es ${s(peor.workflow)} (${s(peor.idle_days)} días). Acción: destrabar el paso ${s(peor.current_step)}.`,
      });
    }
    if (tareas.length > 0) {
      riesgos.push({
        kind: "riesgo",
        area: "Operación",
        titulo: `${tareas.length} tarea(s) vencida(s)`,
        impacto: "medio",
        urgencia: "media",
        evidencia: `ej.: ${s(tareas[0].public_id)} ${s(tareas[0].titulo)}${tareas[0].asignado ? ` (asignada a ${s(tareas[0].asignado)})` : ""}`,
        accion: "Repriorizar o reasignar las tareas vencidas en Connect",
        url: "/connect/tareas",
        detalle: `Riesgo de ejecución: ${tareas.length} tarea(s) vencida(s) abiertas. Acción: repriorizar o reasignar en Connect.`,
      });
    }
  }

  // ── Fase 6 · Brechas de cobertura conocidas (se declaran, no se esconden) ──
  brechas.push({
    kind: "brecha",
    titulo: "Caja chica sin fuente conectada",
    detalle:
      "Brecha de cobertura: no encontré una fuente conectada para movimientos de caja chica (dominio aún no integrado al Copilot).",
  });

  // ── Orden final: riesgos por impacto/urgencia; foco reordena las citas ─────
  const rank = (r: BriefRiesgoRow) =>
    (r.impacto === "alto" ? 0 : r.impacto === "medio" ? 10 : 20) +
    (r.urgencia === "alta" ? 0 : r.urgencia === "media" ? 1 : 2);
  riesgos.sort((a, b) => rank(a) - rank(b));

  const cappedRiesgos = riesgos.slice(0, MAX_RIESGOS);
  const cappedOportunidades = oportunidades.slice(0, MAX_OPORTUNIDADES);
  const cappedBrechas = brechas.slice(0, MAX_BRECHAS);

  const rows: RawRow[] =
    focus === "riesgos"
      ? [...cappedRiesgos, ...cappedOportunidades, ...secciones, ...cappedBrechas]
      : focus === "oportunidades"
        ? [...cappedOportunidades, ...cappedRiesgos, ...secciones, ...cappedBrechas]
        : [...secciones, ...cappedRiesgos, ...cappedOportunidades, ...cappedBrechas];

  return rows.slice(0, MAX_ROWS);
}

function seccionSinDatos(seccion: string, titulo: string, url: string): BriefSeccionRow {
  return {
    kind: "seccion",
    seccion,
    titulo,
    estado: "sin_datos",
    valor: "Sin datos",
    hint: "la fuente no devolvió registros para esta consulta",
    pct: null,
    url,
    detalle: `${titulo}: la fuente conectada no devolvió datos para esta consulta (sección sin datos, no se estima).`,
  };
}
