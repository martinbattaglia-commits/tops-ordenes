// Manual de aceptación funcional del Copilot (2026-07-07).
// Fuente: Nexus_Copilot_Brief_Preguntas_por_Seccion (brief de Dirección).
// Estas 104 preguntas son el CONTRATO de aceptación: el Copilot se aprueba
// cuando las responde como copiloto de gestión (análisis, cruce, visual,
// fuentes, recomendaciones y brechas declaradas), no como buscador.
// Usado por acceptance-smoke.test.ts (runner env-gated, no corre en CI).

export type AcceptanceTipo =
  | "kpi"
  | "singular"
  | "ranking"
  | "reporte"
  | "comparacion"
  | "riesgo"
  | "oportunidad"
  | "recomendacion"
  | "documento"
  | "navegacion"
  | "diagnostico";

export interface AcceptanceQuestion {
  id: string;
  seccion: string;
  pregunta: string;
  tipo: AcceptanceTipo;
  modulos: string[];
  esperado: string;
  visualEsperado: string;
}

const S = (
  seccion: string,
  rows: Array<[string, AcceptanceTipo, string[], string, string]>
): AcceptanceQuestion[] =>
  rows.map(([pregunta, tipo, modulos, esperado, visualEsperado], i) => ({
    id: `${seccion.split(" ")[0].replace(/\./, "")}-${i + 1}`,
    seccion,
    pregunta,
    tipo,
    modulos,
    esperado,
    visualEsperado,
  }));

export const ACCEPTANCE_QUESTIONS: AcceptanceQuestion[] = [
  ...S("1. Gerencia / Cockpit ejecutivo", [
    ["Haceme un resumen ejecutivo de Nexus para hoy: indicadores sanos, indicadores en alerta y prioridades.", "reporte", ["multi"], "KPIs por dominio, top alertas, recomendaciones y fuentes", "dashboard ejecutivo"],
    ["Si mañana tengo reunión de dirección, preparame un tablero con KPIs, riesgos, oportunidades y próximos pasos.", "reporte", ["multi"], "Brief multi-dominio con visuales, riesgos priorizados y acciones", "dashboard ejecutivo"],
    ["Decime qué debería mirar primero hoy y por qué, usando solo datos de Nexus.", "recomendacion", ["multi"], "Top prioridades con impacto, urgencia y evidencia", "dashboard/alert cards"],
    ["Comparame el estado actual de Nexus contra el último período disponible: qué mejoró, qué empeoró y qué se trabó.", "comparacion", ["multi"], "Comparación por dominio, semáforos y brechas de datos", "semáforos/tabla"],
    ["Detectá los 10 riesgos más importantes que aparecen hoy en Nexus, ordenados por impacto y urgencia.", "riesgo", ["multi"], "Ranking de riesgos con evidencia y acción recomendada", "tabla de riesgos"],
    ["Preparame una lectura ejecutiva de la empresa: qué está sano, qué está en riesgo y qué oportunidad comercial aparece.", "reporte", ["multi"], "Síntesis gerencial, oportunidades y warnings", "dashboard ejecutivo"],
    ["Armame un reporte de gobernanza: fuentes incompletas, datos sin clasificar y documentos sin link real.", "diagnostico", ["multi", "drive"], "Brechas de datos/documentos y plan de limpieza", "warnings/tabla"],
    ["Haceme un tablero de salud de Nexus con indicadores por área.", "reporte", ["multi"], "Cards por área y score visual", "KPI cards + semáforos"],
  ]),
  ...S("2. Facturación / Ingresos", [
    ["Haceme un reporte ejecutivo de facturación del último mes por categoría de negocio.", "reporte", ["facturacion"], "Total, ANMAT, Cargas Generales, Sin clasificar, porcentajes y donut", "donut + tabla"],
    ["Qué unidad de negocio sostuvo la facturación del último período y qué porcentaje representó.", "kpi", ["facturacion"], "Categoría líder, porcentaje, facturas y criterio de clasificación", "KPI"],
    ["Comparame la facturación de este mes contra el mes anterior y explicame la variación.", "comparacion", ["facturacion"], "Variación %, clientes/categorías que explican el cambio", "barras comparativas"],
    ["Cuál fue el cliente que más facturó y qué peso tuvo sobre el total.", "singular", ["facturacion"], "Top 1, monto, participación, riesgo de concentración", "KPI"],
    ["Ranking de clientes por facturación con gráfico de barras y concentración del top 5.", "ranking", ["facturacion"], "Ranking, barras, % acumulado y fuentes", "barras + tabla"],
    ["Detectá facturas o clientes que distorsionan el análisis de ingresos.", "diagnostico", ["facturacion"], "Outliers, explicación y fuente", "tabla/warnings"],
    ["Qué porcentaje de ingresos quedó sin clasificar y qué clientes explican esa brecha.", "diagnostico", ["facturacion"], "Warning de calidad de datos y plan de taggeo", "KPI + warning"],
    ["Proyectá una lectura comercial a partir de facturación, contratos y vacancia.", "oportunidad", ["facturacion", "contratos", "vacancia"], "Oportunidades comerciales basadas en datos", "dashboard/insights"],
  ]),
  ...S("3. Compras / Proveedores", [
    ["Cuál fue el proveedor que más gastó el mes pasado y cuánto representó del gasto total.", "singular", ["compras"], "Top 1, monto, período, fuente y %", "KPI"],
    ["Haceme un ranking de proveedores por gasto con gráfico de barras.", "ranking", ["compras"], "Top N, barras, criterio y fuente", "barras + tabla"],
    ["Qué proveedor consume más presupuesto y qué riesgo operativo genera esa concentración.", "riesgo", ["compras"], "Análisis de concentración y recomendación", "KPI + insight"],
    ["Comparame gasto real contra órdenes de compra firmadas.", "comparacion", ["compras"], "Gasto vs compromiso por proveedor", "barras comparativas"],
    ["Detectá proveedores con aumento relevante respecto del período anterior.", "diagnostico", ["compras"], "Variación, top subas, fuentes", "tabla"],
    ["Qué órdenes de compra recientes deberían revisarse por monto, estado o proveedor.", "recomendacion", ["compras"], "Lista priorizada con semáforo", "tabla + semáforos"],
    ["Haceme un reporte de compras: OC emitidas, facturas proveedor, pendientes y alertas.", "reporte", ["compras"], "Dashboard de compras con KPIs", "dashboard"],
    ["Detectá dependencia excesiva de proveedores y sugerí mitigaciones.", "riesgo", ["compras"], "Riesgo por proveedor y acciones", "KPI + insights"],
  ]),
  ...S("4. Tesorería / Finanzas", [
    ["Haceme un reporte financiero ejecutivo con saldos bancarios, caja chica y alertas de liquidez.", "reporte", ["tesoreria"], "KPIs de bancos, caja y warnings", "KPI cards + donut"],
    ["Cuánta plata hay en Santander y qué porcentaje representa del total de fondos.", "kpi", ["tesoreria"], "KPI Santander y composición por banco", "KPI + donut"],
    ["Mostrame la composición de fondos por banco y caja con gráfico.", "reporte", ["tesoreria"], "Donut/barras por fuente de fondos", "donut"],
    ["Comparame saldo disponible contra compromisos de compras.", "comparacion", ["tesoreria", "compras"], "Liquidez vs compromisos", "barras comparativas"],
    ["Qué movimientos financieros relevantes hubo en el último período.", "reporte", ["tesoreria"], "Timeline y eventos destacados", "tabla/timeline"],
    ["Detectá posibles tensiones financieras usando saldos, compras y facturación.", "riesgo", ["tesoreria", "compras", "facturacion"], "Riesgos y recomendaciones", "alert cards"],
    ["Preparame una lectura de tesorería para dirección.", "reporte", ["tesoreria"], "Resumen ejecutivo con fuentes", "dashboard"],
    ["Qué debería mirar primero en finanzas hoy.", "recomendacion", ["tesoreria"], "Prioridades financieras", "alert cards"],
  ]),
  ...S("5. Contratos / CRM", [
    ["Mostrame los contratos vigentes como dashboard: tipo, estado, vencimientos y calidad documental.", "reporte", ["contratos"], "KPIs, donut, tabla y fuentes inline", "dashboard contractual"],
    ["Cuál fue el último contrato firmado y abrime la fuente real si existe.", "documento", ["contratos", "drive"], "Card única, fuente Drive/CRM honesta", "card documento"],
    ["Cuántos contratos están próximos a vencer y cuáles requieren atención urgente.", "kpi", ["contratos"], "KPI warning, días restantes, tabla priorizada", "KPI + tabla"],
    ["Cuántos contratos ANMAT se firmaron el último mes.", "kpi", ["contratos"], "Número principal, timeline y fuentes", "KPI"],
    ["Haceme un reporte de calidad documental de contratos: con Drive, con carpeta y sin documento vinculado.", "reporte", ["contratos", "drive"], "Distribución documental y brecha", "donut documental"],
    ["Detectá contratos con estado problemático, vencimiento cercano o falta de respaldo documental.", "riesgo", ["contratos"], "Riesgos contractuales y acciones", "tabla + semáforos"],
    ["Comparame contratos ANMAT y Cargas Generales por vigencia, vencimiento y documentación.", "comparacion", ["contratos"], "Comparativo por tipo", "tabla comparativa"],
    ["Qué clientes tienen contrato vigente pero documentación pendiente.", "diagnostico", ["contratos", "compliance"], "Cruce CRM + compliance", "tabla"],
  ]),
  ...S("6. Compliance / ANMAT", [
    ["Haceme un reporte ejecutivo de compliance por sede: score, riesgos, vencidos y próximos a vencer.", "reporte", ["compliance"], "Dashboard por sede con semáforos", "dashboard por sede"],
    ["Qué documentos están vencidos y cuáles son los más críticos.", "riesgo", ["compliance"], "KPI vencidos, orden por criticidad", "KPI + tabla"],
    ["Qué documentos de compliance están pendientes y qué riesgo generan.", "reporte", ["compliance"], "Tabla deduplicada con impacto", "tabla"],
    ["Comparame Compliance Magaldi contra Luján y decime cuál sede está más comprometida.", "comparacion", ["compliance"], "Comparativo visual por sede", "comparativo"],
    ["Preparame un plan de acción para resolver hallazgos críticos de compliance.", "recomendacion", ["compliance"], "Acciones priorizadas", "lista priorizada"],
    ["Detectá documentos repetidos, mal clasificados o con fecha dudosa.", "diagnostico", ["compliance"], "Calidad documental y brechas", "tabla/warnings"],
    ["Qué riesgos regulatorios requieren atención inmediata y por qué.", "riesgo", ["compliance"], "Ranking de riesgos", "tabla de riesgos"],
    ["Qué pasó en compliance en el último período.", "reporte", ["compliance"], "Novedades o brecha específica si no hay fuente", "timeline"],
  ]),
  ...S("7. Drive / Documentos", [
    ["Dame la habilitación de Magaldi 1765 y separá documento exacto de relacionados.", "documento", ["drive"], "Mejor coincidencia, Drive si existe, relacionados", "card documento"],
    ["Buscá la plancheta de Luján 3159 y abrime el documento si está vinculado.", "documento", ["drive"], "Documento principal o brecha de metadata", "card documento"],
    ["Haceme un reporte documental de la sede Luján: habilitaciones, planchetas y certificados.", "reporte", ["drive"], "Dashboard documental por tipo/estado", "tabla documental"],
    ["Qué documentos tienen metadata pero no archivo Drive vinculado.", "diagnostico", ["drive"], "Brecha documental con acciones", "tabla/warnings"],
    ["Mostrame documentos críticos por sede, separados entre vigentes, vencidos y sin fecha clara.", "reporte", ["drive", "compliance"], "Agrupación por sede/estado", "tabla agrupada"],
    ["Detectá falsos positivos en búsquedas documentales de habilitaciones.", "diagnostico", ["drive"], "Coincidencia exacta vs relacionados", "card + relacionados"],
    ["Qué archivos de Drive deberían vincularse a contratos o compliance.", "recomendacion", ["drive", "contratos"], "Sugerencias de vinculación", "tabla"],
    ["Preparame un índice documental por sede con fuentes reales.", "reporte", ["drive"], "Índice con links verificables", "tabla con links"],
  ]),
  ...S("8. Vacancia / Capacidad / Comercialización", [
    ["Haceme un reporte de capacidad y vacancia corporativa.", "reporte", ["vacancia"], "Capacidad, ocupado, disponible, % vacancia", "dashboard capacidad"],
    ["Cuántos metros cuadrados disponibles tenemos para Cargas Generales.", "kpi", ["vacancia"], "Número primero, contexto y fuente", "KPI"],
    ["Qué porcentaje de vacancia tenemos actualmente y qué oportunidad comercial representa.", "oportunidad", ["vacancia"], "KPI, progress, recomendación", "KPI + insight"],
    ["Cuántos cubículos ANMAT están alquilados, disponibles y totales.", "kpi", ["vacancia"], "KPI puntual y método de cálculo", "KPI"],
    ["Comparame disponibilidad ANMAT contra Cargas Generales.", "comparacion", ["vacancia"], "Distribución por unidad", "barras"],
    ["Qué capacidad ociosa deberíamos priorizar comercialmente.", "oportunidad", ["vacancia"], "Oportunidad por espacio/sede", "KPI + insight"],
    ["Haceme un tablero de ocupación por sede y unidad de negocio.", "reporte", ["vacancia"], "KPIs y barras", "dashboard"],
    ["Qué espacios disponibles pueden transformarse en oportunidad de venta.", "oportunidad", ["vacancia"], "Recomendación comercial", "insights"],
  ]),
  ...S("9. Operación / Workflows / Tareas", [
    ["Qué workflows están trabados y desde cuándo.", "kpi", ["operacion"], "KPI, días sin actividad, semáforo", "tabla"],
    ["Qué pasó ayer en la operación, explicado en lenguaje ejecutivo.", "reporte", ["operacion"], "Timeline, eventos traducidos, fuente", "timeline"],
    ["Qué tareas están vencidas y cuáles bloquean procesos.", "reporte", ["operacion"], "Tabla priorizada por urgencia", "tabla"],
    ["Haceme un tablero operativo con incidentes, tareas, workflows y alertas.", "reporte", ["operacion"], "Dashboard operativo", "dashboard"],
    ["Qué debería mirar primero mañana en operaciones.", "recomendacion", ["operacion"], "Prioridades accionables", "alert cards"],
    ["Detectá procesos sin actividad reciente y sugerí próximos pasos.", "recomendacion", ["operacion"], "Workflow stuck + acción", "tabla + insights"],
    ["Qué incidentes críticos están abiertos y qué impacto tienen.", "riesgo", ["operacion"], "KPI y riesgo", "KPI + tabla"],
    ["Comparame operación de hoy contra ayer si hay datos.", "comparacion", ["operacion"], "Tendencia o brecha si falta fuente", "comparativo"],
  ]),
  ...S("10. WMS / Depósito / Stock", [
    ["Haceme un reporte de ocupación de depósitos y posiciones disponibles.", "reporte", ["wms"], "Disponibilidad, ocupación, sectores", "dashboard"],
    ["Qué sectores tienen mayor ocupación y cuáles están subutilizados.", "ranking", ["wms"], "Ranking por sector", "barras"],
    ["Qué disponibilidad hay por depósito y por unidad de negocio.", "reporte", ["wms", "vacancia"], "Dashboard por sede", "dashboard"],
    ["Detectá oportunidades de almacenamiento disponibles.", "oportunidad", ["wms", "vacancia"], "Capacidad comercializable", "insights"],
    ["Hay vencimientos ANMAT o productos sensibles próximos.", "riesgo", ["wms"], "Listado crítico por urgencia", "tabla"],
    ["Qué posiciones o ubicaciones requieren atención.", "diagnostico", ["wms"], "Alertas WMS", "tabla"],
    ["Comparame disponibilidad entre depósitos.", "comparacion", ["wms"], "Comparativo por sede", "barras"],
    ["Preparame una lectura WMS para comercial y operaciones.", "reporte", ["wms"], "Resumen con acciones", "dashboard"],
  ]),
  ...S("11. Comercial / Clientes / CRM", [
    ["Haceme un reporte comercial de clientes activos, facturación, contratos y documentación.", "reporte", ["crm", "facturacion", "contratos"], "Visión cliente 360", "dashboard"],
    ["Detectá clientes estratégicos usando facturación, contratos y ocupación.", "diagnostico", ["crm", "facturacion", "contratos", "vacancia"], "Ranking y recomendaciones", "tabla + insights"],
    ["Qué clientes deberían contactarse esta semana y por qué.", "recomendacion", ["crm"], "Prioridad comercial", "lista priorizada"],
    ["Comparame clientes ANMAT contra Cargas Generales.", "comparacion", ["crm", "facturacion"], "Ingresos, contratos, compliance", "comparativo"],
    ["Qué clientes tienen riesgo documental o contractual.", "riesgo", ["crm", "contratos", "compliance"], "Cruce CRM + compliance", "tabla"],
    ["Qué oportunidades comerciales aparecen por vacancia disponible.", "oportunidad", ["crm", "vacancia"], "Oportunidades por sede/unidad", "insights"],
    ["Qué clientes concentran facturación y qué riesgo genera.", "riesgo", ["crm", "facturacion"], "Concentración comercial", "KPI + insight"],
    ["Preparame un pipeline ejecutivo con próximos pasos comerciales.", "reporte", ["crm"], "Resumen y acciones", "dashboard"],
  ]),
  ...S("12. Organigrama / Sistema / Navegación", [
    ["Quién es el presidente de Logística TOPS y qué rol ocupa.", "singular", ["organigrama"], "Respuesta singular con fuente", "texto compacto"],
    ["Quién está a cargo de operaciones y qué áreas dependen de esa función.", "singular", ["organigrama"], "Responsable y contexto", "texto compacto"],
    ["Qué secciones tiene Nexus y para qué sirve cada una.", "navegacion", ["sistema"], "Mapa funcional", "lista con links"],
    ["Dónde veo órdenes de compra, compliance y contratos.", "navegacion", ["sistema"], "Rutas reales y links", "lista con links"],
    ["Qué módulos de Nexus tienen cobertura completa del Copilot y cuáles son brecha.", "diagnostico", ["sistema"], "Matriz de cobertura", "tabla"],
    ["Qué fuentes usa Copilot para responder cada módulo.", "diagnostico", ["sistema"], "Fuentes por dominio", "tabla"],
    ["Qué datos faltan para que el Copilot pueda responder mejor.", "diagnostico", ["sistema"], "Brechas del sistema", "warnings"],
    ["Preparame un mapa ejecutivo de áreas, responsables y módulos.", "reporte", ["organigrama", "sistema"], "Organigrama + sistemas", "tabla"],
  ]),
  ...S("13. Preguntas inter-dominio / Directorio", [
    ["Si mañana tengo reunión de dirección, preparame el resumen ejecutivo de Nexus con KPIs, alertas, riesgos, oportunidades y recomendaciones.", "reporte", ["multi"], "Management brief completo", "dashboard ejecutivo"],
    ["Haceme un informe ejecutivo usando facturación, tesorería, contratos, compliance, vacancia y operación.", "reporte", ["multi"], "Orquestación multi-dominio", "dashboard ejecutivo"],
    ["Cuáles son los 10 riesgos más importantes de Nexus hoy, ordenados por impacto y urgencia.", "riesgo", ["multi"], "Risk ranking con evidencia", "tabla de riesgos"],
    ["Qué decisiones recomendarías tomar esta semana basadas solo en datos de Nexus.", "recomendacion", ["multi"], "5 acciones concretas", "lista priorizada"],
    ["Qué está sano, qué está en riesgo, qué está trabado y qué oportunidad comercial aparece.", "reporte", ["multi"], "Lectura gerencial", "dashboard ejecutivo"],
    ["Cruzá clientes, contratos, facturación y compliance para detectar clientes estratégicos o en riesgo.", "diagnostico", ["multi"], "Cliente 360 con alertas", "tabla"],
    ["Compará ingresos, gastos, saldos, contratos y vacancia para detectar tensión o oportunidad.", "comparacion", ["multi"], "Análisis financiero-operativo", "dashboard"],
    ["Preparame un tablero para comité: negocio, finanzas, riesgo, operación y próximos pasos.", "reporte", ["multi"], "Board pack ejecutivo", "dashboard ejecutivo"],
  ]),
];
