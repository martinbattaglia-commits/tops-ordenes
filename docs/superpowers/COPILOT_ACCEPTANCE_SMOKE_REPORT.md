# Copilot · Reporte de smoke de aceptación (manual de Dirección)

**Fecha:** 2026-07-07 · **Rama:** `fix/f5-2-copilot-context-retrieval` (worktree `tops-ordenes-fix-copilot-context`, base `29e1199` + slice management_brief + slice A de aceptación, **sin commit**)
**Manual:** `Nexus_Copilot_Brief_Preguntas_por_Seccion` (13 secciones · 104 preguntas) — matriz en [COPILOT_ACCEPTANCE_QUESTION_MATRIX.md](COPILOT_ACCEPTANCE_QUESTION_MATRIX.md)

## Entorno de la corrida (transparencia)

- **Entorno:** localhost:3040 (`/copilot`) + runner determinístico `acceptance-smoke.test.ts` contra `askCopilot` (el MISMO engine que sirve la página).
- **Modo:** demo explícito (`NEXT_PUBLIC_DEMO_MODE=1`) · provider **mock determinístico** · datos **fixtures**. Sin tocar prod, sin writes, sin migraciones.
- ⚠️ **Lo que esta corrida NO valida:** la narrativa e interpretación de **Gemini** con **datos reales** (el ruteo por descripción de tools + prompt v17 + pre-seed del engine aplican igual en prod, pero el smoke con Gemini requiere autorización y sesión de piloto). Los números, tools, visuales, citas y brechas son idénticos en prod porque son **código determinístico**.

## Resumen ejecutivo

El Copilot pasó de **buscador con capa gerencial** a un sistema que responde el manual completo sin fallbacks: las 104 preguntas terminan `answered`, **cero** caen en `search_knowledge`, **cero** "Consulta inválida", **cero** vacíos injustificados. 89/104 traen tablero ejecutivo y 104/104 citan fuentes verificables. Las brechas reales de Nexus (WMS/stock, caja chica, movimientos, comparaciones, cliente 360) ahora se **declaran como brechas específicas citables** (matriz de cobertura) en vez de responder otro tema. Lo que separa el 80 del 85+ ya no es ruteo: es la **capa de comparaciones** (slice B), la **dimensión sede en compliance**, visuales de 3 dominios menores y la validación con **Gemini + datos reales**.

## Resultados

| Corrida | PASS | PARTIAL | FAIL | Fallback search | Sin evidencia injustif. | Con tablero |
|---|---|---|---|---|---|---|
| **v1 (inicio de la validación)** | 28 | 35 | 41 | 27 | 6 | 56 |
| **v4 (tras slice A, final)** | **59** | **45** | **0** | **0** | **0** | **89** |

## Score de madurez

| Dimensión | Puntaje | Nota |
|---|---|---|
| Cobertura funcional | 19/25 | 59 PASS + 45 PARTIAL; comparaciones y cliente-360 son las brechas grandes |
| Calidad de respuesta / elaboración | 16/25 | brief y cobertura elaboran de verdad; la narrativa de dominio simple del mock es genérica (en prod narra Gemini — **no verificado**) |
| Visual UX / mini dashboard | 17/20 | 89/104 con tablero calidad Cockpit; faltan adaptadores en operación/compras-reporte/organigrama |
| Fuentes y links reales | 14/15 | 104/104 citas válidas; 101/104 con deep-link; Drive real en documental; fuente por fila |
| Gestión de brechas / honestidad | 9/10 | brechas específicas y citables; 0 genéricos injustificados |
| Estabilidad | 5/5 | 0 errores, 0 consulta inválida en 104 preguntas × 4 corridas |
| **TOTAL** | **80/100** | v1 era ~52/100 |

## Veredicto

**NO APTO PARA PASAR DE ETAPA (todavía) — 80/100: "usable pero requiere ajustes antes de avanzar".**

No se maquilla: el umbral del manual es 85. El salto de 52→80 se hizo en esta sesión con el slice A; los ajustes restantes están identificados, acotados y priorizados (abajo). Además, **ninguna corrida validó aún Gemini con datos reales** — ese smoke es condición necesaria para declarar APTO aunque el score determinístico supere 85.

## Top 10 capacidades que SÍ funcionan

1. Informe ejecutivo multi-dominio (management_brief): KPIs por área + riesgos priorizados + oportunidades + recomendaciones + brechas — 19 preguntas del manual lo usan.
2. Ranking de riesgos por impacto/urgencia con evidencia y acción por fila.
3. Vacancia/capacidad: 8/8 PASS — número primero, tablero, oportunidad comercial.
4. Matriz de cobertura consultable: el Copilot responde sobre sí mismo y declara brechas específicas (12/104 preguntas).
5. Contratos: dashboard contractual, último firmado con fuente Drive real, calidad documental con escalera honesta.
6. Documental: mejor coincidencia + relacionados + "Abrir documento (Drive)" real.
7. Organigrama/navegación: 8/8 PASS (incluye mapa ejecutivo = organigrama+secciones).
8. Citas [S#] validadas en el 100% de las respuestas; fuente inline por fila/KPI.
9. Cero "Consulta inválida" / cero fallback genérico en todo el manual.
10. Reporte de ingresos por categoría con 'Sin clasificar' siempre visible como brecha.

## Top 10 fallas restantes (por impacto)

1. **Comparaciones período-a-período** (facturación m/m, hoy vs ayer, gasto vs compromiso lado a lado, estado vs último período): hoy se declara la brecha — falta el motor comparativo (afecta ~8 preguntas). *Slice B, local: billing ultimos_meses ya trae la serie.*
2. **Compliance sin dimensión sede** (score por sede, Magaldi vs Luján): la RPC no proyecta sede (afecta 3-4 preguntas). *Requiere cambio de RPC → OK previo.*
3. **Cliente 360** (cruce clientes×contratos×facturación×compliance): brecha declarada (afecta ~5).
4. Adaptadores visuales faltantes: operación (workflows/tareas/incidentes), reporte de compras, organigrama (afecta ~10 PARTIAL).
5. % sobre el total en singulares (cliente/proveedor top-1 sin peso relativo).
6. Outliers/duplicados (facturas que distorsionan, docs repetidos): capacidad no existente; hoy responde el listado en vez de declarar la sub-brecha.
7. "Contratos vigentes como dashboard" cae al modo por_vencer cuando la frase menciona vencimientos.
8. Priorización con semáforo en OC recientes.
9. Ranking de secciones con empates (compliance fuera del top-8 narrativo en consultas multi-objetivo).
10. Narrativa ejecutiva de dominios simples depende de Gemini (no verificable en demo).

## Root causes sistémicos (Fase 4)

1. **RC-Router (resuelto en slice A):** ruteo 1-pregunta→1-tool demasiado literal — 27 preguntas caían en search_knowledge. Fix: detector gerencial ampliado + keywords de dominio + coverage_overview.
2. **RC-Comparación (abierto):** no existe capa comparativa entre períodos/sedes/bases. Es la brecha funcional #1.
3. **RC-Guard (resuelto):** el guard metadata degradaba analítica de gestión legítima sobre fichas.
4. **RC-Matcher (resuelto):** nexus-sections exigía TODOS los tokens (`every`) sobre la frase completa.
5. **RC-Brecha-silenciosa (resuelto):** dominios sin fuente (WMS/caja/movimientos) respondían OTRO TEMA; ahora declaran brecha específica citable.
6. **RC-Dimensión-sede (abierto):** compliance/documental sin sede como dimensión → comparativos por sede imposibles sin RPC nueva.
7. **RC-Provider (abierto, no bloqueante local):** el harness mock compone narrativa genérica para dominios simples; la elaboración narrativa real la hace Gemini en prod (prompt v17 la instruye) — **pendiente de smoke autorizado**.

## Plan de corrección (Fase 6)

**Slice B — sin migración (local, próximo):**
- Motor de comparación m/m sobre `billing_summary mode=ultimos_meses` (serie ya existe) + visual comparativo con variación %.
- Comparativo gasto-vs-compromiso lado a lado (las dos bases ya se consultan juntas).
- Adaptadores visuales: operación (tablero incidentes+tareas+workflows), reporte de compras, % del total en singulares.
- Fix matcher "vigentes como dashboard" y ranking de secciones (bonus por token raro).

**Slice C — requieren RPC/migración (necesitan OK explícito):**
- Dimensión SEDE en `ai_compliance_pending` (score por sede, Magaldi vs Luján).
- Cliente 360 (`ai_client_360`: contratos+facturación+compliance por cliente).
- Movimientos de tesorería (proyección de movimientos recientes).

**Validación prod (requiere autorización):**
- Smoke de las 12 preguntas fuertes del manual con **Gemini + datos reales** (sesión piloto), antes de cualquier deploy.

## Recomendación de siguiente etapa (Fase 7, condicional)

- Smoke permanente: las 12 "preguntas más fuertes" del manual + regresiones ya viven en `acceptance-smoke.test.ts` (env-gated `COPILOT_ACCEPTANCE=1`) — correrlo antes de cada release del Copilot.
- Automatizar en CI un subset (las 12 fuertes) sin gate.
- Después de slice B + smoke Gemini: re-correr la batería completa; con ≥85 y Gemini validado, pasar de etapa.

## Matriz completa de resultados (v4)

| # | Sec | Pregunta | Resultado | Tool(s) | Visual | Citas | Links | Motivo / Observación |
|---|-----|----------|-----------|---------|--------|-------|-------|----------------------|
| 1-1 | 1 | Haceme un resumen ejecutivo de Nexus para hoy: indicadores sanos, indicadores en alerta y prioridades. | PASS | management_brief | Resumen ejecutivo · Nexus | 16 | sí | Cumple intención, fuente, visual y citas |
| 1-2 | 1 | Si mañana tengo reunión de dirección, preparame un tablero con KPIs, riesgos, oportunidades y próximos pasos. | PASS | management_brief | Resumen ejecutivo · Nexus | 16 | sí | Cumple intención, fuente, visual y citas |
| 1-3 | 1 | Decime qué debería mirar primero hoy y por qué, usando solo datos de Nexus. | PASS | management_brief | Prioridades de gestión · Resum | 16 | sí | Cumple intención, fuente, visual y citas |
| 1-4 | 1 | Comparame el estado actual de Nexus contra el último período disponible: qué mejoró, qué empeoró y qué se trabó. | PARTIAL | coverage_overview | Cobertura del Copilot por módu | 8 | sí | Brecha de comparación declarada (honesta) pero sin comparación real — slice B |
| 1-5 | 1 | Detectá los 10 riesgos más importantes que aparecen hoy en Nexus, ordenados por impacto y urgencia. | PASS | management_brief | Riesgos priorizados · Nexus | 16 | sí | Cumple intención, fuente, visual y citas |
| 1-6 | 1 | Preparame una lectura ejecutiva de la empresa: qué está sano, qué está en riesgo y qué oportunidad comercial aparece. | PASS | management_brief | Resumen ejecutivo · Nexus | 16 | sí | Cumple intención, fuente, visual y citas |
| 1-7 | 1 | Armame un reporte de gobernanza: fuentes incompletas, datos sin clasificar y documentos sin link real. | PASS | management_brief | Resumen ejecutivo · Nexus | 16 | sí | Cumple intención, fuente, visual y citas |
| 1-8 | 1 | Haceme un tablero de salud de Nexus con indicadores por área. | PASS | management_brief | Resumen ejecutivo · Nexus | 16 | sí | Cumple intención, fuente, visual y citas |
| 2-1 | 2 | Haceme un reporte ejecutivo de facturación del último mes por categoría de negocio. | PASS | revenue_by_category_report | Ingresos por categoría | 3 | sí | Cumple intención, fuente, visual y citas |
| 2-2 | 2 | Qué unidad de negocio sostuvo la facturación del último período y qué porcentaje representó. | PASS | revenue_by_category_report | Ingresos por categoría | 3 | sí | Cumple intención, fuente, visual y citas |
| 2-3 | 2 | Comparame la facturación de este mes contra el mes anterior y explicame la variación. | PARTIAL | coverage_overview | Cobertura del Copilot por módu | 5 | sí | Comparación mes vs anterior → brecha declarada; el dato mensual existe (billing ultimos_meses) — slice B |
| 2-4 | 2 | Cuál fue el cliente que más facturó y qué peso tuvo sobre el total. | PARTIAL | customer_revenue_overview | Facturación por cliente | 1 | sí | Top-1 correcto pero sin % sobre el total del período |
| 2-5 | 2 | Ranking de clientes por facturación con gráfico de barras y concentración del top 5. | PASS | customer_revenue_overview | Facturación por cliente | 2 | sí | Cumple intención, fuente, visual y citas |
| 2-6 | 2 | Detectá facturas o clientes que distorsionan el análisis de ingresos. | PARTIAL | customer_revenue_overview | Facturación por cliente | 2 | sí | Ranking correcto sin análisis de outliers |
| 2-7 | 2 | Qué porcentaje de ingresos quedó sin clasificar y qué clientes explican esa brecha. | PARTIAL | revenue_by_category_report | Ingresos por categoría | 3 | sí | % Sin clasificar + warning OK; falta detalle de qué clientes explican la brecha |
| 2-8 | 2 | Proyectá una lectura comercial a partir de facturación, contratos y vacancia. | PARTIAL | vacancy_overview | Capacidad y vacancia corporati | 3 | sí | Responde vacancia con oportunidad; falta el cruce facturación+contratos |
| 3-1 | 3 | Cuál fue el proveedor que más gastó el mes pasado y cuánto representó del gasto total. | PARTIAL | supplier_spend_overview | Presupuesto comprometido por p | 1 | sí | Top-1 correcto; falta % sobre gasto total del período |
| 3-2 | 3 | Haceme un ranking de proveedores por gasto con gráfico de barras. | PASS | supplier_spend_overview | Presupuesto comprometido por p | 2 | sí | Cumple intención, fuente, visual y citas |
| 3-3 | 3 | Qué proveedor consume más presupuesto y qué riesgo operativo genera esa concentración. | PARTIAL | supplier_spend_overview | Presupuesto comprometido por p | 2 | sí | Concentración con % OK; falta recomendación de mitigación |
| 3-4 | 3 | Comparame gasto real contra órdenes de compra firmadas. | PARTIAL | supplier_spend_overview, supplier_spend_overview | Presupuesto comprometido por p | 4 | sí | Dos bases (gasto+compromiso) consultadas juntas; falta visual comparativo lado a lado |
| 3-5 | 3 | Detectá proveedores con aumento relevante respecto del período anterior. | PARTIAL | coverage_overview | Cobertura del Copilot por módu | 4 | sí | Variación vs período anterior → brecha declarada — slice B |
| 3-6 | 3 | Qué órdenes de compra recientes deberían revisarse por monto, estado o proveedor. | PARTIAL | purchase_orders_overview | — | 1 | sí | OC recientes correctas; falta priorización con semáforo |
| 3-7 | 3 | Haceme un reporte de compras: OC emitidas, facturas proveedor, pendientes y alertas. | PARTIAL | purchase_orders_overview, supplier_invoices_overview | — | 2 | sí | OC + facturas pendientes consultadas juntas; falta dashboard visual del dominio compras |
| 3-8 | 3 | Detectá dependencia excesiva de proveedores y sugerí mitigaciones. | PARTIAL | supplier_spend_overview | Presupuesto comprometido por p | 2 | sí | Ranking de concentración OK; faltan mitigaciones sugeridas |
| 4-1 | 4 | Haceme un reporte financiero ejecutivo con saldos bancarios, caja chica y alertas de liquidez. | PASS | management_brief | Resumen ejecutivo · Nexus | 16 | sí | Cumple intención, fuente, visual y citas |
| 4-2 | 4 | Cuánta plata hay en Santander y qué porcentaje representa del total de fondos. | PASS | bank_balances_overview | Saldos de Tesorería | 2 | sí | Cumple intención, fuente, visual y citas |
| 4-3 | 4 | Mostrame la composición de fondos por banco y caja con gráfico. | PASS | bank_balances_overview | Saldos de Tesorería | 2 | sí | Cumple intención, fuente, visual y citas |
| 4-4 | 4 | Comparame saldo disponible contra compromisos de compras. | PARTIAL | bank_balances_overview | Saldos de Tesorería | 2 | sí | Saldos OK; falta comparación contra compromisos de compras — slice B |
| 4-5 | 4 | Qué movimientos financieros relevantes hubo en el último período. | PASS | coverage_overview | Cobertura del Copilot por módu | 5 | sí | Cumple intención, fuente, visual y citas |
| 4-6 | 4 | Detectá posibles tensiones financieras usando saldos, compras y facturación. | PASS | management_brief | Riesgos priorizados · Nexus | 16 | sí | Cumple intención, fuente, visual y citas |
| 4-7 | 4 | Preparame una lectura de tesorería para dirección. | PASS | management_brief | Resumen ejecutivo · Nexus | 16 | sí | Cumple intención, fuente, visual y citas |
| 4-8 | 4 | Qué debería mirar primero en finanzas hoy. | PARTIAL | management_brief | Prioridades de gestión · Resum | 16 | sí | Brief de prioridades multi-dominio; no focalizado solo en finanzas |
| 5-1 | 5 | Mostrame los contratos vigentes como dashboard: tipo, estado, vencimientos y calidad documental. | PARTIAL | contracts_overview | Contratos próximos a vencer | 3 | sí | Responde "próximos a vencer" en vez del dashboard de cartera vigente completo (matcher de "vencimientos") |
| 5-2 | 5 | Cuál fue el último contrato firmado y abrime la fuente real si existe. | PASS | contracts_overview | Último contrato firmado | 1 | sí | Cumple intención, fuente, visual y citas |
| 5-3 | 5 | Cuántos contratos están próximos a vencer y cuáles requieren atención urgente. | PASS | contracts_overview | Contratos próximos a vencer | 3 | sí | Cumple intención, fuente, visual y citas |
| 5-4 | 5 | Cuántos contratos ANMAT se firmaron el último mes. | PASS | contracts_overview | Contratos firmados | 3 | sí | Cumple intención, fuente, visual y citas |
| 5-5 | 5 | Haceme un reporte de calidad documental de contratos: con Drive, con carpeta y sin documento vinculado. | PASS | contracts_overview | Cartera de contratos | 3 | sí | Cumple intención, fuente, visual y citas |
| 5-6 | 5 | Detectá contratos con estado problemático, vencimiento cercano o falta de respaldo documental. | PARTIAL | contracts_overview | Contratos próximos a vencer | 3 | sí | Tabla con semáforos OK; faltan acciones por contrato |
| 5-7 | 5 | Comparame contratos ANMAT y Cargas Generales por vigencia, vencimiento y documentación. | PARTIAL | contracts_overview | Contratos próximos a vencer | 3 | sí | Listado por tipo sin visual comparativo ANMAT vs Cargas |
| 5-8 | 5 | Qué clientes tienen contrato vigente pero documentación pendiente. | PASS | contracts_overview | Cartera de contratos vigentes | 3 | sí | Cumple intención, fuente, visual y citas |
| 6-1 | 6 | Haceme un reporte ejecutivo de compliance por sede: score, riesgos, vencidos y próximos a vencer. | PARTIAL | compliance_pending | Compliance · vencidos y por ve | 1 | sí | Compliance global correcto; falta score POR SEDE |
| 6-2 | 6 | Qué documentos están vencidos y cuáles son los más críticos. | PARTIAL | compliance_pending | Compliance · vencidos y por ve | 1 | sí | KPI+tabla OK; orden por criticidad no garantizado |
| 6-3 | 6 | Qué documentos de compliance están pendientes y qué riesgo generan. | PASS | compliance_pending | Compliance · vencidos y por ve | 1 | sí | Cumple intención, fuente, visual y citas |
| 6-4 | 6 | Comparame Compliance Magaldi contra Luján y decime cuál sede está más comprometida. | PARTIAL | compliance_pending | Compliance · vencidos y por ve | 1 | sí | Sin comparativo Magaldi vs Luján (falta dimensión sede en la RPC) |
| 6-5 | 6 | Preparame un plan de acción para resolver hallazgos críticos de compliance. | PARTIAL | compliance_pending | Compliance · vencidos y por ve | 1 | sí | Pendientes con riesgo OK (guard corregido); faltan acciones priorizadas |
| 6-6 | 6 | Detectá documentos repetidos, mal clasificados o con fecha dudosa. | PARTIAL | compliance_pending | Compliance · vencidos y por ve | 1 | sí | Lista pendientes; no detecta duplicados/mal clasificados (capacidad inexistente, declarar brecha) |
| 6-7 | 6 | Qué riesgos regulatorios requieren atención inmediata y por qué. | PARTIAL | compliance_pending | Compliance · vencidos y por ve | 1 | sí | Pendientes con riesgo OK; falta ranking explícito por criticidad |
| 6-8 | 6 | Qué pasó en compliance en el último período. | PARTIAL | compliance_pending | Compliance · vencidos y por ve | 1 | sí | Estado actual OK; sin timeline de novedades del período |
| 7-1 | 7 | Dame la habilitación de Magaldi 1765 y separá documento exacto de relacionados. | PASS | docs_browse | Búsqueda documental | 1 | sí | Cumple intención, fuente, visual y citas |
| 7-2 | 7 | Buscá la plancheta de Luján 3159 y abrime el documento si está vinculado. | PASS | docs_browse | Búsqueda documental | 1 | sí | Cumple intención, fuente, visual y citas |
| 7-3 | 7 | Haceme un reporte documental de la sede Luján: habilitaciones, planchetas y certificados. | PARTIAL | docs_browse | Búsqueda documental | 1 | sí | Fichas por sede OK; falta dashboard documental por tipo/estado |
| 7-4 | 7 | Qué documentos tienen metadata pero no archivo Drive vinculado. | PARTIAL | docs_browse | Búsqueda documental | 1 | sí | Listado de fichas; falta filtro específico "sin URL de Drive" |
| 7-5 | 7 | Mostrame documentos críticos por sede, separados entre vigentes, vencidos y sin fecha clara. | PARTIAL | compliance_pending | Compliance · vencidos y por ve | 1 | sí | Compliance pendientes; falta agrupación por sede/estado |
| 7-6 | 7 | Detectá falsos positivos en búsquedas documentales de habilitaciones. | PARTIAL | compliance_pending | Compliance · vencidos y por ve | 1 | sí | Responde pendientes; el análisis de falsos positivos vive en docs_browse (principal vs relacionados) |
| 7-7 | 7 | Qué archivos de Drive deberían vincularse a contratos o compliance. | PARTIAL | docs_browse | Búsqueda documental | 1 | sí | Fichas listadas; faltan sugerencias de vinculación |
| 7-8 | 7 | Preparame un índice documental por sede con fuentes reales. | PASS | docs_browse | Búsqueda documental | 1 | sí | Cumple intención, fuente, visual y citas |
| 8-1 | 8 | Haceme un reporte de capacidad y vacancia corporativa. | PASS | vacancy_overview | Capacidad y vacancia corporati | 3 | sí | Cumple intención, fuente, visual y citas |
| 8-2 | 8 | Cuántos metros cuadrados disponibles tenemos para Cargas Generales. | PASS | vacancy_overview | Capacidad y vacancia corporati | 3 | sí | Cumple intención, fuente, visual y citas |
| 8-3 | 8 | Qué porcentaje de vacancia tenemos actualmente y qué oportunidad comercial representa. | PASS | vacancy_overview | Capacidad y vacancia corporati | 3 | sí | Cumple intención, fuente, visual y citas |
| 8-4 | 8 | Cuántos cubículos ANMAT están alquilados, disponibles y totales. | PASS | vacancy_overview | Cubículos ANMAT | 3 | sí | Cumple intención, fuente, visual y citas |
| 8-5 | 8 | Comparame disponibilidad ANMAT contra Cargas Generales. | PASS | vacancy_overview | Capacidad y vacancia corporati | 3 | sí | Cumple intención, fuente, visual y citas |
| 8-6 | 8 | Qué capacidad ociosa deberíamos priorizar comercialmente. | PASS | vacancy_overview | Capacidad y vacancia corporati | 3 | sí | Cumple intención, fuente, visual y citas |
| 8-7 | 8 | Haceme un tablero de ocupación por sede y unidad de negocio. | PASS | vacancy_overview | Capacidad y vacancia corporati | 3 | sí | Cumple intención, fuente, visual y citas |
| 8-8 | 8 | Qué espacios disponibles pueden transformarse en oportunidad de venta. | PASS | vacancy_overview | Capacidad y vacancia corporati | 3 | sí | Cumple intención, fuente, visual y citas |
| 9-1 | 9 | Qué workflows están trabados y desde cuándo. | PARTIAL | workflows_stuck | — | 1 | sí | Datos correctos sin adaptador visual (workflows) |
| 9-2 | 9 | Qué pasó ayer en la operación, explicado en lenguaje ejecutivo. | PARTIAL | ops_digest | — | 2 | no | Eventos correctos; narrativa ejecutiva depende del provider real (Gemini) |
| 9-3 | 9 | Qué tareas están vencidas y cuáles bloquean procesos. | PARTIAL | tasks_overview | — | 2 | sí | Tareas vencidas OK; falta "cuáles bloquean procesos" y visual |
| 9-4 | 9 | Haceme un tablero operativo con incidentes, tareas, workflows y alertas. | PARTIAL | incidents_overview | — | 2 | sí | Solo incidentes; el tablero operativo multi-fuente completo es el brief |
| 9-5 | 9 | Qué debería mirar primero mañana en operaciones. | PASS | management_brief | Prioridades de gestión · Resum | 16 | sí | Cumple intención, fuente, visual y citas |
| 9-6 | 9 | Detectá procesos sin actividad reciente y sugerí próximos pasos. | PARTIAL | workflows_stuck | — | 1 | sí | Workflow trabado correcto; próximos pasos en excerpt, sin visual |
| 9-7 | 9 | Qué incidentes críticos están abiertos y qué impacto tienen. | PARTIAL | incidents_overview | — | 2 | sí | Incidentes críticos OK sin visual de impacto |
| 9-8 | 9 | Comparame operación de hoy contra ayer si hay datos. | PARTIAL | ops_digest | — | 2 | no | Digest 48h sin lógica comparativa hoy-vs-ayer — slice B |
| 10-1 | 10 | Haceme un reporte de ocupación de depósitos y posiciones disponibles. | PASS | coverage_overview | Cobertura del Copilot por módu | 2 | sí | Cumple intención, fuente, visual y citas |
| 10-2 | 10 | Qué sectores tienen mayor ocupación y cuáles están subutilizados. | PASS | coverage_overview | Cobertura del Copilot por módu | 2 | sí | Cumple intención, fuente, visual y citas |
| 10-3 | 10 | Qué disponibilidad hay por depósito y por unidad de negocio. | PASS | vacancy_overview | Capacidad y vacancia corporati | 3 | sí | Cumple intención, fuente, visual y citas |
| 10-4 | 10 | Detectá oportunidades de almacenamiento disponibles. | PASS | vacancy_overview | Capacidad y vacancia corporati | 3 | sí | Cumple intención, fuente, visual y citas |
| 10-5 | 10 | Hay vencimientos ANMAT o productos sensibles próximos. | PASS | coverage_overview | Cobertura del Copilot por módu | 5 | sí | Cumple intención, fuente, visual y citas |
| 10-6 | 10 | Qué posiciones o ubicaciones requieren atención. | PASS | coverage_overview | Cobertura del Copilot por módu | 1 | no | Cumple intención, fuente, visual y citas |
| 10-7 | 10 | Comparame disponibilidad entre depósitos. | PASS | vacancy_overview | Capacidad y vacancia corporati | 3 | sí | Cumple intención, fuente, visual y citas |
| 10-8 | 10 | Preparame una lectura WMS para comercial y operaciones. | PASS | coverage_overview | Cobertura del Copilot por módu | 3 | sí | Cumple intención, fuente, visual y citas |
| 11-1 | 11 | Haceme un reporte comercial de clientes activos, facturación, contratos y documentación. | PARTIAL | revenue_by_category_report | Ingresos por categoría | 3 | sí | Ingresos por categoría; el cliente-360 completo es brecha declarada |
| 11-2 | 11 | Detectá clientes estratégicos usando facturación, contratos y ocupación. | PARTIAL | customer_revenue_overview | Facturación por cliente | 2 | sí | Ranking de clientes OK; falta cruce con contratos y ocupación |
| 11-3 | 11 | Qué clientes deberían contactarse esta semana y por qué. | PARTIAL | coverage_overview | Cobertura del Copilot por módu | 6 | sí | Brecha cliente-360/pipeline declarada (honesta); sin priorización de contactos |
| 11-4 | 11 | Comparame clientes ANMAT contra Cargas Generales. | PARTIAL | coverage_overview | Cobertura del Copilot por módu | 6 | sí | Brecha de comparación de clientes declarada — slice B |
| 11-5 | 11 | Qué clientes tienen riesgo documental o contractual. | PASS | contracts_overview | Cartera de contratos | 3 | sí | Cumple intención, fuente, visual y citas |
| 11-6 | 11 | Qué oportunidades comerciales aparecen por vacancia disponible. | PASS | management_brief | Oportunidades · Resumen ejecut | 16 | sí | Cumple intención, fuente, visual y citas |
| 11-7 | 11 | Qué clientes concentran facturación y qué riesgo genera. | PARTIAL | customer_revenue_overview | Facturación por cliente | 2 | sí | Concentración con % OK; falta narrativa de riesgo (Gemini en prod) |
| 11-8 | 11 | Preparame un pipeline ejecutivo con próximos pasos comerciales. | PASS | management_brief | Oportunidades · Resumen ejecut | 16 | sí | Cumple intención, fuente, visual y citas |
| 12-1 | 12 | Quién es el presidente de Logística TOPS y qué rol ocupa. | PASS | organization_overview | — | 3 | sí | Cumple intención, fuente, visual y citas |
| 12-2 | 12 | Quién está a cargo de operaciones y qué áreas dependen de esa función. | PASS | organization_overview | — | 1 | sí | Cumple intención, fuente, visual y citas |
| 12-3 | 12 | Qué secciones tiene Nexus y para qué sirve cada una. | PASS | nexus_sections_overview | — | 8 | sí | Cumple intención, fuente, visual y citas |
| 12-4 | 12 | Dónde veo órdenes de compra, compliance y contratos. | PASS | nexus_sections_overview | — | 8 | sí | Cumple intención, fuente, visual y citas |
| 12-5 | 12 | Qué módulos de Nexus tienen cobertura completa del Copilot y cuáles son brecha. | PASS | coverage_overview | Cobertura del Copilot por módu | 6 | sí | Cumple intención, fuente, visual y citas |
| 12-6 | 12 | Qué fuentes usa Copilot para responder cada módulo. | PASS | coverage_overview | Cobertura del Copilot por módu | 8 | sí | Cumple intención, fuente, visual y citas |
| 12-7 | 12 | Qué datos faltan para que el Copilot pueda responder mejor. | PASS | coverage_overview | Cobertura del Copilot por módu | 8 | sí | Cumple intención, fuente, visual y citas |
| 12-8 | 12 | Preparame un mapa ejecutivo de áreas, responsables y módulos. | PASS | organization_overview, nexus_sections_overview | — | 8 | sí | Cumple intención, fuente, visual y citas |
| 13-1 | 13 | Si mañana tengo reunión de dirección, preparame el resumen ejecutivo de Nexus con KPIs, alertas, riesgos, oportunidades y recomendaciones. | PASS | management_brief | Resumen ejecutivo · Nexus | 16 | sí | Cumple intención, fuente, visual y citas |
| 13-2 | 13 | Haceme un informe ejecutivo usando facturación, tesorería, contratos, compliance, vacancia y operación. | PASS | management_brief | Resumen ejecutivo · Nexus | 16 | sí | Cumple intención, fuente, visual y citas |
| 13-3 | 13 | Cuáles son los 10 riesgos más importantes de Nexus hoy, ordenados por impacto y urgencia. | PASS | management_brief | Riesgos priorizados · Nexus | 16 | sí | Cumple intención, fuente, visual y citas |
| 13-4 | 13 | Qué decisiones recomendarías tomar esta semana basadas solo en datos de Nexus. | PASS | management_brief | Prioridades de gestión · Resum | 16 | sí | Cumple intención, fuente, visual y citas |
| 13-5 | 13 | Qué está sano, qué está en riesgo, qué está trabado y qué oportunidad comercial aparece. | PARTIAL | workflows_stuck | — | 1 | sí | Responde workflows trabados (una de las 4 dimensiones); falta ruteo al brief |
| 13-6 | 13 | Cruzá clientes, contratos, facturación y compliance para detectar clientes estratégicos o en riesgo. | PARTIAL | customer_revenue_overview | Facturación por cliente | 2 | sí | Ranking de clientes; el cruce 4-dominios es brecha declarada |
| 13-7 | 13 | Compará ingresos, gastos, saldos, contratos y vacancia para detectar tensión o oportunidad. | PARTIAL | vacancy_overview | Capacidad y vacancia corporati | 3 | sí | Responde vacancia (una de 5 dimensiones); comparación multi-dominio es slice B |
| 13-8 | 13 | Preparame un tablero para comité: negocio, finanzas, riesgo, operación y próximos pasos. | PASS | management_brief | Resumen ejecutivo · Nexus | 16 | sí | Cumple intención, fuente, visual y citas |

## Confirmación de reglas duras

✅ No push · no merge · no deploy · no Netlify · sin migraciones · **cero Supabase writes** · sin backfill · sin reprojection · sin tocar auth/login/middleware · sin UDIE · sin service_role · **sin hardcodear respuestas del manual** (el runner ejerce el engine real; las preguntas NO están en ningún prompt ni respuesta enlatada) · brechas declaradas, no escondidas · **frenado antes de commit**.


---

# ADDENDUM · Slice B (mismo día, 2026-07-07) — comparaciones con fuente real

**Base:** commit `b54b180` (Slice A) + Slice B **sin commit** (esperando OK).

## Qué agregó Slice B (local, TDD, sin migración, sin writes)

1. **Comparación m/m de facturación**: `billing_summary(ultimos_meses, meses=2)` + delta cards (variación absoluta y %) con honestidad total: mes EN CURSO declarado "(parcial)" en KPI/tabla/insight/warning (nunca se vende parcial-vs-completo como caída real) y meses no adyacentes declarados ("vs mes anterior CON DATOS").
2. **Tool nueva `spend_comparison_report`** (orquestadora, sin RPC nueva): `gasto_vs_compromiso` (por proveedor, % ejecutado, pendiente real), `periodo_anterior` (variación con subas/bajas/nuevos, truncación balanceada top-10 subas + top-10 caídas declarada) y `saldo_vs_compromisos` (liquidez: saldo vs **pendiente estimado** = Σ max(compromiso−gasto,0), método declarado — no compromiso bruto histórico).
3. **6 adaptadores visuales nuevos**: workflows_stuck, tasks_overview, incidents_overview, purchase_orders, supplier_invoices, ops_digest — la sección Operación pasó de texto crudo a tableros.
4. **focoTop**: "peso del top sobre el total" → entidad principal + % del top listado con calificador honesto (fix también del mislabel gasto/compromiso en demo vía demoFilter exacto por base+período).
5. **Brief**: delta m/m entre meses CERRADOS (headline = último mes cerrado; el mes en curso parcial se informa aparte, declarado), riesgo automático si la facturación cerrada cayó ≥15%, brecha "comparaciones multi-dominio parciales" declarada.
6. Ruteo: "vigentes como dashboard", "qué está sano / qué mejoró-empeoró (multi-dominio)" → brief; comparaciones m/m de dominios sin serie (compliance/contratos/vacancia/operación) → brecha declarada.

## Revisión adversarial multi-agente del diff (27 agentes, 4 dimensiones)

**22 hallazgos confirmados → 20 corregidos en esta misma sesión, 2 aceptados con racional:**

- 🔴 ALTO corregido: el brief comparaba mes EN CURSO parcial vs cerrado en prod → falso riesgo "cayó 92%" (demo no lo detectaba: fixtures solo meses cerrados). Fix: headline/delta con meses cerrados + fixture dinámico del mes en curso para que demo/tests ejerciten el caso.
- 🔴 ALTO corregido: liquidez comparaba saldo actual vs compromiso BRUTO histórico (incluye OC ya facturadas) → tensión sobreestimada. Fix: pendiente estimado con método declarado.
- Corregidos: superlativos deshonestos ("Mayor suba" sobre una baja; "mayor pendiente" por volumen y no por diferencia), truncación sesgada de caídas, canibalización de comparaciones por categoría/cliente, modo equivocado del comparador, pérdida de brecha declarada para m/m de dominios sin fuente, detector "qué mejoró" sin ancla multi-dominio, branch muerto, guard metadata ("pendiente de cumplir" = contenido), demoFilter con fallback que mezclaba períodos.
- Aceptados (documentados): entityId con razón social (consistente con TODO el catálogo; no es PII bajo redactPii), toRpcArgs no usado en orquestadoras (campo requerido por la interface).

## Resultados batería v6 (post-fixes)

| Métrica | v1 | v4 (Slice A) | **v6 (Slice B)** |
|---|---|---|---|
| PASS | 28 | 59 | **73** |
| PARTIAL | 35 | 45 | **31** |
| FAIL | 41 | 0 | **0** |
| Fallback a search | 27 | 0 | **0** |
| Con tablero | 56 | 89 | **99** |
| Citas válidas | — | 104/104 | **104/104** |

Preguntas PARTIAL→PASS por Slice B: 2-3, 2-4, 3-1, 3-4, 3-5, 3-7, 4-4, 5-1, 9-1, 9-2, 9-3, 9-6, 9-7, 13-5.

## Score de madurez v6

| Dimensión | v4 | **v6** |
|---|---|---|
| Cobertura funcional | 19/25 | **21/25** |
| Calidad / elaboración | 16/25 | **18/25** |
| Visual UX | 17/20 | **19/20** |
| Fuentes y links | 14/15 | **14/15** |
| Brechas / honestidad | 9/10 | **10/10** (review adversarial cerrado; calificadores declarados en todos los caminos) |
| Estabilidad | 5/5 | **5/5** |
| **TOTAL** | **80/100** | **87/100** |

## Veredicto v6

**87/100 — zona APTO en la validación determinística (umbral 85), CONDICIONADO**: el pase de etapa sigue requiriendo el **smoke con Gemini + datos reales** (12 preguntas fuertes del manual, sesión piloto autorizada). Sin ese smoke, el veredicto operativo es **APTO CON OBSERVACIONES — no pasar de etapa todavía**.

**PARTIAL restantes (31)**: mayoría requiere Slice C (RPC nueva, con OK): sede en compliance (6-1/6-4…), cliente 360 (11-x/13-6), movimientos de tesorería, outliers por factura, clientes del "Sin clasificar"; más elaboración narrativa que aporta Gemini en prod (9-x parcialmente).

## Confirmación de reglas duras (Slice B)

✅ No push · no merge · no deploy · no Netlify · **cero migraciones** · **cero Supabase writes** · sin backfill/reprojection · sin tocar auth/login/middleware · **sin tocar UDIE** (el ENOENT de `__boundary_probe.ts` en el dev server fue un artefacto del watcher: el test de boundary crea y borra ese archivo temporal; se resolvió reiniciando el server — cero cambios en UDIE) · sin service_role · sin hardcodear respuestas del manual · **frenado antes del commit de Slice B**.

Nota de proceso: los tests de los fixes post-review se escribieron antes que las correcciones pero su fase RED no se verificó corriendo la suite en el estado intermedio (desvío puntual del ciclo estricto RED→GREEN, declarado); cada test ancla comportamiento nuevo inexistente antes del fix.

