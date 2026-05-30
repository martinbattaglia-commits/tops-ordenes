# FASE 1A · IMPACT ANALYSIS

**Scope:** efecto de FASE 1A sobre módulos vivos, datos, equipo, infra, seguridad y métricas.
**Estado:** análisis · sin implementación.

---

## 1 · Impacto en código existente

| Componente | Tipo de impacto | Riesgo |
|------------|------------------|--------|
| `src/lib/invoicing/calc.ts` | **Reutilizar tal cual** desde motor recurrente | bajo |
| `src/lib/invoicing/emit.ts` | **Reutilizar tal cual** para emitir facturas generadas por contrato | bajo |
| `src/lib/invoicing/storage.ts` | **Reutilizar** `buildInvoicePdfPath` + bucket `invoices` | bajo |
| `src/lib/invoicing/data.ts` | **Extender** con nuevos accessors (no modificar existentes) | bajo |
| `src/lib/invoicing/types.ts` | **Extender** con tipos de recurring/CC (aditivo) | bajo |
| `src/lib/arca/*` | **NO TOCAR** | nulo |
| `src/lib/rbac/check.ts` | **Reutilizar** `requireDrivePermission()` pattern para `requireBillingPermission()` | bajo |
| `src/lib/rbac/data.ts` | **Añadir** seeds nuevos billing.* sin tocar existentes | bajo |
| `src/lib/supabase/server.ts` | **Sin cambio** — usar `createClient()` y `createAdminClient()` ya implementados | nulo |
| `src/app/(app)/billing/page.tsx` | **Refactor:** convertir a shell con tabs | medio |
| `src/app/(app)/billing/actions.ts` | **Extender** acciones (no romper existentes) | bajo |
| `src/app/(app)/billing/EmitInvoiceButton.tsx` | **Reutilizar** tal cual | nulo |
| `src/components/shell/Sidebar.tsx` | **Añadir** dominio "Facturación" con sub-items | bajo |
| `src/components/Icon.tsx` | **Extender** con íconos nuevos (`receipt`, `recurring`, etc.) | bajo |
| `src/app/(app)/ejecutivo/page.tsx` | **Añadir** widgets MRR/ARR/cobranza sin tocar existentes | bajo |
| `src/app/(app)/clients/*` | **No tocar** listado actual; agregar tab "Cuenta corriente" como link externo a `/billing/clientes/[id]` | bajo |
| `src/app/api/invoices/[id]/pdf` | **Reutilizar** para PDF de facturas recurrentes (generan el mismo tipo) | nulo |
| `src/app/api/billing/*` | **NUEVO** dir | n/a |
| Migrations 0001-0013 | **NO TOCAR** | nulo |
| ARCA libraries | **NO TOCAR** | nulo |
| Drive integration | **NO TOCAR** (sigue 🟢 READY) | nulo |
| Compliance Alert Engine (`/anmat`) | **NO TOCAR** | nulo |

**Resumen impacto en código:** **80% aditivo (sin riesgo), 20% extensiones controladas**. Cero refactor destructivo.

---

## 2 · Impacto en datos

### 2.1 Tablas existentes

| Tabla | Cambio | Riesgo |
|-------|--------|--------|
| `clients` | trigger `clients_create_account` AFTER INSERT — crea 1 row en `customer_accounts` | bajo (idempotente con `on conflict do nothing`) |
| `customer_invoices` | sin schema change. Lecturas adicionales para CC + recurring metadata via `observ` tag | nulo schema, bajo en performance |
| `invoice_items` | sin cambio | nulo |
| `invoice_audit` | sin cambio | nulo |
| `clients.condicion_iva`, `tipo_doc`, `localidad` | ya existen (mig 0011), se usan más activamente | nulo |
| `puntos_venta` | sin cambio | nulo |
| `fiscal_config` | sin cambio | nulo |
| `permissions` (mig 0009) | +9 rows nuevas con on conflict do nothing | nulo |
| `role_permissions` | +N rows con on conflict do nothing | nulo |
| `user_roles` | sin cambio (sigue dormido hasta seedeo manual) | nulo |
| `profiles` | sin cambio | nulo |

### 2.2 Tablas nuevas (creadas por 0014)

- 10 tablas + 1 view + ~7 triggers + ~9 índices

### 2.3 Storage

| Bucket | Estado | Cambio |
|--------|--------|--------|
| `invoices` | existente (mig 0011/0013) | sin cambio |
| `receipts` | NUEVO | bucket privado + RLS multi-tenant |
| `contracts` | NUEVO | bucket privado + RLS multi-tenant |
| Otros buckets (`attachments`, `pdfs`, `signatures`, `po-pdfs`, `po-signatures`) | existentes | sin cambio |

### 2.4 Volúmenes estimados primer año

| Tabla | Estimación rows/año |
|-------|---------------------|
| `payment_terms` | ~10 (catálogo, ~estático) |
| `recurring_contracts` | 50-100 contratos activos |
| `recurring_contract_lines` | 100-300 |
| `recurring_runs` | 50-100 × 12 meses = 600-1.200 |
| `customer_accounts` | ~30-50 (1 por cliente) |
| `customer_transactions` | ~5.000 (facturas + cobros + NC + ajustes + mora) |
| `customer_payments` | ~500-1.000 |
| `customer_payment_applications` | ~1.000-2.000 |
| `late_fee_rules` | <5 |
| `customer_late_fee_charges` | <100 |
| `customer_balances` view | computado |

**Total nuevo: ~10K rows/año.** Negligible en Supabase plan actual.

### 2.5 Drive storage

| Tipo | Volumen estimado |
|------|------------------|
| PDFs de facturas (ya generadas) | mantiene actual |
| PDFs de recibos | ~50-100/mes · ~150KB = ~15MB/año |
| PDFs de contratos | ~50/año × ~200KB = ~10MB/año |

**Total nuevo: <30MB/año.** Negligible.

---

## 3 · Impacto en infraestructura

### 3.1 Supabase

| Recurso | Antes | Después FASE 1A | Riesgo |
|---------|-------|-----------------|--------|
| Tablas | ~20 públicas | ~30 públicas | bajo |
| Triggers | ~5 | ~12 | bajo (todos pre/after lightweight) |
| RLS policies | ~50 | ~80 | bajo |
| Index size | ~50MB | ~70MB | nulo |
| Realtime publications | ~3 tablas | ~6 tablas | medio (más eventos = más conexiones) |

### 3.2 Netlify

| Recurso | Antes | Después FASE 1A |
|---------|-------|-----------------|
| Routes | ~50 | ~65 (+/billing/* + /api/billing/*) |
| Scheduled functions | 0 | 1 (cron mensual recurrente) + 1 (cron diario mora) |
| Build time | ~1 min | ~1-1.5 min |
| Functions invocations | ~10k/mes | ~12k/mes |
| Edge functions | sin cambio | sin cambio |

### 3.3 Costos externos

| Costo | Antes | Después |
|-------|-------|---------|
| Supabase Pro | $25/mes | $25/mes (sin cambio de tier) |
| Netlify Pro | $19/mes | $19/mes (scheduled functions incluidas) |
| Drive Workspace | actual | sin cambio (volumen <30MB/año adicional) |
| OpenAI | OCR docs | sin cambio (FASE 1A no usa OCR) |
| ARCA | $0 | $0 (sigue sandbox; cuando prod, sin costo) |
| BCRA cotización API (opcional) | $0 | $0 (endpoint público gratuito) |

**Sin cambios de tier en proveedores.**

---

## 4 · Impacto en equipo / proceso operativo

### 4.1 Roles afectados

| Persona | Tarea actual | Tarea post-FASE 1A | Cambio neto |
|---------|--------------|---------------------|--------------|
| **Ruth (Admin)** | Emite cada factura recurrente manualmente | Configura 1 vez el contrato → motor genera mensual | -5 a -10 horas/mes |
| **Ruth** | Lleva cuenta corriente en Excel | Sistema integrado, real-time | -3 horas/semana |
| **Ruth** | Registra cobros en Excel | Wizard de cobro con aplicación a facturas | -2 horas/semana |
| **Ruth** | Calcula intereses por mora a mano | Cron diario aplica según rules | -1 hora/semana |
| **JL (Director)** | Pregunta a Ruth saldo cliente X | Ve dashboard cuenta corriente real-time | -0 directo, +visibilidad |
| **JL** | Revisa facturación mensual ad-hoc | Widget MRR/ARR en cockpit | mejora calidad de decisión |
| **Operaciones** | No interviene en billing | Sigue sin intervenir (solo `billing.view`) | nulo |
| **Comercial** | No interviene en billing | Lee saldos de clientes (CRM context) | mejora prospección |
| **Compliance/DT** | No interviene | Sin cambio | nulo |
| **Cliente externo** | Recibe facturas por email | Mismo flow + opcional portal de saldo (futuro) | nulo en FASE 1A |

### 4.2 Capacitación necesaria

| Audiencia | Sesión | Duración |
|-----------|--------|----------|
| Ruth | Demo wizard contratos + cuenta corriente + cobros | 2h |
| JL | Demo dashboard MRR/ARR + drill-down moroso | 30 min |
| Operaciones | Demo CC read-only + cómo evitar tocar billing | 30 min |
| Backup admin (sustituto Ruth) | Misma sesión que Ruth | 2h |

---

## 5 · Impacto en seguridad

### 5.1 Superficie de ataque añadida

| Vector | Mitigación |
|--------|------------|
| Endpoints `/api/billing/*` | RBAC + rate-limit pattern reusado del módulo Drive |
| Bucket `receipts` y `contracts` | Multi-tenant RLS pattern 0013 replicado |
| Cron scheduled function | secret en env var Netlify, no exposed |
| Realtime nuevo (3 tablas) | RLS aplicada igual que tablas read |
| View `customer_balances` | RLS de underlying o función SECURITY DEFINER plan B |

### 5.2 Datos sensibles nuevos

| Dato | Sensibilidad | Encriptación |
|------|--------------|--------------|
| Saldo cuenta corriente cliente | alta | RLS + HTTPS |
| Referencia bancaria (transferencia) | media | RLS + HTTPS (no encriptado at-rest específico) |
| CBU/Alias en `customer_payments.bank/reference` | media | idem |
| Late fee rate específica por cliente | baja | idem |

### 5.3 Compliance

| Regulación | Aplica? | Cumplimiento |
|------------|---------|--------------|
| AFIP RG 4892/2020 (QR fiscal) | sí, vía facturas | ya cumplido por mig 0011 |
| Ley 25.326 datos personales | sí | RLS multi-tenant cumple |
| Ley 27.401 compliance fiscal | sí | append-only ledger + audit trail cumplen |
| BCRA externalización de servicios | parcial (Supabase USA) | requiere verificar contratos |

---

## 6 · Impacto en métricas operativas

### 6.1 KPIs nuevos a exponer

| KPI | Cálculo | Frecuencia | Dueño |
|-----|---------|-----------|-------|
| MRR | `sum(recurring_contract_lines.cantidad * precio * frecuencia_factor) where contract.status='ACTIVO'` | real-time | JL |
| ARR | MRR × 12 | real-time | JL |
| Facturación del mes | `sum(customer_invoices.total) where periodo=current_month and not anulada` | real-time | Ruth + JL |
| Facturación proyectada 3M | `sum(MRR × 3 + estimados directos)` | weekly | JL |
| Cobranza pendiente | `sum(invoices.total) - sum(payment_applications.applied_amount) where invoice.estado='AUTORIZADO_ARCA'` | real-time | Ruth |
| Saldo total clientes | `sum(customer_balances.balance_pes)` | real-time | Ruth |
| Clientes morosos | `count(balances where overdue_30_pes > 0)` | real-time | Ruth |
| DSO (Days Sales Outstanding) | promedio días entre fecha factura y fecha cobro | monthly | JL |
| Tasa de cobro on-time | `% facturas cobradas antes del vencimiento` | monthly | JL |
| Churn de contratos | `% contratos cancelados en 30 días` | monthly | JL |

### 6.2 KPIs existentes afectados

| KPI | Antes | Después |
|-----|-------|---------|
| OC firmadas mes (cockpit) | calculado de purchase_orders | sin cambio |
| OS operativas (cockpit) | calculado de orders | sin cambio |
| ANMAT compliance % (cockpit) | de anmat data | sin cambio |
| Ocupación m² (mapa) | de LOCATIONS | enriquecido con MRR por sede |

---

## 7 · Impacto en performance

### 7.1 Read

| Pantalla | Carga adicional | Mitigación |
|----------|------------------|------------|
| `/billing` shell | +1 query para totales | índices + 1 segundo cache |
| `/billing/recurrentes` lista | +1 query (~100 rows max) | rápido |
| `/billing/clientes` lista | +1 query view `customer_balances` (~50 rows max) | índices |
| `/billing/clientes/[id]` detalle | +5 queries (CC, facturas, cobros, contracts, audit) | parallel via Promise.all |
| `/ejecutivo` con widgets nuevos | +4-5 queries pequeñas (MRR, cobranza, morosos) | aggregated views |

### 7.2 Write

| Operación | Tiempo estimado | Notas |
|-----------|-----------------|-------|
| Crear contrato (wizard) | <500ms | 1 insert + N lines |
| Run del motor (1 contrato) | ~1-2s (incluye ARCA si auto-emit) | aceptable |
| Cron run mensual (~50 contratos) | ~30-60s total batch | acepta, corre en background |
| Confirmar cobro | <500ms | 1 insert payment + N applications + 1 transaction |
| Aplicar mora cron diario | ~10-20s para ~50 invoices vencidas | aceptable |

### 7.3 Real-time

| Tabla con realtime | Subscriptores estimados | Eventos/día estimados |
|---------------------|--------------------------|------------------------|
| `customer_transactions` | 1-3 (UI CC abierta) | ~100 |
| `customer_payments` | 1-2 | ~10 |
| `recurring_runs` | 1-2 (monitor cron) | ~50 cron + N manual |

Carga negligible.

---

## 8 · Impacto en testing

### 8.1 Tests nuevos requeridos

| Tipo | Cantidad |
|------|---------|
| RLS tests (T1-T12) | 12 |
| Unit tests motor recurrente | ~10-15 |
| Unit tests aplicación pagos | ~8 |
| Unit tests cálculo de mora | ~6 |
| Integration tests wizard contratos | ~5 |
| E2E test flow completo (contrato → run → factura → cobro) | 1 |

### 8.2 Tests existentes afectados

| Test | Riesgo |
|------|--------|
| Tests de mig 0011 (GATE 2 validados) | nulo — no se tocan tablas |
| Tests de Drive | nulo |
| Tests de RBAC R22 | nulo (helper se reutiliza) |
| Tests de ARCA sandbox | nulo |

---

## 9 · Impacto en documentación

### 9.1 Docs nuevas

- `docs/erp/FASE-1A-AUDIT.md` ✅ generada
- `docs/erp/FASE-1A-DATA-MODEL.md` ✅ generada
- `docs/erp/FASE-1A-RELATIONS.md` ✅ generada
- `docs/erp/FASE-1A-RLS.md` ✅ generada
- `docs/erp/FASE-1A-MIGRATION-0014.md` ✅ generada
- `docs/erp/FASE-1A-UX.md` ✅ generada
- `docs/erp/FASE-1A-RISKS.md` ✅ generada
- `docs/erp/FASE-1A-IMPACT.md` ✅ generada (este)
- `docs/erp/FASE-1A-IMPL-PLAN.md` ⏳ pendiente
- `docs/erp/FASE-1A-CLOSURE-REPORT.md` (post-deploy)

### 9.2 Docs existentes a actualizar (post-implementación)

| Doc | Cambio |
|-----|--------|
| `docs/TOPS-NEXUS-ERP-V2-MASTER-PLAN.md` | marcar FASE 1A → "en curso" / "cerrada" |
| `tops_nexus_state.md` (memoria) | añadir entry sobre tablas nuevas + cron |
| README del repo | mencionar módulo billing recurrente |
| `docs/ERP-AUDITORIA-SUPABASE-*` | actualizar al aplicar 0014 |

---

## 10 · Plan de comunicación

| Stakeholder | Mensaje | Canal | Cuándo |
|-------------|---------|-------|--------|
| JL (Director) | "Aprueba scope FASE 1A y pre-condiciones" | reunión | pre-implementación |
| Ruth (Admin) | "Demo del wizard + cuenta corriente, 2h" | reunión virtual | pre-deploy |
| Operaciones | "Sigue sin tocar billing, no afecta su día a día" | email | post-deploy |
| Clientes | "Las facturas siguen llegando igual, ahora con QR + numeración consistente" | email opcional | post-deploy si hay cambio visible |
| Contador externo | "Plan de cuentas se diseña en FASE 4, FASE 1A no toca contabilidad" | email | pre-implementación |
| Equipo dev | Walkthrough de los 9 docs antes de codear | reunión técnica | post-aprobación, pre-código |

---

## 11 · Métricas de éxito vs base actual

| Métrica | Base (hoy) | Target post-FASE 1A | Cómo medir |
|---------|------------|---------------------|------------|
| Tiempo emisión 1 factura recurrente | 5-10 min | <30 seg (con auto_emit) | log de runs vs ts manual |
| Discrepancia CC vs Excel Ruth | desconocido | <1% mensual | comparación quincenal |
| Latencia query saldo cliente | manual (Excel) | <500ms p95 | métricas Supabase |
| Cobros aplicados correctamente | manual (Excel) | 100% | sum(applications) = payment.amount |
| Visibilidad MRR para JL | ad-hoc | real-time dashboard | tiempo a info |
| Facturas con error ARCA | desconocido | <2% | invoice_audit |
| Tiempo cierre mensual (cobranzas) | varios días | mismo día | journal date |

---

## 12 · Resumen ejecutivo de impacto

| Dimensión | Resultado neto |
|-----------|----------------|
| **Código** | 80% aditivo, 20% extensiones controladas (refactor `/billing` shell) |
| **Datos** | 10 tablas + 1 view nuevas. ~10K rows/año. ~30MB Drive/año. Negligible. |
| **Infra** | Sin upgrade de tier. +2 scheduled functions Netlify. +3 tablas en realtime. |
| **Equipo** | Ruth gana ~15 hs/mes. JL gana visibilidad financiera real-time. Cero impacto operativo en otros roles. |
| **Seguridad** | Superficie ampliada y mitigada con patterns ya validados (R22 + 0013). |
| **Compliance** | Mantiene cumplimiento AFIP existente. Append-only ledger refuerza auditoría. |
| **Costos** | Sin incremento. |
| **Riesgos críticos** | 5 (todos identificados y con mitigación planeada). Backup externo es bloqueante. |
| **Tests** | ~30-40 tests nuevos. Tests existentes intactos. |
| **Docs** | 9 nuevas (8 ya generadas + impl plan pendiente). |

---

## Restricciones honradas

- 🛑 NO IMPLEMENTAR
- 🛑 NO TOCAR código existente
- 🛑 NO DEPLOY · NO MERGE · NO PUSH · NO COMMIT
- 🛑 NO INVENTAR estimaciones — todas las cifras están justificadas por scope verificable
