# Copilot · Matriz de preguntas de aceptación

Fuente: `Nexus_Copilot_Brief_Preguntas_por_Seccion` (brief de Dirección, julio 2026).
Este documento es el CONTRATO de aceptación funcional del Copilot: no es una lista decorativa.
Preguntas: 104. Regenerada por acceptance-smoke.test.ts.

| # | Sección | Pregunta | Intención | Módulos | Resultado esperado | Visual esperado |
|---|---------|----------|-----------|---------|--------------------|-----------------|
| 1-1 | 1. Gerencia / Cockpit ejecutivo | Haceme un resumen ejecutivo de Nexus para hoy: indicadores sanos, indicadores en alerta y prioridades. | reporte | multi | KPIs por dominio, top alertas, recomendaciones y fuentes | dashboard ejecutivo |
| 1-2 | 1. Gerencia / Cockpit ejecutivo | Si mañana tengo reunión de dirección, preparame un tablero con KPIs, riesgos, oportunidades y próximos pasos. | reporte | multi | Brief multi-dominio con visuales, riesgos priorizados y acciones | dashboard ejecutivo |
| 1-3 | 1. Gerencia / Cockpit ejecutivo | Decime qué debería mirar primero hoy y por qué, usando solo datos de Nexus. | recomendacion | multi | Top prioridades con impacto, urgencia y evidencia | dashboard/alert cards |
| 1-4 | 1. Gerencia / Cockpit ejecutivo | Comparame el estado actual de Nexus contra el último período disponible: qué mejoró, qué empeoró y qué se trabó. | comparacion | multi | Comparación por dominio, semáforos y brechas de datos | semáforos/tabla |
| 1-5 | 1. Gerencia / Cockpit ejecutivo | Detectá los 10 riesgos más importantes que aparecen hoy en Nexus, ordenados por impacto y urgencia. | riesgo | multi | Ranking de riesgos con evidencia y acción recomendada | tabla de riesgos |
| 1-6 | 1. Gerencia / Cockpit ejecutivo | Preparame una lectura ejecutiva de la empresa: qué está sano, qué está en riesgo y qué oportunidad comercial aparece. | reporte | multi | Síntesis gerencial, oportunidades y warnings | dashboard ejecutivo |
| 1-7 | 1. Gerencia / Cockpit ejecutivo | Armame un reporte de gobernanza: fuentes incompletas, datos sin clasificar y documentos sin link real. | diagnostico | multi, drive | Brechas de datos/documentos y plan de limpieza | warnings/tabla |
| 1-8 | 1. Gerencia / Cockpit ejecutivo | Haceme un tablero de salud de Nexus con indicadores por área. | reporte | multi | Cards por área y score visual | KPI cards + semáforos |
| 2-1 | 2. Facturación / Ingresos | Haceme un reporte ejecutivo de facturación del último mes por categoría de negocio. | reporte | facturacion | Total, ANMAT, Cargas Generales, Sin clasificar, porcentajes y donut | donut + tabla |
| 2-2 | 2. Facturación / Ingresos | Qué unidad de negocio sostuvo la facturación del último período y qué porcentaje representó. | kpi | facturacion | Categoría líder, porcentaje, facturas y criterio de clasificación | KPI |
| 2-3 | 2. Facturación / Ingresos | Comparame la facturación de este mes contra el mes anterior y explicame la variación. | comparacion | facturacion | Variación %, clientes/categorías que explican el cambio | barras comparativas |
| 2-4 | 2. Facturación / Ingresos | Cuál fue el cliente que más facturó y qué peso tuvo sobre el total. | singular | facturacion | Top 1, monto, participación, riesgo de concentración | KPI |
| 2-5 | 2. Facturación / Ingresos | Ranking de clientes por facturación con gráfico de barras y concentración del top 5. | ranking | facturacion | Ranking, barras, % acumulado y fuentes | barras + tabla |
| 2-6 | 2. Facturación / Ingresos | Detectá facturas o clientes que distorsionan el análisis de ingresos. | diagnostico | facturacion | Outliers, explicación y fuente | tabla/warnings |
| 2-7 | 2. Facturación / Ingresos | Qué porcentaje de ingresos quedó sin clasificar y qué clientes explican esa brecha. | diagnostico | facturacion | Warning de calidad de datos y plan de taggeo | KPI + warning |
| 2-8 | 2. Facturación / Ingresos | Proyectá una lectura comercial a partir de facturación, contratos y vacancia. | oportunidad | facturacion, contratos, vacancia | Oportunidades comerciales basadas en datos | dashboard/insights |
| 3-1 | 3. Compras / Proveedores | Cuál fue el proveedor que más gastó el mes pasado y cuánto representó del gasto total. | singular | compras | Top 1, monto, período, fuente y % | KPI |
| 3-2 | 3. Compras / Proveedores | Haceme un ranking de proveedores por gasto con gráfico de barras. | ranking | compras | Top N, barras, criterio y fuente | barras + tabla |
| 3-3 | 3. Compras / Proveedores | Qué proveedor consume más presupuesto y qué riesgo operativo genera esa concentración. | riesgo | compras | Análisis de concentración y recomendación | KPI + insight |
| 3-4 | 3. Compras / Proveedores | Comparame gasto real contra órdenes de compra firmadas. | comparacion | compras | Gasto vs compromiso por proveedor | barras comparativas |
| 3-5 | 3. Compras / Proveedores | Detectá proveedores con aumento relevante respecto del período anterior. | diagnostico | compras | Variación, top subas, fuentes | tabla |
| 3-6 | 3. Compras / Proveedores | Qué órdenes de compra recientes deberían revisarse por monto, estado o proveedor. | recomendacion | compras | Lista priorizada con semáforo | tabla + semáforos |
| 3-7 | 3. Compras / Proveedores | Haceme un reporte de compras: OC emitidas, facturas proveedor, pendientes y alertas. | reporte | compras | Dashboard de compras con KPIs | dashboard |
| 3-8 | 3. Compras / Proveedores | Detectá dependencia excesiva de proveedores y sugerí mitigaciones. | riesgo | compras | Riesgo por proveedor y acciones | KPI + insights |
| 4-1 | 4. Tesorería / Finanzas | Haceme un reporte financiero ejecutivo con saldos bancarios, caja chica y alertas de liquidez. | reporte | tesoreria | KPIs de bancos, caja y warnings | KPI cards + donut |
| 4-2 | 4. Tesorería / Finanzas | Cuánta plata hay en Santander y qué porcentaje representa del total de fondos. | kpi | tesoreria | KPI Santander y composición por banco | KPI + donut |
| 4-3 | 4. Tesorería / Finanzas | Mostrame la composición de fondos por banco y caja con gráfico. | reporte | tesoreria | Donut/barras por fuente de fondos | donut |
| 4-4 | 4. Tesorería / Finanzas | Comparame saldo disponible contra compromisos de compras. | comparacion | tesoreria, compras | Liquidez vs compromisos | barras comparativas |
| 4-5 | 4. Tesorería / Finanzas | Qué movimientos financieros relevantes hubo en el último período. | reporte | tesoreria | Timeline y eventos destacados | tabla/timeline |
| 4-6 | 4. Tesorería / Finanzas | Detectá posibles tensiones financieras usando saldos, compras y facturación. | riesgo | tesoreria, compras, facturacion | Riesgos y recomendaciones | alert cards |
| 4-7 | 4. Tesorería / Finanzas | Preparame una lectura de tesorería para dirección. | reporte | tesoreria | Resumen ejecutivo con fuentes | dashboard |
| 4-8 | 4. Tesorería / Finanzas | Qué debería mirar primero en finanzas hoy. | recomendacion | tesoreria | Prioridades financieras | alert cards |
| 5-1 | 5. Contratos / CRM | Mostrame los contratos vigentes como dashboard: tipo, estado, vencimientos y calidad documental. | reporte | contratos | KPIs, donut, tabla y fuentes inline | dashboard contractual |
| 5-2 | 5. Contratos / CRM | Cuál fue el último contrato firmado y abrime la fuente real si existe. | documento | contratos, drive | Card única, fuente Drive/CRM honesta | card documento |
| 5-3 | 5. Contratos / CRM | Cuántos contratos están próximos a vencer y cuáles requieren atención urgente. | kpi | contratos | KPI warning, días restantes, tabla priorizada | KPI + tabla |
| 5-4 | 5. Contratos / CRM | Cuántos contratos ANMAT se firmaron el último mes. | kpi | contratos | Número principal, timeline y fuentes | KPI |
| 5-5 | 5. Contratos / CRM | Haceme un reporte de calidad documental de contratos: con Drive, con carpeta y sin documento vinculado. | reporte | contratos, drive | Distribución documental y brecha | donut documental |
| 5-6 | 5. Contratos / CRM | Detectá contratos con estado problemático, vencimiento cercano o falta de respaldo documental. | riesgo | contratos | Riesgos contractuales y acciones | tabla + semáforos |
| 5-7 | 5. Contratos / CRM | Comparame contratos ANMAT y Cargas Generales por vigencia, vencimiento y documentación. | comparacion | contratos | Comparativo por tipo | tabla comparativa |
| 5-8 | 5. Contratos / CRM | Qué clientes tienen contrato vigente pero documentación pendiente. | diagnostico | contratos, compliance | Cruce CRM + compliance | tabla |
| 6-1 | 6. Compliance / ANMAT | Haceme un reporte ejecutivo de compliance por sede: score, riesgos, vencidos y próximos a vencer. | reporte | compliance | Dashboard por sede con semáforos | dashboard por sede |
| 6-2 | 6. Compliance / ANMAT | Qué documentos están vencidos y cuáles son los más críticos. | riesgo | compliance | KPI vencidos, orden por criticidad | KPI + tabla |
| 6-3 | 6. Compliance / ANMAT | Qué documentos de compliance están pendientes y qué riesgo generan. | reporte | compliance | Tabla deduplicada con impacto | tabla |
| 6-4 | 6. Compliance / ANMAT | Comparame Compliance Magaldi contra Luján y decime cuál sede está más comprometida. | comparacion | compliance | Comparativo visual por sede | comparativo |
| 6-5 | 6. Compliance / ANMAT | Preparame un plan de acción para resolver hallazgos críticos de compliance. | recomendacion | compliance | Acciones priorizadas | lista priorizada |
| 6-6 | 6. Compliance / ANMAT | Detectá documentos repetidos, mal clasificados o con fecha dudosa. | diagnostico | compliance | Calidad documental y brechas | tabla/warnings |
| 6-7 | 6. Compliance / ANMAT | Qué riesgos regulatorios requieren atención inmediata y por qué. | riesgo | compliance | Ranking de riesgos | tabla de riesgos |
| 6-8 | 6. Compliance / ANMAT | Qué pasó en compliance en el último período. | reporte | compliance | Novedades o brecha específica si no hay fuente | timeline |
| 7-1 | 7. Drive / Documentos | Dame la habilitación de Magaldi 1765 y separá documento exacto de relacionados. | documento | drive | Mejor coincidencia, Drive si existe, relacionados | card documento |
| 7-2 | 7. Drive / Documentos | Buscá la plancheta de Luján 3159 y abrime el documento si está vinculado. | documento | drive | Documento principal o brecha de metadata | card documento |
| 7-3 | 7. Drive / Documentos | Haceme un reporte documental de la sede Luján: habilitaciones, planchetas y certificados. | reporte | drive | Dashboard documental por tipo/estado | tabla documental |
| 7-4 | 7. Drive / Documentos | Qué documentos tienen metadata pero no archivo Drive vinculado. | diagnostico | drive | Brecha documental con acciones | tabla/warnings |
| 7-5 | 7. Drive / Documentos | Mostrame documentos críticos por sede, separados entre vigentes, vencidos y sin fecha clara. | reporte | drive, compliance | Agrupación por sede/estado | tabla agrupada |
| 7-6 | 7. Drive / Documentos | Detectá falsos positivos en búsquedas documentales de habilitaciones. | diagnostico | drive | Coincidencia exacta vs relacionados | card + relacionados |
| 7-7 | 7. Drive / Documentos | Qué archivos de Drive deberían vincularse a contratos o compliance. | recomendacion | drive, contratos | Sugerencias de vinculación | tabla |
| 7-8 | 7. Drive / Documentos | Preparame un índice documental por sede con fuentes reales. | reporte | drive | Índice con links verificables | tabla con links |
| 8-1 | 8. Vacancia / Capacidad / Comercialización | Haceme un reporte de capacidad y vacancia corporativa. | reporte | vacancia | Capacidad, ocupado, disponible, % vacancia | dashboard capacidad |
| 8-2 | 8. Vacancia / Capacidad / Comercialización | Cuántos metros cuadrados disponibles tenemos para Cargas Generales. | kpi | vacancia | Número primero, contexto y fuente | KPI |
| 8-3 | 8. Vacancia / Capacidad / Comercialización | Qué porcentaje de vacancia tenemos actualmente y qué oportunidad comercial representa. | oportunidad | vacancia | KPI, progress, recomendación | KPI + insight |
| 8-4 | 8. Vacancia / Capacidad / Comercialización | Cuántos cubículos ANMAT están alquilados, disponibles y totales. | kpi | vacancia | KPI puntual y método de cálculo | KPI |
| 8-5 | 8. Vacancia / Capacidad / Comercialización | Comparame disponibilidad ANMAT contra Cargas Generales. | comparacion | vacancia | Distribución por unidad | barras |
| 8-6 | 8. Vacancia / Capacidad / Comercialización | Qué capacidad ociosa deberíamos priorizar comercialmente. | oportunidad | vacancia | Oportunidad por espacio/sede | KPI + insight |
| 8-7 | 8. Vacancia / Capacidad / Comercialización | Haceme un tablero de ocupación por sede y unidad de negocio. | reporte | vacancia | KPIs y barras | dashboard |
| 8-8 | 8. Vacancia / Capacidad / Comercialización | Qué espacios disponibles pueden transformarse en oportunidad de venta. | oportunidad | vacancia | Recomendación comercial | insights |
| 9-1 | 9. Operación / Workflows / Tareas | Qué workflows están trabados y desde cuándo. | kpi | operacion | KPI, días sin actividad, semáforo | tabla |
| 9-2 | 9. Operación / Workflows / Tareas | Qué pasó ayer en la operación, explicado en lenguaje ejecutivo. | reporte | operacion | Timeline, eventos traducidos, fuente | timeline |
| 9-3 | 9. Operación / Workflows / Tareas | Qué tareas están vencidas y cuáles bloquean procesos. | reporte | operacion | Tabla priorizada por urgencia | tabla |
| 9-4 | 9. Operación / Workflows / Tareas | Haceme un tablero operativo con incidentes, tareas, workflows y alertas. | reporte | operacion | Dashboard operativo | dashboard |
| 9-5 | 9. Operación / Workflows / Tareas | Qué debería mirar primero mañana en operaciones. | recomendacion | operacion | Prioridades accionables | alert cards |
| 9-6 | 9. Operación / Workflows / Tareas | Detectá procesos sin actividad reciente y sugerí próximos pasos. | recomendacion | operacion | Workflow stuck + acción | tabla + insights |
| 9-7 | 9. Operación / Workflows / Tareas | Qué incidentes críticos están abiertos y qué impacto tienen. | riesgo | operacion | KPI y riesgo | KPI + tabla |
| 9-8 | 9. Operación / Workflows / Tareas | Comparame operación de hoy contra ayer si hay datos. | comparacion | operacion | Tendencia o brecha si falta fuente | comparativo |
| 10-1 | 10. WMS / Depósito / Stock | Haceme un reporte de ocupación de depósitos y posiciones disponibles. | reporte | wms | Disponibilidad, ocupación, sectores | dashboard |
| 10-2 | 10. WMS / Depósito / Stock | Qué sectores tienen mayor ocupación y cuáles están subutilizados. | ranking | wms | Ranking por sector | barras |
| 10-3 | 10. WMS / Depósito / Stock | Qué disponibilidad hay por depósito y por unidad de negocio. | reporte | wms, vacancia | Dashboard por sede | dashboard |
| 10-4 | 10. WMS / Depósito / Stock | Detectá oportunidades de almacenamiento disponibles. | oportunidad | wms, vacancia | Capacidad comercializable | insights |
| 10-5 | 10. WMS / Depósito / Stock | Hay vencimientos ANMAT o productos sensibles próximos. | riesgo | wms | Listado crítico por urgencia | tabla |
| 10-6 | 10. WMS / Depósito / Stock | Qué posiciones o ubicaciones requieren atención. | diagnostico | wms | Alertas WMS | tabla |
| 10-7 | 10. WMS / Depósito / Stock | Comparame disponibilidad entre depósitos. | comparacion | wms | Comparativo por sede | barras |
| 10-8 | 10. WMS / Depósito / Stock | Preparame una lectura WMS para comercial y operaciones. | reporte | wms | Resumen con acciones | dashboard |
| 11-1 | 11. Comercial / Clientes / CRM | Haceme un reporte comercial de clientes activos, facturación, contratos y documentación. | reporte | crm, facturacion, contratos | Visión cliente 360 | dashboard |
| 11-2 | 11. Comercial / Clientes / CRM | Detectá clientes estratégicos usando facturación, contratos y ocupación. | diagnostico | crm, facturacion, contratos, vacancia | Ranking y recomendaciones | tabla + insights |
| 11-3 | 11. Comercial / Clientes / CRM | Qué clientes deberían contactarse esta semana y por qué. | recomendacion | crm | Prioridad comercial | lista priorizada |
| 11-4 | 11. Comercial / Clientes / CRM | Comparame clientes ANMAT contra Cargas Generales. | comparacion | crm, facturacion | Ingresos, contratos, compliance | comparativo |
| 11-5 | 11. Comercial / Clientes / CRM | Qué clientes tienen riesgo documental o contractual. | riesgo | crm, contratos, compliance | Cruce CRM + compliance | tabla |
| 11-6 | 11. Comercial / Clientes / CRM | Qué oportunidades comerciales aparecen por vacancia disponible. | oportunidad | crm, vacancia | Oportunidades por sede/unidad | insights |
| 11-7 | 11. Comercial / Clientes / CRM | Qué clientes concentran facturación y qué riesgo genera. | riesgo | crm, facturacion | Concentración comercial | KPI + insight |
| 11-8 | 11. Comercial / Clientes / CRM | Preparame un pipeline ejecutivo con próximos pasos comerciales. | reporte | crm | Resumen y acciones | dashboard |
| 12-1 | 12. Organigrama / Sistema / Navegación | Quién es el presidente de Logística TOPS y qué rol ocupa. | singular | organigrama | Respuesta singular con fuente | texto compacto |
| 12-2 | 12. Organigrama / Sistema / Navegación | Quién está a cargo de operaciones y qué áreas dependen de esa función. | singular | organigrama | Responsable y contexto | texto compacto |
| 12-3 | 12. Organigrama / Sistema / Navegación | Qué secciones tiene Nexus y para qué sirve cada una. | navegacion | sistema | Mapa funcional | lista con links |
| 12-4 | 12. Organigrama / Sistema / Navegación | Dónde veo órdenes de compra, compliance y contratos. | navegacion | sistema | Rutas reales y links | lista con links |
| 12-5 | 12. Organigrama / Sistema / Navegación | Qué módulos de Nexus tienen cobertura completa del Copilot y cuáles son brecha. | diagnostico | sistema | Matriz de cobertura | tabla |
| 12-6 | 12. Organigrama / Sistema / Navegación | Qué fuentes usa Copilot para responder cada módulo. | diagnostico | sistema | Fuentes por dominio | tabla |
| 12-7 | 12. Organigrama / Sistema / Navegación | Qué datos faltan para que el Copilot pueda responder mejor. | diagnostico | sistema | Brechas del sistema | warnings |
| 12-8 | 12. Organigrama / Sistema / Navegación | Preparame un mapa ejecutivo de áreas, responsables y módulos. | reporte | organigrama, sistema | Organigrama + sistemas | tabla |
| 13-1 | 13. Preguntas inter-dominio / Directorio | Si mañana tengo reunión de dirección, preparame el resumen ejecutivo de Nexus con KPIs, alertas, riesgos, oportunidades y recomendaciones. | reporte | multi | Management brief completo | dashboard ejecutivo |
| 13-2 | 13. Preguntas inter-dominio / Directorio | Haceme un informe ejecutivo usando facturación, tesorería, contratos, compliance, vacancia y operación. | reporte | multi | Orquestación multi-dominio | dashboard ejecutivo |
| 13-3 | 13. Preguntas inter-dominio / Directorio | Cuáles son los 10 riesgos más importantes de Nexus hoy, ordenados por impacto y urgencia. | riesgo | multi | Risk ranking con evidencia | tabla de riesgos |
| 13-4 | 13. Preguntas inter-dominio / Directorio | Qué decisiones recomendarías tomar esta semana basadas solo en datos de Nexus. | recomendacion | multi | 5 acciones concretas | lista priorizada |
| 13-5 | 13. Preguntas inter-dominio / Directorio | Qué está sano, qué está en riesgo, qué está trabado y qué oportunidad comercial aparece. | reporte | multi | Lectura gerencial | dashboard ejecutivo |
| 13-6 | 13. Preguntas inter-dominio / Directorio | Cruzá clientes, contratos, facturación y compliance para detectar clientes estratégicos o en riesgo. | diagnostico | multi | Cliente 360 con alertas | tabla |
| 13-7 | 13. Preguntas inter-dominio / Directorio | Compará ingresos, gastos, saldos, contratos y vacancia para detectar tensión o oportunidad. | comparacion | multi | Análisis financiero-operativo | dashboard |
| 13-8 | 13. Preguntas inter-dominio / Directorio | Preparame un tablero para comité: negocio, finanzas, riesgo, operación y próximos pasos. | reporte | multi | Board pack ejecutivo | dashboard ejecutivo |
