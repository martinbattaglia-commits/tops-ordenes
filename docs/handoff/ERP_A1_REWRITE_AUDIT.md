# ERP-A1 · AUDITORÍA DE LA REESCRITURA DE 0053

**Proyecto:** TOPS Nexus — Logística TOPS (Verotin S.A.)
**Presidente:** Martín Battaglia
**Documento:** `ERP_A1_REWRITE_AUDIT.md`
**Audita:** `0053_treasury_core.sql` **reescrito** (C1–C8) vs. versión auditada en `ERP_A1_MIGRATION_AUDIT.md`.
**Naturaleza:** solo auditoría. No se aplicó, ejecutó ni commiteó nada. `0052` intacto. No se escribió `0054`.

> **Honestidad:** volví a intentar romper el diseño tras la reescritura. Los 6 hallazgos P1 anteriores (H1–H6) están **cerrados**. La nueva pasada adversarial encontró **1 residual P2 nuevo y real** (R11: `opening_balance` mutable re-basa el saldo derivado) — que **se corrigió en `0053`** con `tg_lock_bank_account_basis`. Restan solo residuales inherentes (service-role/superusuario, GUC) y requisitos forward para `0054`. **Sin P0 ni P1.**
>
> **Adenda:** este documento ya refleja la corrección de R11 aplicada en `0053` (autorizada). El veredicto final es **GO**.

---

## 1. Diff conceptual contra la versión anterior

| Área | Antes | Ahora |
|---|---|---|
| **UPDATE de confirmados** | RLS permitía editar cualquier columna (H1) | 3 triggers `tg_lock_*`: confirmado→anulado únicamente, con `voided_*` obligatorio; resto inmutable |
| **DELETE financiero** | Solo ausencia de policy (service-role borraba) | 5 triggers `tg_forbid_delete_financial` que **siempre** rechazan (frenan service-role) + `tg_protect_system_bank_account` |
| **Allocations** | INSERT directo libre (H2); FK cascade | Guard `via_rpc` en INSERT; trigger anti-UPDATE; FK `on delete restrict`; DELETE prohibido |
| **Efectivo** | `bank_account_id` nullable (H3) | Cuenta **CAJA** (`account_type='caja'`, `is_system=true`); `customer_receipts.bank_account_id` **NOT NULL** |
| **RLS write** | `admin/operaciones/supervisor` (H4) | **solo `admin`** (alineado a RBAC; fino vía `has_permission` en RPC) |
| **RLS read** | `authenticated` (incluía `cliente`, H5) | `current_role() in ('admin','operaciones','supervisor')` — excluye `cliente` |
| **type↔direction** | sin CHECK (H6) | `treasury_movements_type_direction_ck` + `reference_type_ck` |
| **Precisión** | `numeric(14,2)` mixto (H12) | `numeric(15,2)` lado ventas; `14,2` lado AP |
| **Objetos nuevos** | — | +5 funciones (lock×3 conceptual, forbid_delete, guard_alloc, forbid_update_alloc, protect_bank) y +11 triggers respecto del original |

Conteo verificado: 6 enums · 6 tablas · 11 funciones · 18 triggers (6 insert / 6 update / 6 delete) · 18 policies · 2 CHECK de coherencia · `$$` balanceados (34).

---

## 2. Verificación C1–C8

| C | Requisito | ¿Cumple? | Evidencia en `0053` |
|---|---|:--:|---|
| **C1** | Append-only: UPDATE confirmados solo →anulado con `voided_*` | ✅ | `tg_lock_treasury_movement` / `_customer_receipt` / `_supplier_payment`: `row(...) is distinct from` bloquea cambios; exige `new.status='anulado'` + `voided_at/by/reason` no nulos |
| **C2** | DELETE absoluto en mov/recibos/pagos/allocations | ✅ | `tg_forbid_delete_financial` en 5 tablas (6 triggers before delete contando `protect_system_bank`) |
| **C3** | Allocations solo RPC; sin INSERT/UPDATE/DELETE directo | ✅ | `guard_allocation_insert` (via_rpc) + `tg_forbid_update_allocation` + forbid_delete + FK `on delete restrict` |
| **C4** | Cuenta CAJA, sin NULL semánticos | ✅ | `account_type` CHECK `+'caja'`; `is_system`; seed CAJA `is_system=true`; `customer_receipts.bank_account_id NOT NULL` |
| **C5** | RLS write ≤ RBAC (solo admin) | ✅ | Todas las policies de write `current_role()='admin'` |
| **C6** | Excluir `cliente` de lectura financiera | ✅ | Todas las policies de read `current_role() in ('admin','operaciones','supervisor')` |
| **C7** | CHECK type↔direction y reference_type↔entidad | ✅ | `treasury_movements_type_direction_ck` + `treasury_movements_reference_type_ck` |
| **C8** | `numeric(15,2)` lado ventas | ✅ | `bank_accounts.opening_balance`, `treasury_movements.amount`, `customer_receipts.gross/retention/net`, `receipt_allocations.amount` |

**Las 8 correcciones están incorporadas y verificadas.**

---

## 3. Verificación D1–D5 (congeladas — sin regresión)

| D | ¿Intacta? | Nota |
|---|:--:|---|
| **D1** saldo derivado | ✅ | Ningún saldo persistido como verdad. CAJA es otra cuenta con saldo derivado. *(Ver R11: `opening_balance` mutable — no es persistir el saldo, pero re-basa la derivación.)* |
| **D2** allocations N:M | ✅ | Cardinalidad N:M intacta; solo se endureció el acceso (RPC-only, inmutable). |
| **D3** numeración | ✅ | Sequences + triggers `public_id` (`MOV-/REC-/PAG-YYYY-NNNNNN`) sin cambios. |
| **D4** retención simplificada | ✅ | Solo `retention_amount`; sin régimen/certificado. |
| **D5** cuenta corriente derivada | ✅ | Sigue derivada de facturas+allocations; C3 garantiza que nadie la corrompa fuera de las RPC. |

---

## 4. Verificación F1–F6

| F | Estado tras reescritura | Evidencia |
|---|:--:|---|
| **F1** concurrencia | ⏳ `0054` | Lock por factura en RPC. *Refuerzo:* C3 impide allocations espurias fuera de RPC. |
| **F2** retención CHECK | ✅ | `retention >= 0`, `retention <= gross`, `net` GENERATED |
| **F3** append-only | ✅ **completo** | C1 (UPDATE lock) + C2 (DELETE forbid). Ahora resiste service-role (triggers se disparan igual). |
| **F4** vistas confirmado | ⏳ `0054` | Diseñado: vistas filtran `status='confirmado'` |
| **F5** auditoría void | ✅ **enforced** | C1 exige `voided_at/by/reason` para anular |
| **F6** guard insert | ✅ **extendido** | Movimientos (original) + allocations (C3) |

F3, F5 y F6 quedan **cerrados**; F1 y F4 correctamente diferidos a `0054`.

---

## 5. Nueva auditoría adversarial (intento de romper el diseño otra vez)

### Intentos que FALLARON (el diseño resiste)
- **Editar el `amount` de un movimiento confirmado** (admin, vía PostgREST/SQL): el trigger `tg_lock_treasury_movement` dispara `row(...) is distinct` → rechazado. **También para service-role** (los triggers se ejecutan; service-role no es superusuario en Supabase). ✅
- **Anular sin auditoría** (`status='anulado'` sin `voided_*`): `TREASURY_VOID_REQUIRES_AUDIT`. ✅
- **Half-void** (llenar `voided_*` dejando `status='confirmado'`): `única transición confirmado→anulado`. ✅
- **Borrar un recibo/pago/movimiento/allocation**: `tg_forbid_delete_financial`. ✅
- **Insertar una allocation directa para bajar el saldo de una factura sin cobro**: `guard_allocation_insert` (via_rpc) → rechazado incluso para admin. ✅
- **Insertar un movimiento `cobranza` a mano**: guard F6. ✅
- **Cargar `cobranza` con `direction='egreso'`** (invertir signo): `type_direction_ck`. ✅
- **Borrar la cuenta CAJA**: `tg_protect_system_bank_account`. ✅
- **`cliente` leyendo finanzas**: RLS read los excluye. ✅

### Intentos que TODAVÍA pasan (residuales) — honestos

- **R11 (P2, NUEVO) — ✅ RESUELTO en `0053`.** `bank_accounts.opening_balance` era mutable: un `admin` podía `UPDATE … SET opening_balance=X` tras tener movimientos y, como D1 calcula `saldo = opening_balance + Σ(confirmados)`, **re-basaba el histórico** del saldo derivado sin auditoría.
  *Corrección aplicada:* trigger `tg_lock_bank_account_basis` (before update) que bloquea cambiar `opening_balance/currency/account_type` una vez que la cuenta tiene movimientos, y protege la naturaleza de cuentas de sistema (CAJA). Editar alias/cbu/account_name/active sigue permitido. **Cerrado de origen.**
- **R1 (P2) — Bypass del guard por GUC.** `set_config('treasury.via_rpc','on',...)` lo puede setear cualquier rol con SQL. El guard (movimientos + allocations) es **defensa-en-profundidad**, no frontera. Service-role = confianza total por diseño Supabase.
- **R2 (P2→requisito de `0054`) — Fuga de GUC por pgbouncer.** Si una RPC setea `via_rpc` con `is_local=false`, el pooler puede filtrarlo a requests siguientes. **Requisito vinculante para `0054`:** usar siempre `set_config(...,true)` (scope transacción).
- **R3 (P3) — `status='pendiente'` no protegido.** El lock solo actúa sobre `confirmado`/`anulado`. Un movimiento `pendiente` (reservado, no usado en A) sería editable hasta confirmarse. Documentado.
- **R4 (P3) — Superusuario.** `session_replication_role='replica'`, `TRUNCATE` o `DROP` saltan triggers. Inherente a Postgres; fuera del modelo de amenaza (solo el owner/superusuario, no service-role).
- **R5 (P2→`0054`) — Sin backstop de esquema para `Σ allocations`.** La igualdad `Σ=gross/amount` y `Σ≤total` viven solo en la RPC (F1). El guard garantiza que la RPC es el único escritor, pero un bug en la RPC no lo atrapa el esquema.
- **R10 (P3) — RLS read podría ser más estricta que RBAC.** Un usuario con `tesoreria.view` granular pero rol legacy fuera de `(admin,operaciones,supervisor)` quedaría sin lectura. **Falla cerrado** (seguro), pero verificar que `compliance` tenga rol legacy interno. Migrar read a `has_permission('tesoreria.view')` es opción futura.
- **R12 (P3) — `is_system` solo protege DELETE.** Admin podría `UPDATE` CAJA (desactivarla / cambiar `account_type`). Extensible al trigger de bank_accounts.

### Residuales ya conocidos, diferidos a `0054` (no son de `0053`)
- Retención 100% → `net=0` → la RPC debe omitir el movimiento (`amount>0`).
- Deadlock en cobro/pago multi-factura → la RPC lockea facturas en orden determinístico.
- Storage (`R8`): el bloque de policies se modela sobre `0015` (nunca aplicada); si `create policy on storage.objects` falla por privilegios, aplicar storage por separado.

---

## 6. Clasificación

### 🔴 P0
**Ninguno.**

### 🟠 P1
**Ninguno nuevo.** H1–H6 cerrados.

### 🟡 P2
- **R11** — ✅ **RESUELTO en `0053`** (`tg_lock_bank_account_basis`): `opening_balance/currency/account_type` inmutables con movimientos.
- **R1** — guard via_rpc es defensa-en-profundidad, no frontera (service-role confiable).
- **R2** — fuga de GUC por pooler ⇒ requisito vinculante en `0054` (`is_local=true`).
- **R5** — sin backstop de esquema para suma de allocations (enforcement RPC-only).
- **R8** — storage modelado sobre migración nunca aplicada (riesgo de aplicación).

### ⚪ P3
- **R3** `pendiente` no protegido (no usado en A).
- **R4** superusuario salta triggers (inherente).
- **R10** RLS read podría ser más estricta que RBAC (falla cerrado).
- **R12** `is_system` solo protege DELETE, no UPDATE.
- `created_by` no forzado a `auth.uid()` (la RPC lo setea).

---

## 7. Riesgos remanentes

- **Integridad del saldo derivado:** sólida para movimientos (append-only hard) **y para la base** — R11 cerrado: `opening_balance` queda inmutable una vez que hay movimientos (`tg_lock_bank_account_basis`). No quedan puntos donde D1 pueda re-basarse sin auditoría.
- **Frontera de confianza:** el guard `via_rpc` y la RLS asumen que el service-role y el owner de la DB son confiables. Toda escritura debe canalizarse por las RPC de `0054`. El append-only (triggers) **sí** resiste al service-role; el guard via_rpc no.
- **Dependencias hacia `0054`:** F1 (lock por factura, orden determinístico), F4 (vistas `confirmado`), `via_rpc` con `is_local=true`, manejo `net=0`, `created_by=auth.uid()`, `has_permission` fino.
- **Aplicación:** `0052` (aislada, committeada) antes de `0053`; validar el bloque storage por privilegios.

---

## 8. Veredicto final

> ## 🟢 GO
>
> La reescritura **cierra de origen H1–H6**, respeta D1–D5 sin regresión, cierra F3/F5/F6, resiste un segundo intento adversarial (incluido service-role), y el único residual P2 accionable-ahora (**R11**) quedó **cerrado en `0053`** con `tg_lock_bank_account_basis`. No hay P0 ni P1.
>
> **`0053` queda apta para aplicar.** Condiciones forward (no son de `0053`, no reabren el diseño congelado):
> 1. **R2** — `0054` debe usar `set_config('treasury.via_rpc','on',true)` (scope transacción) — requisito vinculante.
> 2. **R8** — verificar privilegios del bloque storage al aplicar; si falla, aplicar storage por separado.
> 3. Resolver en `0054`: F1 (lock + orden determinístico), F4 (vistas `confirmado`), `net=0`, `created_by=auth.uid()`.
>
> **Orden de aplicación (cuando autorices):** `0052` (aislada, committeada) → `0053`.

---

*Fin — Auditoría de la Reescritura ERP-A1. Veredicto: GO CON CONDICIONES. No se aplicó, ejecutó ni commiteó; `0052` intacto; `0054` no escrito.*
