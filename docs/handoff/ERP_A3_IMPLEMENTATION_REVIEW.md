# ERP-A3 · REVISIÓN DE IMPLEMENTACIÓN — Backend Tesorería

**Proyecto:** TOPS Nexus — Logística TOPS (Verotin S.A.)
**Presidente:** Martín Battaglia
**Documento:** `ERP_A3_IMPLEMENTATION_REVIEW.md`
**Base:** `0053`/`0054` desplegados y verificados en producción (`arsksytgdnzukbmfgkju`).
**Naturaleza:** implementación del backend + revisión. **No se escribió UI/páginas/componentes.**

> **Reglas:** RPC-First (cero lógica financiera en TS) · D1 (saldo derivado) · D5 (cuenta corriente derivada) · zod solo forma · `humanizeRpcError`.
> **Verificación:** `npm run typecheck` **EXIT 0** · `npm run lint` **EXIT 0** (sin observaciones en `tesoreria`).

---

## 1. Archivos creados

`src/lib/tesoreria/` (rama `feature/erp-a-tesoreria`, **untracked** — listos para commit):

| Archivo | Bytes | Rol |
|---|---|---|
| `types.ts` | 3.9K | enums espejo + DTOs de vistas + `ActionResult` |
| `validation.ts` | 2.6K | esquemas zod (solo forma) |
| `data.ts` | 4.5K | 9 accessors READ-ONLY sobre vistas/tablas |
| `errors.ts` | 2.2K | `humanizeRpcError` (códigos `0054` → texto) |
| `actions.ts` | 4.6K | `"use server"` — 4 Server Actions (adaptadores) |

Solo `src/lib/tesoreria/`. **No** se crearon páginas/layouts/componentes/hooks (eso es ERP-A4).

---

## 2. Tipos creados (`types.ts`)

- **Enums** (espejo de `0053`): `RECEIPT_METHOD_VALUES`, `PAYMENT_METHOD_VALUES`, `MOVEMENT_TYPE_VALUES`, `DIRECTION_VALUES`, `MOVEMENT_STATUS_VALUES`, `VOID_TARGET_VALUES` + sus tipos.
- **DTOs de vistas:** `BankAccount`, `BankBalance`, `TreasuryMovement`, `CustomerOpenItem`, `SupplierOpenItem`, `CustomerCurrentAccount`, `SupplierCurrentAccount`, `CashflowRow`.
- **Resultado:** `ActionResult<T> = { ok:true; message; data? } | { ok:false; message }`.

---

## 3. Accessors implementados (`data.ts`) — 9, READ-ONLY

| Accessor | Fuente | D1/D5 |
|---|---|---|
| `listBankAccounts()` | `bank_accounts` | — |
| `getBankBalances()` | **`treasury_bank_balances`** | **D1** (saldo derivado de la vista) |
| `listMovements(opts)` | `treasury_movements` (filtros banco/estado, paginado) | — |
| `listCustomerOpenItems(clientId?)` | `customer_open_items` | derivado |
| `listSupplierOpenItems(vendorId?)` | `supplier_open_items` | derivado |
| `getCustomerCurrentAccount()` | **`customer_current_account`** | **D5** |
| `getSupplierCurrentAccount()` | **`supplier_current_account`** | **D5** |
| `getCashflowProjection()` | `treasury_cashflow_projection` | derivado |

Cliente de sesión (`createClient()` → RLS aplica). Resiliente (`if (!supabase) return []`). **Ninguna suma/saldo en TS** (verificado §6).

---

## 4. Server Actions implementadas (`actions.ts`) — 4 adaptadores

| Action | RPC `0054` | Patrón |
|---|---|---|
| `registerReceiptAction(input)` | `tesoreria_register_receipt` | zod → `.rpc()` → `humanizeRpcError` → `revalidatePath` |
| `registerPaymentAction(input)` | `tesoreria_register_payment` | ídem |
| `registerTransferAction(input)` | `tesoreria_register_transfer` | ídem |
| `voidMovementAction(input)` | `tesoreria_void_movement` | ídem |

Las 4 son **idénticas en forma**: `safeParse` → cliente de sesión → `supabase.rpc("tesoreria_…", { p_… })` → mapeo de error → revalidación. **Cero `.insert/.update/.from`** (verificado §6). Montos top-level enviados como `Number(...)` (JSON serializa el decimal exacto); montos de allocations como **string** dentro del jsonb (exactos, casteados en la RPC).

---

## 5. Validaciones implementadas (`validation.ts`)

`RegisterReceiptSchema`, `RegisterPaymentSchema`, `RegisterTransferSchema`, `VoidMovementSchema` — zod valida **forma/tipos/formato**: `UUID`, `DATE (YYYY-MM-DD)`, `MONEY (string, ≤2 decimales)`, `z.enum` de métodos/targets, `allocations` como array `.min(1)`.
**No valida** (queda en RPC, sin duplicar): `Σ allocations = importe`, saldo de factura, vigencia/pertenencia de factura, moneda, CAJA, transición de void.

---

## 6. Auditoría de cumplimiento

| Regla | Verificación | Resultado |
|---|---|:--:|
| **D1** saldo derivado | `grep reduce/+=/saldo-calc` en `data.ts` | **0** (ningún cálculo de saldo en TS) ✅ |
| **D1** saldo de vista | `data.ts` lee `treasury_bank_balances` | sí (×2 refs) ✅ |
| **D5** cuenta corriente derivada | `data.ts` lee `customer/supplier_current_account` | sí (×3 refs); **0** persistencia ✅ |
| **RPC-First** | `actions.ts`: `.rpc(` = **4**; `.insert/.update/.from` = **0** | ✅ (solo adaptadores) |
| **zod solo forma** | `validation.ts` valida shape; sin reglas financieras | ✅ |
| **humanizeRpcError** | export presente; mapea códigos de `0054` | ✅ |
| **typecheck / lint** | EXIT 0 / EXIT 0 | ✅ |

**Confirmado:** D1 ✅ · D5 ✅ · RPC-First ✅. Toda regla financiera permanece en `0054`; el backend TS es un adaptador delgado.

---

## 7. Riesgos

### 🔴 P0
**Ninguno.** Compila, lintea, no duplica lógica, respeta D1/D5/RPC-First.

### 🟠 P1
- **R-A3I-1 — Higiene de rama (recurrente).** El working dir volvió a quedar en `main` entre sesiones; verifiqué y cambié a `feature/erp-a-tesoreria` antes de crear. **Regla:** confirmar `git branch` antes de tocar archivos ERP-A. Los 5 archivos quedaron **untracked** (sin commitear); recomendado commitear en la feature branch.
- **R-A3I-2 — No introducir lógica financiera en futuros cambios.** Cualquier suma/validación de saldo en `actions.ts`/`data.ts` rompería RPC-First/D1/D5. La PR debe rechazarlo (auditoría §6 reproducible por grep).

### 🟡 P2
- **R-A3I-3 — Sin tipos generados de DB:** los accessors castean `as DTO[]`; si una vista cambiara, el cast no lo detecta en compile-time. *Mitigación futura:* generar tipos de Supabase.
- **R-A3I-4 — `revalidatePath('/tesoreria')`** apunta a ruta inexistente (UI = A4); hoy no-op inofensivo.
- **R-A3I-5 — Demo/needsSupabase:** los accessors devuelven `[]` y las actions `{ok:false,'no disponible'}` si no hay cliente; OK como degradación.
- **R-A3I-6 — Dependencia `AUTORIZADO_ARCA`** para cobranzas imputables (heredada de `0054`).

### ⚪ P3
- i18n de mensajes; helper `canCreateTreasury()` para UX (ocultar botones); tipado fino de filtros de `listMovements`.

---

## 8. Veredicto

> # 🟢 READY FOR ERP-A4
>
> El backend de Tesorería (`src/lib/tesoreria/`: `types.ts`, `validation.ts`, `data.ts`, `errors.ts`, `actions.ts`) está **implementado, compila (typecheck EXIT 0) y lintea (EXIT 0)**, siguiendo las convenciones de la casa (`erp/`, `comercial/`).
> - **RPC-First** verificado: 4 acciones = adaptadores (`.rpc` ×4, `.insert/.update/.from` ×0); cero lógica financiera en TS.
> - **D1** (saldo derivado de `treasury_bank_balances`) y **D5** (cuenta corriente de `customer/supplier_current_account`) **preservados**: ninguna suma/saldo se calcula ni persiste en TS.
> - **zod** valida solo forma; `humanizeRpcError` traduce los códigos de `0054`.
> - Se apoya en ERP-A1 (modelo) + ERP-A2 (RPCs/vistas) **verificados en producción `arsksytgdnzukbmfgkju`**.
>
> **Sin P0.** Los P1 son operativos (higiene de rama; no meter lógica financiera a futuro), no de la implementación actual.
>
> **ERP-A3 (backend) queda CERRADO.** No se escribió UI/páginas/componentes. Habilitado (autorización aparte): **ERP-A4** (capa visual). **Follow-up:** commitear los 5 archivos en `feature/erp-a-tesoreria` + eventual push/merge.

---

## Anexo — Evidencia

| Check | Resultado |
|---|---|
| Archivos | 5 en `src/lib/tesoreria/` |
| typecheck / lint | EXIT 0 / EXIT 0 |
| `.rpc(` en actions / `.insert/.update/.from` | 4 / 0 |
| cálculo de saldo en data.ts | 0 |
| lecturas `treasury_bank_balances` / `*_current_account` | 2 / 3 |
| `humanizeRpcError` export | 1 |
| Rama | `feature/erp-a-tesoreria` (HEAD `70de44b`); archivos untracked |
| main intacto | `1630f70` (= origin/main) |

---

*Fin — Revisión de Implementación ERP-A3. Veredicto: READY FOR ERP-A4. Backend creado y verificado; sin UI; ERP-A3 cerrado.*
