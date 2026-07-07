// Command center 2026-07-07 · Catálogo de sugerencias del Copilot, POR SECCIÓN
// de Nexus y CONSCIENTE DE COBERTURA.
//
// Regla de producto: una sugerencia principal ('supported') es una pregunta que
// HOY rutea a una tool específica y responde con datos reales o con un vacío
// honesto de dominio — nunca el fallback genérico. El test de cobertura
// (copilot-suggestions.test.ts) valida CADA prompt contra el router: si alguien
// agrega una sugerencia que cae en el default genérico, la suite rompe.
//
// 'partial' = el dominio existe en Nexus pero el Copilot aún no tiene fuente
// conectada (brecha registrada en COPILOT_NEXUS_COVERAGE_MATRIX.md). NO se
// muestran como principales — quedan documentadas acá para la próxima fase.

export type SuggestionCoverage = "supported" | "partial" | "experimental";

export interface CopilotSuggestionPrompt {
  id: string;
  /** Texto corto del chip. */
  label: string;
  /** Pregunta completa que se envía al Copilot. */
  prompt: string;
  coverage: SuggestionCoverage;
}

export interface CopilotSuggestionSection {
  id: string;
  title: string;
  /** Emoji (sin dependencia de catálogos de íconos). */
  icon: string;
  /** Acento hex del módulo (paleta fija; regla repo: no /opacity sobre var()). */
  color: string;
  description: string;
  coverage: SuggestionCoverage;
  prompts: CopilotSuggestionPrompt[];
}

export const COPILOT_SUGGESTION_SECTIONS: CopilotSuggestionSection[] = [
  {
    id: "gerencia",
    title: "Gerencia · Cockpit",
    icon: "🎯",
    color: "#8b5cf6",
    description: "Prioridades del día, operación e incidentes.",
    coverage: "supported",
    prompts: [
      { id: "agenda", label: "¿Qué miro primero hoy?", prompt: "¿Qué debería mirar primero hoy?", coverage: "supported" },
      { id: "ops-hoy", label: "Operación de hoy", prompt: "¿Qué pasó hoy en operaciones?", coverage: "supported" },
      { id: "incidentes", label: "Incidentes críticos", prompt: "¿Qué incidentes críticos están abiertos?", coverage: "supported" },
      { id: "tareas", label: "Tareas vencidas", prompt: "¿Qué tareas están vencidas?", coverage: "supported" },
    ],
  },
  {
    id: "facturacion",
    title: "Facturación · Ingresos",
    icon: "💰",
    color: "#3b82f6",
    description: "Totales, distribución por categoría y clientes top.",
    coverage: "supported",
    prompts: [
      { id: "total-mes", label: "Facturación del último mes", prompt: "¿Cuánto se facturó el último mes?", coverage: "supported" },
      { id: "categorias", label: "% ANMAT vs Cargas Generales", prompt: "Haceme un reporte de ingresos por categoría: qué porcentaje fue ANMAT y qué porcentaje Cargas Generales", coverage: "supported" },
      { id: "cliente-top", label: "Cliente que más facturó", prompt: "¿Cuál fue el cliente que más facturó?", coverage: "supported" },
      { id: "ranking-clientes", label: "Ranking de clientes", prompt: "Ranking de clientes por facturación", coverage: "supported" },
    ],
  },
  {
    id: "compras",
    title: "Compras · Proveedores",
    icon: "🛒",
    color: "#f59e0b",
    description: "Gasto por proveedor, órdenes y facturas de compra.",
    coverage: "supported",
    prompts: [
      { id: "proveedor-top", label: "Proveedor con más gasto", prompt: "¿Cuál fue el proveedor que más gastó el mes pasado?", coverage: "supported" },
      { id: "ranking-proveedores", label: "Ranking por gasto", prompt: "Ranking de proveedores por gasto", coverage: "supported" },
      { id: "ultima-oc", label: "Última orden de compra", prompt: "¿Cuál fue la última orden de compra emitida?", coverage: "supported" },
      { id: "ultima-fc-prov", label: "Última factura de proveedor", prompt: "¿Cuál fue la última factura de proveedor?", coverage: "supported" },
    ],
  },
  {
    id: "tesoreria",
    title: "Tesorería · Finanzas",
    icon: "🏦",
    color: "#22c55e",
    description: "Saldos bancarios y última facturación emitida.",
    coverage: "supported",
    prompts: [
      { id: "santander", label: "Saldo en Santander", prompt: "¿Cuánta plata hay en Santander?", coverage: "supported" },
      { id: "bancos", label: "Saldo total en bancos", prompt: "¿Cuál es el saldo total en bancos?", coverage: "supported" },
      { id: "ultima-factura", label: "Última factura emitida", prompt: "¿Cuál fue la última factura emitida?", coverage: "supported" },
    ],
  },
  {
    id: "compliance",
    title: "Compliance · ANMAT",
    icon: "🛡️",
    color: "#ef4444",
    description: "Documentación regulatoria, vencimientos y novedades.",
    coverage: "supported",
    prompts: [
      { id: "pendientes", label: "Documentos pendientes", prompt: "¿Qué documentos de compliance están pendientes?", coverage: "supported" },
      { id: "vencidos", label: "Documentos vencidos", prompt: "¿Qué documentos están vencidos?", coverage: "supported" },
      { id: "novedades", label: "Novedades de compliance", prompt: "¿Qué novedades hubo en compliance?", coverage: "supported" },
    ],
  },
  {
    id: "documentos",
    title: "Documentos · Drive",
    icon: "📁",
    color: "#14b8a6",
    description: "Habilitaciones, planchetas y archivos con link real.",
    coverage: "supported",
    prompts: [
      { id: "hab-magaldi", label: "Habilitación Magaldi 1765", prompt: "Dame la habilitación de Magaldi 1765", coverage: "supported" },
      { id: "plancheta-lujan", label: "Plancheta Luján 3159", prompt: "Dame la plancheta de habilitación de Luján 3159", coverage: "supported" },
      { id: "archivos", label: "Archivos de compliance", prompt: "¿Cuáles son los archivos de compliance?", coverage: "supported" },
    ],
  },
  {
    id: "contratos",
    title: "Contratos · CRM",
    icon: "📄",
    color: "#eab308",
    description: "Firmas recientes, vencimientos y cartera vigente.",
    coverage: "supported",
    prompts: [
      { id: "firmados-mes", label: "Firmados el último mes", prompt: "¿Cuántos contratos se firmaron el último mes?", coverage: "supported" },
      { id: "por-vencer", label: "Próximos a vencer", prompt: "¿Qué contratos están próximos a vencer?", coverage: "supported" },
      { id: "ultimo-anmat", label: "Último contrato ANMAT", prompt: "¿Cuál fue el último contrato ANMAT firmado?", coverage: "supported" },
      { id: "vigentes", label: "Contratos vigentes", prompt: "Mostrame los contratos vigentes", coverage: "supported" },
    ],
  },
  {
    id: "vacancia",
    title: "Vacancia · Capacidad",
    icon: "🏗️",
    color: "#f43f5e",
    description: "m² disponibles, ocupación y cubículos ANMAT.",
    coverage: "supported",
    prompts: [
      { id: "vacancia-pct", label: "% de vacancia actual", prompt: "¿Qué porcentaje de vacancia tenemos?", coverage: "supported" },
      { id: "m2-cargas", label: "m² para Cargas Generales", prompt: "¿Cuántos metros cuadrados hay disponibles para Cargas Generales?", coverage: "supported" },
      { id: "cubiculos", label: "Cubículos ANMAT alquilados", prompt: "¿Cuántos cubículos de ANMAT están alquilados?", coverage: "supported" },
      { id: "capacidad", label: "Capacidad y ocupación", prompt: "¿Cuál es la capacidad comercializable y cuánto está ocupado?", coverage: "supported" },
    ],
  },
  {
    id: "sistema",
    title: "Organigrama · Sistema",
    icon: "👥",
    color: "#64748b",
    description: "Personas, responsables y mapa de secciones de Nexus.",
    coverage: "supported",
    prompts: [
      { id: "presidente", label: "Presidente de TOPS", prompt: "¿Quién es el presidente de Logística TOPS?", coverage: "supported" },
      { id: "operaciones", label: "A cargo de operaciones", prompt: "¿Quién está a cargo de operaciones?", coverage: "supported" },
      { id: "secciones", label: "Secciones de Nexus", prompt: "¿Qué secciones tiene Nexus?", coverage: "supported" },
      { id: "donde-oc", label: "¿Dónde veo las OC?", prompt: "¿Dónde veo las órdenes de compra?", coverage: "supported" },
    ],
  },
  {
    // 10ª sección supported (smoke 2026-07-07): equilibra la grilla de 2 columnas
    // (9 secciones dejaban hueco abajo a la derecha) con cobertura 100% real.
    id: "salud",
    title: "Salud operativa · Riesgos",
    icon: "🚨",
    color: "#f97316",
    description: "Clientes en riesgo, workflows trabados y novedades de ayer.",
    coverage: "supported",
    prompts: [
      { id: "clientes-riesgo", label: "Clientes en riesgo", prompt: "¿Qué clientes están en riesgo?", coverage: "supported" },
      { id: "workflows-trabados", label: "Workflows trabados", prompt: "¿Qué workflows están trabados?", coverage: "supported" },
      { id: "ayer", label: "Qué pasó ayer", prompt: "¿Qué pasó ayer en la operación?", coverage: "supported" },
    ],
  },
  // ── Brechas conocidas (matriz): NO se muestran como principales ─────────────
  {
    id: "wms",
    title: "WMS · Depósito",
    icon: "📦",
    color: "#a3a3a3",
    description: "Stock, posiciones y vencimientos ANMAT (en conexión).",
    coverage: "partial",
    prompts: [
      { id: "posiciones", label: "Posiciones ocupadas", prompt: "¿Qué posiciones del depósito están ocupadas?", coverage: "partial" },
      { id: "stock", label: "Stock crítico", prompt: "¿Qué stock requiere atención?", coverage: "partial" },
      { id: "vencimientos-wms", label: "Vencimientos ANMAT de stock", prompt: "¿Hay vencimientos ANMAT próximos en el depósito?", coverage: "partial" },
    ],
  },
  {
    id: "caja",
    title: "Caja chica · Movimientos",
    icon: "🧾",
    color: "#a3a3a3",
    description: "Caja chica y movimientos de tesorería (en conexión).",
    coverage: "partial",
    prompts: [
      { id: "caja-chica", label: "Estado de caja chica", prompt: "¿Cómo está la caja chica?", coverage: "partial" },
      { id: "movimientos", label: "Movimientos relevantes", prompt: "¿Qué movimientos financieros relevantes hubo?", coverage: "partial" },
      { id: "flujo", label: "Flujo de fondos", prompt: "Mostrame el flujo de fondos proyectado", coverage: "partial" },
    ],
  },
];

/** Secciones con cobertura completa — lo ÚNICO que se muestra como principal. */
export function getPrincipalSections(): CopilotSuggestionSection[] {
  return COPILOT_SUGGESTION_SECTIONS.filter((s) => s.coverage === "supported").map((s) => ({
    ...s,
    prompts: s.prompts.filter((p) => p.coverage === "supported"),
  }));
}
