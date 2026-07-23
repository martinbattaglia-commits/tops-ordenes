// Command center 2026-07-07 · Catálogo de sugerencias del Copilot, POR SECCIÓN
// de Nexus y CONSCIENTE DE COBERTURA.
//
// Paradigma (round "reportes ejecutivos" 2026-07-07): el Copilot NO es un
// buscador. Cada sugerencia principal dispara un REPORTE EJECUTIVO —cruce de
// áreas, KPIs, comparación de períodos, riesgos, oportunidades, gráficos y una
// DECISIÓN— no una consulta trivial ("Saldo en Santander"). El chip visible es
// corto; el prompt interno es elaborado. Cada reporte declara, además, su
// objetivo de decisión, las fuentes esperadas, los visuales y el fallback si
// faltan datos (para no sobreprometer: informe parcial + brecha específica).
//
// Regla de producto (test de cobertura, copilot-suggestions.test.ts): TODO
// prompt 'supported' rutea a una tool específica del router determinístico —
// nunca al fallback genérico (search_knowledge con la pregunta entera). Los
// prompts largos están redactados para pegar en su rama de dominio o en el
// management_brief multi-dominio.
//
// 'partial' = el dominio existe en Nexus pero el Copilot aún no tiene fuente
// conectada (brecha registrada en COPILOT_NEXUS_COVERAGE_MATRIX.md). NO se
// muestran como principales — quedan documentadas acá para la próxima fase.

// 'preview' (2026-07-08): sugerencia PREPARADA en la UI cuya fuente aún no está
// conectada (p.ej. Manual Nexus subido a Drive pero sin ingerir — C1.5). Se
// muestra, pero al ejecutarse responde una BRECHA honesta client-side (no rutea
// a una tool ni cae en "No encontré en Nexus"). Al cerrar C1.5 pasa a 'supported'.
export type SuggestionCoverage = "supported" | "partial" | "experimental" | "preview";

export interface CopilotSuggestionPrompt {
  id: string;
  /** Texto corto del chip (botón). */
  label: string;
  /** Prompt ejecutivo completo que se envía al Copilot (dispara el informe). */
  prompt: string;
  coverage: SuggestionCoverage;
  /** Reporte ejecutivo — qué DECISIÓN habilita (obligatorio en 'supported'). */
  decisionGoal?: string;
  /** Fuentes/dominios esperados del informe. */
  sources?: string[];
  /** Visuales esperados (KPIs, barras, donut, semáforo, tabla comparativa…). */
  visuals?: string[];
  /** Qué responder si faltan insumos (informe parcial + brecha, no inventar). */
  fallback?: string;
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
    description: "Informes ejecutivos multi-área, riesgos y decisiones del día.",
    coverage: "supported",
    prompts: [
      {
        id: "brief-dia",
        label: "Informe ejecutivo del día",
        prompt:
          "Armá el informe ejecutivo del día para Dirección cruzando facturación, cobranzas, contratos, compliance, compras, proveedores, vacancia, capacidad, tareas e incidentes. Mostrá los KPIs principales, los riesgos críticos, las oportunidades, los temas que requieren decisión y los próximos pasos recomendados, con fuentes.",
        coverage: "supported",
        decisionGoal: "Qué atender hoy en toda la operación, en una sola lectura.",
        sources: ["facturación", "tesorería", "contratos", "compliance", "compras", "vacancia", "operación"],
        visuals: ["resumen ejecutivo", "KPIs", "semáforo por área", "riesgos", "recomendaciones"],
        fallback: "Si un área no tiene fuente conectada, se declara como brecha y el informe sigue con el resto.",
      },
      {
        id: "riesgos-top",
        label: "Top 5 riesgos",
        prompt:
          "Identificá los 5 riesgos más importantes para la Dirección cruzando facturación, clientes, contratos, compliance, compras, tareas e incidentes. Ordenalos por impacto, urgencia y probabilidad, con la evidencia de cada uno y una recomendación concreta por riesgo.",
        coverage: "supported",
        decisionGoal: "Dónde poner el foco de mitigación esta semana.",
        sources: ["facturación", "contratos", "compliance", "operación", "compras"],
        visuals: ["ranking de riesgos", "matriz impacto/urgencia", "recomendaciones"],
        fallback: "Los dominios sin serie comparable se reportan a estado actual y se aclara.",
      },
      {
        id: "oportunidades",
        label: "Oportunidades de la semana",
        prompt:
          "Detectá las oportunidades comerciales y operativas de esta semana cruzando vacancia, capacidad disponible, contratos por vencer, clientes y estado operativo. Indicá qué oportunidad priorizar, por qué y qué acción tomar, con su evidencia.",
        coverage: "supported",
        decisionGoal: "Qué oportunidad accionar primero y con qué acción.",
        sources: ["vacancia", "contratos", "comercial", "operación"],
        visuals: ["oportunidades priorizadas", "KPIs de capacidad", "recomendaciones"],
        fallback: "Si falta la fuente de una oportunidad, se declara y no se inventa.",
      },
      {
        id: "priorizar",
        label: "Qué priorizar hoy",
        prompt:
          "¿Qué deberíamos priorizar hoy? Analizá el estado general de Nexus y proponé las decisiones gerenciales separadas en urgentes, comerciales, financieras y operativas, justificando cada una con su evidencia y su fuente.",
        coverage: "supported",
        decisionGoal: "Qué decisiones tomar hoy, ordenadas por tipo y urgencia.",
        sources: ["operación", "facturación", "tesorería", "contratos", "compliance"],
        visuals: ["decisiones por categoría", "KPIs", "recomendaciones"],
        fallback: "Las áreas sin datos se listan como 'sin datos', no se estiman.",
      },
      {
        id: "comite",
        label: "Resumen para comité",
        prompt:
          "Prepará un brief ejecutivo semanal para el comité de dirección con la evolución de ingresos, riesgos, cumplimiento, capacidad, contratos, compras y temas bloqueados. Incluí KPIs, gráficos, alertas y recomendaciones, con fuentes.",
        coverage: "supported",
        decisionGoal: "Qué llevar al comité y qué decisiones pedir.",
        sources: ["facturación", "contratos", "compliance", "vacancia", "compras", "operación"],
        visuals: ["KPIs", "gráfico de tendencia", "semáforo", "recomendaciones"],
        fallback: "La comparación entre períodos cubre facturación y gasto; el resto va a estado actual.",
      },
    ],
  },
  {
    id: "facturacion",
    title: "Facturación · Ingresos",
    icon: "💰",
    color: "#3b82f6",
    description: "Reportes de ingresos por unidad, concentración y proyección.",
    coverage: "supported",
    prompts: [
      {
        id: "por-unidad",
        label: "Facturación por unidad",
        prompt:
          "Analizá la facturación por unidad de negocio separando ANMAT y Cargas Generales: total, participación porcentual, variación contra el período anterior, clientes principales de cada unidad y recomendaciones comerciales.",
        coverage: "supported",
        decisionGoal: "Dónde crece y dónde cae cada unidad, para reasignar el foco comercial.",
        sources: ["facturación por categoría (billing)"],
        visuals: ["KPIs por unidad", "donut de participación", "tabla comparativa"],
        fallback: "La facturación sin tag de unidad se reporta 'sin clasificar', no se reparte.",
      },
      {
        id: "cierre",
        label: "Proyección de cierre",
        prompt:
          "Estimá la facturación esperada al cierre de este mes comparándola contra el mes anterior; mostrá la brecha para alcanzar el cierre, el ritmo de facturación acumulado y los riesgos para llegar al objetivo.",
        coverage: "supported",
        decisionGoal: "Si vamos a llegar al cierre del mes y cuánto falta.",
        sources: ["facturación mensual (billing últimos meses)"],
        visuals: ["KPI de proyección", "gráfico de barras m/m", "brecha al objetivo"],
        fallback: "El mes en curso es parcial: se informa como dato, no como variación cerrada.",
      },
      {
        id: "ranking",
        label: "Ranking y concentración",
        prompt:
          "Armá un ranking de clientes por facturación y analizá la concentración de ingresos: dependencia de los clientes principales, riesgo de concentración y acciones recomendadas para diversificar la cartera.",
        coverage: "supported",
        decisionGoal: "Cuán dependiente es el ingreso de pocos clientes y cómo diversificar.",
        sources: ["facturación por cliente"],
        visuals: ["ranking", "% de concentración", "tabla top clientes"],
        fallback: "El % se calcula sobre el top listado y el visual lo aclara.",
      },
      {
        id: "desvios",
        label: "Clientes con desvíos",
        prompt:
          "Detectá clientes con desvíos de facturación respecto de su histórico: altas y bajas relevantes, anomalías en el monto o la frecuencia y posibles causas a revisar con Comercial.",
        coverage: "supported",
        decisionGoal: "Qué cuentas revisar por caída o cambio de comportamiento.",
        sources: ["facturación por cliente"],
        visuals: ["KPIs", "tabla de desvíos", "tendencia por cliente"],
        fallback: "Sin serie histórica por cliente, se reporta el período disponible y se aclara.",
      },
      {
        id: "anmat-vs-cargas",
        label: "ANMAT vs Cargas Generales",
        prompt:
          "Compará ANMAT contra Cargas Generales en facturación, participación y tendencia; mostrá un cuadro comparativo con los números de cada unidad y recomendaciones comerciales para el próximo período.",
        coverage: "supported",
        decisionGoal: "Qué unidad empujar comercialmente según su peso y su tendencia.",
        sources: ["facturación por categoría"],
        visuals: ["cuadro comparativo", "donut de participación", "KPIs por unidad"],
        fallback: "La rentabilidad fina requiere costos por unidad; si faltan, se aclara y se usa facturación.",
      },
    ],
  },
  {
    id: "compras",
    title: "Compras · Proveedores",
    icon: "🛒",
    color: "#f59e0b",
    description: "Gasto por proveedor, anomalías, forecast de pagos y criticidad.",
    coverage: "supported",
    prompts: [
      {
        id: "gasto-prov",
        label: "Gasto por proveedor",
        prompt:
          "Analizá el gasto por proveedor: ranking de los mayores proveedores, participación de cada uno, concentración del gasto y oportunidades de ahorro o consolidación de compras.",
        coverage: "supported",
        decisionGoal: "Con quién se concentra el gasto y dónde negociar ahorro.",
        sources: ["gasto por proveedor"],
        visuals: ["ranking", "% de concentración", "tabla top proveedores"],
        fallback: "Sin categoría de compra, el ahorro se sugiere a nivel proveedor y se aclara.",
      },
      {
        id: "fuera-patron",
        label: "Compras fuera de patrón",
        prompt:
          "Detectá compras y facturas de proveedor fuera de patrón por monto, frecuencia o proveedor respecto de lo habitual; mostrá las alertas, la posible causa y la acción recomendada para cada una.",
        coverage: "supported",
        decisionGoal: "Qué compras auditar por comportamiento anómalo.",
        sources: ["facturas de proveedor"],
        visuals: ["tabla de alertas", "KPIs", "semáforo por anomalía"],
        fallback: "El patrón se estima con el histórico disponible; si es corto, se aclara.",
      },
      {
        id: "forecast-pagos",
        label: "Forecast de pagos",
        prompt:
          "Armá una proyección de pagos a proveedores a 30, 60 y 90 días usando las facturas de proveedor y las órdenes de compra abiertas; indicá la presión sobre la caja por período y las prioridades de pago.",
        coverage: "supported",
        decisionGoal: "Cuánto y cuándo hay que pagar, para ordenar la caja.",
        sources: ["facturas de proveedor", "órdenes de compra"],
        visuals: ["gráfico de barras 30/60/90", "KPIs de egresos", "tabla de vencimientos"],
        fallback: "Si faltan fechas de vencimiento, se proyecta con lo disponible y se declara la brecha.",
      },
      {
        id: "criticos",
        label: "Proveedores críticos",
        prompt:
          "Identificá los proveedores críticos por gasto, recurrencia, impacto operativo y dependencia; mostrá el nivel de riesgo, la categoría y un plan de acción para reducir la dependencia de los más críticos.",
        coverage: "supported",
        decisionGoal: "De qué proveedores dependemos y cómo mitigar esa dependencia.",
        sources: ["gasto por proveedor"],
        visuals: ["ranking de criticidad", "% de dependencia", "plan de acción"],
        fallback: "El impacto operativo cualitativo no está en datos; se marca para completar.",
      },
    ],
  },
  {
    id: "tesoreria",
    title: "Tesorería · Finanzas",
    icon: "🏦",
    color: "#22c55e",
    description: "Forecast de caja, liquidez y cobertura de obligaciones.",
    coverage: "supported",
    prompts: [
      {
        id: "forecast-caja",
        label: "Forecast de caja 30/60/90",
        prompt:
          "Armá un forecast de caja a 30, 60 y 90 días cruzando los saldos bancarios con los ingresos esperados, los pagos a proveedores y las compras abiertas como compromisos; mostrá el gráfico por período, los supuestos usados, las alertas de liquidez y las recomendaciones.",
        coverage: "supported",
        decisionGoal: "Si la caja alcanza a 30/60/90 y qué pagos priorizar.",
        sources: ["saldos bancarios", "compromisos (compras/OC)"],
        visuals: ["gráfico de barras 30/60/90", "KPI de saldo actual", "alertas de liquidez"],
        fallback: "Los ingresos esperados sin fecha se declaran como supuesto, no se inventan.",
      },
      {
        id: "liquidez",
        label: "Liquidez y alertas",
        prompt:
          "Analizá la situación de liquidez actual con los saldos bancarios disponibles, los ingresos esperados y los egresos próximos; marcá las alertas de liquidez y sugerí acciones concretas para sostener la caja.",
        coverage: "supported",
        decisionGoal: "Si hay margen de caja o hay que actuar ya.",
        sources: ["saldos bancarios"],
        visuals: ["KPI de saldo", "semáforo de liquidez", "tabla de egresos próximos"],
        fallback: "Ingresos y egresos futuros sin fuente conectada se declaran como brecha.",
      },
      {
        id: "caja-obligaciones",
        label: "Caja vs obligaciones",
        prompt:
          "Compará el saldo de caja disponible contra las obligaciones y compromisos próximos, incluidas las compras abiertas; indicá la cobertura, la brecha de liquidez, los vencimientos críticos y las prioridades de pago.",
        coverage: "supported",
        decisionGoal: "Cuánto cubre la caja de lo que hay que pagar y qué priorizar.",
        sources: ["saldos bancarios", "compromisos (compras/OC)"],
        visuals: ["KPI de cobertura", "gráfico caja vs obligaciones", "tabla de prioridades"],
        fallback: "Las obligaciones sin fecha cargada se listan aparte y se aclara.",
      },
    ],
  },
  {
    id: "compliance",
    title: "Compliance · ANMAT",
    icon: "🛡️",
    color: "#ef4444",
    description: "Matriz de riesgo regulatorio, clientes regulados y vencimientos.",
    coverage: "supported",
    prompts: [
      {
        id: "riesgo-anmat",
        label: "Riesgo ANMAT",
        prompt:
          "Armá una matriz de riesgo de compliance ANMAT con los documentos vencidos, por vencer y vigentes, los clientes o sedes afectadas, la criticidad de cada caso y las acciones necesarias; mostrá un semáforo y las prioridades.",
        coverage: "supported",
        decisionGoal: "Qué documentación regularizar primero por riesgo regulatorio.",
        sources: ["compliance ANMAT (pendientes/vencimientos)"],
        visuals: ["matriz de riesgo", "semáforo", "tabla de prioridades"],
        fallback: "Los casos sin fecha clave se listan como 'a revisar', no se priorizan a ciegas.",
      },
      {
        id: "clientes-regulados",
        label: "Clientes regulados en riesgo",
        prompt:
          "¿Qué clientes de productos regulados están en riesgo? Revisá el impacto documental, operativo y comercial de cada uno, con la evidencia disponible y la acción recomendada para contener cada caso.",
        coverage: "supported",
        decisionGoal: "Qué cuentas reguladas atender antes de que escale el riesgo.",
        sources: ["salud de clientes", "compliance"],
        visuals: ["tabla de clientes en riesgo", "semáforo", "acciones"],
        fallback: "El cruce fino con documentación por cliente puede faltar; se declara.",
      },
      {
        id: "vencimientos",
        label: "Próximos vencimientos",
        prompt:
          "Mostrá los próximos vencimientos de compliance, habilitaciones y documentación ANMAT ordenados por fecha; priorizá por impacto operativo y urgencia, e indicá qué gestionar primero.",
        coverage: "supported",
        decisionGoal: "Qué habilitación o documento gestionar primero para no incumplir.",
        sources: ["compliance (vencimientos)"],
        visuals: ["línea de tiempo de vencimientos", "semáforo", "tabla priorizada"],
        fallback: "Los ítems sin fecha se listan aparte para completar la fecha.",
      },
    ],
  },
  {
    id: "documentos",
    title: "Documentos · Drive",
    icon: "📁",
    color: "#14b8a6",
    description: "Documentos faltantes, mapa por sede y paquete de auditoría.",
    coverage: "supported",
    prompts: [
      {
        id: "faltantes",
        label: "Documentos faltantes",
        prompt:
          "Detectá los archivos y documentos críticos faltantes o no vinculados en Drive separados por cliente, sede y tipo documental; priorizá cuáles conseguir primero por su impacto.",
        coverage: "supported",
        decisionGoal: "Qué documentación crítica falta y a quién pedírsela.",
        sources: ["fichas documentales (Drive/compliance)"],
        visuals: ["tabla por sede/cliente", "semáforo de faltantes", "prioridad"],
        fallback: "Lo faltante se infiere de lo indexado; lo no indexado se declara como límite.",
      },
      {
        id: "mapa-sede",
        label: "Mapa documental por sede",
        prompt:
          "Armá un índice documental por sede — Magaldi y Luján — con habilitaciones, planchetas, constancias, manuales y contratos disponibles, indicando el estado y el link real cuando exista.",
        coverage: "supported",
        decisionGoal: "Qué hay y qué falta documentalmente en cada sede.",
        sources: ["fichas documentales por sede"],
        visuals: ["tabla por sede", "links reales", "semáforo de completitud"],
        fallback: "Los documentos sin URL se citan por título hasta vincularlos.",
      },
      {
        id: "auditoria",
        label: "Fuentes para auditoría",
        prompt:
          "Prepará un índice documental de fuentes para una auditoría o revisión ejecutiva: archivos de compliance con su link real, estado, vigencia y prioridad, listos para compartir.",
        coverage: "supported",
        decisionGoal: "Qué paquete de evidencia llevar a una auditoría.",
        sources: ["fichas documentales (compliance)"],
        visuals: ["tabla de fuentes", "links reales", "estado/vigencia"],
        fallback: "Si un documento no está indexado, se marca como faltante, no se inventa.",
      },
    ],
  },
  {
    id: "contratos",
    title: "Comercial · CRM",
    icon: "📈",
    color: "#eab308",
    description:
      "Pipeline de prospectos, priorización comercial y reactivación de oportunidades, más contratos (renovaciones, riesgo y vencimientos).",
    coverage: "supported",
    prompts: [
      {
        id: "pipeline-inteligente",
        label: "Pipeline inteligente",
        prompt:
          "Armá un informe ejecutivo del pipeline comercial de clientes potenciales. Cruzá prospectos, estado del CRM, origen del lead, actividad reciente, recorrido comercial, cotizaciones, servicios de interés, probabilidad de conversión, urgencia, potencial económico y próxima acción recomendada. Separá los prospectos por etapa del embudo: nuevo, contactado, calificado, recorrido realizado, cotizado, negociación, dormido y perdido. Mostrá KPIs, embudo de conversión, ranking de oportunidades y recomendaciones concretas para Comercial.",
        coverage: "supported",
        decisionGoal: "Qué prospectos atender primero y qué acción comercial corresponde tomar.",
        sources: ["CRM / prospectos", "cotizaciones", "actividad reciente", "servicios de interés"],
        visuals: [
          "KPI total de prospectos",
          "KPI prospectos calientes",
          "embudo de conversión",
          "ranking de oportunidades",
          "cards de próximos pasos",
        ],
        fallback:
          "Si faltan estados del pipeline u origen del lead, se declara la brecha y qué integrar (CRM/Clientify).",
      },
      {
        id: "prospectos-prioritarios",
        label: "Prospectos prioritarios",
        prompt:
          "Identificá los clientes potenciales con mayor potencial de revenue para Logística TOPS. Cruzá información del CRM, tipo de servicio buscado, unidad de negocio probable —ANMAT, Cargas Generales, oficinas u otros—, superficie requerida, capacidad disponible, urgencia, probabilidad de cierre, ticket potencial, compatibilidad operativa y riesgo comercial. Armá un ranking priorizado con justificación, valor estimado, acción recomendada y responsable sugerido.",
        coverage: "supported",
        decisionGoal: "Dónde enfocar la energía comercial esta semana (Dirección y Comercial).",
        sources: [
          "CRM / prospectos",
          "servicio buscado",
          "vacancia / capacidad",
          "unidad de negocio (ANMAT / Cargas Generales)",
        ],
        visuals: [
          "ranking top 10 prospectos",
          "score comercial",
          "revenue potencial estimado",
          "semáforo de prioridad",
          "gráfico por unidad de negocio",
        ],
        fallback:
          "Si falta el potencial económico o la unidad de negocio, se estima con lo disponible y se marca el dato faltante.",
      },
      {
        id: "reactivacion-comercial",
        label: "Reactivación comercial",
        prompt:
          "Detectá oportunidades comerciales dormidas, frías o perdidas que convenga reactivar. Analizá prospectos sin actividad reciente, leads que pidieron cotización y no avanzaron, clientes potenciales con recorrido realizado, oportunidades vencidas, propuestas no respondidas y prospectos compatibles con capacidad disponible actual. Priorizá por probabilidad de recuperación, valor potencial, tiempo desde último contacto, motivo probable de enfriamiento y acción recomendada. Proponé un plan de reactivación comercial con mensajes sugeridos y próximos pasos.",
        coverage: "supported",
        decisionGoal: "Qué oportunidades dormidas reactivar y con qué mensaje.",
        sources: [
          "CRM / prospectos",
          "cotizaciones sin avance",
          "actividad / último contacto",
          "vacancia / capacidad disponible",
        ],
        visuals: [
          "KPI oportunidades dormidas",
          "KPI valor potencial recuperable",
          "ranking de reactivación",
          "tabla último contacto / motivo / acción",
          "cards con mensajes sugeridos",
        ],
        fallback:
          "Si falta historial de contacto, se declara la brecha y qué registrar para mejorar el informe.",
      },
      {
        id: "renovaciones",
        label: "Renovaciones prioritarias",
        prompt:
          "Detectá los contratos próximos a vencer y priorizá las renovaciones según la facturación asociada, el cliente, el riesgo comercial y la oportunidad de renegociación; indicá por dónde empezar.",
        coverage: "supported",
        decisionGoal: "Qué renovación encarar primero para no perder ingresos.",
        sources: ["contratos (por vencer)", "facturación por cliente"],
        visuals: ["ranking de renovaciones", "línea de vencimientos", "KPIs"],
        fallback: "La facturación por contrato puede no estar vinculada; se aclara.",
      },
      {
        id: "riesgo-contractual",
        label: "Riesgo contractual",
        prompt:
          "Analizá el riesgo contractual de la cartera cruzando los contratos por vencer, la facturación asociada, la calidad documental y el estado de cada uno; rankeá por impacto.",
        coverage: "supported",
        decisionGoal: "Qué contratos vigilar por combinación de vencimiento e ingreso.",
        sources: ["contratos", "facturación por cliente"],
        visuals: ["matriz de riesgo", "ranking", "semáforo documental"],
        fallback: "La facturación por contrato, si no está vinculada, se declara como brecha.",
      },
      {
        id: "vs-operacion",
        label: "Contrato vs operación",
        prompt:
          "Compará lo pactado en los contratos vigentes contra la operación y la facturación disponible; detectá brechas, posibles ajustes de precio o superficie y oportunidades de renegociación.",
        coverage: "supported",
        decisionGoal: "Dónde el contrato y la operación no coinciden (y hay ajuste posible).",
        sources: ["contratos vigentes", "facturación", "vacancia/superficie"],
        visuals: ["tabla comparativa contrato/operación", "KPIs de brecha"],
        fallback: "El cruce fino contrato↔operación puede faltar; se marca qué dato completar.",
      },
      {
        id: "impacto-venc",
        label: "Impacto de vencimientos",
        prompt:
          "Estimá el impacto económico y operativo de los contratos que vencen próximamente: ranking por facturación en juego, riesgo de baja y recomendaciones de acción por contrato.",
        coverage: "supported",
        decisionGoal: "Cuánto ingreso está en juego por vencimientos y qué defender.",
        sources: ["contratos (por vencer)", "facturación por cliente"],
        visuals: ["ranking por impacto", "KPI de ingreso en riesgo", "línea de vencimientos"],
        fallback: "La facturación por contrato no vinculada se declara; no se estima el monto.",
      },
    ],
  },
  {
    id: "vacancia",
    title: "Vacancia · Capacidad",
    icon: "🏗️",
    color: "#f43f5e",
    description: "Capacidad vendible, simulación de ocupación y revenue por m².",
    coverage: "supported",
    prompts: [
      {
        id: "vendible",
        label: "Capacidad vendible",
        prompt:
          "Analizá la capacidad comercializable y vendible por sede, sector y tipo de servicio; estimá la oportunidad comercial y recomendá qué vender primero según la disponibilidad y la demanda.",
        coverage: "supported",
        decisionGoal: "Qué metros o servicios salir a vender primero.",
        sources: ["vacancia/capacidad (motor corporativo)"],
        visuals: ["KPIs de capacidad", "barras por sede", "tabla vendible"],
        fallback: "La demanda esperada no está en datos; se marca como supuesto comercial.",
      },
      {
        id: "simulacion",
        label: "Simulación de ocupación",
        prompt:
          "Simulá escenarios de ocupación por sede para ANMAT y Cargas Generales; estimá el impacto en facturación, la capacidad comercializable restante y la prioridad comercial de cada escenario.",
        coverage: "supported",
        decisionGoal: "Qué escenario de ocupación conviene empujar.",
        sources: ["vacancia/capacidad", "facturación (tarifa)"],
        visuals: ["escenarios comparados", "barras de ocupación", "KPIs"],
        fallback: "La facturación proyectada usa la tarifa disponible; si falta, se declara.",
      },
      {
        id: "revenue-m2",
        label: "Revenue potencial por m²",
        prompt:
          "Estimá el revenue potencial de la superficie disponible según unidad de negocio, tarifa y tipo de servicio; mostrá escenarios conservador, medio y agresivo con sus supuestos.",
        coverage: "supported",
        decisionGoal: "Cuánto ingreso adicional habilita ocupar lo disponible.",
        sources: ["vacancia (m² disponibles)", "tarifa por unidad"],
        visuals: ["KPIs por escenario", "barras conservador/medio/agresivo"],
        fallback: "Sin tarifa cargada por servicio, el escenario se declara como estimación.",
      },
      {
        id: "cubiculos",
        label: "Cubículos ANMAT",
        prompt:
          "Analizá la ocupación, la disponibilidad y la oportunidad comercial de los cubículos ANMAT; indicá clientes objetivo, el riesgo de vacancia y el revenue potencial de los que están libres.",
        coverage: "supported",
        decisionGoal: "Qué hacer con los cubículos ANMAT libres.",
        sources: ["vacancia (cubículos ANMAT)"],
        visuals: ["KPI ocupados/libres", "revenue potencial", "tabla de objetivo"],
        fallback: "Los clientes objetivo salen del CRM; si no hay match, se sugiere genérico y se aclara.",
      },
    ],
  },
  {
    id: "sistema",
    title: "Organigrama · Sistema",
    icon: "👥",
    color: "#64748b",
    description: "Responsables por área, brechas de gestión y mapa de módulos.",
    coverage: "supported",
    prompts: [
      {
        id: "responsables",
        label: "Responsables por área",
        prompt:
          "Armá un mapa ejecutivo de responsables por área, módulos y procesos de Nexus; indicá quién debería intervenir ante cada tipo de problema y dónde hay superposición o vacío de responsabilidad.",
        coverage: "supported",
        decisionGoal: "A quién escalar cada tipo de tema.",
        sources: ["organigrama", "mapa de secciones de Nexus"],
        visuals: ["mapa de responsables", "tabla área→responsable"],
        fallback: "Las áreas sin responsable cargado se marcan como vacío a definir.",
      },
      {
        id: "brechas-gestion",
        label: "Brechas de gestión",
        prompt:
          "Detectá brechas de gestión o responsabilidades difusas cruzando el organigrama con las tareas, los workflows y los incidentes; indicá dónde falta un dueño claro y qué proponer.",
        coverage: "supported",
        decisionGoal: "Dónde la falta de dueño está frenando la operación.",
        sources: ["organigrama", "tareas", "workflows", "incidentes"],
        visuals: ["tabla de brechas", "semáforo por área", "recomendaciones"],
        fallback: "El cruce con tareas e incidentes puede ser parcial; se declara el alcance.",
      },
      {
        id: "mapa-modulos",
        label: "Mapa de módulos Nexus",
        prompt:
          "¿Qué módulos tiene Nexus y cómo se conectan entre sí? Explicá qué área usa cada uno, qué datos comparten y qué decisiones permite tomar cada módulo.",
        coverage: "supported",
        decisionGoal: "Entender el sistema para saber dónde mirar cada cosa.",
        sources: ["mapa de secciones de Nexus"],
        visuals: ["mapa de módulos", "tabla módulo→área→decisión"],
        fallback: "Si un módulo no está documentado, se lista igual y se marca 'sin detalle'.",
      },
      {
        id: "ayuda-rol",
        label: "Ayuda interna por rol",
        prompt:
          "¿Qué secciones de Nexus le conviene revisar primero a cada rol de usuario según sus permisos y su flujo de trabajo? Apoyate en el manual y en el mapa de permisos.",
        coverage: "supported",
        decisionGoal: "Orientar a cada rol sobre qué mirar primero.",
        sources: ["mapa de secciones", "manual Nexus", "permisos"],
        visuals: ["tabla rol→secciones", "orden recomendado"],
        fallback: "Si el manual no cubre un rol, se responde con permisos y se aclara.",
      },
    ],
  },
  {
    // 10ª sección supported (smoke 2026-07-07): equilibra la grilla de 2 columnas
    // (9 secciones dejaban hueco abajo a la derecha) con cobertura 100% real.
    id: "salud",
    title: "Salud operativa · Riesgos",
    icon: "🚨",
    color: "#f97316",
    description: "Riesgos operativos activos, workflows trabados y novedades.",
    coverage: "supported",
    prompts: [
      {
        id: "riesgos-op",
        label: "Riesgos operativos",
        prompt:
          "Identificá los riesgos operativos activos cruzando incidentes, workflows trabados, tareas vencidas y su impacto en clientes y compliance; ordená por severidad y proponé una acción por cada riesgo.",
        coverage: "supported",
        decisionGoal: "Qué está en rojo en la operación y qué hacer ya.",
        sources: ["incidentes", "workflows", "tareas"],
        visuals: ["semáforo de riesgos", "ranking por severidad", "acciones"],
        fallback: "Los dominios sin datos se reportan 'sin novedades', no se rellenan.",
      },
      {
        id: "workflows",
        label: "Workflows trabados",
        prompt:
          "Analizá los workflows o procesos trabados: antigüedad sin actividad, área responsable, impacto operativo y la acción recomendada para destrabar cada uno; empezá por el más crítico.",
        coverage: "supported",
        decisionGoal: "Qué proceso destrabar primero.",
        sources: ["workflows trabados"],
        visuals: ["tabla por antigüedad", "semáforo", "acciones"],
        fallback: "Sin dueño de paso cargado, el workflow se marca 'a asignar'.",
      },
      {
        id: "ayer",
        label: "Qué pasó ayer",
        prompt:
          "Armá el reporte de novedades operativas de ayer: qué se movió en la operación, qué quedó pendiente y qué requiere atención hoy, con las fuentes de cada punto.",
        coverage: "supported",
        decisionGoal: "Qué cambió desde ayer y qué arrastramos a hoy.",
        sources: ["digest operativo (24-48h)"],
        visuals: ["timeline de novedades", "KPIs del día", "pendientes"],
        fallback: "Los eventos sin registrar en Nexus no aparecen; se reporta lo trazado.",
      },
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

// ── Manual Nexus · Ayuda Interna (2026-07-08) ────────────────────────────────
// Sección de ayuda interna/capacitación: cómo usar Nexus, operar módulos, seguir
// flujos y qué hace cada rol. Vive APARTE de COPILOT_SUGGESTION_SECTIONS (no es
// una sección de datos: no aplica el gate de routing ni la regla 3–5). C1.5
// CERRADO (2026-07-08): coverage 'supported' — el click rutea a la capa
// manual_nexus (17 docs del Manual ingeridos, mig 0186 aplicada) vía el intent
// manual_nexus del clasificador → company_knowledge_search(capa='manual_nexus').
export const MANUAL_NEXUS_HELP: CopilotSuggestionSection = {
  id: "manual_nexus",
  title: "Manual Nexus · Ayuda Interna",
  icon: "📖",
  color: "#6366f1",
  description: "Guías de uso, flujos, módulos, roles y pasos operativos del sistema.",
  coverage: "supported",
  prompts: [
    {
      id: "crear-oc",
      label: "Crear Orden de Compra",
      coverage: "supported",
      decisionGoal: "Cómo dar de alta una Orden de Compra, paso a paso.",
      prompt:
        "Explicame paso a paso cómo crear una Orden de Compra en Nexus usando el Manual de Usuario. Indicá el módulo correspondiente, el flujo recomendado, campos importantes, permisos necesarios, errores comunes y dónde consultar la fuente.",
    },
    {
      id: "crear-os",
      label: "Crear Orden de Servicio",
      coverage: "supported",
      decisionGoal: "Cómo crear y seguir una Orden de Servicio.",
      prompt:
        "Explicame paso a paso cómo crear o gestionar una Orden de Servicio en Nexus usando el Manual de Usuario. Indicá qué módulo se usa, qué datos se cargan, qué áreas intervienen, cómo se sigue el estado y qué recomendaciones operativas debo tener en cuenta.",
    },
    {
      id: "facturar-servicio",
      label: "Facturar un servicio",
      coverage: "supported",
      decisionGoal: "Cómo facturar un servicio desde Nexus.",
      prompt:
        "Explicame cómo usar el módulo de Facturación en Nexus para facturar un servicio. Indicá el flujo recomendado, relación con clientes, órdenes o servicios si aplica, validaciones previas, permisos necesarios y errores frecuentes.",
    },
    {
      id: "usar-wms",
      label: "Usar WMS / Depósito",
      coverage: "supported",
      decisionGoal: "Para qué sirve el WMS y qué mirar primero.",
      prompt:
        "Explicame cómo usar el módulo WMS / Depósito de Nexus. Detallá para qué sirve, qué operaciones permite, qué información muestra, cómo se relaciona con posiciones, stock, movimientos o capacidad, y qué debe mirar primero un usuario operativo.",
    },
    {
      id: "compliance-cockpit",
      label: "Compliance Cockpit",
      coverage: "supported",
      decisionGoal: "Dónde está y cómo se controla el compliance.",
      prompt:
        "Explicame dónde encuentro Compliance Cockpit, para qué sirve, qué documentos o vencimientos permite controlar, qué roles deberían usarlo y cómo interpretar sus alertas.",
    },
    {
      id: "permisos-rol",
      label: "Permisos por rol",
      coverage: "supported",
      decisionGoal: "Qué ve y qué hace cada rol en Nexus.",
      prompt:
        "Mostrame qué puede ver y hacer cada rol de usuario en Nexus según el Manual de Usuario. Armá una tabla clara por rol, módulos visibles, permisos principales y recomendaciones de uso.",
    },
    {
      id: "orden-lectura",
      label: "Orden recomendado de lectura",
      coverage: "supported",
      decisionGoal: "Por dónde empezar a aprender Nexus por rol.",
      prompt:
        "Indicame cuál es el orden recomendado para leer o aprender Nexus según el Manual de Usuario. Separalo por rol si existe información disponible: dirección, operaciones, comercial, depósito, administración, auditor.",
    },
    {
      id: "reportar-error",
      label: "Reportar un error",
      coverage: "supported",
      decisionGoal: "Cómo reportar un error o pedir soporte interno.",
      prompt:
        "Explicame cómo reportar un error o pedir soporte interno en Nexus según el Manual de Usuario. Indicá pasos, canales, información que debería incluir el usuario y buenas prácticas.",
    },
    {
      id: "mapa-modulos",
      label: "Mapa de módulos Nexus",
      coverage: "supported",
      decisionGoal: "Cómo se conectan los módulos y qué decide cada uno.",
      prompt:
        "Explicame cómo se conectan los módulos de Nexus. Armá un mapa simple de módulos, áreas responsables, decisiones que permite tomar cada módulo y relaciones entre ellos.",
    },
    {
      id: "flujo-operativo",
      label: "Flujo completo operativo",
      coverage: "supported",
      decisionGoal: "El recorrido de punta a punta dentro de Nexus.",
      prompt:
        "Explicame un flujo operativo completo dentro de Nexus, desde la necesidad o solicitud inicial hasta la operación, documentación, facturación y seguimiento. Usá el Manual de Usuario como fuente.",
    },
  ],
};

/** Sección de ayuda interna del Manual Nexus (separada del catálogo de datos). */
export function getManualNexusSection(): CopilotSuggestionSection {
  return MANUAL_NEXUS_HELP;
}
