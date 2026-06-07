# ANALYTICS EJECUTIVO · ARQUITECTURA DEL DASHBOARD DE DIRECCIÓN

**Proyecto:** TOPS Nexus — Logística TOPS (Verotin S.A.)
**Presidente:** Martín Battaglia
**Documento:** `ANALYTICS_EJECUTIVO_ARCHITECTURE.md`
**Fecha:** 2026-06-07
**Naturaleza:** **auditoría + diseño**. No se escribió código, ni UI, ni se modificó producción. No se tocó ERP-A ni ERP-B.
**Fuente de verdad:** producción `arsksytgdnzukbmfgkju` (única referencia válida). Donde un dato vive **fuera** de prod (p. ej. Clientify) se marca explícitamente.

> **Objetivo:** dashboard único para Dirección con el estado completo de la compañía, **basado exclusivamente en datos reales ya existentes en Nexus**. La auditoría determina qué KPIs son **confiables hoy**, cuáles **existen pero están vacíos** (se poblarán con la operación) y cuáles **aún no pueden calcularse** (falta fuente).

---

## 0. Hallazgo central (leer primero)

Nexus tiene el **esquema y los motores completos**, pero la **base productiva contiene datos piloto mínimos**. El dashboard es **implementable** reusando capas de datos ya funcionales; el límite no es técnico sino de **volumen de datos reales**. Clasificación que gobierna todo el diseño:

| Tier | Significado | Ejemplos |
|---|---|---|
| 🟢 **A — Confiable hoy** | fuente real + funcional + con datos | WMS capacidad/vacancia, Tesorería saldos/flujo, Órdenes operativas, AP facturas proveedor, Pipeline Clientify |
| 🟡 **B — Listo pero vacío/escaso** | fuente real y funcional, **sin volumen** aún | IVA Compras/percepciones (detalle fiscal = 0), CRM local (`crm_*` = 0), Tracking (1 vehículo), Facturación cliente (2 fact., CAE mock) |
| 🔴 **C — No calculable** | **falta fuente o módulo** | Rentabilidad (sin costos), Incidentes (sin módulo), Forecast ponderado (no implementado), Facturación fiscal real (ARCA SANDBOX) |

---

## 1. Mapa de fuentes de datos

Evidencia de prod `arsksytgdnzukbmfgkju` (conteos reales) + capa de acceso en código.

| Dominio | Fuente (tabla/vista/motor) | Acceso (código) | Datos reales en prod | Tier |
|---|---|---|---|---|
| **Comercial** | Clientify (SaaS externo) | `src/lib/clientify/data.ts` `getPipelineSnapshot()` | Pipeline live (si `CLIENTIFY_API_KEY`) | 🟢A* |
| | `crm_leads/opportunities/quotes/proposals/contracts` | `src/lib/comercial/*-data.ts` | **0 filas (todas)** | 🟡B |
| **Financiero** | `treasury_bank_balances` (vista) | `src/lib/tesoreria/data.ts` | 3 cuentas | 🟢A |
| | `treasury_movements` | idem | 2 movimientos | 🟡B |
| | `customer_open_items` / `customer_current_account` | idem | 1 recibo · derivado | 🟢A |
| | `supplier_open_items` / `supplier_current_account` | idem | 1 pago · derivado | 🟢A |
| | `treasury_cashflow_projection` (vista) | idem | derivado de vencimientos | 🟢A |
| **Compras** | `supplier_invoices` | `src/lib/erp/data.ts` | 4 facturas ($1.34M) | 🟢A |
| | `supplier_invoice_fiscal` / `libro_iva_compras` (vistas) | `src/lib/erp/libro-iva-data.ts` | **vat_lines=0 → libro vacío** | 🟡B |
| | `supplier_ap_status` (vista) | `src/lib/erp/data.ts` | 4 (estado AP) | 🟢A |
| **Operaciones** | `orders` / `order_services` / `v_orders_dashboard` | `src/lib/data/orders.ts` | 15 órdenes · 30 servicios | 🟢A |
| | `logistics_orders` | `src/lib/...` | 8 pedidos | 🟢A |
| | Incidentes | — | **módulo inexistente** | 🔴C |
| **WMS** | Capacity Engine (modelos locales m²) | `src/lib/wms/corporate-capacity.ts` | m² relevados reales (Luján+Magaldi) | 🟢A |
| | Digital Twin (`warehouse_*` + `inventory_items`) | `src/lib/wms/twin.ts` | 24 posiciones (**todas `disponible`** → ocup. 0%) | 🟡B |
| **Tracking** | `fleet_positions/vehicles` + realtime CDC | `src/lib/tracking/*` | 1 vehículo · pos. escasas | 🟡B |
| | `geofences` / `fleet_events` | `src/lib/tracking/engine/geofence.ts` | 2 cercas (inactivas) · **eventos = stub** | 🔴C |
| **Clientes** | `clients` / `customer_invoices` | `src/lib/invoicing/data.ts` | 2 clientes · 2 fact. (**CAE mock, SANDBOX**) | 🟡B |
| | Rentabilidad (costos) | — | **sin datos de costo** | 🔴C |

> *Comercial-A: el pipeline es confiable pero vive en **Clientify (externo)**, no en prod. Bajo la regla "prod = única referencia válida", los KPIs comerciales requieren o bien Clientify (externo, ya integrado) o **poblar `crm_*`** vía el sync existente (`/api/clientify/sync-deals`, hoy sin cron visible). Decisión a ratificar (ver §8 R-P1).

**Dashboards ya existentes (reusables):** `/ejecutivo` (incompleto: 2/4 KPIs null), `/dashboard` (órdenes), `/reports`, `/compras`, `/comercial/dashboard-vacancia` (capacidad — completo), `/comercial/pipeline` (Clientify), `/billing`, `/wms`, `/compras/libro-iva` (B3). El dashboard ejecutivo **agrega** estas capas, no las reimplementa.

---

## 2. KPIs ejecutivos (titulares cross-dominio)

Fila superior del dashboard — los 6 números que Dirección mira primero.

| KPI | Fórmula | Fuente | Tier | Estado hoy |
|---|---|---|---|---|
| **Caja disponible** | Σ `treasury_bank_balances.balance` | vista tesorería | 🟢A | confiable |
| **Por cobrar (AR)** | Σ `customer_open_items.saldo` | vista | 🟢A | confiable (bajo volumen) |
| **Por pagar (AP)** | Σ `supplier_open_items.saldo` | vista | 🟢A | confiable |
| **Vacancia comercial %** | Capacity Engine `getCorporateVacancySummary()` | motor WMS | 🟢A | confiable |
| **Pipeline abierto** | Clientify `pipelineTotal` | Clientify | 🟢A* | confiable (externo) |
| **Órdenes del mes** | count `orders` (mes) | `orders` | 🟢A | confiable |

> Regla de honestidad: cada tarjeta muestra **fuente + fecha de dato**; los KPIs Tier B/C se muestran con badge "se poblará con la operación" o "no disponible — requiere X", nunca un cero engañoso (patrón ya usado en `/ejecutivo`).

---

## 3. KPIs financieros

| KPI | Fórmula | Fuente | Tier |
|---|---|---|---|
| Saldos por cuenta | `treasury_bank_balances` (opening + Σ movimientos) | vista | 🟢A |
| Caja total / por banco | Σ balance | vista | 🟢A |
| Cobros del período | `customer_receipts` (Σ por fecha) | tabla | 🟢A (escaso) |
| Pagos del período | `supplier_payments` (Σ por fecha) | tabla | 🟢A (escaso) |
| Cuenta corriente cliente | `customer_current_account` (saldo, próx. vto) | vista | 🟢A |
| Cuenta corriente proveedor | `supplier_current_account` | vista | 🟢A |
| **Flujo proyectado** | `treasury_cashflow_projection` (fecha, monto, acumulado) | vista | 🟢A |
| Aging AR/AP | `customer/supplier_open_items.estado_*` | vistas | 🟢A |

**Confiables**: todo el bloque financiero (la infraestructura ERP-A está cerrada y validada). **Caveat**: volumen real bajo (2 movimientos, 1 recibo, 1 pago) → los números son correctos pero pequeños hasta que crezca la operación.

---

## 4. KPIs comerciales

| KPI | Fórmula | Fuente | Tier |
|---|---|---|---|
| Pipeline total (abierto) | Σ `amount` deals abiertos | Clientify | 🟢A* |
| Deals por etapa | group by stage | Clientify | 🟢A* |
| Ganado YTD | Σ `amount` won (año actual) | Clientify | 🟢A* |
| Top deals | top 6 abiertos por monto | Clientify | 🟢A* |
| Leads (bandeja/estado) | `crm_leads` | prod | 🟡B (0 filas) |
| Oportunidades locales | `crm_opportunities` | prod | 🟡B (0 filas) |
| **Forecast ponderado** (monto×prob) | — | — | 🔴C (no implementado) |
| **Facturación proyectada** (desde CRM) | — | — | 🔴C (el KPI actual del dashboard es facturación **realizada** de órdenes, mal rotulado) |

**Confiable hoy**: snapshot Clientify (pipeline/won/top), **externo a prod**. **Gap**: `crm_*` en prod están vacías; el forecast ponderado y la facturación proyectada real **no existen** (requieren cálculo nuevo monto×probabilidad y/o sync Clientify→`crm_*`).

---

## 5. KPIs operativos

| KPI | Fórmula | Fuente | Tier |
|---|---|---|---|
| Órdenes del mes / estado | count/group `orders.status` | `orders` / `v_orders_dashboard` | 🟢A |
| Ingreso por órdenes (realizado) | Σ `orders.total` (FIRMADA) | `orders` | 🟢A |
| Órdenes por depósito | group depot | vista | 🟢A |
| Tasa de firma | firmadas / total | `orders` | 🟢A |
| Pedidos logísticos | `logistics_orders.status` | tabla | 🟢A |
| Flota — vehículos activos / última posición | `listFleet()` | `fleet_*` | 🟡B (1 vehículo) |
| Flota — online/offline | recency de `recorded_at` | derivado | 🟡B |
| **Geofence enter/exit** | `fleet_events` | — | 🔴C (emisión = stub) |
| **Incidentes** | — | — | 🔴C (módulo inexistente) |

**Confiable**: órdenes y pedidos. **Tracking**: funcional end-to-end (ingest Traccar→`fleet_positions`→realtime CDC→Mapbox) pero **1 vehículo y datos escasos**; **pendiente P1 visual**: el basemap Mapbox colapsa a `height:0` (bug de layout conocido, no aplicado). **Incidentes**: no hay tabla ni módulo → **no calculable**.

---

## 6. KPIs WMS

| KPI | Fórmula | Fuente | Tier |
|---|---|---|---|
| Capacidad comercializable m² | Capacity Engine (modelos Luján+Magaldi) | `corporate-capacity.ts` | 🟢A |
| Ocupado / Disponible / Reservado m² | idem | motor | 🟢A |
| **Vacancia física / comercial / proyectada %** | `getCorporateVacancySummary()` | motor | 🟢A |
| Capacidad por categoría (ANMAT/CG/Oficinas) | `getCapacityByCategory()` | motor | 🟢A |
| Comparación por sede | corporate por sede | motor | 🟢A |
| Posiciones ocupadas % (Digital Twin) | ocupadas/total `warehouse_positions` | `twin.ts` + DB | 🟡B (24 pos., **0% ocupadas**) |
| Stock / clientes activos | `inventory_items` | `getWmsDashboard()` | 🟡B (4 items) |
| Compromisos CRM (reservado/comprometido) | `committed-capacity.ts` ← `crm_opportunities` | snapshot | 🟡B (CRM vacío → físico) |

**WMS es el dominio más fuerte**: la vacancia/capacidad se computa de **m² relevados reales** (modelos locales), independiente del volumen transaccional. El dashboard `/comercial/dashboard-vacancia` ya lo muestra completo. El Digital Twin (posiciones DB) está al 0% de ocupación porque las posiciones aún no se cargaron/operan.

---

## 7. Dashboard principal — Layout

**Ruta propuesta:** consolidar en **`/ejecutivo`** (ya existe, hoy incompleto) o nueva `/analytics`. Server Component que **agrega en paralelo** las capas ya funcionales; cada bloque degrada de forma independiente (un dominio sin datos no rompe el resto). Guard: rol Dirección (`ejecutivo`/admin) — reusar RBAC existente.

```
┌──────────────────────────────────────────────────────────────────────┐
│ HEADER · "Estado de la compañía" · fecha/hora · selector de período    │
├──────────────────────────────────────────────────────────────────────┤
│ FILA 1 · 6 KPI titulares (§2)                                          │
│  Caja │ Por cobrar │ Por pagar │ Vacancia % │ Pipeline │ Órdenes mes   │
├───────────────────────────────┬──────────────────────────────────────┤
│ FINANCIERO (§3)               │ COMERCIAL (§4)                        │
│ · Saldos por banco            │ · Pipeline por etapa (Clientify*)     │
│ · Flujo proyectado (sparkline)│ · Ganado YTD · Top deals              │
│ · Aging AR/AP                 │ · [badge: leads/opps locales = vacío] │
├───────────────────────────────┼──────────────────────────────────────┤
│ WMS (§6)                      │ OPERACIONES (§5)                      │
│ · Vacancia física/com/proy %  │ · Órdenes por estado/depósito         │
│ · Capacidad por categoría     │ · Pedidos logísticos                  │
│ · Comparación por sede        │ · Flota: vehículos/última pos.        │
│                               │ · [badge: incidentes = no disponible] │
├───────────────────────────────┴──────────────────────────────────────┤
│ COMPRAS (§ Compras)                                                    │
│ · Facturas proveedor (count/total) · AP status                        │
│ · IVA Crédito Fiscal + Percepciones [badge: se poblará con OCR]        │
├──────────────────────────────────────────────────────────────────────┤
│ CLIENTES                                                               │
│ · Facturación realizada · Top clientes [badge: rentabilidad = N/D]    │
├──────────────────────────────────────────────────────────────────────┤
│ FOOTER · leyenda de Tiers (confiable / se poblará / no disponible)     │
└──────────────────────────────────────────────────────────────────────┘
```

**Principios:** (1) **solo lectura** (vistas/motores existentes, cero escritura, cero recálculo fiscal en front); (2) **honestidad de datos** — Tier B/C con badge explícito, nunca cero engañoso; (3) **degradación por bloque**; (4) **drill-down** a la pantalla detallada de cada dominio (link a `/tesoreria`, `/compras/libro-iva`, `/comercial/dashboard-vacancia`, etc.).

---

## 8. Riesgos

### 🔴 P0
- **R1 — Riesgo de "dashboard vacío".** Bajo volumen real (CRM 0, IVA compras 0, WMS ocupación 0%, billing mock) puede dar impresión de sistema sin datos. Mitigación: badges de Tier honestos + arrancar por los bloques 🟢A (financiero, WMS capacidad, órdenes) que sí tienen datos; documentar a Dirección qué se poblará con la operación.

### 🟠 P1
- **R2 — Comercial fuera de la fuente de verdad.** El pipeline confiable vive en **Clientify (externo)**; `crm_*` en prod están vacías. Decisión a ratificar: (a) consumir Clientify en el dashboard (externo, ya integrado), o (b) activar cron `/api/clientify/sync-deals` para poblar `crm_*` y leer de prod. Sin esto, "comercial" o es externo o queda vacío.
- **R3 — Forecast ponderado y facturación proyectada inexistentes.** El KPI "facturación proyectada" actual es facturación **realizada** mal rotulada. Implementar forecast real (monto×probabilidad) es trabajo nuevo, no agregación.

### 🟡 P2
- **R4 — Tracking escaso + bug visual P1.** 1 vehículo; basemap Mapbox colapsa a `height:0` (fix conocido, no aplicado). El KPI de flota será pobre hasta que haya dispositivos emitiendo. Geofence events = stub (no calculable).
- **R5 — Facturación cliente es MOCK (ARCA SANDBOX).** `fiscal_config.ambiente='SANDBOX'` → CAE ficticio sin validez fiscal. Los KPIs de facturación cliente reflejan datos no fiscales hasta ERP-C (ARCA productiva).
- **R6 — Digital Twin 0% ocupación.** 24 posiciones todas `disponible`; el % de ocupación física será 0 hasta que se carguen/operen posiciones.

### ⚪ P3
- **R7 — Rentabilidad e incidentes no existen.** Sin datos de costo (rentabilidad) ni módulo de incidentes → estos KPIs deben marcarse "no disponible — requiere módulo" (no inventar).
- **R8 — Performance de agregación multi-dominio.** Varias vistas/motores por request. Mitigación: `Promise.all` + caché corto + degradación por bloque.

---

## 9. Roadmap (fases)

| Fase | Alcance | Tier objetivo | Gate |
|---|---|---|---|
| **AN-0** | Este documento (auditoría + diseño) | — | ✅ aprobación presidencial |
| **AN-1 · Núcleo confiable** | Dashboard `/ejecutivo` v1: titulares + bloques **🟢A** (Financiero ERP-A, WMS capacidad, Órdenes, AP facturas). Solo lectura, honestidad de Tiers. | 🟢A | typecheck/lint/build + verificación visual |
| **AN-2 · Comercial** | Resolver R2 (Clientify externo vs sync `crm_*`); pipeline/won/top en el dashboard | 🟢A* | decisión presidencial de fuente |
| **AN-3 · Compras fiscal** | IVA Crédito Fiscal + Percepciones (se activa solo cuando OCR B2 puebla `vat_lines`) | 🟡B→A | datos reales OCR |
| **AN-4 · Operaciones+** | Tracking (tras fix P1 Mapbox + más vehículos); pedidos logísticos | 🟡B | fix visual + dispositivos |
| **AN-5 · Gaps** | Forecast ponderado (R3), rentabilidad (requiere costos), incidentes (requiere módulo), facturación fiscal (ERP-C) | 🔴C→B | proyectos propios |

> **Orden recomendado:** empezar por **AN-1** (máximo dato real con cero dependencias nuevas). Los Tiers B/C se incorporan a medida que sus fuentes se pueblan o se construyen.

---

## 10. Veredicto

> # 🟢 READY FOR ANALYTICS IMPLEMENTATION
>
> El Dashboard Ejecutivo es **implementable hoy** reusando capas de datos **reales y funcionales** ya existentes en Nexus, en **solo lectura**, sin tocar ERP-A/ERP-B ni producción. La auditoría confirma fuentes accesibles para los 6 dominios y clasifica cada KPI por confiabilidad:
> - **🟢 Tier A (confiable ya):** Financiero completo (saldos, flujo, cobros/pagos, cuentas corrientes — ERP-A cerrado), WMS capacidad/vacancia (Capacity Engine, m² reales), Órdenes operativas, AP facturas proveedor, Pipeline Clientify.
> - **🟡 Tier B (listo pero vacío):** IVA Compras/percepciones (se llena con OCR B2), CRM local (`crm_*`=0), Tracking (1 vehículo), Facturación cliente (mock SANDBOX), Digital Twin (0% ocupación).
> - **🔴 Tier C (no calculable):** Rentabilidad (sin costos), Incidentes (sin módulo), Forecast ponderado (no implementado), Facturación fiscal real (ARCA SANDBOX).
>
> **Recomendación:** implementar **AN-1 (núcleo Tier A)** como v1 del dashboard, con **honestidad de Tiers** (badges "se poblará"/"no disponible", nunca ceros engañosos), y reusar `/ejecutivo` + los dashboards ya funcionales. Decisión a ratificar antes de AN-2: **fuente comercial** (Clientify externo vs sync a `crm_*` para cumplir "prod = única referencia válida").
>
> Este documento es **solo auditoría y diseño**: no se escribió código ni UI, no se modificó producción, no se tocó ERP-A ni ERP-B.

---

## Anexo — Evidencia de producción (`arsksytgdnzukbmfgkju`)

| Dominio | Conteo real | Lectura |
|---|---|---|
| CRM (`crm_leads/opportunities/quotes/proposals/contracts/...`) | **0 / 0 / 0 / 0 / 0** | vacío; pipeline vive en Clientify |
| Tesorería | bank_accounts 3 · treasury_movements 2 · receipts 1 · payments 1 · allocations 1+1 | funcional, escaso |
| Compras | supplier_invoices 4 · **vat_lines 0 · other_taxes 0 · items 0** · libro_iva 0 filas | cabecera sí, detalle fiscal vacío |
| Operaciones | orders 15 · order_services 30 · logistics_orders 8 · shipments 1 | funcional |
| WMS | warehouse_positions 24 (**todas `disponible`**) · sectors 13 · zones 2 · inventory_items 4 | estructura ok, ocupación 0% |
| Tracking | fleet_vehicles 1 · fleet_positions ~14 · fleet_events 0 · geofences 2 (inactivas) | funcional, escaso; eventos stub |
| Clientes | clients 2 · customer_invoices 2 (**CAE mock, SANDBOX**) | mock fiscal |
| Vistas disponibles | treasury_bank_balances, treasury_cashflow_projection, customer/supplier_open_items, customer/supplier_current_account, supplier_invoice_fiscal, libro_iva_compras, supplier_ap_status, v_orders_dashboard, vendor_stats | todas read-only (security_invoker) |
| Motores | Capacity Engine (`corporate-capacity.ts`), Digital Twin (`twin.ts`), Clientify (`clientify/data.ts`), Tracking (`tracking/engine`) | funcionales |

---

*Fin — Arquitectura del Analytics Ejecutivo. Veredicto: READY FOR ANALYTICS IMPLEMENTATION. Solo auditoría y diseño: no se escribió código ni UI, no se modificó producción, no se tocó ERP-A ni ERP-B.*
