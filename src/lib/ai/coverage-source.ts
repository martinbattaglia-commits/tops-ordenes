// Slice A (manual de aceptación 2026-07-07) · MATRIZ DE COBERTURA del Copilot
// (tool LOCAL, sin DB). El manual exige dos cosas que antes fallaban:
//   1. Que el Copilot responda sobre su propia cobertura ("qué módulos cubre",
//      "qué fuentes usa", "qué datos faltan").
//   2. Que los dominios SIN fuente conectada (WMS/stock, caja chica,
//      movimientos de tesorería) declaren una BRECHA ESPECÍFICA y citable en
//      vez de responder otro tema con datos no relacionados.
// Mantenimiento: al conectar una fuente nueva, actualizar la fila acá (los
// tests de coverage-source.test.ts vigilan que las brechas conocidas existan).

export interface CoverageRow {
  modulo: string;
  /** conectado = fuente real consultable · parcial = cobertura incompleta ·
   *  brecha = sin fuente conectada (el Copilot lo declara, no lo esconde). */
  estado: "conectado" | "parcial" | "brecha";
  /** Tool del catálogo + fuente real (RPC / lib compartida / datos del repo). */
  fuente: string;
  /** Ruta del módulo en Nexus ("" en brechas sin módulo consultable). */
  ruta: string;
  detalle: string;
  keywords: string;
  [key: string]: string;
}

export const COPILOT_COVERAGE: CoverageRow[] = [
  { modulo: "Informe ejecutivo de gestión", estado: "conectado", fuente: "management_brief (orquesta 11 tools de dominio)", ruta: "/copilot", detalle: "Resumen ejecutivo multi-dominio: KPIs por área, riesgos priorizados, oportunidades, recomendaciones y brechas.", keywords: "resumen ejecutivo informe gestion direccion riesgos oportunidades" },
  { modulo: "Facturación · Ingresos", estado: "conectado", fuente: "billing_summary · revenue_by_category_report · customer_revenue_overview (RPCs ai_*)", ruta: "/billing", detalle: "Totales por período, distribución por categoría (ANMAT/Cargas/Sin clasificar) y ranking por cliente.", keywords: "facturacion ingresos ventas categorias clientes" },
  { modulo: "Tesorería · Saldos bancarios", estado: "conectado", fuente: "bank_balances_overview (RPC ai_bank_balances_overview)", ruta: "/tesoreria/bancos", detalle: "Saldos por banco y caja derivados de movimientos.", keywords: "tesoreria bancos saldos santander galicia fondos" },
  { modulo: "Compras · Proveedores", estado: "conectado", fuente: "supplier_spend_overview · purchase_orders_overview · supplier_invoices_overview · suppliers_overview (RPCs ai_*)", ruta: "/compras", detalle: "Gasto y compromiso por proveedor, órdenes de compra y facturas de proveedor.", keywords: "compras proveedores gasto ordenes oc facturas" },
  { modulo: "Contratos · CRM", estado: "conectado", fuente: "contracts_overview (RPC ai_contracts_overview + enriquecimiento Drive)", ruta: "/comercial/contratos", detalle: "Cartera, vencimientos, firmas y calidad documental con link real a Drive cuando existe.", keywords: "contratos crm vencimientos firmas drive" },
  { modulo: "Compliance · ANMAT", estado: "conectado", fuente: "compliance_pending (RPC ai_compliance_pending)", ruta: "/anmat", detalle: "Documentos y casos vencidos o por vencer (90 días) con riesgo.", keywords: "compliance anmat habilitaciones vencimientos regulatorio" },
  { modulo: "Documentos · Drive", estado: "conectado", fuente: "docs_browse (RPC ai_docs_browse + URL real de Drive)", ruta: "/anmat", detalle: "Fichas documentales de compliance y contratos con apertura del documento real cuando está vinculado.", keywords: "documentos drive archivos fichas planchetas habilitaciones" },
  { modulo: "Vacancia · Capacidad física", estado: "conectado", fuente: "vacancy_overview (motor corporate-capacity + compromisos CRM, misma fuente que el dashboard)", ruta: "/comercial/dashboard-vacancia", detalle: "m² comercializables/ocupados/disponibles por unidad de negocio y cubículos ANMAT.", keywords: "vacancia capacidad m2 cubiculos ocupacion disponibilidad" },
  { modulo: "Operación · Connect", estado: "conectado", fuente: "incidents_overview · tasks_overview · workflows_stuck · ops_digest · my_agenda (RPCs ai_*)", ruta: "/connect", detalle: "Incidentes, tareas, workflows trabados, agenda y digest de eventos.", keywords: "operacion incidentes tareas workflows eventos agenda" },
  { modulo: "Organigrama institucional", estado: "conectado", fuente: "organization_overview (datos del repo, misma fuente que /organigrama)", ruta: "/organigrama", detalle: "Jerarquía, cargos y personas (sin datos de contacto).", keywords: "organigrama presidente cargos personas estructura" },
  { modulo: "Navegación de Nexus", estado: "conectado", fuente: "nexus_sections_overview (mapa de secciones del repo, rutas verificadas)", ruta: "/copilot", detalle: "Qué secciones existen y cómo llegar a cada una.", keywords: "secciones navegacion rutas mapa sistema" },
  { modulo: "Búsqueda general (Knowledge)", estado: "conectado", fuente: "search_knowledge · connect_search (RPCs del spine Knowledge)", ruta: "/connect/buscar", detalle: "Búsqueda full-text sobre entidades visibles para el usuario.", keywords: "busqueda knowledge texto entidades" },
  // ── Brechas declaradas (el Copilot las dice, no las esconde) ───────────────
  { modulo: "WMS · Depósito · Stock", estado: "brecha", fuente: "sin fuente conectada", ruta: "", detalle: "Brecha de cobertura: posiciones, sectores, stock y lotes/vencimientos de mercadería NO están conectados al Copilot. La capacidad física por unidad de negocio sí está disponible vía Vacancia (/comercial/dashboard-vacancia).", keywords: "wms deposito stock posiciones ubicaciones sectores lotes vencimientos mercaderia almacenamiento subutilizado pallets" },
  { modulo: "Caja chica", estado: "brecha", fuente: "sin fuente conectada", ruta: "", detalle: "Brecha de cobertura: los movimientos de caja chica no tienen fuente conectada al Copilot (espejo de planilla pendiente de integración).", keywords: "caja chica gastos menores planilla" },
  { modulo: "Movimientos de tesorería", estado: "brecha", fuente: "sin fuente conectada (solo saldos derivados)", ruta: "/tesoreria/bancos", detalle: "Brecha de cobertura: el Copilot ve SALDOS actuales por cuenta, pero no el listado de movimientos financieros del período.", keywords: "movimientos financieros transferencias cobranzas pagos flujo de fondos" },
  { modulo: "Comparaciones entre períodos", estado: "brecha", fuente: "sin motor de comparación", ruta: "", detalle: "Brecha de capacidad: comparar períodos (mes vs mes anterior, hoy vs ayer, gasto vs compromiso lado a lado) todavía no está soportado — los datos por período existen pero falta la capa comparativa.", keywords: "comparacion variacion mes anterior tendencia evolucion" },
  { modulo: "Cliente 360 (cruce comercial)", estado: "brecha", fuente: "sin cruce integrado", ruta: "/comercial/contratos", detalle: "Brecha de capacidad: el cruce cliente×contratos×facturación×compliance en una sola vista aún no está integrado (cada dominio responde por separado).", keywords: "cliente 360 cruce comercial estrategicos pipeline" },
];

const norm = (s: string): string =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

const STOP = new Set([
  "que", "cual", "cuales", "como", "donde", "hay", "el", "la", "los", "las", "de",
  "del", "en", "un", "una", "y", "o", "para", "por", "con", "copilot", "nexus",
  "modulos", "modulo", "cobertura", "responder", "responde", "fuentes", "usa",
  "datos", "faltan", "pueda", "mejor", "cada", "son", "tienen", "requieren",
  // "cobertura completa / cuáles son brecha" pregunta por la MATRIZ entera:
  // estos términos no deben filtrar a solo-brechas.
  "completa", "completo", "brecha", "brechas", "conectado", "conectados",
]);

/** Matriz de cobertura filtrada por query (scoring por tokens; sin query o sin
 *  tokens útiles → matriz completa). Misma semántica que nexus-sections. */
export function resolveCopilotCoverage(args: Record<string, unknown>): CoverageRow[] {
  const raw = typeof args.query === "string" ? norm(args.query) : "";
  const limit = typeof args.limit === "number" ? Math.max(1, Math.min(args.limit, 50)) : 30;
  const tokens = raw
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2 && !STOP.has(t));
  if (tokens.length === 0) return COPILOT_COVERAGE.slice(0, limit);
  const scored = COPILOT_COVERAGE.map((r) => {
    const hay = norm(`${r.modulo} ${r.fuente} ${r.detalle} ${r.keywords}`);
    return { r, score: tokens.filter((t) => hay.includes(t)).length };
  }).filter((x) => x.score > 0);
  scored.sort((a, b) => b.score - a.score);
  // Sin match → matriz completa (mejor el mapa entero que un vacío para una
  // pregunta que ES sobre cobertura; el router solo llega acá con esa intención).
  if (scored.length === 0) return COPILOT_COVERAGE.slice(0, limit);
  return scored.slice(0, limit).map((x) => x.r);
}
