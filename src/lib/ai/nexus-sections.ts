// fix/f5-2 · Catálogo de SECCIONES de Nexus consultable por el Copilot (tool LOCAL).
//
// BASE EXTENSIBLE para "módulos internos consultables" (auditoría de cobertura
// 2026-07-06): una fila por sección REAL de la navegación (Sidebar.tsx), con su
// ruta verificada contra el App Router (el test anti-404 valida cada ruta contra
// page.tsx). Responde "¿qué secciones tiene Nexus?", "¿dónde veo X?", "¿cómo
// llego a Y?" con deep-link a la página real. NO contiene datos de negocio —
// solo el mapa del sistema. Al agregar un módulo al sidebar, agregarlo acá
// (el test de paridad de rutas rompe si la ruta no existe).

export interface NexusSection {
  /** Grupo del sidebar (COCKPIT, COMPRAS, TESORERÍA…). */
  section: string;
  /** Etiqueta visible en la navegación. */
  label: string;
  /** Ruta REAL del App Router (verificada por test anti-404). */
  route: string;
  /** Sinónimos/keywords normalizados para matching (sin acentos, minúsculas). */
  keywords: string;
  // Compatibilidad RawRow (ToolSpec.resolve).
  [key: string]: string;
}

export const NEXUS_SECTIONS: NexusSection[] = [
  // ── COCKPIT ────────────────────────────────────────────────────────────────
  { section: "Cockpit", label: "Nexus Copilot", route: "/copilot", keywords: "copilot asistente ia inteligencia artificial chat" },
  { section: "Cockpit", label: "Cockpit ejecutivo", route: "/ejecutivo", keywords: "cockpit ejecutivo comando presidencial resumen general" },
  { section: "Cockpit", label: "Vacancia corporativa", route: "/comercial/dashboard-vacancia", keywords: "vacancia ocupacion capacidad cubiculos m2 disponibles" },
  { section: "Cockpit", label: "Accesos Google", route: "/workspace", keywords: "google workspace gmail drive accesos" },
  { section: "Cockpit", label: "Centro de monitoreo (CCTV)", route: "/cctv", keywords: "cctv camaras monitoreo hikvision seguridad video" },
  { section: "Cockpit", label: "Tracking de flota", route: "/operaciones/tracking", keywords: "tracking flota vehiculos gps camiones posicion mapa" },
  { section: "Cockpit", label: "Organigrama", route: "/organigrama", keywords: "organigrama jerarquia cargos personas estructura autoridades" },
  { section: "Cockpit", label: "Analytics ejecutivo", route: "/analytics", keywords: "analytics kpis financiero dashboard ejecutivo indicadores" },
  // ── NEXUS LINK ─────────────────────────────────────────────────────────────
  { section: "Nexus Link", label: "Inicio Nexus Link", route: "/connect", keywords: "nexus link mensajes comunicacion interna inicio" },
  { section: "Nexus Link", label: "Actividad", route: "/connect/actividad", keywords: "actividad feed eventos" },
  { section: "Nexus Link", label: "Notificaciones", route: "/connect/notificaciones", keywords: "notificaciones avisos alertas" },
  { section: "Nexus Link", label: "Búsqueda", route: "/connect/buscar", keywords: "busqueda buscar search" },
  { section: "Nexus Link", label: "Canales", route: "/connect/canales", keywords: "canales channels grupos" },
  { section: "Nexus Link", label: "Incidentes", route: "/connect/incidentes", keywords: "incidentes incidencias problemas reportes criticos" },
  { section: "Nexus Link", label: "Tareas", route: "/connect/tareas", keywords: "tareas pendientes asignaciones workflows" },
  // ── COMPRAS · PROVEEDORES ──────────────────────────────────────────────────
  { section: "Compras · Proveedores", label: "Dashboard compras", route: "/compras", keywords: "compras dashboard resumen" },
  { section: "Compras · Proveedores", label: "Órdenes de compra", route: "/compras/ordenes", keywords: "ordenes de compra oc orden compra purchase orders" },
  { section: "Compras · Proveedores", label: "Proveedores", route: "/compras/proveedores", keywords: "proveedores vendors proveedor" },
  { section: "Compras · Proveedores", label: "Facturas de proveedor", route: "/compras/facturas", keywords: "facturas proveedor factura compra gastos" },
  { section: "Compras · Proveedores", label: "Conciliación de OC", route: "/compras/conciliacion", keywords: "conciliacion oc factura matching" },
  { section: "Compras · Proveedores", label: "Libro IVA Compras", route: "/compras/libro-iva", keywords: "libro iva compras impuestos fiscal" },
  // ── OPERACIONES · SERVICIOS ────────────────────────────────────────────────
  { section: "Operaciones · Servicios", label: "Dashboard servicio", route: "/dashboard", keywords: "dashboard operativo servicio operaciones" },
  { section: "Operaciones · Servicios", label: "Órdenes de servicio", route: "/orders", keywords: "ordenes de servicio os orden servicio" },
  { section: "Operaciones · Servicios", label: "Clientes", route: "/clients", keywords: "clientes cliente cartera" },
  // ── WMS · DEPÓSITO ─────────────────────────────────────────────────────────
  { section: "WMS · Depósito", label: "Dashboard WMS", route: "/wms", keywords: "wms deposito almacen warehouse" },
  { section: "WMS · Depósito", label: "Inventario", route: "/wms/inventario", keywords: "inventario stock existencias posiciones" },
  { section: "WMS · Depósito", label: "Recepciones", route: "/wms/recepciones", keywords: "recepciones ingreso mercaderia" },
  { section: "WMS · Depósito", label: "Movimientos", route: "/wms/movimientos", keywords: "movimientos stock traslados" },
  { section: "WMS · Depósito", label: "Picking", route: "/wms/picking", keywords: "picking preparacion pedidos" },
  { section: "WMS · Depósito", label: "Packing", route: "/wms/packing", keywords: "packing embalaje" },
  { section: "WMS · Depósito", label: "Despachos", route: "/wms/despachos", keywords: "despachos envios salida" },
  { section: "WMS · Depósito", label: "Custodia", route: "/wms/custody", keywords: "custodia custody cadena" },
  { section: "WMS · Depósito", label: "Lotes", route: "/wms/lotes", keywords: "lotes lote partida" },
  { section: "WMS · Depósito", label: "Vencimientos WMS", route: "/wms/vencimientos", keywords: "vencimientos stock vencido caducidad" },
  // ── PEDIDOS · LOGÍSTICA ────────────────────────────────────────────────────
  { section: "Pedidos · Logística", label: "Tablero de pedidos", route: "/pedidos", keywords: "pedidos logistica tablero entregas" },
  // ── COMERCIAL · CRM ────────────────────────────────────────────────────────
  { section: "Comercial · CRM", label: "Prospección", route: "/comercial/prospeccion", keywords: "prospeccion prospectos leads linkedin" },
  { section: "Comercial · CRM", label: "Contactos", route: "/comercial/contactos", keywords: "contactos clientify crm" },
  { section: "Comercial · CRM", label: "Pipeline", route: "/comercial/pipeline", keywords: "pipeline ventas embudo deals" },
  { section: "Comercial · CRM", label: "Tablero comercial", route: "/comercial/tablero", keywords: "tablero comercial clientify kpis ventas" },
  { section: "Comercial · CRM", label: "Oportunidades", route: "/comercial/oportunidades", keywords: "oportunidades negocios deals 360" },
  { section: "Comercial · CRM", label: "Contratos", route: "/comercial/contratos", keywords: "contratos cartera contrato comercial anmat cargas" },
  { section: "Comercial · CRM", label: "Mapa Luján 3159", route: "/comercial/mapa-lujan", keywords: "mapa lujan sede pedro lujan cubiculos" },
  { section: "Comercial · CRM", label: "Mapa Magaldi 1765", route: "/comercial/mapa-magaldi", keywords: "mapa magaldi sede central cubiculos" },
  { section: "Comercial · CRM", label: "Cotizador", route: "/comercial/herramientas/cotizador", keywords: "cotizador cotizacion precios tarifas" },
  // ── COMPLIANCE ─────────────────────────────────────────────────────────────
  { section: "Compliance", label: "Compliance Cockpit", route: "/anmat", keywords: "compliance anmat habilitaciones documentos regulatorio normativa cumplimiento" },
  { section: "Compliance", label: "Drive TOPS", route: "/drive", keywords: "drive documentos archivos google corporativo" },
  // ── FACTURACIÓN ────────────────────────────────────────────────────────────
  { section: "Facturación", label: "Facturación", route: "/billing", keywords: "facturacion facturas emitidas billing ventas arca" },
  { section: "Facturación", label: "Reportes", route: "/reports", keywords: "reportes informes" },
  // ── TESORERÍA · FINANZAS ───────────────────────────────────────────────────
  { section: "Tesorería · Finanzas", label: "Resumen de tesorería", route: "/tesoreria", keywords: "tesoreria finanzas resumen" },
  { section: "Tesorería · Finanzas", label: "Bancos", route: "/tesoreria/bancos", keywords: "bancos banco santander galicia saldo cuentas caja" },
  { section: "Tesorería · Finanzas", label: "Movimientos de tesorería", route: "/tesoreria/movimientos", keywords: "movimientos tesoreria ingresos egresos" },
  { section: "Tesorería · Finanzas", label: "Cobranzas", route: "/tesoreria/cobranzas", keywords: "cobranzas cobros cuentas por cobrar" },
  { section: "Tesorería · Finanzas", label: "Pagos", route: "/tesoreria/pagos", keywords: "pagos cuentas por pagar proveedores" },
  { section: "Tesorería · Finanzas", label: "Flujo de fondos", route: "/tesoreria/flujo-fondos", keywords: "flujo de fondos cashflow proyeccion" },
  { section: "Tesorería · Finanzas", label: "Conciliación bancaria", route: "/tesoreria/conciliacion", keywords: "conciliacion bancaria extracto" },
  { section: "Tesorería · Finanzas", label: "Caja chica", route: "/tesoreria/caja-chica", keywords: "caja chica gastos menores efectivo" },
  // ── RRHH ───────────────────────────────────────────────────────────────────
  { section: "RRHH", label: "Dashboard RRHH", route: "/rrhh", keywords: "rrhh recursos humanos personal" },
  { section: "RRHH", label: "Empleados", route: "/rrhh/empleados", keywords: "empleados legajos personal" },
  { section: "RRHH", label: "Solicitudes", route: "/rrhh/solicitudes", keywords: "solicitudes licencias permisos" },
  { section: "RRHH", label: "Novedades", route: "/rrhh/novedades", keywords: "novedades rrhh" },
  { section: "RRHH", label: "Mi espacio", route: "/rrhh/mi-espacio", keywords: "mi espacio recibos personal" },
  // ── SISTEMA ────────────────────────────────────────────────────────────────
  { section: "Sistema", label: "Roles y permisos", route: "/settings/roles", keywords: "roles permisos rbac accesos" },
  { section: "Sistema", label: "Usuarios", route: "/settings/users", keywords: "usuarios cuentas invitar" },
  { section: "Sistema", label: "Comunicados", route: "/sistema/comunicados", keywords: "comunicados anuncios avisos institucionales" },
  { section: "Sistema", label: "Configuración", route: "/settings", keywords: "configuracion settings ajustes fiscal" },
];

const norm = (s: string): string =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/** Palabras vacías de las preguntas de navegación ("dónde veo las…"). */
const STOPWORDS = new Set([
  "donde", "veo", "esta", "estan", "encuentro", "miro", "como", "llego", "entro",
  "accedo", "que", "cual", "cuales", "secciones", "seccion", "modulos", "modulo",
  "tiene", "hay", "nexus", "sistema", "el", "la", "los", "las", "de", "del", "en",
  "un", "una", "a", "al", "y", "o", "es", "son", "me", "mostrame", "decime", "ver",
  // Slice A (aceptación 2026-07-07): la frase completa viaja como query — más
  // vocabulario de catálogo para que "¿qué secciones tiene Nexus y para qué
  // sirve cada una?" resuelva al MAPA completo, no a 0 filas.
  "para", "sirve", "sirven", "cada", "cuenta", "tenemos", "existen", "funciona",
]);

/** Devuelve las secciones más relevantes para la consulta. Slice A (aceptación
 *  2026-07-07): scoring por CANTIDAD de tokens matcheados — antes exigía TODOS
 *  (`every`) y una consulta multi-objetivo ("dónde veo OC, compliance y
 *  contratos") o con frase completa devolvía 0 filas. Score 0 queda afuera: el
 *  vacío honesto se mantiene para consultas sin relación real. Sin tokens
 *  útiles → mapa completo (acotado por limit). */
export function resolveNexusSections(args: Record<string, unknown>): NexusSection[] {
  const raw = typeof args.query === "string" ? norm(args.query) : "";
  const limit = typeof args.limit === "number" ? Math.max(1, Math.min(args.limit, 50)) : 30;
  const tokens = raw
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t));
  if (tokens.length === 0) return NEXUS_SECTIONS.slice(0, limit);
  const scored = NEXUS_SECTIONS.map((s) => {
    const hay = norm(`${s.section} ${s.label} ${s.keywords}`);
    return { s, score: tokens.filter((t) => hay.includes(t)).length };
  }).filter((x) => x.score > 0);
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((x) => x.s);
}
