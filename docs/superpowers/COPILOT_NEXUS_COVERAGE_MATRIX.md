# COPILOT_NEXUS_COVERAGE_MATRIX.md
**Matriz de cobertura: secciones reales de Nexus vs. lo que el Copilot puede consultar**
Fecha: 2026-07-06 · Rama: `fix/f5-2-copilot-context-retrieval` · Método: auditoría read-only
(App Router completo + Sidebar + `src/lib/*` data layers + catálogo de tools del Copilot,
4 inventarios paralelos + verificación de rutas contra `page.tsx`).

> **Root cause sistémico:** el Copilot nació cubriendo 5 dominios (incidentes, tareas,
> compliance, contratos, knowledge) y el resto de Nexus quedó **visible en UI pero
> invisible para el Copilot**: sin tool, sin RPC de lectura, sin proyección y sin fuente
> compartida. Además, los deep-links exigían `public_id` y algunos apuntaban a rutas
> inexistentes. No era un bug de Organigrama: era la ausencia de una matriz de cobertura.

## Estado por módulo

Leyenda estado: ✅ cubierto · 🟡 parcial · 👻 invisible (UI existe, Copilot no la ve) ·
🔗 solo navegación (cubierto por `nexus_sections_overview`, sin datos de negocio).
"Nav" = aparece en el sidebar. Todas las rutas listadas cargan (verificadas contra page.tsx).

| Módulo | Ruta UI | Nav | Fuente real | Tool Copilot | Entity type → chip | Estado | Fix propuesto |
|---|---|---|---|---|---|---|---|
| **Incidentes (Nexus Link)** | /connect/incidentes | ✔ | connect_incidents | incidents_overview | connect_incident → /connect/incidentes | ✅ | — |
| **Tareas / Workflows** | /connect/tareas | ✔ | connect_tasks | tasks_overview, workflows_stuck | connect_task → /connect/tareas | ✅ | — |
| **Mensajes/Canales (Link)** | /connect, /connect/canales | ✔ | connect_conversations/messages | connect_search | connect_message → /connect/buscar | ✅ | — |
| **Compliance / ANMAT** | /anmat | ✔ | compliance_items + searchable_items (569 fichas) | compliance_pending, docs_browse | compliance_* → /anmat (fix: era /compliance=404) | ✅ | hecho en esta rama |
| **Contratos comerciales** | /comercial/contratos | ✔ | contracts (57) + fichas | contracts_overview, docs_browse | contrato → /comercial/contratos | ✅ (metadata; texto PDF = P5 diferido) | — |
| **Facturación (emitidas)** | /billing | ✔ | customer_invoices (29) | customer_invoices_overview (P2) + **billing_summary (nuevo)** | customer_invoice, billing_periodo → /billing | ✅ | mig 0181 aplicada · **0182 pendiente de aplicar** |
| **Facturas de proveedor** | /compras/facturas | ✔ | supplier_invoices (16) | supplier_invoices_overview (P2) | supplier_invoice → /compras/facturas | ✅ | 0181 aplicada |
| **Órdenes de compra** | /compras/ordenes | ✔ | purchase_orders (24) | purchase_orders_overview (P2) | purchase_order → /compras/ordenes | ✅ | 0181 aplicada |
| **Proveedores (catálogo)** | /compras/proveedores | ✔ | vendors | suppliers_overview (P2) | supplier → /compras/proveedores | ✅ | 0181 aplicada |
| **Gasto/presupuesto por proveedor** | /compras/* | ✔ | supplier_invoices + purchase_orders (agregado) | **supplier_spend_overview (nuevo)** | supplier_spend → /compras/facturas u /ordenes según base | ✅ (código) | **0182 pendiente de aplicar** |
| **Tesorería · Bancos (saldos)** | /tesoreria/bancos | ✔ | treasury_bank_balances (view invoker: Santander $56,7M, Galicia $17,1M, Caja $2,4M) | **bank_balances_overview (nuevo)** | bank_balance → /tesoreria/bancos | ✅ (código) | **0182 pendiente de aplicar** |
| **Organigrama** | /organigrama | ✔ | src/lib/orgchart.ts (estático, fuente única con la UI) | organization_overview (local) | organization_member → /organigrama | ✅ | hecho en esta rama |
| **Navegación / secciones** | (todo el sidebar) | ✔ | src/lib/ai/nexus-sections.ts (catálogo nuevo, rutas verificadas) | **nexus_sections_overview (local, nuevo)** | nexus_section → ruta de cada sección | ✅ | hecho — es la BASE EXTENSIBLE |
| Tesorería · Movimientos/Pagos/Cobranzas | /tesoreria/* | ✔ | treasury_movements, *_open_items, *_current_account | — (solo nav) | — | 👻 datos / 🔗 nav | RPC `ai_treasury_movements` (0183+); las cuentas corrientes AR/AP son alto valor |
| Tesorería · Flujo de fondos | /tesoreria/flujo-fondos | ✔ | treasury_cashflow_projection | — | — | 👻 / 🔗 | RPC futura; fuente estructurada lista |
| Tesorería · Caja chica | /tesoreria/caja-chica | ✔ | v_cash_box_resumen/movimientos (espejo Drive xlsx) | — | — | 👻 / 🔗 | RPC sobre v_cash_box_resumen; NO mezclar con saldo bancario |
| Conciliación bancaria | /tesoreria/conciliacion | ✔ | bank_statements, bank_reconciliation_* | — | — | 👻 / 🔗 | valor medio; RPC futura |
| Órdenes de servicio (OS) | /orders, /dashboard | ✔ | orders, clients, operators | — | — | 👻 / 🔗 | RPC `ai_service_orders_overview` — alto valor operativo |
| Clientes (maestro) | /clients, /clientes/[id] | ✔ | clients + customer_current_account | clients_health (solo salud por incidentes) | client → null | 🟡 | RPC de legajo/cuenta corriente (decidir PII con Dirección) |
| WMS · Inventario/Lotes/Vencimientos | /wms/* | ✔ | inventory_items, inventory_lots, warehouse_positions | — | — | 👻 / 🔗 | RPC stock/vencimientos (ANMAT-crítico) — candidato prioritario |
| Vacancia / capacidad | /comercial/dashboard-vacancia | ✔ | wms/corporate-capacity.ts (estático congelado) + crm_units/opportunities | — | — | 👻 / 🔗 | tool local sobre corporate-capacity (patrón organigrama) |
| Tracking de flota | /operaciones/tracking | ✔ | fleet_vehicles, fleet_positions (PostGIS) | — | — | 👻 / 🔗 | RPC "última posición por vehículo" (cuidado volumen) |
| Comercial · Pipeline/Contactos | /comercial/pipeline, /contactos | ✔ | API Clientify (externa) + clientify_dashboard_snapshots (cache) | — | — | 👻 / 🔗 | usar el CACHE (snapshots), nunca la API viva por pregunta |
| Comercial · Oportunidades/Leads | /comercial/oportunidades, /leads | ✔ | crm_opportunities, crm_leads | — | — | 👻 / 🔗 | RPC read-only CRM nativo |
| Prospección | /comercial/prospeccion | ✔ | prospeccion_prospects/scores | — | — | 👻 / 🔗 | RPC futura (valor medio) |
| Pedidos · Logística | /pedidos | ✔ | (tablero) | — | — | 👻 / 🔗 | investigar fuente antes de tool |
| RRHH | /rrhh/* | ✔ | rrhh_empleados/documents/solicitudes | — | — | 👻 / 🔗 **decisión de producto** | PII sensible: el system prompt HOY excluye RRHH/sueldos (regla 7). No conectar sin decisión de Dirección |
| CCTV | /cctv | ✔ | API Hikvision (externa) | — | — | 🔗 | no aplica a Copilot (video en vivo); nav alcanza |
| Drive corporativo | /drive | ✔ | Google Drive API | docs_browse cubre las FICHAS sincronizadas | — | 🟡 | ya cubierto vía proyección; no scraping en vivo |
| Analytics / Ejecutivo | /analytics, /ejecutivo | ✔ | lib/analytics/executive-data (agregador multi-módulo) | parcialmente vía nuevas tools | — | 🟡 | los KPIs que faltan salen de las RPC nuevas + futuras |
| Knowledge admin | /knowledge/admin | gate | knowledge_* RPCs | search_knowledge/entity_timeline/entity_360 | knowledge_event → null | ✅ (spine) | — |
| Libro IVA compras | /compras/libro-iva | ✔ | supplier_invoice_fiscal/vat_lines | — | — | 👻 / 🔗 **gate contadora** | relacionado con auditoría fiscal F6; no exponer sin gate |
| Sistema (roles/usuarios/settings) | /settings/* | ✔ | roles, user_roles, permissions | — | — | 🔗 | bajo valor para Copilot; nav alcanza |
| Reportes / Cotizador / Herramientas | /reports, /comercial/herramientas/* | ✔ | orders / estáticos embebidos | — | — | 🔗 | nav alcanza por ahora |

## Preguntas que hoy fallan aunque la información existe (estado tras esta rama)

| Pregunta | Antes | Ahora |
|---|---|---|
| ¿Quién es el presidente? | 👻 empty | ✅ organization_overview |
| ¿Cuánto se facturó el último mes? | 👻 empty | ✅ billing_summary (**requiere aplicar 0182**) |
| ¿Cuánta plata hay en el Santander? | 👻 empty | ✅ bank_balances_overview (**requiere 0182**) |
| ¿Proveedor que más consume presupuesto? | ❌ listado incorrecto | ✅ supplier_spend_overview base=compromiso (**requiere 0182**) |
| ¿Dónde veo las órdenes de compra? / ¿Qué secciones tiene Nexus? | 👻 empty | ✅ nexus_sections_overview |
| ¿Cuánto stock hay del cliente X? / vencimientos WMS | 👻 empty | 👻 **brecha registrada** (WMS, 0183+) |
| ¿Dónde está el camión X? | 👻 empty | 👻 **brecha registrada** (tracking) |
| ¿Cuánto hay en caja chica? | 👻 empty | 👻 **brecha registrada** (v_cash_box_resumen) |
| Pipeline / oportunidades comerciales | 👻 empty | 👻 **brecha registrada** (CRM/Clientify cache) |

## Addendum 2026-07-07 · Hallazgos del SMOKE HUMANO (los tests verdes no alcanzaron)

El smoke humano en :3040 falló en 3 casos que los tests no cubrían. Se agregó una
**capa de intención de negocio** (singular=top-1 vs ranking=top-N · período "mes
pasado" · tolerancia de typos en contexto · documento-específico vs lista-de-pendientes):

| Caso real (auditoría ai_messages) | Tool ANTES | Tool AHORA | Estado |
|---|---|---|---|
| "¿Cuál es el proveedor que gastó más el mes pasado?" | supplier_spend con 8 filas (ranking) y período 'todo' | supplier_spend **limit=1, periodo=ultimo_mes** | ✅ código |
| "…el proveedor que **insumió** más…" | suppliers_overview (catálogo) ❌ | supplier_spend top-1 ("insumi/consum" = contexto gasto) | ✅ código |
| "el **probador** que más gastó" (typo) | search_knowledge → vacío ❌ | supplier_spend (typo tolerado en contexto de gasto) | ✅ código |
| "me das la **plancheta de habilitación de Luján 3159**" | compliance_pending (lista de vencidos → VTO MAYO/Incendio) ❌ | **docs_browse** query="lujan" (documento específico) | ✅ código |
| "¿Cuál fue el **cliente que más facturó**?" | search_knowledge → vacío ❌ (sin tool) | **customer_revenue_overview** top-1 → /billing | ✅ código · **requiere aplicar 0183** |
| "Ranking de clientes por facturación" | vacío ❌ | customer_revenue_overview top-N | ídem |
| "¿Quién es Martin Rinas?" (persona fuera del organigrama institucional) | vacío genérico | — | 👻 **brecha registrada**: personas = perfiles/RRHH, decisión de producto (PII) |
| Límite 40/día del piloto alcanzado durante el smoke | — | — | ⚠️ en preview se sube por env `AI_LIMIT_REQUESTS_PER_DAY`; para prod existe `ai_budget_overrides` (mig 0180) |

**Decisión de producto (Dirección 2026-07-07) — datos piloto:** los clientes/proveedores
de la etapa piloto (p.ej. `CLIENTE TEST QA TOPS`) son **válidos** y computan normal en
todas las métricas. Prohibido filtrar por nombre (TEST/QA/PILOTO); solo excluyen campos
estructurados (`anulada`, `estado_arca`, o un futuro `is_demo`). Test de blindaje en
`engine.test.ts` ("clientes piloto computan NORMAL").

Nueva fila de cobertura:

| Módulo | Ruta UI | Nav | Fuente real | Tool Copilot | Entity type → chip | Estado | Fix |
|---|---|---|---|---|---|---|---|
| **Facturación por cliente (top/ranking)** | /billing | ✔ | customer_invoices agrupado por cliente | **customer_revenue_overview (nuevo)** | customer_revenue → /billing | ✅ (código) | **mig 0183 entregada, NO aplicada** |

## Addendum 2026-07-07 (2) · CAPA DE REPORTES GERENCIALES (nuevo estándar)

**Estándar:** Copilot no solo encuentra registros — razona y elabora reportes ejecutivos
(totales, %, rankings, comparaciones) con cálculo determinístico en SQL, redacción del
modelo con números exactos, fuentes citadas y datos chart-ready. Caso testigo: **ingresos
por categoría (ANMAT vs Cargas Generales)**.

**Fuente de categoría (investigada, no asumida):** `clients.tags` (text[]: ANMAT /
CARGAS GENERALES / OFICINAS / TRANSPORTE). Facturas/ítems/OS no tienen categoría propia;
`contracts.tipo` (ANMAT|Cargas Generales) no mapea hoy a clientes de facturación (0
matches por razón social). Regla terciaria: keywords `%anmat%/%regulad%` en ítems.

**Criterio determinístico:** tags cliente (ANMAT→ANMAT; CARGAS GENERALES→CG) → keyword
en ítems→ANMAT → **Sin clasificar** (siempre visible; nunca se inventa ni se filtra por
nombre). Validado junio 2026: ANMAT 79,4% ($100,2M·9) · Sin clasificar 17,2% ($21,7M·7)
· CG 3,5% ($4,4M·2); suma EXACTA al total ($126.229.317,50).

| Capacidad | Tool | Entity → chip | Estado | Fix |
|---|---|---|---|---|
| Ingresos por categoría / % ANMAT vs CG / reporte ejecutivo / distribución | **revenue_by_category_report** | revenue_categoria → /billing | ✅ código · **mig 0184 APLICADA** | — |
| **Capa VISUAL ejecutiva (estándar 2026-07-07)**: tableros con KPI cards + tabla + donut/barras SVG nativas + insight + warnings, adjuntos DETERMINÍSTICAMENTE por el engine (adaptadores `visuals.ts` sobre las filas de la tool; el modelo no toca números) | adaptadores: revenue_by_category, customer_revenue, supplier_spend, bank_balances, billing_summary, compliance_pending, docs_browse | `CopilotAnswer.visual` → render `VisualReport` en CopilotChat | ✅ **implementado** (renderer SVG sin libs, dark-safe) | brechas restantes: líneas/tendencias, comparación entre períodos, export |
| UX documental "principal vs relacionados" | docs_browse (adaptador visual kind 'document') | mejor coincidencia como KPI + relacionados en tabla separada + warning | ✅ primera iteración | brecha: deep-link por documento individual (Drive) = P5 diferido |
| **Vacancia / capacidad / cubículos ANMAT** (smoke 2026-07-07) | **vacancy_overview (nuevo, `fetchRows` = FUENTE COMPARTIDA: motor corporate-capacity + CommittedSnapshot crm_opportunities, RLS `comercial.view`; sin migración, sin duplicar cálculo)** | vacancy_metric → /comercial/dashboard-vacancia | ✅ código — paridad UI↔Copilot por construcción | — |
| Guard documental: vocabulario de recuperación (plancheta/plano/sedes/"me puedes dar") | guardrails METADATA_INTENT_TERMS + SINGULAR_DOC_OBJECT + CONTENT ("incumpl","qué pasa si") | — | ✅ las 4 preguntas reales del smoke pasan; contenido sigue degradando (tests adversariales verdes) | — |
| KPI cards con progress + tonos semánticos (estilo Cockpit) | `CopilotVisualKpi.pct/tone` + renderer | — | ✅ | brecha: líneas/tendencias, export |
| **Intención puntual "número primero"** (cuántos/qué %) | `vacancy_overview` con `focus`/`categoria`; KPI principal grande (col-span, text-2xl) | — | ✅ (cubículos/vacancia/m² por categoría) | extender a más dominios según smoke |
| **Fuentes INLINE** (por card y por fila) | `CopilotVisualKpi.url/actionLabel` + `table.rowLinks` + `SourceAction` (externa ↗ / interna →); chips globales quedan como fallback | — | ✅ | — |
| **Links REALES a Drive en documentos** | `ToolSpec.enrich` (docs_browse): post-RPC lee `url` de compliance_documents/contract_documents por entity_id (cliente de sesión/RLS, sin migración; 569/569 con drive_file_id) → botón "Abrir documento (Drive)"; sin URL → "Ver ficha (solo metadata)" explícito | acción en visual; chip interno /anmat = fallback | ✅ | brecha residual: viewer interno/download proxy |
| **Contratos ejecutivos** (firmados / por vencer) | adaptador `contracts_overview`: KPI "último mes" SOLO si el usuario acotó el período (`args.periodo`, hint del router que no viaja al RPC); sin período → "Firmados recientes: N" / KPI alerta danger si ≤30 días + semáforo 🔴🟡🟢 + barras por días restantes + fuente por fila | contrato → /comercial/contratos | ✅ (round 2 smoke) | detalle por contrato individual (no existe página) |
| **"El último contrato firmado" = SINGULAR** (smoke round 2) | router: `/ultim[oa] contrato/` → mode firmados_recientes + **limit=1** (la RPC ya ordena por firma desc; sin migración) + query por tipo (ANMAT/Cargas Generales); adaptador → **card única kind 'document'** (cliente/tipo/firma/vencimiento/estado + acción de escalera + warning si no hay Drive) | acción inline en la card | ✅ | empates de fecha_firma (import masivo 2026-05-21): desempate determinístico del RPC |
| **Dashboard contractual** ("mostrame contratos vigentes") | adaptador modo vigentes/todos: KPI total + KPIs por tipo (con pct) + "vencen en 90 días" (warn) + vencidos (danger) + **calidad documental (Con contrato en Drive ok / Sin vínculo documental danger)** + donut por tipo + **barras por estado + donut disponibilidad documental (charts[])** + orden inteligente + **tabla acotada a 12 críticos** + aviso de cap de la tool (p_limit 50 < 57 vigentes reales) + insight | — | ✅ (round 2 smoke) | — |
| **Escalera de links documentales de contratos** | enrich en contracts_overview (sesión/RLS): contract_documents.url → **"Abrir contrato"** (kind drive) · drive_folder_id → **"Carpeta Drive"** (kind folder) · fallback → **"Sin PDF vinculado"** (kind fallback, UI atenuada, navega al módulo pero NUNCA se presenta como fuente documental; "Ir a contratos" a secas quedó prohibido) + columna "Documento" con badge por fila | acciones inline por fila | ✅ código · **cobertura de DATOS en prod: 5 con archivo + 18 solo carpeta + 34 sin vínculo de 57 vigentes** | 👻 brecha de DATOS: vincular Drive a los 34 restantes (Drive sync, no código) |
| **Command Center: retorno + grilla equilibrada** (smoke round 2) | botón "✨ Volver a recomendaciones" tras cada respuesta (toggle `showHome`; historial INTACTO, elegir otra sugerencia repliega) + 10ª sección supported **"Salud operativa · Riesgos"** (clients_health / workflows_stuck / ops_digest ayer) → 10 secciones = grilla 2-col sin hueco (test de paridad en copilot-suggestions.test.ts) | — | ✅ | — |
| Comparación entre períodos ("comparame este mes vs anterior") | — | — | 🟡 parcial: el modelo puede llamar la tool 2 veces (períodos distintos); tool comparativa dedicada = fase futura | backlog |
| **Brecha de datos**: clientes sin tag (`CLIENTE TEST QA TOPS`, `Verotin SA`) | — | — | 👻 su facturación cae en "Sin clasificar" (visible) | asignar tags en /clients (dato, no código) |

Base extensible: el patrón tool-por-reporte (opción A del diseño) queda establecido con
`billing_summary`, `customer_revenue_overview`, `supplier_spend_overview`,
`bank_balances_overview`, `revenue_by_category_report`. Próximos reportes de la matriz
(compliance_risk_report, wms_occupancy_report) siguen el mismo molde.

## Criterio de arquitectura aplicado (y a aplicar en próximas fases)
1. **Datos en DB** → RPC `SECURITY INVOKER` + tool (RLS del caller; migración aditiva con rollback, aplicada solo con OK).
2. **Datos estáticos en frontend** → módulo compartido en `src/lib/` consumido por UI y Copilot (patrón `orgchart.ts` → `org-source.ts`; `nexus-sections.ts` como catálogo).
3. **Fuentes externas (Clientify/Drive/Hikvision)** → SIEMPRE vía cache/proyección en DB; nunca scraping vivo por pregunta.
4. **Links** → `entityUrl` a nivel módulo; `publicId` es pista, no requisito; test anti-404 filesystem-backed obliga a que cada ruta exista como `page.tsx`.
5. **Agregados** (totales/saldos/rankings) → SQL calcula, el modelo narra (regla 4 del prompt).
6. **Vacío real** → mensaje honesto por dominio (P1a), nunca el fallback genérico si la tool corrió.

## Priorización recomendada (próximas fases)
1. **Aplicar 0182** (billing/bancos/gasto proveedor) — código listo, solo falta el SQL.
2. **OS/órdenes de servicio** (`orders`) — corazón operativo, fuente simple.
3. **WMS stock + vencimientos** — ANMAT-crítico, tablas listas.
4. **Tesorería movimientos + caja chica + flujo de fondos** — fuentes estructuradas listas.
5. **Vacancia** (tool local sobre corporate-capacity) + **tracking** (última posición).
6. **CRM nativo** (oportunidades/leads) + Clientify cache.
7. **RRHH / Libro IVA** — solo con decisión de producto / gate contadora.
