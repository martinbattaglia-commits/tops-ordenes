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
