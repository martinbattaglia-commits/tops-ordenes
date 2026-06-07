# ERP-A1 · REVISIÓN TÉCNICA PRE-IMPLEMENTACIÓN

**Proyecto:** TOPS Nexus — Logística TOPS (Verotin S.A.)
**Presidente:** Martín Battaglia
**Documento:** `ERP_A1_PRE_IMPLEMENTATION_REVIEW.md`
**Cubre:** migraciones `0052_treasury_permission_module.sql` y `0053_treasury_core.sql` (ERP-A1, modelo de datos).
**Basado en:** `ERP_A_TREASURY_DESIGN.md` (freeze D1–D5) + `ERP_A_ARCHITECTURE_FINAL_REVIEW.md` (P1 F1–F5 obligatorios).
**Naturaleza:** revisión previa. **No** es código, migración ni commit. No modifica archivos existentes.

> **Objetivo:** validar que el spec de `0052`/`0053` es consistente con las convenciones reales del repo, que incorpora F1–F5, y dejar la lista cerrada de tablas/enums/vistas/RPCs antes de escribir SQL.

---

## 1. Checklist de consistencia

| # | Ítem | Estado | Evidencia |
|---|---|:--:|---|
| 1.1 | Última migración aplicada = `0051`; tesorería arranca en `0052` | ✅ | `supabase/migrations/0051_*` |
| 1.2 | Valor de enum nuevo (`tesoreria`) va en migración **aislada** y committeada antes de usarlo | ✅ | regla `0021`/`0029` |
| 1.3 | Nombres de **tabla** previstos sin colisión | ✅ | `bank_accounts, treasury_movements, customer_receipts, supplier_payments, receipt_allocations, payment_allocations` → todos LIBRE |
| 1.4 | Nombres de **enum** sin colisión | ⚠️→✅ | **Ya existen `movement_type_t`, `movement_reference_t`, `alloc_status_t` (WMS).** Se resuelve **prefijando `treasury_*`** todos los enums del dominio (ver §5). |
| 1.5 | Tipo monetario alineado a AP = `numeric(14,2)` | ✅ | `0014:64-67` |
| 1.6 | `public_id` por sequence + trigger `before insert` | ✅ | `0014:48,82-97` |
| 1.7 | `created_by uuid references auth.users(id) on delete set null` | ✅ | `0014:42,72` |
| 1.8 | RLS read/insert/update/delete con `current_role()` | ✅ | `0014:116-135` |
| 1.9 | `current_role()` devuelve `user_role_t` {admin, operaciones, supervisor, cliente} | ✅ | `0001:23,180`; `0005:23-24` |
| 1.10 | RBAC granular: `permission_module_t` + `permissions(unique(module,action))` + seed `role_permissions` | ✅ | `0009:17-51,180-289` |
| 1.11 | Función transaccional: `returns jsonb · language plpgsql · security definer · set search_path = public, pg_temp · … for update` | ✅ | `0050_crm_promote_lead.sql:21-43` |
| 1.12 | Bucket privado: `storage.buckets` insert + `storage.objects` policies con `current_role()` | ✅ | `0015:27-60` |
| 1.13 | `touch_updated_at()` para `updated_at` | ✅ | `0009:68-79` |
| 1.14 | Enums idempotentes (`do $$ … exception when duplicate_object then null; end $$;`) | ✅ | `0014:13-21` |
| 1.15 | Seeds idempotentes (`on conflict … do nothing`) | ✅ | `0014:140-146` |

**Resultado:** consistente. Única acción correctiva: **prefijo `treasury_*` en todos los enums** (1.4).

---

## 2. Validación de convenciones Nexus

| Convención | Cómo la aplica ERP-A1 |
|---|---|
| **Enums** | `create type public.treasury_*_t as enum (...)` envuelto en `do $$ … exception when duplicate_object …`. |
| **PK** | `id uuid primary key default gen_random_uuid()` + `create extension if not exists pgcrypto`. |
| **public_id** | `short_id int default nextval(seq)` + trigger `before insert` que arma `REC-/PAG-/MOV-YYYY-NNNNNN` (lpad 6). Igual a `set_supplier_invoice_public_id` (`0014:82-97`). |
| **FK** | `references` con `on delete restrict` (entidades vivas: bancos, clients, vendors, invoices) y `on delete cascade` (allocations → su recibo/pago). `created_by … on delete set null`. |
| **Índices** | por FK y por columnas de filtro (`status`, `date desc`, `(reference_type, reference_id)`, `transfer_group_id`). Mismo criterio que `si_*_idx` (`0014:76-80`). |
| **RLS** | `enable row level security` + policies read(authenticated)/insert/update(internos)/**sin delete** (F3). Molde `0014:116-135`. |
| **RBAC** | `0052` agrega `tesoreria` al enum; `0053` siembra `permissions` (5 slugs) + `role_permissions` (patrón `insert…select` `0009:231-289`). |
| **Triggers** | 3× `public_id` + 1× `touch_updated_at` en `bank_accounts`. |
| **Append-only** | sin DELETE; anulación = `status='anulado'` + `voided_*` (F3/F5). |
| **Storage** | bucket privado `treasury` + policies internas (`current_role() in (admin,operaciones,supervisor)`), molde `0015`. |
| **Funciones (A4)** | `security definer`, `search_path` fijado, `for update` para serializar (F1), errores `'CODE: msg'`. |

Sin patrones nuevos introducidos.

---

## 3. Confirmación de incorporación F1–F5

| Hallazgo | Incorporado en | Mecanismo congelado |
|---|---|---|
| **F1 — Sobre-imputación concurrente** | RPC `0054` (diseñado ahora) | Dentro de la transacción, antes de imputar: `perform 1 from customer_invoices where id = p_invoice for update;` (o `pg_advisory_xact_lock(hashtext(p_invoice::text))`). Serializa por factura. **No persiste saldo** → D5 intacta (es lock, no UPDATE; SELECT/FOR UPDATE no dispara el lock trigger fiscal). |
| **F2 — Retención inválida** | `0053` | `customer_receipts`: `check (retention_amount >= 0)`, `check (retention_amount <= gross_amount)`, `check (net_amount = gross_amount - retention_amount)`. Se evalúa además `net_amount` como columna **`generated always as (gross_amount - retention_amount) stored`** (elimina desync, F16). |
| **F3 — Eliminación física prohibida** | `0053` | **No** se crean policies de DELETE en `treasury_movements`, `customer_receipts`, `supplier_payments`, allocations. RLS default-deny ⇒ DELETE imposible vía PostgREST. Único camino: void. |
| **F4 — Vistas solo `confirmado`** | Vistas `0054` (diseñado ahora) | Toda vista de saldo/cuenta corriente une al recibo/pago padre y filtra `parent.status='confirmado'` y `treasury_movements.status='confirmado'`. Excluye anulados/voided. |
| **F5 — Auditoría de anulación** | `0053` | Columnas `voided_at timestamptz`, `voided_by uuid references auth.users(id)`, `void_reason text` en las 3 entidades transaccionales. Completadas por la RPC `tesoreria_void_movement` (A4). |

> F1 y F4 se **diseñan** en A1 (forman parte del contrato) pero se **implementan** en `0054` (A4), porque viven en RPC/vistas. F2, F3 y F5 se implementan en `0053` (A1).

---

## 4. Lista final de tablas (6)

| Tabla | Propósito | Claves / reglas distintivas |
|---|---|---|
| `bank_accounts` | Cuentas bancarias (Santander, Galicia; multi-banco a futuro) | `opening_balance numeric(14,2) default 0`; `touch_updated_at`; seed 2 bancos |
| `treasury_movements` | **Fuente única de verdad** financiera | `public_id MOV-`; `amount > 0`; `reference_type/reference_id` polimórfico; `transfer_group_id`; `status` (default confirmado); `voided_*` |
| `customer_receipts` | Cobranzas | `public_id REC-`; `gross/retention/net` con CHECKs (F2); `net` GENERATED; FK `client_id→clients`; `voided_*` |
| `supplier_payments` | Pagos a proveedor | `public_id PAG-`; `amount > 0`; FK `vendor_id→vendors`; `operation_number`; `voided_*` |
| `receipt_allocations` | Imputación cobro→factura cliente (N:M, D2) | FK `receipt_id` (cascade) + `customer_invoice_id` (restrict); `amount > 0`; `unique(receipt_id, customer_invoice_id)` |
| `payment_allocations` | Imputación pago→factura proveedor (N:M, D2) | FK `payment_id` (cascade) + `supplier_invoice_id` (restrict); `amount > 0`; `unique(payment_id, supplier_invoice_id)` |

**Reutilizadas (no se crean ni mutan):** `clients`, `vendors`, `customer_invoices`, `supplier_invoices`, `auth.users`, RBAC (`permissions/roles/role_permissions/user_roles`).
**Storage:** bucket privado `treasury` (no es tabla; adjuntos de recibos/pagos).

---

## 5. Lista final de enums (6, prefijo `treasury_*` para evitar colisión)

| Enum | Valores | Nota |
|---|---|---|
| `treasury_movement_type_t` | `cobranza, pago_proveedor, transferencia, ajuste` | **prefijado** (existe `movement_type_t` en WMS) |
| `treasury_direction_t` | `ingreso, egreso` | |
| `treasury_status_t` | `pendiente, confirmado, anulado` | `pendiente` reservado (clearing cheque/echeq futuro; A inserta `confirmado`) |
| `treasury_receipt_method_t` | `transferencia, efectivo, cheque, echeq` | cobranzas |
| `treasury_payment_method_t` | `transferencia, cheque, echeq` | pagos (sin efectivo) |
| `treasury_doc_status_t` | `confirmado, anulado` | estado de recibo/pago |

**+ RBAC (en `0052`, aislada):** `alter type public.permission_module_t add value if not exists 'tesoreria';`

---

## 6. Lista final de vistas derivadas (6 — implementación en `0054`/A4)

| Vista | Deriva | Reglas (F4/F7) |
|---|---|---|
| `treasury_bank_balances` | `opening_balance + Σ ingresos − Σ egresos` (movs `confirmado`) | solo `status='confirmado'` |
| `customer_invoice_balances` | por factura: `total`, `pagado`, `saldo`, `estado_cobro` | allocations de recibos `confirmado`; factura vigente (`estado_arca` autorizada, no anulada); `vencida` si `saldo>0 and fch_vto_pago<current_date` |
| `supplier_invoice_balances` | ídem proveedor | pagos `confirmado`; excluye `status='anulada'` |
| `customer_current_account` | por cliente: Σ saldos, factura más vencida | suma sobre `customer_invoice_balances` |
| `supplier_current_account` | por proveedor | suma sobre `supplier_invoice_balances` |
| `treasury_cashflow_projection` | próximos cobros/pagos por vencimiento + saldo proyectado | base = `treasury_bank_balances` actual |

---

## 7. Lista final de RPCs previstas (4 — implementación en `0054`/A4)

| RPC | Firma (resumen) | Garantías |
|---|---|---|
| `tesoreria_register_receipt` | `(client_id, payment_date, method, bank_account_id, gross, retention, observations, attachment, allocations[])→jsonb` | atómica; `for update` por factura (F1); valida `Σ alloc = gross`, saldo y destino; inserta recibo+allocations+movimiento ingreso (`amount=net`) |
| `tesoreria_register_payment` | `(vendor_id, payment_date, method, bank_account_id, amount, operation_number, observations, attachment, allocations[])→jsonb` | atómica; `for update` por factura; `Σ alloc = amount`; inserta pago+allocations+movimiento egreso |
| `tesoreria_register_transfer` | `(date, from_bank, to_bank, amount, description)→jsonb` | bancos distintos; 2 movimientos con mismo `transfer_group_id` (egreso+ingreso) |
| `tesoreria_void_movement` | `(target, reason)→jsonb` | marca `status='anulado'` + `voided_*` en movimiento(s) y doc; ambas patas en transferencia; append-only |

Convención: `security definer`, `set search_path = public, pg_temp`, errores `'CODE: mensaje'`, `returns jsonb`.

---

## 8. Riesgos remanentes

### 🔴 P0
**Ninguno.**

### 🟠 P1 (incorporados al diseño base — no quedan abiertos)
F1, F2, F3, F4, F5 → ver §3. **Cerrados por diseño**; su implementación se distribuye en `0053` (F2/F3/F5) y `0054` (F1/F4).

### 🟡 P2 (resolver o documentar dentro de A)
- **F6 — INSERT directo de movimiento salteando RPC.** Recomendado incluir en `0053` un trigger `before insert` que permita inserción directa **solo** `type='ajuste'`; `cobranza/pago_proveedor/transferencia` solo vía RPC (`security definer`). *Decisión pendiente:* incluir en A1 (recomendado) o diferir.
- **F8 — Validación destino de allocation / anulación de factura con allocations.** Se cubre en la RPC (A4) para el alta; la regla "no anular factura con cobros confirmados" se documenta para ERP-C/D.
- **F7 — Conjunto de facturas vigentes** definido en vistas (A4).
- **F9 — Sin cobro/pago "a cuenta"** (anticipos) → fuera de alcance A; ERP-D.
- **F10 — Cheque/Echeq inmediatos** → `pendiente` reservado; clearing futuro.
- **F11 — Read RLS amplio** (incluye rol legacy `cliente`) → se mantiene patrón; endurecer tras validación funcional.
- **F12 — Multi-moneda** → RPC valida ARS; FX fuera de A.

### ⚪ P3
- `reference_id` nulo en transferencias (vínculo por `transfer_group_id`) — documentado.
- Numeración no reinicia por año (sequence global + prefijo) — consistente con `FP-`.
- Un solo `attachment` por recibo/pago.
- `net_amount` como GENERATED (adoptado, F16) — simplifica.

---

## Recomendación formal

> ## 🟢 GO ERP-A1
>
> El spec de `0052_treasury_permission_module.sql` y `0053_treasury_core.sql` es consistente con las convenciones reales del repositorio, no presenta colisiones (resuelto el prefijo `treasury_*` en enums), e incorpora los P1 obligatorios F1–F5. No hay riesgos P0 ni P1 abiertos.
>
> **Decisión pendiente menor (P2 F6):** ¿incluir en `0053` el trigger que restringe INSERT directo a `type='ajuste'`? Recomendación: **sí** (cierra el bypass de invariantes desde el inicio). Si se aprueba, se incorpora; si no, se difiere y se documenta.
>
> Autorizado a escribir, en este orden y como única tarea de esta fase:
> 1. `0052_treasury_permission_module.sql` (enum aislado).
> 2. `0053_treasury_core.sql` (tablas, enums `treasury_*`, sequences, triggers, índices, CHECKs F2, RLS sin DELETE F3, columnas `voided_*` F5, RBAC seed, bucket `treasury`, seed bancos `opening_balance=0`).
>
> Fuera de esta fase (no escribir aún): vistas y RPCs (`0054`/A4), backend TS, server actions, UI, dashboard, automatismos, integraciones, OCR, ARCA.

---

## Anexo — Evidencia verificada

| Afirmación | Evidencia |
|---|---|
| Colisión de enums `movement_type_t`/`movement_reference_t`/`alloc_status_t` (WMS) | `grep create type` sobre `supabase/migrations/` |
| 6 nombres de tabla libres | búsqueda `create table` negativa para los 6 |
| Patrón función `security definer`+`for update`+`search_path` | `0050_crm_promote_lead.sql:21-43` |
| Patrón bucket privado + policies | `0015_supplier_invoice_attachments.sql:27-60` |
| `current_role()` → `user_role_t` | `0001:23,180`; `0005:23-24` |
| RBAC `permission_module_t` + seed | `0009:17-28,180-289` |
| Tipo monetario AP `numeric(14,2)` | `0014:64-67` |
| public_id seq+trigger | `0014:48,82-97` |

---

*Fin — Revisión Pre-Implementación ERP-A1. Recomendación: GO ERP-A1. No se escribió código, migraciones ni se realizaron commits.*
