# ERP-A3 · ARQUITECTURA DE BACKEND — Tesorería (Data Layer + Server Actions)

**Proyecto:** TOPS Nexus — Logística TOPS (Verotin S.A.)
**Presidente:** Martín Battaglia
**Documento:** `ERP_A3_BACKEND_ARCHITECTURE.md`
**Base:** `0053` (modelo) + `0054` (RPCs+vistas) **desplegados y verificados en producción** (`arsksytgdnzukbmfgkju`).
**Naturaleza:** diseño técnico. **No se escribe código ni UI.**

> **Principios congelados:** **RPC-First** (las Server Actions son adaptadores: validación + autorización + llamada RPC + manejo de errores; **cero lógica financiera en TS**). **D1** (saldo derivado — nunca calcular saldo en TS). **D5** (cuenta corriente derivada — nunca persistir saldo de cliente/proveedor). **No duplicar lógica:** toda regla financiera vive en DB (`0054`).

---

## 1. Estructura de carpetas

Espejo de `src/lib/erp/` y `src/lib/comercial/` (convenciones de la casa):

```
src/lib/tesoreria/
├── types.ts        # enums (espejo de treasury_*) + DTOs de vistas + ActionResult
├── validation.ts   # esquemas zod (SOLO forma/shape; las reglas financieras son del RPC)
├── data.ts         # accessors READ-ONLY sobre las 6 vistas + movimientos + bancos
├── errors.ts       # humanizeRpcError(): códigos de 0054 → mensajes legibles
└── actions.ts      # "use server" — 4 Server Actions (adaptadores RPC-First)
```
> Sin sub-archivos de "lógica": no hay lógica de negocio que ubicar (vive en `0054`). UI (`(app)/tesoreria/*`) queda **fuera de A3** (fase posterior).

---

## 2. Tipos (`types.ts`)

**Enums (espejo de `0054`/`0053`)** — como arrays `*_VALUES` + tipos:
```ts
export const RECEIPT_METHOD_VALUES = ["transferencia","efectivo","cheque","echeq"] as const;
export const PAYMENT_METHOD_VALUES = ["transferencia","cheque","echeq"] as const;
export const VOID_TARGET_VALUES    = ["receipt","payment","transfer","movement"] as const;
export type ReceiptMethod = (typeof RECEIPT_METHOD_VALUES)[number];
// ... MovementType, Direction, TreasuryStatus, DocStatus
```

**DTOs de vistas (read-only, lo que devuelve cada vista):**
```ts
export interface BankBalance { bank_account_id; bank_name; account_name; account_type; currency; is_system; opening_balance: number; balance: number }
export interface CustomerOpenItem { invoice_id; client_id; numero_comprobante; total; pagado; saldo; estado_cobro; fch_vto_pago }
export interface SupplierOpenItem { invoice_id; vendor_id; public_id; total; pagado; saldo; estado_pago; fecha_vencimiento }
export interface CustomerCurrentAccount { client_id; facturas_abiertas; total_facturado; total_cobrado; saldo_cuenta; proxima_vencimiento }
export interface SupplierCurrentAccount { vendor_id; facturas_abiertas; total_facturado; total_pagado; saldo_cuenta; proxima_vencimiento }
export interface CashflowRow { fecha; tipo: "cobro"|"pago"; monto; flujo_acumulado }
export interface TreasuryMovement { id; public_id; date; type; direction; bank_account_id; amount; status; reference_type; reference_id; ... }
```

**Resultado de acciones (patrón de la casa):**
```ts
export type ActionResult<T = unknown> = { ok: true; message: string; data?: T } | { ok: false; message: string };
```
> Los montos se modelan como `number` en DTOs (lectura), pero en **entrada** se manejan como **string decimal** para evitar imprecisión float (ver §5 / R-A3-2).

---

## 3. Data layer (`data.ts`) — READ-ONLY, derivado

Patrón `erp/data.ts`: `createClient()` de sesión (RLS aplica → solo roles internos ven datos), `isMock()` para demo, degradación si `0053/0054` no estuvieran (no aplica en prod, ya están). **Ninguna de estas funciones calcula saldos** — leen las **vistas** (D1/D5):

| Accessor | Fuente (vista/tabla) | Regla |
|---|---|---|
| `listBankAccounts()` | `bank_accounts` | catálogo |
| `getBankBalances()` | **`treasury_bank_balances`** | **D1: saldo derivado, leído de la vista** |
| `listMovements(filtros)` | `treasury_movements` (+ join banco) | paginado; filtros por banco/tipo/estado/fecha |
| `listCustomerOpenItems(clientId?)` | **`customer_open_items`** | saldo por factura, derivado |
| `listSupplierOpenItems(vendorId?)` | **`supplier_open_items`** | derivado |
| `getCustomerCurrentAccount()` | **`customer_current_account`** | **D5: cuenta corriente derivada** |
| `getSupplierCurrentAccount()` | **`supplier_current_account`** | **D5** |
| `getCashflowProjection()` | **`treasury_cashflow_projection`** | proyección derivada |
| `getReceipt(id)` / `getPayment(id)` | `customer_receipts`/`supplier_payments` (+ allocations) | detalle |

```ts
export async function getBankBalances(): Promise<BankBalance[]> {
  const supabase = createClient();
  if (!supabase) return [];                       // resiliente (patrón casa)
  const { data, error } = await supabase.from("treasury_bank_balances").select("*").order("bank_name");
  if (error) throw error;                          // página degrada con <ModuleUnavailable/>
  return data as BankBalance[];
}
```
> **Prohibido en `data.ts`:** sumar movimientos en TS, derivar saldo, persistir cuenta corriente. Todo sale de las vistas.

---

## 4. Server Actions (`actions.ts`) — adaptadores RPC-First

`"use server"`, `createClient()` de sesión (la RPC corre con `auth.uid()` del usuario; RLS + `has_permission` gobiernan autz). **Solo:** validar (zod) → llamar RPC → mapear error → `revalidatePath`. **Sin reglas financieras.**

```ts
"use server";
import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { RegisterReceiptSchema, ... } from "./validation";
import { humanizeRpcError } from "./errors";
import type { ActionResult } from "./types";

export async function registerReceiptAction(input: unknown): Promise<ActionResult> {
  const parsed = RegisterReceiptSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  const supabase = createClient();
  if (!supabase) return { ok: false, message: "Servicio no disponible" };
  const p = parsed.data;
  const { data, error } = await supabase.rpc("tesoreria_register_receipt", {
    p_client_id: p.client_id, p_payment_date: p.payment_date, p_payment_method: p.payment_method,
    p_bank_account_id: p.bank_account_id, p_gross_amount: p.gross_amount, p_retention_amount: p.retention_amount,
    p_observations: p.observations ?? null, p_attachment: p.attachment ?? null, p_allocations: p.allocations,
  });
  if (error) return { ok: false, message: humanizeRpcError(error.message) };
  revalidatePath("/tesoreria");                    // ruta futura (A3-UI); no-op hoy
  return { ok: true, message: "Cobranza registrada", data };
}
```

| Action | RPC (0054) | Permiso (en RPC) |
|---|---|---|
| `registerReceiptAction` | `tesoreria_register_receipt` | `tesoreria.create` |
| `registerPaymentAction` | `tesoreria_register_payment` | `tesoreria.create` |
| `registerTransferAction` | `tesoreria_register_transfer` | `tesoreria.create` |
| `voidMovementAction` | `tesoreria_void_movement` | `tesoreria.edit` |

> Las 4 acciones son **idénticas en forma**: parse zod → `.rpc()` → `humanizeRpcError` → `revalidatePath`. **No hay un solo cálculo financiero en TS.**

**`errors.ts` — mapeo de códigos de `0054`:**
```ts
export function humanizeRpcError(m = ""): string {
  if (m.includes("FORBIDDEN")) return "No tenés permiso para esta operación.";
  if (m.includes("ALLOCATION_SUM_MISMATCH")) return "La suma de las imputaciones no coincide con el importe.";
  if (m.includes("OVERALLOCATION")) return "Una factura quedaría sobre-imputada (excede su saldo).";
  if (m.includes("INVOICE_NOT_PAYABLE")) return "La factura no está autorizada o está anulada.";
  if (m.includes("INVOICE_WRONG_CLIENT") || m.includes("INVOICE_WRONG_VENDOR")) return "La factura no pertenece al cliente/proveedor.";
  if (m.includes("CASH_REQUIRES_CAJA")) return "El efectivo debe imputarse a la cuenta CAJA.";
  if (m.includes("CURRENCY_UNSUPPORTED")) return "Solo se opera en ARS.";
  if (m.includes("SAME_ACCOUNT")) return "La transferencia requiere cuentas distintas.";
  if (m.includes("NOT_FOUND_OR_ALREADY_VOID")) return "El comprobante no existe o ya está anulado.";
  if (m.includes("VOID_REQUIRES_REASON")) return "La anulación requiere un motivo.";
  // ... INVALID_AMOUNT/RETENTION, BANK_INVALID/INACTIVE, INVALID_TARGET_TYPE
  return "No se pudo completar la operación.";
}
```

---

## 5. Validaciones (`validation.ts`) — SOLO forma (zod)

zod valida **shape/tipos**, no reglas financieras (esas son del RPC — no duplicar):
```ts
const AllocationSchema = z.object({ invoice_id: z.string().uuid(), amount: z.string().regex(/^\d+(\.\d{1,2})?$/) });
export const RegisterReceiptSchema = z.object({
  client_id: z.string().uuid(),
  payment_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  payment_method: z.enum(RECEIPT_METHOD_VALUES as [string,...string[]]),
  bank_account_id: z.string().uuid(),
  gross_amount: z.string().regex(/^\d+(\.\d{1,2})?$/),         // string decimal (R-A3-2)
  retention_amount: z.string().regex(/^\d+(\.\d{1,2})?$/).default("0"),
  observations: z.string().max(500).optional().nullable(),
  attachment: z.string().max(500).optional().nullable(),
  allocations: z.array(AllocationSchema).min(1),
});
// análogos: RegisterPaymentSchema, RegisterTransferSchema, VoidMovementSchema
```
**Qué NO valida zod (queda en el RPC):** `Σ allocations = monto`, saldo de factura, factura vigente, pertenencia cliente/proveedor, moneda, banco activo, CAJA para efectivo, transición de void. **Evita drift** entre TS y DB.

---

## 6. Permisos

**Doble candado, ya existente — la acción NO reimplementa autz:**
1. **RLS** (cliente de sesión): las tablas treasury sólo se leen/escriben por roles internos (`current_role() in admin/operaciones/supervisor`); escritura directa restringida.
2. **`has_permission()` dentro del RPC** (`0054`): `tesoreria.create` (altas) / `tesoreria.edit` (void). Si falta → `FORBIDDEN` → `humanizeRpcError`.

Matriz efectiva (de `0053`, verificada en prod): `admin`/`director_ops` = todo; `operaciones` = solo lectura (sus acciones de alta fallan `FORBIDDEN`); `compliance` = lectura + export.
> Opcional UX (no autz): un helper `canCreateTreasury()` que consulte `has_permission` para **ocultar botones**; la autorización real la impone el RPC.

---

## 7. Riesgos

### 🔴 P0
**Ninguno.** RPCs/vistas desplegadas y verificadas; el backend es un adaptador delgado.

### 🟠 P1
- **R-A3-1 — Tentación de lógica financiera en TS.** Cualquier cálculo de saldo/validación de suma en las actions viola RPC-First y crea drift. *Regla:* las actions solo parsean+llaman+mapean; revisión de PR debe rechazar lógica financiera en `src/lib/tesoreria/actions.ts`.
- **R-A3-2 — Precisión de dinero (float JS).** Pasar montos como `number` arriesga imprecisión (0.1+0.2). *Mitigación (diseño):* montos de **entrada como string decimal** (`/^\d+(\.\d{1,2})?$/`); el RPC castea a `numeric`. DTOs de lectura pueden ser `number` (ya redondeados a 2 por la DB).

### 🟡 P2
- **R-A3-3 — Demo/needsSupabase:** las actions no pueden ejecutar RPCs en demo. *Mitigación:* `isMock()` ⇒ devolver `{ok:false,'no disponible en demo'}` o deshabilitar.
- **R-A3-4 — `revalidatePath('/tesoreria')`** apunta a rutas que aún no existen (UI = fase posterior); hoy es no-op inofensivo.
- **R-A3-5 — Dependencia `AUTORIZADO_ARCA`:** `registerReceipt` solo imputa a facturas autorizadas (mock ARCA puede limitar datos).
- **R-A3-6 — RLS de vistas** hereda la de `customer_invoices`/`supplier_invoices` (existencia de facturas); el dato de pago sí gated.

### ⚪ P3
- i18n de mensajes; helper `canCreateTreasury()` para UX; tipado fino de filtros de `listMovements`.

---

## 8. Veredicto

> # 🟢 READY FOR ERP-A3 IMPLEMENTATION
>
> El diseño de backend es **completo y RPC-First**: `src/lib/tesoreria/` con `types.ts` + `validation.ts` (zod de forma) + `data.ts` (lectura **derivada** de las 6 vistas — **D1/D5 intactos**, cero cálculo de saldo en TS) + `errors.ts` + `actions.ts` (4 adaptadores que solo validan/autorizan/llaman RPC/mapean errores).
>
> **Se apoya en infraestructura ya desplegada y verificada en producción** (ERP-A1 modelo + ERP-A2 RPCs/vistas): no duplica lógica; toda regla financiera permanece en DB (`0054`). Sigue las **convenciones reales de la casa** (`erp/`, `comercial/stage-actions.ts`).
>
> Sin P0; los P1 son **directivas de implementación** (no lógica financiera en TS; dinero como string decimal). **Solo backend** — UI/páginas/componentes quedan fuera de A3.
>
> Pendiente: **autorización explícita** para escribir el backend (`src/lib/tesoreria/`). Este documento es solo diseño.

---

*Fin — Arquitectura de Backend ERP-A3. Veredicto: READY FOR ERP-A3 IMPLEMENTATION. No se escribió código ni UI.*
