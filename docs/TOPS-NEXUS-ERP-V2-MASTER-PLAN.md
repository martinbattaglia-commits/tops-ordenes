# TOPS NEXUS ERP V2 — MASTER PLAN

**Fecha:** 2026-05-29
**Commit base:** `4d1dbff` en `feature/nexus-fullstack`
**Modo:** documento de planificación · **NO IMPLEMENTAR HASTA APROBACIÓN**
**Cumple:** Master Prompt Enterprise V2 — 10 entregables sin código.
**No autorizado:** deploy, merge, push, commit, producción, carga de credenciales.

---

## Resumen ejecutivo

> **TOPS ÓRDENES no es greenfield. Ya está parcialmente convertido a ERP.** Las migraciones 0008–0013 + libs en `src/lib/{arca,invoicing,documental,rbac,drive,clientify,cctv}/` evidencian que las **FASES 1 y 5 del prompt** (Facturación + ARCA) están **avanzadas en sandbox**. El verdadero gap son **FASES 2 (Proveedores extendido + Vendor invoices), 3 (Tesorería), 4 (Contabilidad)** y las **piezas faltantes de FASE 1** (recurrente + cuenta corriente).

El plan a continuación parte del estado real verificado, no asume tabla rasa.

---

## Entregable 1 · Arquitectura completa

### 1.1 Estado real verificado (no asumido)

```
src/app/(app)/
├── anmat          ← Compliance ANMAT (live)
├── billing        ← Facturación (en curso FASE E1)
├── cctv           ← CCTV Hikvision (live)
├── clients        ← Clientes operativos (live)
├── comercial      ← CRM Clientify (live)
├── compras        ← OC + Proveedores básicos (live)
├── dashboard      ← Dashboard servicios (live)
├── documental     ← Centro documental (live)
├── drive          ← Drive TOPS browser (READY post-credenciales)
├── ejecutivo      ← Cockpit corporativo (live)
├── operaciones/mapa  ← Mapa CABA (live)
├── orders         ← Órdenes de servicio (live)
├── reports        ← Reportes (esqueleto)
├── settings       ← RBAC + usuarios + roles (live)
└── templates      ← Plantillas (esqueleto)

src/lib/
├── anmat/         ← Data + alert-engine (live)
├── arca/          ← wsaa, wsfev1, cms-forge, soap, qr, production-service, mock-service (FASE 5 implementada)
├── cctv/          ← Hikvision NVR (live)
├── clientify/     ← CRM API (live)
├── compras/       ← OC data + PDF + email + storage (live)
├── documental/    ← Documentos + OCR (live)
├── drive/         ← Service account client + browser API (READY)
├── invoicing/     ← calc, data, emit, storage, types (FASE E1 implementada)
├── ocr/           ← lib OCR (live, sub-integrada con documental)
├── pdf/           ← Generación PDF (live)
├── rbac/          ← Permisos + roles + check server-side (live)
├── pricing/       ← Calculator + vehículos + zonas (live)
└── whatsapp/      ← Meta API (sandbox)

supabase/migrations/
├── 0001_init.sql                       ← base auth + clients + orders
├── 0002_seed.sql                       ← seeds operativos
├── 0003_storage.sql                    ← buckets iniciales
├── 0004_extended_schema.sql            ← order_services + operators
├── 0005_fix_rls_recursion.sql          ← fix RLS stack overflow
├── 0006_real_operators.sql             ← operadores reales TOPS
├── 0007_extend_service_units.sql       ← unidades de servicio
├── 0008_purchase_orders.sql            ← vendors + products + purchase_orders + po_items + po_events
├── 0009_rbac.sql                       ← permissions + roles + role_permissions + user_roles + has_permission()
├── 0010_documents.sql                  ← documents + documents_audit + storage isolation por client
├── 0011_arca_billing.sql               ← fiscal_config + puntos_venta + customer_invoices + invoice_items + invoice_audit
└── 0013_invoices_storage_isolation.sql ← R4 fix: multi-tenant bucket invoices
```

**RBAC permissions seedeadas (22 totales):** cockpit, compras, servicios, comercial, compliance, cctv, documental, analytics, sistema.

### 1.2 Arquitectura objetivo TOPS NEXUS ERP V2

Mapa de módulos (los del prompt, marcando estado real):

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        TOPS NEXUS ERP V2                                │
│                       Verotin S.A. · 2026                               │
└─────────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────┐  ┌─────────────────────────────────────┐
│   COCKPIT / EXECUTIVE LAYER    │  │   IAM / RBAC / AUDIT                │
│   • /ejecutivo (live)          │  │   • Roles + permissions (live)      │
│   • Dashboard corporativo (gap)│  │   • Audit trails (parciales)        │
│   • Alertas globales (gap)     │  │   • user_roles + has_permission()   │
└────────────────────────────────┘  └─────────────────────────────────────┘

┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│ OPERACIONES  │  │ COMERCIAL    │  │ COMPLIANCE   │  │ DOCUMENTAL   │
│ • /orders    │  │ • Clientify  │  │ • ANMAT      │  │ • documents  │
│   (live)     │  │   (live)     │  │   (live)     │  │   (live)     │
│ • /clients   │  │ • Pipeline   │  │ • Alert eng. │  │ • OCR (live) │
│   (live)     │  │   (live)     │  │   (live)     │  │ • Drive TOPS │
│ • /operac.   │  │ • Contactos  │  │ • RNE Vigente│  │   (READY)    │
│   (live)     │  │   (live)     │  │   (live)     │  │ • CCTV (live)│
└──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘

┌──────────────────────┐  ┌──────────────────────┐  ┌──────────────────┐
│ COMPRAS              │  │ FACTURACIÓN          │  │ ARCA / AFIP      │
│ • OC (live)          │  │ • customer_invoices  │  │ • wsaa (live)    │
│ • vendors básico     │  │   (live)             │  │ • wsfev1 (live)  │
│   (live)             │  │ • PDF + email (live) │  │ • CAE (live)     │
│ • vendors extendido  │  │ • Storage iso (live) │  │ • QR fiscal      │
│   (CBU/alias) GAP    │  │ • Cliente CC GAP     │  │   (live)         │
│ • vendor_invoices    │  │ • Recurrente GAP     │  │ • Padrón GAP     │
│   GAP                │  │                      │  │ • Retenciones GAP│
│ • OCR vendor GAP     │  │                      │  │                  │
│ • Proveedor CC GAP   │  │                      │  │                  │
└──────────────────────┘  └──────────────────────┘  └──────────────────┘

┌──────────────────────┐  ┌──────────────────────────────────────────────┐
│ TESORERÍA  ← GAP TOTAL│  │ CONTABILIDAD  ← GAP TOTAL                    │
│ • caja               │  │ • plan de cuentas (chart of accounts)        │
│ • banks              │  │ • asientos automáticos (journal entries)     │
│ • medios pago        │  │ • libros IVA ventas/compras                  │
│ • conciliación       │  │ • percepciones + retenciones                 │
└──────────────────────┘  └──────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│   INTEGRACIONES                                                         │
│   • Drive (Service Account, READY)   • Clientify (live)                 │
│   • Hikvision NVR (live)             • Resend email (live)              │
│   • OpenAI GPT-4o-mini OCR (live)    • Meta WhatsApp (sandbox)          │
│   • Supabase (live)                  • ARCA WS (sandbox + producción)   │
└─────────────────────────────────────────────────────────────────────────┘
```

**Principios arquitectónicos del ERP:**

1. **Modular pero acoplado correctamente:** los módulos `treasury`, `accounting`, `vendor_invoices` se conectan al ledger (asientos automáticos) sin acoplamiento UI.
2. **Single source of truth fiscal:** ARCA permanece la fuente para CAE/QR/factura electrónica. Contabilidad **deriva** de ARCA (no duplica).
3. **RLS multi-tenant ya pattern-validado:** patrón `client_id/yyyy/mm/...` (mig 0010+0013) se replica para nuevas tablas que requieran scoping por cliente.
4. **RBAC obligatorio por endpoint:** todo route handler nuevo pasa por `requireDrivePermission()` o equivalente con permiso del módulo correspondiente.
5. **Migration governance:** sigue FASE 0 — no más bootstrap, todo va por `supabase migration` con tracker `schema_migrations`.
6. **Drive como sistema documental único:** PDFs de OC, facturas, recibos, certificaciones, todo termina en Drive bajo estructura canónica.

### 1.3 Ruta canónica de archivos en Drive (estructura propuesta)

```
/Verotin S.A./
  ├── /CLIENTES/
  │   ├── /<razon-social>/
  │   │   ├── /Facturas/<año>/<mes>/<tipo-pv-nro>.pdf
  │   │   ├── /Notas-Crédito/<año>/<mes>/...
  │   │   ├── /Remitos/...
  │   │   ├── /Contratos/...
  │   │   └── /Recibos/...
  │   └── /...
  ├── /PROVEEDORES/
  │   ├── /<razon-social>/
  │   │   ├── /OC/<año>/<mes>/...           ← ya implementado
  │   │   ├── /Facturas/<año>/<mes>/...     ← GAP
  │   │   └── /Pagos/...                    ← GAP
  │   └── /...
  ├── /TESORERÍA/
  │   ├── /Movimientos/<año>/<mes>/...      ← GAP
  │   ├── /Conciliaciones/<año>/<mes>/...   ← GAP
  │   └── /Comprobantes/...
  ├── /CONTABILIDAD/
  │   ├── /Libros-IVA/<año>/...             ← GAP
  │   ├── /Cierres-mensuales/<año>/...      ← GAP
  │   └── /Asientos/<año>/<mes>/...         ← GAP
  └── /COMPLIANCE/
      ├── /ANMAT/...                        ← ya parcial
      ├── /Habilitaciones/...
      └── /Auditorías/...
```

---

## Entregable 2 · Modelo de datos

### 2.1 Tablas que YA existen (no se modifican salvo migraciones aditivas)

| Migración | Tabla | Status |
|-----------|-------|--------|
| 0001-0007 | clients, orders, order_services, operators, services | live |
| 0008 | vendors, products, purchase_orders, po_items, po_events, vendor_stats (view) | live |
| 0009 | permissions, roles, role_permissions, user_roles + helpers `current_role()`, `has_permission()` | live (RBAC dormido) |
| 0010 | documents, documents_audit | live |
| 0011 | fiscal_config, puntos_venta, customer_invoices, invoice_items, invoice_audit + enums condicion_iva_t, comprobante_tipo_t | live (sandbox + GATE 2 cerrado) |
| 0013 | RLS multi-tenant en storage.objects bucket `invoices` | live |

### 2.2 Tablas NUEVAS propuestas por gap

#### 2.2.1 Facturación — gaps (continuación de FASE 1)

```
recurring_billing_templates
  · id, client_id, frequency_t (monthly|quarterly|...), concept, base_amount,
    currency, iva_rate, next_run_date, active, created_by, created_at

recurring_billing_runs
  · id, template_id, run_date, generated_invoice_id (→ customer_invoices), status, error

customer_balance        ← cuenta corriente cliente
  · view materializada o tabla agregada:
    client_id, balance_pesos, total_facturado_ytd, total_cobrado_ytd, vencidas_30, vencidas_60, vencidas_90+

customer_movements      ← movimientos (factura, NC, pago, ajuste)
  · id, client_id, movement_t (invoice|credit_note|payment|adjustment),
    reference_id (polymorphic), amount, currency, applied_at, observ
```

#### 2.2.2 Proveedores — gaps (FASE 2)

```
vendor_extended         ← extensión de tabla vendors existente
  · vendor_id (FK 1:1 a vendors)
  · cbu, alias, condicion_iva, ingresos_brutos, ganancias_exento,
    contacto_secundario, banco_principal, observaciones

vendor_invoices         ← facturas de proveedores subidas/OCR
  · id, vendor_id, tipo_comprobante, pto_venta, nro, cae, fecha_emision,
    fecha_vto, neto, iva, total, currency, status (pendiente|pagada|parcial|anulada),
    storage_path (Drive + Supabase bucket), source (upload|email|ocr_auto),
    ocr_confidence, ocr_raw_json, created_by, created_at

vendor_invoice_items    ← items extraídos por OCR (opcional, fase 2.5)
  · id, vendor_invoice_id, descripcion, cantidad, precio_unit, subtotal

vendor_balance          ← cuenta corriente proveedor
  · view materializada o tabla agregada similar a customer_balance

vendor_movements        ← movimientos
  · id, vendor_id, movement_t (oc|invoice|payment|credit), reference_id,
    amount, currency, applied_at
```

#### 2.2.3 Tesorería — gaps (FASE 3)

```
treasury_accounts       ← caja, bancos, cuentas
  · id, name, type_t (caja|banco|tarjeta|otro), bank_t (galicia|santander|macro|...),
    currency, account_number, cbu, alias, active, opening_balance,
    opening_balance_date, color (UX)

treasury_movements      ← movimientos
  · id, account_id, direction_t (in|out|transfer),
    method_t (transfer|cheque|echeq|cash|card|other), amount, currency,
    operation_date, value_date, reference, source_movement_id (polymorphic),
    counterparty_t (client|vendor|internal|tax|other), counterparty_id,
    related_invoice_id (customer or vendor),
    receipt_path, status (registered|reconciled|cancelled), created_by

treasury_cheques        ← cheques y e-cheqs
  · id, treasury_movement_id (FK), cheque_t (propio|tercero|echeq),
    bank, account_number, cheque_number, issuer_cuit, issuer_name,
    issue_date, due_date, status (cartera|depositado|cobrado|rechazado|endosado)

treasury_reconciliations ← conciliación con extractos bancarios
  · id, account_id, period_start, period_end, opening_balance,
    closing_balance, total_in, total_out, conciliated, conciliated_at,
    reconciliation_path (Drive)
```

#### 2.2.4 Contabilidad — gaps (FASE 4)

```
chart_of_accounts       ← plan de cuentas
  · id, code (jerárquico: 1.1.01.001), name, type_t (activo|pasivo|patrimonio|ingreso|egreso|resultado),
    parent_id (self-FK), is_summary (cabecera), currency, active

journal_entries         ← asientos
  · id, entry_date, type_t (automatico|manual|cierre|apertura),
    source_module (invoicing|treasury|purchase_orders|...),
    source_reference_id (polymorphic),
    description, period_yyyy_mm, total_debit, total_credit (deben balancear),
    posted, posted_at, created_by

journal_entry_lines     ← líneas
  · id, entry_id, line_num, account_id, debit, credit, description, currency,
    cost_center_id (opcional)

iva_books               ← libros IVA
  · view o tabla:
    periodo_yyyy_mm, tipo (ventas|compras), comprobante_reference (customer_invoice_id o vendor_invoice_id),
    neto, iva_21, iva_105, iva_27, no_gravado, exento, total

withholdings            ← retenciones aplicadas
  · id, applied_on_movement_id, regime_t (ganancias|iva|iibb_caba|sicore|...),
    base_amount, rate, withheld_amount, certificate_number
```

#### 2.2.5 ARCA / AFIP — gaps (FASE 5)

```
arca_padron_cache       ← cache de validación CUIT (semi-mensual)
  · cuit, razon_social, condicion_iva, domicilio, last_checked, valid

withholding_regimes_catalog ← catálogo
  · seed: ganancias varios, iva_per, iva_ret, sicore, etc.
```

#### 2.2.6 RBAC — extensión de permissions

Agregar a `permissions` (mig 0014 propuesta):

```
billing.view, billing.create, billing.emit, billing.cancel, billing.recurring.manage
vendors.view, vendors.edit
vendor_invoices.view, vendor_invoices.create, vendor_invoices.edit
treasury.view, treasury.cash.manage, treasury.bank.manage, treasury.reconcile
accounting.view, accounting.post, accounting.close
arca.view, arca.emit, arca.cancel
```

Asignación propuesta a roles existentes (ver Anexo C).

### 2.3 Relaciones críticas

```
clients (1) ────< customer_invoices >──── puntos_venta
clients (1) ────< customer_movements >──── customer_invoices/payments
clients (1) ────< recurring_billing_templates (1) ────< recurring_billing_runs

vendors (1) ────< vendor_invoices
vendors (1) ────< vendor_movements
vendors (1) ────1:1── vendor_extended

treasury_accounts (1) ────< treasury_movements
treasury_movements (1) ────0..1── treasury_cheques
treasury_movements (polymorphic) ────> customer_invoices | vendor_invoices

journal_entries (1) ────< journal_entry_lines (N debit/credit balanceadas)
journal_entry_lines (N) ────> chart_of_accounts
journal_entries (polymorphic source) ────> {customer_invoices, vendor_invoices, treasury_movements, ...}

arca: ya existe en customer_invoices.cae + qr_data + fecha_vto_cae
```

---

## Entregable 3 · Tablas Supabase (sumario SQL signatures)

Esto NO es código ejecutable — es la firma de cada migración propuesta. La implementación SQL real se hace después de aprobación con idempotencia (lección de FASE 0), down-migrations y registro en tracker.

```sql
-- 0014: RBAC extension
do $$ begin
  -- agregar nuevos permission slugs (insert idempotente)
end $$;

-- 0015: recurring billing
create type if not exists recurring_freq_t as enum ('monthly','quarterly','semiannual','annual','custom');
create table if not exists public.recurring_billing_templates (...);
create table if not exists public.recurring_billing_runs (...);
alter table public.customer_invoices add column if not exists recurring_run_id uuid;

-- 0016: customer current account
create type if not exists customer_movement_t as enum ('invoice','credit_note','payment','adjustment','refund');
create table if not exists public.customer_movements (...);
create view public.customer_balance as ...;

-- 0017: vendors extended + vendor invoices
create type if not exists vendor_invoice_status_t as enum ('pendiente','pagada','parcial','anulada','rechazada');
create table if not exists public.vendor_extended (...);
create table if not exists public.vendor_invoices (...);
create table if not exists public.vendor_movements (...);
create view public.vendor_balance as ...;

-- 0018: treasury foundations
create type if not exists treasury_account_t as enum ('caja','banco','tarjeta','mercadopago','otro');
create type if not exists payment_method_t as enum ('transferencia','cheque','echeq','efectivo','tarjeta','otro');
create type if not exists cheque_status_t as enum ('cartera','depositado','cobrado','rechazado','endosado','anulado');
create table if not exists public.treasury_accounts (...);
create table if not exists public.treasury_movements (...);
create table if not exists public.treasury_cheques (...);

-- 0019: treasury reconciliation
create table if not exists public.treasury_reconciliations (...);

-- 0020: chart of accounts + journals
create type if not exists account_type_t as enum ('activo','pasivo','patrimonio','ingreso','egreso','resultado');
create table if not exists public.chart_of_accounts (...);
create type if not exists journal_entry_t as enum ('automatico','manual','cierre','apertura','ajuste');
create table if not exists public.journal_entries (...);
create table if not exists public.journal_entry_lines (...);

-- 0021: IVA + withholdings
create view public.iva_books as ...;
create table if not exists public.withholdings (...);
create table if not exists public.withholding_regimes_catalog (...);

-- 0022: ARCA padron cache
create table if not exists public.arca_padron_cache (...);

-- 0023: storage isolation patterns
-- (replicar pattern 0010/0013 a nuevos buckets: receipts, reconciliations)

-- 0024: RLS aditivas para todas las tablas anteriores
-- (mantener pattern read-self-or-internal donde corresponda)
```

**Reservas de número de migración:**
- 0012 quedó saltada (per memoria persistente: "migración 0012 reservada" — verificar antes de usar 0014)
- Numeración propuesta: **0014–0024**

### 3.1 Idempotencia obligatoria

Per FASE 0 governance — **cada migración nueva DEBE**:
- Usar `create table if not exists`
- Usar `do $$ begin create type ... end $$ exception when duplicate_object then null;` para enums
- Tener una **down-migration** comentada al final
- Estar registrada en `schema_migrations` tracker (NO via bootstrap)

---

## Entregable 4 · Relaciones (diagrama narrativo)

### 4.1 Por dominio funcional

**Facturación (existente + nuevo):**
- `clients` → `customer_invoices` (1:N)
- `customer_invoices` → `invoice_items` (1:N)
- `customer_invoices` → `puntos_venta` (N:1)
- `customer_invoices` → `customer_movements` (1:1 auto-creado al emitir)
- `recurring_billing_templates` → `customer_invoices` (1:N vía recurring_run_id)
- `customer_movements` → `treasury_movements` (cobros: 1:1)

**Compras (existente + extendido):**
- `vendors` → `purchase_orders` (1:N) — existente
- `vendors` → `vendor_invoices` (1:N) — nuevo
- `vendors` → `vendor_extended` (1:1) — nuevo
- `purchase_orders` ⟷ `vendor_invoices` (matching opcional vía vendor_invoice.matched_po_id)
- `vendor_invoices` → `vendor_movements` (1:1 auto)
- `vendor_movements` → `treasury_movements` (pagos: 1:1)

**Tesorería:**
- `treasury_accounts` → `treasury_movements` (1:N)
- `treasury_movements` → `treasury_cheques` (0:1 cuando method=cheque|echeq)
- `treasury_movements` polymorphic reference a `customer_movements`, `vendor_movements`, `withholdings`
- `treasury_accounts` → `treasury_reconciliations` (1:N por período)

**Contabilidad:**
- `journal_entries` → `journal_entry_lines` (1:N, sum(debit)=sum(credit))
- `journal_entry_lines` → `chart_of_accounts` (N:1)
- `journal_entries` polymorphic `source_reference_id`: cada vez que se emite una factura, se paga una OC, se concilia un mov, se genera un asiento automático
- `iva_books` view: agrega customer_invoices.iva* y vendor_invoices.iva*

**RBAC:**
- `auth.users` → `user_roles` → `roles` → `role_permissions` → `permissions`
- Helpers `current_role()`, `has_permission(slug)` — ya existen
- Nuevos slugs (E 2.2.6) se agregan vía 0014

### 4.2 Cross-domain polymorphism

Para no romper integridad referencial pero permitir referencias entre módulos:

```
treasury_movements.counterparty_t  ∈ {client, vendor, internal, tax, other}
treasury_movements.counterparty_id uuid    -- FK lógica, validada por trigger o app

journal_entries.source_module       text   -- 'invoicing'|'treasury'|'compras'|'vendor_invoices'|'manual'
journal_entries.source_reference_id uuid   -- FK lógica al record origen
```

Trigger opcional en 0024 para validar referential integrity (`source_reference_id` realmente existe en la tabla del módulo declarado).

---

## Entregable 5 · Roadmap técnico

### 5.1 Por trimestre (estimado a partir del scope actual)

```
2026 Q3 (Jun-Ago)
├── Q3-S1 (Jun)
│   ├── Completar FASE 1: recurring billing + customer current account
│   ├── Migrations 0014 (RBAC), 0015 (recurring), 0016 (CC cliente)
│   └── UI: /billing/recurring + /clients/:id/cuenta-corriente
├── Q3-S2 (Jul)
│   ├── FASE 2: vendor_extended + vendor_invoices + OCR pipeline
│   ├── Migrations 0017
│   └── UI: /proveedores/:id + /compras/facturas + upload + OCR worker
└── Q3-S3 (Ago)
    ├── FASE 2: vendor CC + integración con purchase_orders matching
    └── Tests funcionales + GATE 2-bis (storage isolation vendor_invoices)

2026 Q4 (Sep-Nov)
├── Q4-S1 (Sep)
│   ├── FASE 3: tesorería foundations (accounts + movements + cheques)
│   ├── Migrations 0018, 0019
│   └── UI: /tesoreria
├── Q4-S2 (Oct)
│   ├── FASE 3: conciliación bancaria
│   └── Integraciones: importadores Galicia/Santander/Macro (CSV/Excel)
└── Q4-S3 (Nov)
    ├── FASE 4: contabilidad foundations (plan de cuentas + asientos manuales)
    ├── Migrations 0020
    └── UI: /contabilidad

2027 Q1 (Dic-Feb)
├── Q1-S1 (Dic)
│   ├── FASE 4: asientos automáticos desde otros módulos
│   ├── Migrations 0021
│   └── Libros IVA generación
└── Q1-S2 (Ene-Feb)
    ├── FASE 5: ARCA producción (sandbox→prod)
    ├── Padron + retenciones
    ├── Migrations 0022
    └── Hardening + auditoría externa

2027 Q2 (Mar-May)
└── Refinamiento + dashboard ejecutivo final + reportes BI
```

### 5.2 Equipo asumido

- 1 Staff Engineer (full-stack)
- 1 Designer (UX premium, part-time)
- 1 Compliance / Contador (validaciones AFIP + plan de cuentas)
- 1 Tester (smoke + regression)

Si no hay equipo dedicado: dividir trimestres en 2x (cada trimestre se vuelve 6 meses).

### 5.3 Decisiones técnicas críticas

| Decisión | Recomendación | Justificación |
|----------|---------------|---------------|
| ORM vs raw SQL | Mantener Supabase JS client + PostgREST | Patrón actual funciona, RLS aplicada por defecto |
| Money type | NUMERIC(18,2) con currency text | Estándar AR; mantener `pesos_centavos` separado si hace falta precisión |
| Polymorphic FKs | Trigger de validación | Sin FK formal pero verificable |
| Recurring engine | Cron Netlify scheduled function + worker idempotente | Reemplazable por queue (Inngest/Trigger) si crece |
| OCR pipeline | GPT-4o-mini + retry queue | Ya integrado en docs; replicable a vendor_invoices |
| Reportes | Vista materializada + cache de 1h por client | Balance entre frescura y performance |
| Conciliación bancaria | Import CSV → matching heurístico → UI manual | v1 sin scraping de bancos (riesgo legal) |
| Auditoría | Trigger genérico de audit log por tabla sensible | Pattern de `documents_audit` extensible |

---

## Entregable 6 · Roadmap funcional

### 6.1 Por persona/rol

**Director (José Luis):**
- Q3: dashboard cobranza + saldo clientes en tiempo real
- Q4: visibilidad de tesorería (saldo bancos / cheques en cartera)
- Q1: balance mensual y resultados consolidados

**Administración (Ruth):**
- Q3: emitir facturas recurrentes con 1 click + ver cuenta corriente cliente
- Q3: subir factura de proveedor → OCR llena automáticamente
- Q4: registrar cobranza con cheque, ver vencimientos
- Q4: conciliar movimientos bancarios
- Q1: imprimir libros IVA ventas/compras

**Operaciones:**
- Q3: ver OC en curso + alertas de facturas vencidas de proveedor
- Q4: registrar comprobante de combustible / mantenimiento → impacta tesorería

**Cliente externo (Bidcom, Bagó, etc.):**
- Q3-Q4: cuenta corriente visible vía /compras/validar/<token> (read-only)
- Q4: descarga PDF de factura desde portal

**Compliance (Maria Inés, DT):**
- Q3-Q4: dashboard ANMAT extendido con cobertura de habilitaciones por cliente

### 6.2 Por flujo de negocio

**Flujo de facturación recurrente (gap Fase 1):**
```
1. Admin crea template:
   - Cliente Bidcom · 22 m² ANMAT · USD 50/m² · mensual · día 1
2. Día 1 de cada mes:
   - Cron dispara → genera customer_invoice borrador
   - Notificación a Ruth para aprobar
3. Ruth aprueba → ARCA wsfev1 → CAE
4. PDF generado → Drive + Storage
5. Email automático al cliente con PDF + portal
6. customer_movement creado → cuenta corriente actualizada
```

**Flujo de factura de proveedor (gap Fase 2):**
```
1. Ruth recibe PDF por email del proveedor
2. Sube a /compras/facturas/upload
3. OCR (GPT-4o-mini) extrae: CUIT, fecha, CAE, importe, IVA, total
4. UI muestra preview lado a lado
5. Ruth confirma o corrige
6. vendor_invoice creado + vendor_movement
7. Matching automático con OC existente (si match >85%)
8. Drive: /PROVEEDORES/<razon>/Facturas/<año>/<mes>/<tipo>-<pv>-<nro>.pdf
9. Asiento automático (compras: deudor mercaderías + IVA, acreedor proveedor)
```

**Flujo de pago a proveedor (Fase 3):**
```
1. Ruth en /tesoreria/pagos selecciona vendor_invoice pendiente
2. Elige método: transferencia desde Galicia
3. Genera recibo + treasury_movement
4. vendor_movement = pago aplicado → vendor_balance actualizado
5. Asiento automático (cancela cuenta proveedor + sale dinero de banco)
6. Comprobante Drive: /TESORERÍA/Movimientos/<año>/<mes>/...
```

### 6.3 KPIs a exponer en dashboard corporativo

| Widget | Fuente | Frecuencia |
|--------|--------|-----------|
| Facturación mensual | `sum(customer_invoices.total) where periodo=current_month` | real-time |
| Cobranza pendiente | `customer_balance.vencidas_30+60+90` agregado | real-time |
| Saldo clientes | `sum(customer_balance.balance_pesos)` | real-time |
| Saldo proveedores | `sum(vendor_balance.balance_pesos)` | real-time |
| Tesorería neta | `sum(treasury_accounts.current_balance)` | real-time |
| Clientes activos | `count(clients) where status=activo` | daily |
| Ocupación ANMAT/Generales | desde mapa + LOCATIONS | real-time |
| Alertas | Compliance Alert Engine + tesorería + vencimientos | real-time |
| RNE vigente | `anmat_credentials` | real-time |

---

## Entregable 7 · Riesgos

### 7.1 Top 10 riesgos identificados

| ID | Riesgo | Probabilidad | Impacto | Mitigación |
|----|--------|--------------|---------|------------|
| RG1 | **Migración 0014+ rompen integridad sin idempotencia** | media | alto | Forzar lint de migrations (verify `if not exists`); CI con dry-run; FASE 0 governance |
| RG2 | RBAC mismatch enum vs tabla `roles` (4 vs 7) — heredado | alta | alto | Resolver primero PARIDAD-4 (sincronizar enum + tabla) antes de seedear user_roles |
| RG3 | OCR produce datos incorrectos en vendor_invoice → asientos erróneos | media | alto | OCR siempre revisado por humano antes de pasar a "confirmada"; matching score < 70% bloquea auto-posting |
| RG4 | ARCA producción rechaza facturas con dato faltante | media | crítico | Validador local pre-envío (lo más cerca posible a wsfev1 reglas); rollback a borrador automático |
| RG5 | Falta backup externo de Supabase (RP6 pendiente) | alta | crítico | **Bloqueante para FASE 4+:** antes de contabilidad y libros IVA, asegurar backup S3/GCS + retention 7 años |
| RG6 | Cuenta corriente cliente discrepante vs ARCA por cambios retroactivos | media | medio | Snapshot al cierre mensual + lock de períodos cerrados |
| RG7 | Tesorería: pagos duplicados por race condition (clic doble) | media | alto | Idempotency key + UNIQUE constraint en treasury_movements (date + amount + counterparty + hash) |
| RG8 | Conciliación bancaria: discrepancia silenciosa por timezone | baja | medio | UTC en DB, conversión solo en UI con tz=AR/Buenos_Aires |
| RG9 | Plan de cuentas mal diseñado → asientos imposibles de reportar | media | alto | Validación inicial con contador certificado antes de migrar a producción |
| RG10 | Cambios de scope del usuario mid-roadmap | alta | medio | Gates explícitos entre fases; aprobación documentada por fase |

### 7.2 Riesgos heredados del proyecto

(Ya documentados en `docs/ERP-AUDITORIA-SUPABASE-2026-05-29.md` y `docs/ERP-FASE0-GOBERNANZA-DB.md`)

- PARIDAD-3 ya cerrada (tracker sincronizado hasta 0009)
- Riesgo: `db push` directo sigue siendo destructivo en potencia → mantener prohibición
- 0010+0011 aplicadas en DB pero requieren validación de idempotencia para próximas migraciones

---

## Entregable 8 · Plan de migración

### 8.1 Pre-requisitos para empezar implementación

| Pre-req | Estado actual | Acción si falta |
|---------|---------------|-----------------|
| **Backup externo Supabase configurado** | ❌ no verificado | RG5 — bloqueante; configurar antes de tocar prod |
| **RBAC seedeado al menos para Director + Admin** | ❌ user_roles=0 | Aplicar `scripts/seed-rbac-real-roles.sql` con OK |
| **Drive integration cerrada** | 🟢 READY (esta sesión) | Validar con FOLDER_ID + JSON cuando lleguen |
| **ARCA prod-ready** | 🟡 sandbox + GATE 3 cerrado | Validar producción real con factura test ($1) |
| **Plan de cuentas validado por contador** | ❌ pendiente | Reunión con contador externo antes de FASE 4 |
| **Migration governance (config.toml + tracker)** | 🟡 parcial | Cerrar PARIDAD-3 con config.toml local |
| **Tests automatizados base** | ❌ inexistentes | Agregar smoke tests por endpoint crítico |

### 8.2 Estrategia de migración por fase

**FASE 1 completar (recurring + CC cliente):**
- Migrations 0014 (RBAC), 0015 (recurring), 0016 (CC cliente)
- Cero impact a tablas existentes (todas las nuevas)
- Deploy: 1 ciclo Netlify con feature flag opcional

**FASE 2 (proveedores):**
- Migration 0017 (vendor_extended, vendor_invoices, vendor_movements)
- `vendors` existente queda intacta; `vendor_extended` es 1:1 add-on
- Bucket Drive nuevo: `vendor-invoices` con RLS pattern 0013
- OCR worker: integrable con `src/lib/ocr/` existente

**FASE 3 (tesorería):**
- Migrations 0018, 0019
- Sin impact a otros módulos (tablas nuevas)
- Importadores bancarios: implementar 1 banco por sprint (empezar Galicia)

**FASE 4 (contabilidad):**
- Migrations 0020, 0021
- Posible impact: triggers automáticos en customer_invoices, vendor_invoices, treasury_movements que generan asientos
- **Requiere lock por período:** una vez generado asiento, no se puede borrar la factura origen
- Migración de datos históricos: opcional, decidir con contador

**FASE 5 (ARCA padron + retenciones):**
- Migration 0022
- Sin impact, solo cache + catálogo

### 8.3 Estrategia de rollback por fase

| Fase | Rollback inmediato | Rollback tardío |
|------|--------------------|-----------------|
| 1 | `supabase migration repair --status reverted 0014 0015 0016` + redeploy de UI sin nuevas pantallas | Si hay facturas recurrentes generadas, mantenerlas como manuales |
| 2 | Drop tables vendor_extended, vendor_invoices, vendor_movements | OCR resultados se pierden; PDFs en Drive quedan |
| 3 | Drop treasury_* | Movimientos perdidos (riesgo: pagos sin trazar) |
| 4 | Drop journal_*, chart_of_accounts | Asientos perdidos; recomendable congelar antes |
| 5 | Drop arca_padron_cache | Sin impact |

**Regla general:** una vez aplicada en producción, **no rollback de datos** — solo rollback de UI/features.

### 8.4 Compatibilidad con módulos existentes

- ✅ **Compras:** vendor_invoices ENRIQUECE pero no reemplaza purchase_orders
- ✅ **Facturación:** recurring + CC EXTIENDEN customer_invoices; no rompen 0011
- ✅ **Documental:** ya soporta cualquier PDF; los nuevos (recibos, etc.) se almacenan ahí
- ⚠️ **RBAC:** add permissions NO modifica existentes
- ⚠️ **Drive:** estructura nueva propuesta es ADITIVA; carpetas viejas siguen funcionando

---

## Entregable 9 · Execution Plan por fases

### 9.1 Estructura de cada fase (template)

Cada fase sigue este patrón inspirado en GATE A/B/C/E1 ya practicado:

```
FASE X
├── X.0 — Pre-flight audit
│   └── Documentar gap, riesgos, dependencias, snapshot
├── X.1 — Data model & migrations (NO aplicar a DB)
│   └── SQL escrito + idempotencia + down + tracker
├── X.2 — Backend / libs / actions
│   └── src/lib/<modulo>/ + tests unitarios
├── X.3 — API routes
│   └── src/app/api/<modulo>/ con RBAC + rate-limit + logging
├── X.4 — UI / pantallas
│   └── src/app/(app)/<modulo>/ + componentes
├── X.5 — Smoke tests + RLS integrity tests
│   └── Caso autorizado / no autorizado / RLS / scope
├── X.6 — GATE de aprobación
│   └── Documentado en docs/FASE-X-GATE-REPORT.md
├── X.7 — Deploy (con OK explícito)
│   └── Aplicar migration → deploy Netlify → smoke prod
└── X.8 — Closure report
    └── Estado final, métricas, hallazgos, próximos pasos
```

### 9.2 FASE 1 — Detalle completar facturación

```
1.0 — Pre-flight: verificar customer_invoices actual + RBAC dormido
1.1 — Migrations:
      - 0014_rbac_extend_billing.sql (slugs nuevos billing.*)
      - 0015_recurring_billing.sql (templates + runs)
      - 0016_customer_movements.sql (CC + view balance)
1.2 — src/lib/billing/:
      - recurring/engine.ts (calculador + idempotencia)
      - recurring/scheduler.ts (cron job entry-point)
      - customer-balance/data.ts
1.3 — src/app/api/billing/:
      - recurring/create + edit + list + run-now
      - customer-balance/[clientId]
1.4 — UI:
      - /billing/recurrente (wizard de template)
      - /clients/[id]/cuenta-corriente
1.5 — Smoke tests: emitir factura recurrente → verificar PDF + Drive + CC
1.6 — GATE: docs/FASE-1-COMPLETION-REPORT.md
1.7 — Deploy con OK
1.8 — Closure
```

### 9.3 FASE 2 — Proveedores extendido

```
2.0 — Pre-flight: verificar OCR pipeline existente
2.1 — Migrations:
      - 0017_vendor_extended_invoices.sql
      - Storage bucket nuevo: vendor-invoices con RLS
2.2 — src/lib/vendor-invoices/:
      - upload-handler
      - ocr-pipeline (reusar src/lib/ocr/)
      - matching (purchase_orders matcher)
2.3 — API routes
2.4 — UI: /proveedores + /compras/facturas
2.5 — Smoke: upload PDF → OCR → confirmar → matching OC
2.6 — GATE
2.7 — Deploy
2.8 — Closure
```

### 9.4 FASES 3-5 — Outline

(detalle se expandirá en sub-docs `docs/FASE-3-TESORERIA.md`, etc. cuando se apruebe avanzar)

### 9.5 Gates de control entre fases

| Gate | Pre-condición | Aprobador |
|------|---------------|-----------|
| FASE 1 → 2 | Recurring billing en producción 30 días sin issues | Director (José Luis) |
| FASE 2 → 3 | Vendor invoices con OCR ≥85% accuracy en 100 facturas | Admin (Ruth) |
| FASE 3 → 4 | Tesorería con 1 mes de movimientos reales sin discrepancias | Director + Contador |
| FASE 4 → 5 | Contador valida plan de cuentas + asientos automáticos | Contador externo |
| FASE 5 → prod ARCA | ARCA sandbox con 100 facturas tipo A sin errores | Compliance + Director |

---

## Entregable 10 · Impact Analysis

### 10.1 Impacto en módulos existentes

| Módulo | Cambio | Tipo | Severidad |
|--------|--------|------|-----------|
| `/dashboard` (operativo) | Sin cambios | none | - |
| `/ejecutivo` (cockpit) | Nuevos KPIs (saldo clientes, tesorería) | aditivo | bajo |
| `/orders` | Sin cambios; integración con billing existente continúa | none | - |
| `/clients` | Nueva tab "Cuenta Corriente" | aditivo | bajo |
| `/compras` | Nueva pantalla "Facturas proveedores" | aditivo | bajo |
| `/billing` | Re-shell con tabs: Emitidas / Recurrentes / Cobranza | refactor leve | medio |
| `/anmat` | Sin cambios | none | - |
| `/drive` | Sin cambios (READY) | none | - |
| `/cctv` | Sin cambios | none | - |
| `/comercial` | Sin cambios | none | - |
| `/documental` | Recibe nuevos tipos de docs (recibos, conciliaciones) | aditivo | bajo |
| RBAC | +13 permisos nuevos seedeados (sin tocar existentes) | aditivo | bajo |
| Migration tracker | +11 migrations en serie 0014-0024 | aditivo | medio (idempotencia obligatoria) |

### 10.2 Impacto en infraestructura

| Recurso | Impacto | Acción |
|---------|---------|--------|
| Supabase DB rows estimadas Q3 | +2k customer_movements + ~500 recurring_runs + ~1k vendor_invoices | dentro del plan actual (free/pro) |
| Storage Supabase | +500 MB-1GB en buckets nuevos (vendor-invoices, receipts, reconciliations) | revisar plan vs uso al cierre Q3 |
| Drive corporativo | +10-20 GB/año (PDFs facturas + recibos) | dentro del plan Workspace |
| Netlify build | sin impacto |  - |
| Netlify functions | +6 functions nuevas (recurring cron + APIs) | dentro del límite gratuito 125k/mes |
| OpenAI API (OCR) | ~$10-30/mes para 500 facturas/mes | presupuesto operativo |
| ARCA WSFEv1 | sin costo, dentro de cuota | - |

### 10.3 Impacto en equipo / proceso

| Stakeholder | Cambio operativo |
|------------|-------------------|
| Ruth (admin) | Aprende UI nueva (recurring + vendor_invoices); ganancia neta de 5-10 hs/mes |
| José Luis (director) | Visibilidad financiera real-time; aprende dashboard nuevo |
| Operaciones | Mínimo (siguen con OC + remitos) |
| Maria Inés (DT/Compliance) | Sin cambios |
| Contador externo | Mayor involucramiento Q4 (plan de cuentas) |

### 10.4 Impacto en métricas

| Métrica | Antes | Después FASE 4 |
|---------|-------|----------------|
| Tiempo emisión factura recurrente | 5-10 min/cliente/mes | <30 seg (auto) |
| Tiempo carga factura proveedor | 3-5 min/factura | <1 min con OCR |
| Saldo cliente disponible | 1-2 días lag (manual) | real-time |
| Cierre mensual contable | manual semanas | 1-2 horas (validación) |
| Conciliación bancaria | manual | semi-automática |

### 10.5 Impacto en seguridad

| Vector | Mitigación |
|--------|------------|
| RBAC nuevo sin validar → bypass | requireDrivePermission() pattern obligatorio en todo endpoint nuevo |
| Multi-tenant storage para vendor_invoices | Replicar pattern 0010+0013 con tests |
| OCR injection (PDF malicioso) | Sandbox de OCR + rate limit + size cap |
| Asientos contables tampering | Lock de períodos cerrados + audit trail |
| Facturas recurrentes runaway | Idempotency key + dry-run obligatorio antes de batch |

---

## Anexos

### Anexo A · Reservas de tablas y migrations

- **Migrations 0001-0013** ya aplicadas (ver memoria persistente).
- **0012** reservada (no usar).
- **0014-0024** propuesta esta sesión (no escritas todavía).
- Cualquier migration entre medio (`0014_a_emergencia.sql`) requiere bump a `0014_b_...` para mantener orden.

### Anexo B · Compatibilidad con políticas existentes

Este plan respeta:
- ✅ **FASE 0 governance DB:** todo nuevo SQL será idempotente, registrado en tracker, con down-migration.
- ✅ **PARIDAD-3 closure:** no `supabase db push` ciego.
- ✅ **Drive integration freeze:** módulo Drive sigue en 🟢 READY independientemente; no se modifica hasta lleguen creds.
- ✅ **RBAC fail-open documentado:** new permissions siguen el mismo pattern (compliance.view aplicado en Drive).
- ✅ **Audit trail:** patrón `documents_audit` se replica a tablas sensibles nuevas.

### Anexo C · Asignación propuesta de nuevos permisos a roles existentes

| Rol | billing | vendors | vendor_invoices | treasury | accounting | arca |
|-----|---------|---------|------------------|----------|------------|------|
| **Director** | view+create+emit+cancel | view+edit | view+create+edit | view+manage | view+post+close | view+emit+cancel |
| **Administracion** | view+create+emit | view+edit | view+create+edit | view+cash+bank+reconcile | view+post | view+emit |
| **Operaciones** | view | view | view | - | - | - |
| **Comercial** | view | - | - | - | - | - |
| **Deposito** | - | - | - | - | - | - |
| **Auditor** | view | view | view | view | view | view |
| **Compliance** | view | - | - | - | - | view |

### Anexo D · Sub-docs propuestos para expandir cuando se apruebe avanzar

- `docs/erp/FASE-1-COMPLETION-PLAN.md` — Recurring + CC cliente detallado
- `docs/erp/FASE-2-VENDOR-INVOICES.md` — OCR pipeline + matching
- `docs/erp/FASE-3-TREASURY.md` — Tesorería con detalle bancario
- `docs/erp/FASE-4-ACCOUNTING.md` — Plan de cuentas + libros IVA
- `docs/erp/FASE-5-ARCA-PRODUCTION.md` — Padrón + retenciones + transición sandbox→prod
- `docs/erp/DRIVE-CANONICAL-STRUCTURE.md` — Estructura completa de carpetas
- `docs/erp/SCHEMA-MIGRATIONS-0014-0024.md` — Todos los SQL signatures expandidos

---

## Cierre — qué necesito de vos para avanzar

Este documento es **planificación pura**. Para empezar implementación necesito:

1. **Aprobación del scope** (fases + orden propuesto)
2. **Aprobación del numbering de migrations** (0014-0024 o ajustes)
3. **Confirmación de pre-requisitos:**
   - ¿Está cerrado el backup externo Supabase (RG5)?
   - ¿Está cerrada PARIDAD-3 con config.toml?
   - ¿Quién es el contador externo que valida plan de cuentas (FASE 4)?
4. **Decisión sobre orden de fases:**
   - Default propuesto: 1 → 2 → 3 → 4 → 5
   - Alternativa A: priorizar 2 (proveedores) por dolor operativo actual
   - Alternativa B: saltar a 3 (tesorería) si urge visibilidad de caja
5. **Aprobación entre cada gate (1.6, 2.6, etc.)** — no avanzar sin tu OK

**El módulo Drive sigue 🟢 READY FOR CREDENTIALS** — independientemente de este plan. Cuando entregues credenciales, ejecuto el flujo PASO 1/2/5 del execution plan Drive sin bloqueo por este ERP plan.

**No autorizado:** deploy, merge, push, commit, producción, carga de credenciales — sigue vigente.

---

## Restricciones honradas

- 🛑 NO IMPLEMENTAR — este documento es 100% planificación
- 🛑 NO SQL ejecutable — todo el SQL son **signatures**, no `create table` real listo para correr
- 🛑 NO DEPLOY · NO MERGE · NO PUSH · NO COMMIT
- 🛑 NO CARGAR CREDENCIALES
- 🛑 NO ASUMIR — el estado actual fue verificado contra archivos reales del repo (`ls`, `grep`, lectura de migrations)
- 🛑 NO INVENTAR — los gaps están demostrados por ausencia de tablas/módulos verificable
