# ERP-A4 · ARQUITECTURA DE UI — Capa Visual de Tesorería

**Proyecto:** TOPS Nexus — Logística TOPS (Verotin S.A.)
**Presidente:** Martín Battaglia
**Documento:** `ERP_A4_UI_ARCHITECTURE.md`
**Base:** ERP-A1 (modelo) + ERP-A2 (RPCs/vistas) + ERP-A3 (`src/lib/tesoreria/`) — verificados en producción (`arsksytgdnzukbmfgkju`).
**Naturaleza:** diseño funcional. **No se escribe UI/páginas/componentes.**

> **Reglas:** **D1** (saldo solo de `treasury_bank_balances`, nunca calculado en frontend) · **D5** (cuenta corriente solo de `customer/supplier_current_account`, nunca en React) · **RPC-First** (formularios consumen `actions.ts`, nunca SQL/RPC directo) · **UX** = Design System Nexus existente, **sin** rediseñar ni inventar componentes.

---

## 0. Convenciones de la casa a reutilizar (no inventar)

| Pieza | Reutilizar |
|---|---|
| Layout de página | `<div className="p-4 lg:p-8 nx-page-fade">` + `page-header` / `eyebrow-tiny` / `page-title` / `page-subtitle` |
| KPI / número | `text-eyebrow-sm uppercase text-fg-muted` + `text-3xl font-bold text-fg-brand tabular` + `<CountUp>` |
| Botón acción | `btn btn-primary btn-sm` + `<Icon name="plus" />` |
| Estado | `<StatusBadge>` (mapeo estado→color) |
| Degradación | `<ModuleUnavailable migration=... />` si falla la data |
| Mini-gráfico | `<Sparkline>` / `charts/*` |
| Acceso restringido | `<RestrictedAccess>` |
| Formato | `fmtCurrency`, `fmtDate` (`@/lib/utils`) |
| Página server | `export const dynamic = "force-dynamic"` + server component que llama `data.ts` |
| Formulario | client component estilo `NuevaFacturaForm.tsx` (inputs/clases existentes) que llama un Server Action |

> **Regla de agregación (D1/D5):** cualquier total/KPI se computa en el **server component** (o capa de datos) haciendo roll-up sobre las **filas de las vistas** — **nunca en React cliente** y **nunca sobre movimientos**. El saldo por banco/factura ya viene derivado de la vista.

---

## 1. Mapa completo de pantallas

| Ruta | Pantalla | Tipo | Data (A3) |
|---|---|---|---|
| `/tesoreria` | **Overview Tesorería** | server | `getBankBalances`, `getCustomerCurrentAccount`, `getSupplierCurrentAccount`, `getCashflowProjection` |
| `/tesoreria/bancos` | **Bancos** | server | `getBankBalances` (+ acción transferencia) |
| `/tesoreria/movimientos` | **Movimientos** | server | `listMovements` (+ acción anular) |
| `/tesoreria/cobranzas` | **Cobranzas** | server | `listCustomerOpenItems`, `getCustomerCurrentAccount` (+ acción cobranza) |
| `/tesoreria/pagos` | **Pagos** | server | `listSupplierOpenItems`, `getSupplierCurrentAccount` (+ acción pago) |
| `/tesoreria/flujo-fondos` | **Flujo de Fondos** | server | `getCashflowProjection`, `getBankBalances` |

**Navegación (Sidebar):** grupo nuevo **"Tesorería · Finanzas"** (aditivo; sin tocar grupos existentes):
```
{ label: "Tesorería · Finanzas", items: [
  { href: "/tesoreria",              label: "Resumen",        icon: "wallet" },
  { href: "/tesoreria/bancos",       label: "Bancos",         icon: "bank"|"wallet" },
  { href: "/tesoreria/movimientos",  label: "Movimientos",    icon: "refresh" },
  { href: "/tesoreria/cobranzas",    label: "Cobranzas",      icon: "download" },
  { href: "/tesoreria/pagos",        label: "Pagos",          icon: "truck"|"cart" },
  { href: "/tesoreria/flujo-fondos", label: "Flujo de fondos",icon: "trend-up" },
]}
```
> Usar **íconos existentes** del set `Icon`. Sin íconos nuevos.

---

## 2. Componentes requeridos

**Reutilizados (sin crear):** `Icon`, `CountUp`, `StatusBadge`, `Sparkline`, `ModuleUnavailable`, `ModuleScaffold`, `RestrictedAccess`, `RealtimeRefresher`, `charts/*`, clases `btn`/`page-*`/`card`.

**Nuevos mínimos (solo lo que no existe; siguen el patrón de la casa):**
| Componente | Tipo | Por qué |
|---|---|---|
| `TreasuryKpis` | server (presentacional) | fila de KPIs con `CountUp` (composición de clases existentes) |
| `BankBalancesTable` | server | tabla de `treasury_bank_balances` |
| `MovementsTable` | server | tabla de `treasury_movements` + `StatusBadge` |
| `OpenItemsTable` | server | tabla reutilizable cliente/proveedor (open items) |
| `CobranzaForm` | **client** | formulario → `registerReceiptAction` |
| `PagoForm` | **client** | formulario → `registerPaymentAction` |
| `TransferenciaForm` | **client** | formulario → `registerTransferAction` |
| `AnularDialog` | **client** | confirma motivo → `voidMovementAction` |

> Los componentes "Table"/"Kpis" son **composiciones** de clases/elementos existentes (no nuevos primitivos de diseño). Los formularios siguen `NuevaFacturaForm.tsx` (inputs, validación de forma, estado de submit, toast/resultado).

---

## 3. Formularios requeridos

| Formulario | Action (A3) | Campos | Allocations |
|---|---|---|---|
| **Registrar cobranza** | `registerReceiptAction` | cliente, fecha, método (`transferencia/efectivo/cheque/echeq`), banco (efectivo⇒CAJA), bruto, retención, obs, adjunto | selección de facturas del cliente (`listCustomerOpenItems`) con monto por factura (N:M) |
| **Registrar pago** | `registerPaymentAction` | proveedor, fecha, método (`transferencia/cheque/echeq`), banco, importe, nº operación, obs, adjunto | facturas del proveedor (`listSupplierOpenItems`) con monto por factura |
| **Registrar transferencia** | `registerTransferAction` | fecha, banco origen, banco destino, importe, descripción | — |
| **Anular movimiento** | `voidMovementAction` | tipo (receipt/payment/transfer/movement), id, **motivo (obligatorio)** | — |

**UX de allocations:** el form muestra los **open items** (saldo pendiente por factura, derivado de la vista) y deja imputar montos; el cliente **no calcula saldos** (los toma de la vista) y **no valida la suma** (la RPC lo hace; el form solo previene envíos obvios). Respuesta de la action (`ActionResult`) → toast de éxito o `humanizeRpcError`.

---

## 4. Tablas requeridas

| Tabla | Vista/accessor | Columnas | Estado |
|---|---|---|---|
| **Movimientos** | `listMovements` | fecha, `public_id`, tipo, banco, dirección, importe (`fmtCurrency`), estado | `StatusBadge` (confirmado/anulado/pendiente) |
| **Cuenta corriente clientes** | `getCustomerCurrentAccount` | cliente, facturas abiertas, facturado, cobrado, **saldo (de la vista)**, próx. vencimiento | — |
| **Cuenta corriente proveedores** | `getSupplierCurrentAccount` | proveedor, facturas abiertas, facturado, pagado, **saldo (de la vista)** | — |
| **Open items cliente** | `listCustomerOpenItems` | factura, total, pagado, **saldo**, estado_cobro, vto | badge estado_cobro |
| **Open items proveedor** | `listSupplierOpenItems` | factura, total, pagado, **saldo**, estado_pago, vto | badge estado_pago |
| **Saldos bancarios** | `getBankBalances` | banco, cuenta, tipo, **balance (de la vista)** | CAJA marcada (`is_system`) |

> **Todos los saldos provienen de las vistas** (D1/D5). Ninguna tabla suma movimientos en React.

---

## 5. KPIs requeridos

| KPI | Fuente | Cómputo |
|---|---|---|
| **Saldo bancos (total)** | `getBankBalances` | roll-up **server-side** de `balance` (cada uno ya derivado de la vista) |
| **Cobranzas pendientes** | `getCustomerCurrentAccount` | roll-up server de `saldo_cuenta` |
| **Pagos pendientes** | `getSupplierCurrentAccount` | roll-up server de `saldo_cuenta` |
| **Flujo proyectado** | `getCashflowProjection` | último `flujo_acumulado` / saldo proyectado |

> Los KPIs se calculan en el **server component** (Next server) sobre filas de vistas — **no en React cliente**, **no desde movimientos**. Render con `<CountUp>` + `fmtCurrency`. *(Decisión D1/D5, ver R-A4-1.)*

---

## 6. Integración backend

- **Pantallas (lectura):** server components llaman **`src/lib/tesoreria/data.ts`** (accessors sobre las vistas). Degradan con `<ModuleUnavailable migration="0053_treasury_core" />` si fallara.
- **Formularios (escritura):** client components llaman **exclusivamente** las Server Actions de **`src/lib/tesoreria/actions.ts`** (`registerReceiptAction`, etc.). **Nunca** `supabase.from/.rpc` desde el cliente; **nunca** SQL. RPC-First de punta a punta.
- **Resultado:** `ActionResult` → toast/inline; en error, `message` ya viene humanizado.
- **Refresco:** las actions hacen `revalidatePath('/tesoreria')`; las páginas son `force-dynamic`.

---

## 7. Permisos

| Capacidad | Gate |
|---|---|
| Ver Tesorería | RLS (las vistas/tablas solo devuelven datos a roles internos `admin/operaciones/supervisor`); página envuelve con `<RestrictedAccess>` si el rol no es interno |
| Registrar cobranza/pago/transferencia | botón visible solo si `has_permission('tesoreria.create')`; la RPC reimpone (`FORBIDDEN`) |
| Anular | botón solo si `has_permission('tesoreria.edit')`; RPC reimpone |
| Administrar cuentas bancarias | `tesoreria.admin` (alta/edición de bancos — fuera del alcance operativo de A4) |

> El frontend **oculta** botones por permiso (UX); la **autorización real** la imponen RLS + `has_permission` en la RPC (no se confía en el cliente).

---

## 8. Riesgos

### 🔴 P0
**Ninguno.** El backend (A3) y la DB (A1/A2) están listos y verificados; A4 es composición visual sobre patrones existentes.

### 🟠 P1
- **R-A4-1 — Agregados de KPI.** Los totales (saldo bancos, cobranzas/pagos pendientes) deben computarse **server-side** sobre filas de vistas, **nunca en React** ni desde movimientos (D1/D5). *Directiva:* el roll-up vive en el server component / un accessor `getTreasuryKpis()` en `data.ts`; la PR debe rechazar sumas en componentes cliente.
- **R-A4-2 — Formularios solo vía actions.** Ningún form puede llamar `supabase`/SQL/RPC directo (RPC-First). Revisión de PR obligatoria.

### 🟡 P2
- **R-A4-3 — Dependencia `AUTORIZADO_ARCA`:** el form de cobranza solo lista facturas autorizadas; con ARCA en mock puede haber pocas/ninguna. UX debe manejar "sin facturas imputables".
- **R-A4-4 — `revalidatePath('/tesoreria')`** ya cableado en A3; las rutas se crean en A4 (deja de ser no-op).
- **R-A4-5 — Anulación desde UI:** el flujo de void debe partir del recibo/pago (no del movimiento de cobranza/pago directo), coherente con `0054`.
- **R-A4-6 — Sin tipos generados de DB** (cast en A3): cambios de vista no se detectan en compile-time.

### ⚪ P3
- i18n; estados vacíos/skeletons; orden/paginado de movimientos; `Sparkline` opcional en Flujo de Fondos.

---

## 9. Veredicto

> # 🟢 READY FOR ERP-A4 IMPLEMENTATION
>
> El diseño funcional de la capa visual está **completo y anclado en lo ya existente**:
> - **6 pantallas** (`/tesoreria` + 5 submódulos), **4 formularios** (cobranza/pago/transferencia/anular), **6 tablas**, **4 KPIs** — todos mapeados a accessors/actions de **ERP-A3** y a las vistas de **ERP-A2** verificadas en producción `arsksytgdnzukbmfgkju`.
> - **D1** (saldo bancos solo de `treasury_bank_balances`) y **D5** (cuenta corriente solo de `customer/supplier_current_account`) **preservados**: ningún saldo se calcula en React; los agregados son roll-up server-side sobre vistas.
> - **RPC-First**: los formularios consumen **solo** `actions.ts`; nunca SQL/RPC directo.
> - **UX**: reutiliza el Design System Nexus (clases `page-*`/`btn`/`StatusBadge`/`CountUp`/`ModuleUnavailable`/`Icon`); los únicos componentes nuevos son tablas/formularios que **componen** primitivos existentes — sin rediseñar ni inventar.
>
> **Sin P0.** Los P1 son **directivas de implementación** (KPIs server-side; forms solo vía actions), no bloqueantes de diseño.
>
> Pendiente: **autorización explícita** para escribir la UI (`src/app/(app)/tesoreria/*` + componentes). Este documento es solo diseño.

---

*Fin — Arquitectura de UI ERP-A4. Veredicto: READY FOR ERP-A4 IMPLEMENTATION. No se escribió UI ni componentes.*
