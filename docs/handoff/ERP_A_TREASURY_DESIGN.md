# ERP-A · TREASURY FOUNDATION — DISEÑO DE ARQUITECTURA CONGELADA

**Proyecto:** TOPS Nexus — Logística TOPS (Verotin S.A.)
**Presidente:** Martín Battaglia
**Documento:** `ERP_A_TREASURY_DESIGN.md`
**Estado:** 🧊 ARCHITECTURE FREEZE — diseño definitivo, pendiente de aprobación para iniciar ERP-A1.
**Alcance del documento:** únicamente diseño. No contiene código, migraciones, commits ni cambios sobre producción.

> **Regla de lectura:** todo lo descripto aquí es el contrato de diseño. Las migraciones/código de ERP-A1…A5 deben implementar *exactamente* este documento. Cualquier desvío requiere re-aprobar el freeze.

---

## 0. Resumen ejecutivo

ERP-A construye la **capa base de Tesorería** como dominio nuevo y aislado sobre Next.js 14 + Supabase. Es la **fuente única de verdad financiera** para cobros, pagos, bancos, movimientos, saldos y flujo de fondos. No reabre CRM, Digital Twin, Capacity, OCR ni ARCA.

Pilares congelados:
- **Saldo derivado** de movimientos confirmados (D1) — nunca un contador mutable.
- **Allocations N:M** desde el día uno (D2) — soporta pagos/cobros parciales y multi-factura.
- **Numeración automática** `REC-/PAG-/MOV-YYYY-NNNNNN` (D3) vía sequence+trigger.
- **Retenciones simplificadas**: solo `retention_amount` (D4).
- **Cuenta corriente derivada** de Facturas + Allocations (D5) — sin tablas de cuenta corriente.

Consecuencia arquitectónica central: **las funciones transaccionales escriben solo en el dominio Tesorería** (movimientos, recibos, pagos, allocations). El estado de cobro/pago y el saldo de cada factura se **derivan en vistas**, por lo que **el ERP nunca hace UPDATE sobre `customer_invoices`/`supplier_invoices`**. Esto mantiene una única fuente de verdad y **neutraliza el lock trigger fiscal de ARCA** (`tg_lock_authorized_invoice`).

---

## 1. Arquitectura congelada (D1–D5)

### D1 — Saldo bancario derivado ✅
**Decisión:** el saldo de cada banco es `saldo_inicial + Σ ingresos_confirmados − Σ egresos_confirmados`, calculado desde `treasury_movements` con `status='confirmado'`. No se persiste un saldo mutable.

**Rationale:** un contador mutable se desincroniza ante concurrencia, anulaciones o fallos parciales y deja de ser fuente de verdad. La suma sobre un libro append-only es siempre reproducible y auditable.

**Implementación:** vista `treasury_bank_balances`. Si se necesitara performance, se podrá agregar una *materialized view* refrescada por las RPC — pero la verdad sigue siendo la suma.

**Riesgo asociado:** queries de saldo más costosas a gran volumen (mitigable; ver R-P2-1).

### D2 — Allocations N:M ✅
**Decisión:** existen `receipt_allocations` y `payment_allocations` desde la primera versión. Un cobro/pago se imputa a 1..N facturas; una factura puede recibir 1..N cobros/pagos. Soporta parciales.

**Rationale:** la relación 1:1 cobro↔factura no representa la operación real (un cobro salda varias facturas; una factura grande se cobra en cuotas). Migrar de 1:1 a N:M después es destructivo. Se paga el costo de modelado una sola vez, al inicio.

**Riesgo asociado:** complejidad de validación de sobre-imputación (mitigable con CHECK + RPC; ver R-P1-1).

### D3 — Numeración automática ✅
**Decisión:** `public_id` legible por entidad, generado por `sequence + trigger before insert`, idéntico al patrón `FP-YYYY-NNNN` de `supplier_invoices` (`0014:82-97`):
- Cobranza: `REC-YYYY-NNNNNN`
- Pago: `PAG-YYYY-NNNNNN`
- Movimiento: `MOV-YYYY-NNNNNN`

**Rationale:** numeración manual genera duplicados y huecos. El patrón ya existe en Nexus; no se introduce nada nuevo.

> Nota: se adopta padding de **6 dígitos** (`NNNNNN`) por pedido explícito del freeze, vs. 4 en `FP-`. Es el único ajuste respecto de AP y es deliberado.

### D4 — Retenciones simplificadas ✅
**Decisión:** ERP-A almacena únicamente `retention_amount` en la cobranza. No se modela régimen, certificado ni tipo de retención. Se documenta para **ERP-F** (Reportes IVA/Contables).

**Rationale:** tesorería necesita el monto neto que ingresa al banco; el detalle impositivo de la retención es materia contable (ERP-F), no de la capa base.

**Semántica contable congelada (importante):**
- `net_amount = gross_amount − retention_amount` (CHECK).
- El **movimiento bancario** de una cobranza registra `amount = net_amount` (lo que efectivamente entra al banco).
- Las **allocations** imputan `gross_amount` (la deuda cancelada de la factura **incluye** la retención, porque la retención también cancela deuda del cliente — es un crédito fiscal del cliente, no un menor cobro de la factura).

### D5 — Cuenta corriente derivada ✅
**Decisión:** **no** se crean tablas `customer_current_account` ni `supplier_current_account`. La cuenta corriente se deriva de Facturas + Allocations:
```
saldo_factura = total_factura − Σ allocations.amount (de recibos/pagos no anulados)
cuenta_corriente_cliente = Σ saldo_factura por cliente
```

**Rationale:** una tabla de cuenta corriente sería un segundo registro de la misma verdad → riesgo de divergencia. La verdad ya está en facturas + allocations.

**Consecuencia clave:** el `estado_cobro` y el `saldo` de cada factura **se derivan en vistas**, no se almacenan. Por lo tanto **las RPC no mutan las facturas**. Esto:
1. mantiene una sola fuente de verdad,
2. **evita por completo el lock trigger ARCA** (`tg_lock_authorized_invoice`, `0011:257-281`) — nunca hay UPDATE sobre `customer_invoices`,
3. anula el riesgo R5 del diseño preliminar.

---

## 2. ERD definitivo

```
┌─────────────────────────────┐         seed: Banco Santander, Banco Galicia
│        bank_accounts        │
│  PK id uuid                 │
│  bank_name, account_name    │
│  account_type, currency     │
│  alias, cbu                 │
│  opening_balance numeric    │────┐  saldo = opening + Σ(mov confirmados)   [VISTA treasury_bank_balances]
│  active, created/updated_at │    │
└──────────────┬──────────────┘    │
               │ 1                  │
               │ N                  │
┌──────────────▼───────────────────▼────────────────────────────────┐
│                       treasury_movements                            │  ◄── FUENTE ÚNICA DE VERDAD
│  PK id uuid · public_id MOV-YYYY-NNNNNN (seq+trigger)               │
│  date · type(enum) · direction(enum) · status(enum)                │
│  FK bank_account_id → bank_accounts (restrict)                     │
│  amount numeric(14,2) > 0                                           │
│  description                                                        │
│  reference_type text · reference_id uuid     ← puntero polimórfico  │
│  transfer_group_id uuid                       ← agrupa par de transf.│
│  FK created_by → auth.users · created_at                           │
└───▲──────────────────────────▲───────────────────────────▲────────┘
    │ reference_type=           │ reference_type=           │ type=transferencia
    │ 'customer_receipt'        │ 'supplier_payment'        │ (2 movs, mismo transfer_group_id)
    │                           │                           │ type=ajuste → manual, sin doc
┌───┴─────────────────────┐ ┌──┴──────────────────────┐
│   customer_receipts     │ │   supplier_payments      │
│  PK id · public_id REC- │ │  PK id · public_id PAG-  │
│  FK client_id → clients │ │  FK vendor_id → vendors  │
│  payment_date           │ │  payment_date            │
│  payment_method(enum)   │ │  payment_method(enum)    │
│  FK bank_account_id     │ │  FK bank_account_id      │
│  gross_amount           │ │  amount                  │
│  retention_amount       │ │  operation_number        │
│  net_amount (CHECK)     │ │  attachment              │
│  observations·attachment│ │  observations            │
│  status(confirmado/anul)│ │  status(confirmado/anul) │
│  FK created_by·created_at│ │  FK created_by·created_at│
└───┬─────────────────────┘ └──────────┬───────────────┘
    │ 1                                 │ 1
    │ N                                 │ N
┌───▼─────────────────────┐ ┌───────────▼──────────────┐
│   receipt_allocations   │ │   payment_allocations    │
│  PK id uuid             │ │  PK id uuid              │
│  FK receipt_id (cascade)│ │  FK payment_id (cascade) │
│  FK customer_invoice_id │ │  FK supplier_invoice_id  │
│      → customer_invoices│ │      → supplier_invoices │
│  amount numeric(14,2)>0 │ │  amount numeric(14,2)>0  │
│  UNIQUE(receipt_id,inv) │ │  UNIQUE(payment_id,inv)  │
└───┬─────────────────────┘ └───────────┬──────────────┘
    │                                    │
    ▼ (solo lectura / FK)                ▼ (solo lectura / FK)
┌─────────────────────────┐ ┌──────────────────────────┐
│   customer_invoices     │ │   supplier_invoices       │   (EXISTENTES — no se mutan)
│   (0011_arca_billing)   │ │   (0014_supplier_invoices)│
└─────────────────────────┘ └──────────────────────────┘

VISTAS DERIVADAS (D1, D5):
  • treasury_bank_balances          (saldo por banco)
  • customer_invoice_balances       (saldo + estado_cobro por factura cliente)
  • supplier_invoice_balances       (saldo + estado_pago por factura proveedor)
  • customer_current_account        (cuenta corriente por cliente)
  • supplier_current_account        (cuenta corriente por proveedor)
  • treasury_cashflow_projection    (próximos cobros/pagos + saldo proyectado)
```

**Entidades reutilizadas (NO se duplican):** `public.clients` (`0001`), `public.vendors` (`0008`), `public.customer_invoices` (`0011`), `public.supplier_invoices` (`0014`), `auth.users`, RBAC `permissions/roles/role_permissions/user_roles` (`0009`).

---

## 3. Modelo de datos (definitivo)

> Tipos y convenciones alineados a la casa: `numeric(14,2)` (igual que AP), `gen_random_uuid()`, `created_by → auth.users(id) on delete set null`, enums idempotentes, `public_id` por sequence+trigger, `touch_updated_at()` (`0009:68`).

### 3.1 Enums

```
treasury_movement_type_t  = { cobranza, pago_proveedor, transferencia, ajuste }
treasury_direction_t      = { ingreso, egreso }
treasury_status_t         = { pendiente, confirmado, anulado }
receipt_method_t          = { transferencia, efectivo, cheque, echeq }
payment_method_t          = { transferencia, cheque, echeq }
doc_status_t              = { confirmado, anulado }     -- estado de recibo/pago
```
Patrón de creación: `do $$ begin create type … exception when duplicate_object then null; end $$;`

### 3.2 `bank_accounts`

| Campo | Tipo | Reglas |
|---|---|---|
| `id` | uuid PK | `default gen_random_uuid()` |
| `bank_name` | text NOT NULL | seed: `'Banco Santander'`, `'Banco Galicia'`; libre a futuro |
| `account_name` | text NOT NULL | nombre/titular de la cuenta |
| `account_type` | text NOT NULL | `'caja_ahorro' | 'cuenta_corriente'` (CHECK suave) |
| `currency` | text NOT NULL | `default 'ARS'` |
| `alias` | text | alias CBU |
| `cbu` | text | 22 dígitos (sin validación dura en A) |
| `opening_balance` | numeric(14,2) NOT NULL | `default 0` — saldo inicial (D1) |
| `active` | boolean NOT NULL | `default true` |
| `created_at` | timestamptz NOT NULL | `default now()` |
| `updated_at` | timestamptz NOT NULL | `default now()` + trigger `touch_updated_at` |

**Índices:** `bank_accounts_active_idx (active)`.
**Seed:** Santander + Galicia (caja_ahorro/cuenta_corriente según corresponda), `opening_balance` a confirmar con administración (default 0).

### 3.3 `treasury_movements` — fuente única de verdad

| Campo | Tipo | Reglas |
|---|---|---|
| `id` | uuid PK | |
| `public_id` | text UNIQUE NOT NULL | `MOV-YYYY-NNNNNN` (seq+trigger) |
| `short_id` | int NOT NULL | `nextval('treasury_movement_short_id_seq')` |
| `date` | date NOT NULL | `default current_date` |
| `type` | treasury_movement_type_t NOT NULL | |
| `direction` | treasury_direction_t NOT NULL | coherencia con `type` validada en RPC |
| `bank_account_id` | uuid NOT NULL | FK → `bank_accounts(id)` ON DELETE RESTRICT |
| `amount` | numeric(14,2) NOT NULL | `CHECK (amount > 0)` |
| `description` | text | |
| `reference_type` | text | `'customer_receipt' | 'supplier_payment' | 'transfer' | 'manual'` |
| `reference_id` | uuid | puntero polimórfico (no FK dura) |
| `transfer_group_id` | uuid | agrupa los 2 movimientos de una transferencia |
| `status` | treasury_status_t NOT NULL | `default 'confirmado'` |
| `created_by` | uuid | FK → auth.users ON DELETE SET NULL |
| `created_at` | timestamptz NOT NULL | `default now()` |

**Índices:** `(bank_account_id)`, `(status)`, `(date desc)`, `(reference_type, reference_id)`, `(transfer_group_id)`, `(type)`.
**Regla:** sólo `status='confirmado'` impacta saldos. `anulado` se excluye de toda suma.

### 3.4 `customer_receipts` — cobranzas

| Campo | Tipo | Reglas |
|---|---|---|
| `id` | uuid PK | |
| `public_id` | text UNIQUE NOT NULL | `REC-YYYY-NNNNNN` |
| `short_id` | int NOT NULL | sequence |
| `client_id` | uuid NOT NULL | FK → `clients(id)` ON DELETE RESTRICT |
| `payment_date` | date NOT NULL | `default current_date` |
| `payment_method` | receipt_method_t NOT NULL | transferencia/efectivo/cheque/echeq |
| `bank_account_id` | uuid | FK → `bank_accounts(id)`; **NULL permitido sólo si `payment_method='efectivo'`** (caja) — validado en RPC |
| `gross_amount` | numeric(14,2) NOT NULL | `CHECK (> 0)` — deuda cancelada |
| `retention_amount` | numeric(14,2) NOT NULL | `default 0`, `CHECK (>= 0)` |
| `net_amount` | numeric(14,2) NOT NULL | `CHECK (net_amount = gross_amount − retention_amount)` |
| `observations` | text | |
| `attachment` | text | path en bucket `treasury` (ver R-P2-3) |
| `status` | doc_status_t NOT NULL | `default 'confirmado'` |
| `created_by` | uuid | FK auth.users |
| `created_at` | timestamptz NOT NULL | `default now()` |

**Índices:** `(client_id)`, `(payment_date desc)`, `(status)`, `(bank_account_id)`.

### 3.5 `supplier_payments` — pagos a proveedor

| Campo | Tipo | Reglas |
|---|---|---|
| `id` | uuid PK | |
| `public_id` | text UNIQUE NOT NULL | `PAG-YYYY-NNNNNN` |
| `short_id` | int NOT NULL | sequence |
| `vendor_id` | uuid NOT NULL | FK → `vendors(id)` ON DELETE RESTRICT |
| `payment_date` | date NOT NULL | `default current_date` |
| `payment_method` | payment_method_t NOT NULL | transferencia/cheque/echeq |
| `bank_account_id` | uuid NOT NULL | FK → `bank_accounts(id)` |
| `amount` | numeric(14,2) NOT NULL | `CHECK (> 0)` |
| `operation_number` | text | nº transferencia / nº echeq |
| `observations` | text | |
| `attachment` | text | path en bucket `treasury` |
| `status` | doc_status_t NOT NULL | `default 'confirmado'` |
| `created_by` | uuid | FK auth.users |
| `created_at` | timestamptz NOT NULL | `default now()` |

**Índices:** `(vendor_id)`, `(payment_date desc)`, `(status)`, `(bank_account_id)`.

### 3.6 `receipt_allocations` (D2)

| Campo | Tipo | Reglas |
|---|---|---|
| `id` | uuid PK | |
| `receipt_id` | uuid NOT NULL | FK → `customer_receipts(id)` ON DELETE CASCADE |
| `customer_invoice_id` | uuid NOT NULL | FK → `customer_invoices(id)` ON DELETE RESTRICT |
| `amount` | numeric(14,2) NOT NULL | `CHECK (> 0)` |
| `created_at` | timestamptz NOT NULL | `default now()` |
| | | `UNIQUE (receipt_id, customer_invoice_id)` |

**Índices:** `(receipt_id)`, `(customer_invoice_id)`.
**Invariante (validada en RPC):** `Σ amount por receipt = gross_amount` del recibo; y por factura, `Σ allocations.amount (no anuladas) ≤ total` de la factura.

### 3.7 `payment_allocations` (D2)

| Campo | Tipo | Reglas |
|---|---|---|
| `id` | uuid PK | |
| `payment_id` | uuid NOT NULL | FK → `supplier_payments(id)` ON DELETE CASCADE |
| `supplier_invoice_id` | uuid NOT NULL | FK → `supplier_invoices(id)` ON DELETE RESTRICT |
| `amount` | numeric(14,2) NOT NULL | `CHECK (> 0)` |
| `created_at` | timestamptz NOT NULL | `default now()` |
| | | `UNIQUE (payment_id, supplier_invoice_id)` |

**Índices:** `(payment_id)`, `(supplier_invoice_id)`.
**Invariante:** `Σ amount por payment = amount` del pago; por factura, `Σ allocations ≤ total`.

### 3.8 Vistas derivadas (D1 + D5)

- **`treasury_bank_balances`** → por `bank_account`: `opening_balance + Σ(amount where direction=ingreso & confirmado) − Σ(amount where direction=egreso & confirmado)`.
- **`customer_invoice_balances`** → por factura cliente: `total`, `pagado = Σ receipt_allocations.amount (recibo no anulado)`, `saldo = total − pagado`, `estado_cobro` ∈ {pendiente, parcial, cobrada, vencida, anulada} (derivado; `vencida` cuando `saldo>0 AND fch_vto_pago<current_date`; `anulada` cuando `customer_invoices.anulada OR estado_arca='ANULADO'`).
- **`supplier_invoice_balances`** → análogo con `payment_allocations` y `fecha_vencimiento`.
- **`customer_current_account`** → por cliente: `Σ total`, `Σ pagado`, `Σ saldo`, factura más vencida.
- **`supplier_current_account`** → por proveedor: ídem.
- **`treasury_cashflow_projection`** → próximos cobros (facturas cliente con saldo>0 por `fch_vto_pago`) y próximos pagos (facturas proveedor con saldo>0 por `fecha_vencimiento`), con saldo proyectado acumulado a partir del saldo bancario actual.

> Las vistas son **read-only** y constituyen la cuenta corriente (D5). Nada de esto se almacena. `estado_cobro/estado_pago` **no** son columnas: son cálculo.

---

## 4. RBAC — módulo `tesoreria`

### 4.1 Enum
Agregar `'tesoreria'` a `permission_module_t` (`0009:17`) en **migración aislada** (regla casa `0021`/`0029`: el valor nuevo debe estar committeado antes de usarse en seeds, por la restricción de Postgres sobre enums).

### 4.2 Catálogo de permisos (respeta `unique(module, action)`)

| slug | module | action | label |
|---|---|---|---|
| `tesoreria.view` | tesoreria | view | Ver tesorería (bancos, movimientos, saldos) |
| `tesoreria.create` | tesoreria | create | Registrar cobranzas, pagos y transferencias |
| `tesoreria.edit` | tesoreria | edit | Editar/anular movimientos, recibos y pagos |
| `tesoreria.export` | tesoreria | export | Exportar reportes de caja/bancos/flujo |
| `tesoreria.admin` | tesoreria | admin | Administrar cuentas bancarias |

> No se define `delete` ni `sign` para tesorería: la anulación es lógica (`edit`/RPC `void`), no DELETE; no hay firma fiscal en este dominio.

### 4.3 Matriz rol × permiso (seed)

| Rol (slug) | view | create | edit | export | admin | Notas |
|---|:--:|:--:|:--:|:--:|:--:|---|
| `director_ops` | ✅ | ✅ | ✅ | ✅ | ✅ | hereda TODO (seed "all permissions") |
| `admin` (Administración) | ✅ | ✅ | ✅ | ✅ | ✅ | equipo financiero — operador natural de tesorería |
| `operaciones` | ✅ | — | — | — | — | sólo consulta |
| `compliance` | ✅ | — | — | ✅ | — | lectura + export para auditoría |
| `comercial` | — | — | — | — | — | sin acceso |
| `seguridad` | — | — | — | — | — | sin acceso |
| `cliente_b2b` | — | — | — | — | — | sin acceso |

Seed con el mismo patrón `insert … select` por slug de `0009:231-289`. `director_ops` ya recibe todo vía la regla "all permissions"; el resto se asigna explícito.

---

## 5. RLS — políticas completas

Doble capa, idéntica a la casa: RLS por `current_role()` (capa de tabla) + `has_permission()` a nivel acción en la app/RPC.

**`bank_accounts`**
- `select`: `auth.role() = 'authenticated'`
- `all` (write): `current_role() = 'admin'` *(administrar cuentas = sensible; solo Administración)*

**`treasury_movements`, `customer_receipts`, `supplier_payments`, `receipt_allocations`, `payment_allocations`**
- `select`: `auth.role() = 'authenticated'`
- `insert`: `current_role() in ('admin','operaciones','supervisor')`
- `update`: `current_role() in ('admin','operaciones','supervisor')` *(usado solo para anulación lógica)*
- `delete`: `current_role() = 'admin'` *(no se usa en operación; reservado a corrección administrativa)*

> Mismo molde que `supplier_invoices` (`0014:116-135`). La granularidad fina (quién puede registrar vs. solo ver) se ejerce en la capa de acciones vía `has_permission('tesoreria.create' | 'tesoreria.edit' | …)`. Las **escrituras reales pasan siempre por RPC `security definer`**, de modo que la RLS de tabla actúa como segundo cinturón.

> Las **vistas** heredan RLS de las tablas subyacentes (Postgres). No requieren policy propia. Las vistas que cruzan `customer_invoices`/`supplier_invoices` quedan sujetas a la RLS existente de esas tablas (lectura autenticada).

---

## 6. Reglas transaccionales (RPC Postgres `security definer`)

Todas las operaciones de escritura son **funciones atómicas** (patrón `0047_crm_write_path_fns`, `0031_pedidos_functions`). Una operación = una transacción. Si algo falla, no queda nada a medias. **Ninguna RPC hace UPDATE sobre facturas** (D5).

### 6.1 `tesoreria_register_receipt(...)` — registrar cobranza
**Input:** `client_id, payment_date, payment_method, bank_account_id, gross_amount, retention_amount, observations, attachment, allocations[]{customer_invoice_id, amount}`.
**Pasos (1 transacción):**
1. Validar: `Σ allocations.amount = gross_amount`; cada factura pertenece a `client_id`; `saldo_actual(factura) ≥ amount` imputado (no sobre-imputar); método/banco coherentes (efectivo ⇒ banco opcional).
2. `insert customer_receipts` (calcula `net_amount = gross − retention`).
3. `insert receipt_allocations` (N filas).
4. `insert treasury_movements`: `type='cobranza', direction='ingreso', amount = net_amount, reference_type='customer_receipt', reference_id = receipt.id, status='confirmado'`.
5. **No** se toca la factura. El saldo/estado se deriva en `customer_invoice_balances`.
**Output:** `receipt_id, public_id, movement_id`.

### 6.2 `tesoreria_register_payment(...)` — registrar pago proveedor
**Input:** `vendor_id, payment_date, payment_method, bank_account_id, amount, operation_number, observations, attachment, allocations[]{supplier_invoice_id, amount}`.
**Pasos:**
1. Validar `Σ allocations.amount = amount`; facturas del `vendor_id`; sin sobre-imputar; saldo del banco no se valida (puede quedar negativo → se reporta, no se bloquea, salvo política contraria).
2. `insert supplier_payments`.
3. `insert payment_allocations`.
4. `insert treasury_movements`: `type='pago_proveedor', direction='egreso', amount, reference_type='supplier_payment', reference_id=payment.id, status='confirmado'`.
5. No se toca la factura. Saldo/estado vía `supplier_invoice_balances`.
**Output:** `payment_id, public_id, movement_id`.

### 6.3 `tesoreria_register_transfer(...)` — transferencia interna
**Input:** `date, from_bank_account_id, to_bank_account_id, amount, description`.
**Pasos:**
1. Validar bancos distintos, `amount>0`.
2. Generar `transfer_group_id := gen_random_uuid()`.
3. `insert treasury_movements` **egreso** (banco origen) con `type='transferencia', reference_type='transfer', transfer_group_id`.
4. `insert treasury_movements` **ingreso** (banco destino) con mismo `transfer_group_id`.
**Output:** `transfer_group_id, movement_out_id, movement_in_id`.
> No hay tabla de transferencias (decisión de dominio): la transferencia ES el par de movimientos agrupados.

### 6.4 `tesoreria_void_movement(...)` — anular
**Input:** `target` (movement_id | receipt_id | payment_id | transfer_group_id), `reason`.
**Pasos:**
1. Marcar `status='anulado'` en el/los `treasury_movements` afectados (en transferencia: ambos).
2. Marcar `status='anulado'` en el `customer_receipt`/`supplier_payment` asociado.
3. Las `allocations` permanecen físicamente pero se excluyen de saldos porque su recibo/pago quedó anulado (las vistas filtran por `status='confirmado'`).
4. Registrar motivo (`observations`/auditoría).
**Garantía:** anulación 100% reversible a nivel saldo, **append-only**, sin DELETE. El saldo del banco y de las facturas se recalcula solo (derivado).

---

## 7. Impacto sobre módulos existentes

| Módulo | ¿Se toca en ERP-A? | Tipo | Detalle |
|---|---|---|---|
| **Facturación cliente** (`customer_invoices`) | **No se muta** | Solo lectura (FK + vistas) | `receipt_allocations` referencia la factura; saldo/estado derivados. **El lock trigger ARCA nunca se activa** (no hay UPDATE). |
| **Compras / AP** (`supplier_invoices`) | **No se muta** | Solo lectura (FK + vistas) | `payment_allocations` referencia la factura; `pagada` real pasa a ser **derivado** (`saldo=0`) en `supplier_invoice_balances`. El enum `status` legacy permanece pero deja de ser la verdad del pago. |
| **OCR** | **Cero** | Ninguno | No participa de cobro/pago. |
| **ARCA** | **Cero** | Ninguno | No se toca emisión ni credenciales. La derivación evita incluso rozar el lock trigger. |
| **Dashboard / Reports** | **Opcional** | Lectura aditiva | Podrán consumir `treasury_bank_balances` y `*_current_account`. No se rediseñan en A. |
| **RBAC** (`0009`) | **Sí** | Aditivo | Nuevo módulo `tesoreria` + permisos + seed. Migración de enum **aislada**. |
| **Sidebar / shell** | **Sí** | Aditivo | Grupo nav nuevo. Sin tocar grupos existentes. |
| **CRM / Digital Twin / Capacity / WMS / Pedidos** | **Cero** | Ninguno | Dominios independientes. |

**Colisiones destructivas detectadas:** ninguna. Dependencias = lecturas/FK sobre `clients`, `vendors`, `customer_invoices`, `supplier_invoices` + escritura aditiva sobre el enum RBAC.

**Nota sobre `supplier_invoices.status`:** convive. ERP-A no lo borra ni lo migra; simplemente la verdad del pago pasa a `supplier_invoice_balances`. La reconciliación del enum legacy (que `pagada` se setee desde el saldo derivado) se documenta para **ERP-C**, fuera de A.

---

## 8. Riesgos clasificados

### 🔴 P0 — integridad
- **R-P0-1 — Escritura no atómica.** Si las reglas se implementaran en TS (no en RPC), un fallo parcial dejaría movimiento sin recibo o allocations huérfanas. **Mitigación (congelada):** toda escritura en funciones Postgres `security definer`, una transacción por operación.
- **R-P0-2 — Saldo como contador mutable.** Desincronización bajo concurrencia/anulación. **Mitigación:** D1 — saldo derivado de movimientos confirmados.

### 🟠 P1 — correctitud
- **R-P1-1 — Sobre-imputación de allocations.** Imputar más que el saldo de la factura o que el monto del recibo/pago. **Mitigación:** CHECK de igualdad `Σ allocations = monto` + validación de saldo en RPC + `UNIQUE(doc, invoice)`.
- **R-P1-2 — Orden de migración del enum RBAC.** Usar `'tesoreria'` en el mismo commit que el `ALTER TYPE` → error "unsafe use of new value of enum". **Mitigación:** migración `0052` aislada y committeada antes de `0053`.
- **R-P1-3 — Coherencia `type`↔`direction`.** Un `cobranza/egreso` corrompería saldos. **Mitigación:** validación en RPC (cobranza⇒ingreso, pago⇒egreso; transferencia⇒par; ajuste⇒libre).
- **R-P1-4 — Semántica de retención.** Confundir `net` (banco) con `gross` (deuda cancelada). **Mitigación:** congelado en D4: movimiento usa `net_amount`, allocations usan `gross_amount`, CHECK `net = gross − retention`.

### 🟡 P2 — operativo / performance
- **R-P2-1 — Costo de vistas derivadas a gran volumen.** **Mitigación:** índices definidos; opción futura de *materialized view* refrescada por RPC (sin cambiar la fuente de verdad).
- **R-P2-2 — Anulación mal modelada (DELETE).** Rompe auditoría. **Mitigación:** `void` lógico, append-only.
- **R-P2-3 — Adjuntos sin bucket.** Repetir el bug silencioso de AP (`0015`/`ocr-actions.ts:67-75`). **Mitigación:** crear bucket privado `treasury` con RLS en `0053`, o documentar explícitamente la deuda; la app debe **fallar visible** si el upload falla.
- **R-P2-4 — Banco en negativo.** Un pago puede dejar saldo negativo. **Mitigación:** A reporta (no bloquea) por defecto; política de bloqueo se decide en A4 si Administración lo pide.

### ⚪ P3 — menor
- **R-P3-1 — Multi-moneda.** Se modela `currency` pero se opera solo ARS. Sin impacto si se documenta.
- **R-P3-2 — Ubicación en Sidebar.** Cosmético (grupo "Tesorería · Finanzas" propuesto).
- **R-P3-3 — Padding 6 vs 4 dígitos** en `public_id` respecto de `FP-`. Deliberado (D3), sin impacto funcional.

---

## 9. Roadmap ERP-A

> Orden de commits obligatorio de migraciones: **`0052` (aislada) → `0053` → `0054`**.

### ERP-A1 — Modelo de datos
- `0052_treasury_permission_module.sql` — **aislada**: `alter type permission_module_t add value if not exists 'tesoreria'` + `notify pgrst`.
- `0053_treasury_core.sql` — enums del dominio; tablas `bank_accounts`, `treasury_movements`, `customer_receipts`, `supplier_payments`, `receipt_allocations`, `payment_allocations`; sequences + triggers `public_id` + `touch_updated_at`; índices; CHECKs; **RLS** completa (§5); bucket privado `treasury` + policies; **seed RBAC** (permisos §4.2 + matriz §4.3); **seed bancos** Santander/Galicia.
- **Entregable:** schema aplicado en staging + checklist RLS/RBAC verde.

### ERP-A2 — Backend (capa de datos + tipos)
- `src/lib/tesoreria/`: `types.ts` (espejo de enums), `data.ts` (accessors read-only sobre tablas y vistas), `validation.ts` (zod), `actions.ts` (server actions → RPC). Patrón idéntico a `src/lib/erp/`.
- Fallback demo/mock siguiendo `env.app.demoMode`.
- **Entregable:** accessors tipados + acciones que invocan las RPC (RPC llegan en A4).

### ERP-A3 — UI
- Rutas `(app)/tesoreria`: `page.tsx` (overview caja/bancos), `/bancos`, `/movimientos`, `/cobranzas`, `/pagos`, `/flujo-fondos`.
- Sidebar: grupo **"Tesorería · Finanzas"** (o dentro de `Analytics & Finanzas`).
- Design system Nexus existente; tablas muestran **Neto / IVA / Total** cuando aplique. Sin rediseño.
- **Entregable:** navegación + listados read-only conectados a A2.

### ERP-A4 — Automatismos (funciones transaccionales)
- `0054_treasury_fns.sql`: `tesoreria_register_receipt`, `tesoreria_register_payment`, `tesoreria_register_transfer`, `tesoreria_void_movement`; vistas `treasury_bank_balances`, `customer_invoice_balances`, `supplier_invoice_balances`, `customer_current_account`, `supplier_current_account`, `treasury_cashflow_projection`.
- Cablear formularios de cobranza/pago/transferencia a las RPC.
- **Entregable:** alta real de cobros/pagos/transferencias con saldos derivados en vivo.

### ERP-A5 — Validación E2E
- Script de validación en staging (patrón `scripts/` del CRM): cobranza→movimiento→saldo banco→saldo factura derivado; pago→ídem; transferencia (par + saldos cruzados); anulación reversa saldos; **concurrencia** (dos cobros simultáneos no desincronizan el saldo derivado); sobre-imputación rechazada; RLS por rol; verificación de que `customer_invoices` AUTORIZADO **no** fue mutada.
- **Entregable:** reporte GO/NO-GO.

---

## Anexo — Evidencia de auditoría (verificada en repo)

| Afirmación | Evidencia |
|---|---|
| Última migración = 0051 | `supabase/migrations/0051_crm_onboarding_autocreate.sql` |
| Enum nuevo debe ir aislado | `0021_wms_permission_module.sql`, `0029_pedidos_permission_module.sql` |
| Patrón `public_id` seq+trigger | `0014_supplier_invoices.sql:48,82-97` |
| Convención RLS AP | `0014:116-135` |
| RBAC: módulos/acciones/roles/seed | `0009_rbac.sql:17-40,180-289` |
| `has_permission()` + `current_role()` | `0009:164-175` |
| `touch_updated_at()` | `0009:68-79` |
| `clients` (PK uuid, razon, cuit) | `0001_init.sql:38-49` |
| `vendors` (PK uuid, razon, cuit) | `0008_purchase_orders.sql:39-54` |
| `customer_invoices` sin saldo/cobro | `0011_arca_billing.sql:133-207` |
| Lock trigger solo veta columnas fiscales | `0011:257-281` |
| `supplier_invoices` sin registro de pago | `0014:50-75` |
| No existe ruta `(app)/tesoreria` | `find src/app -type d` (ausente) |

---

*Fin del documento — ERP-A Treasury Foundation · Architecture Freeze. Pendiente de aprobación para iniciar ERP-A1. No se ha escrito código, migraciones ni realizado commits.*
