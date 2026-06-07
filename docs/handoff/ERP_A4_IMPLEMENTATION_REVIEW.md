# ERP-A4 · REVISIÓN DE IMPLEMENTACIÓN — Capa Visual de Tesorería

**Proyecto:** TOPS Nexus — Logística TOPS (Verotin S.A.)
**Presidente:** Martín Battaglia
**Documento:** `ERP_A4_IMPLEMENTATION_REVIEW.md`
**Base:** ERP-A1/A2 (DB) + ERP-A3 (backend `src/lib/tesoreria/`), verificados en producción (`arsksytgdnzukbmfgkju`).
**Naturaleza:** implementación de UI + revisión. **No se desplegó, mergeó ni pusheó.**

> **Reglas:** D1 (saldo de `treasury_bank_balances`) · D5 (cuenta corriente de `customer/supplier_current_account`) · RPC-First (forms → `actions.ts`) · Design System Nexus (reutilizar, no inventar).
> **Verificación:** `typecheck` **EXIT 0** · `lint` **EXIT 0** · `build` **EXIT 0** (las 6 rutas compilan).

---

## 1. Pantallas implementadas (6)

| Ruta | Build | Contenido | Data (A3) |
|---|---|---|---|
| `/tesoreria` | ƒ 601 B | Overview: 4 KPIs + mini bancos | `getBankBalances`, `getCustomer/SupplierCurrentAccount`, `getCashflowProjection` |
| `/tesoreria/bancos` | ƒ 1.58 kB | tabla saldos + KPI total + `TransferenciaForm` | `getBankBalances`, `listBankAccounts` |
| `/tesoreria/movimientos` | ƒ 577 B | libro de movimientos + estado | `listMovements` |
| `/tesoreria/cobranzas` | ƒ 2.77 kB | open items + KPI + `CobranzaForm` | `listCustomerOpenItems`, `getCustomerCurrentAccount`, `listBankAccounts` |
| `/tesoreria/pagos` | ƒ 2.73 kB | open items + KPI + `PagoForm` | `listSupplierOpenItems`, `getSupplierCurrentAccount`, `listBankAccounts` |
| `/tesoreria/flujo-fondos` | ƒ 577 B | proyección + KPIs | `getCashflowProjection`, `getBankBalances` |

Las 6 son server components `force-dynamic` con degradación `<ModuleUnavailable migration="0053_treasury_core" />`. **Navegación:** grupo nuevo **"Tesorería · Finanzas"** en `Sidebar.tsx` (aditivo, íconos existentes `wallet/building/refresh/download/cart/trend-up`).

---

## 2. Componentes implementados (5 + Sidebar)

| Componente | Tipo | Rol |
|---|---|---|
| `components/tesoreria/ui.tsx` | server | `Kpi` (usa `CountUp`) + `StatusPill` (clases `badge`/`dot`) |
| `components/tesoreria/TransferenciaForm.tsx` | **client** | → `registerTransferAction` |
| `components/tesoreria/CobranzaForm.tsx` | **client** | → `registerReceiptAction` (allocations N:M) |
| `components/tesoreria/PagoForm.tsx` | **client** | → `registerPaymentAction` (allocations N:M) |
| `components/tesoreria/AnularButton.tsx` | **client** | → `voidMovementAction` (motivo obligatorio) |
| `shell/Sidebar.tsx` | edit aditivo | grupo "Tesorería · Finanzas" |

**Reutiliza** (sin inventar): `CountUp`, `Icon`, `ModuleUnavailable`, clases `page-header`/`page-title`/`eyebrow-tiny`/`card`/`btn`/`badge`/`dot`/`input`/`field-label`/`text-fg-*`/`tabular`. Tablas/KPIs son **composiciones** de esos primitivos.

---

## 3. Integración backend validada

- **Lectura:** las páginas llaman **`src/lib/tesoreria/data.ts`** (accessors sobre vistas). Conteo de imports: `getBankBalances` ×6, `listBankAccounts` ×6, `getCustomer/SupplierCurrentAccount` ×4, `getCashflowProjection` ×4, `listCustomer/SupplierOpenItems` ×2, `listMovements` ×2.
- **Escritura:** los 4 formularios importan **exclusivamente** `@/lib/tesoreria/actions` (`registerReceiptAction`/`registerPaymentAction`/`registerTransferAction`/`voidMovementAction`).
- **0** llamadas `supabase` / `.rpc(` / `.from(` / `createClient` en `components/tesoreria/` ni en `(app)/tesoreria/` (los únicos matches de "from" son `Array.from`). **RPC-First end-to-end.**

---

## 4. Verificación D1 (saldo derivado)

- Saldos bancarios mostrados vienen de **`getBankBalances()` → `treasury_bank_balances`** (`b.balance`). Ninguna página suma movimientos para obtener saldo (grep: **0**).
- Los **totales/KPIs** (saldo bancos, saldo proyectado) son **roll-up server-side** (`reduce` en el server component) sobre `balance` —cada uno ya derivado por la vista— **nunca en React cliente**, **nunca desde movimientos**. ✅

---

## 5. Verificación D5 (cuenta corriente derivada)

- Cobranzas/pagos pendientes vienen de **`getCustomer/SupplierCurrentAccount()` → vistas `*_current_account`** (`c.saldo_cuenta`); los open items por factura de `customer/supplier_open_items` (`it.saldo`).
- Ningún saldo de cliente/proveedor se calcula ni persiste en frontend; los totales son roll-up server-side sobre filas de las vistas. ✅

---

## 6. Verificación RPC-First

- Los formularios **no contienen lógica financiera**: arman el payload (incluida la suma de los importes que el usuario imputa, que es un total de inputs, **no** un saldo) y llaman la Server Action. La RPC re-valida `Σ allocations = importe`, saldo, vigencia, etc.
- **Cero** acceso directo a SQL/Supabase/RPC desde el cliente; todo pasa por `actions.ts`. ✅

---

## 7. Typecheck

`npm run typecheck` → **EXIT 0** (sin errores).

## 8. Lint

`npm run lint` → **EXIT 0** (sin errores; warnings preexistentes ajenos a tesorería).
*(Adicional: `npm run build` → EXIT 0; las 6 rutas `/tesoreria*` aparecen como dinámicas en el árbol de rutas.)*

---

## 9. Riesgos

### 🔴 P0
**Ninguno.** Compila/lintea/buildea; RPC-First, D1/D5 cumplidos.

### 🟠 P1
- **R-A4I-1 — Higiene de rama (recurrente).** El working dir volvió a quedar en `main`; lo verifiqué y cambié a `feature/erp-a-tesoreria` antes de crear. Los 11 archivos quedan **untracked** (sin commitear); recomendado commitear.
- **R-A4I-2 — Verificación visual runtime pendiente.** typecheck/lint/build confirman compilación, pero el render visual con datos reales (login + RLS) corresponde a **ERP-A5 (E2E)**: las rutas `(app)/*` están detrás del muro de login y la app apunta a prod (`arsks`); no se levantó preview para no operar contra producción sin sesión.

### 🟡 P2
- **R-A4I-3 — Selectores por id.** Cobranza/Pago listan cliente/proveedor por `id` (las vistas open_items no traen razón social). UX: mostrar nombre requiere enriquecer con `clients/vendors` (P3/A5).
- **R-A4I-4 — Sin gating de botones por permiso.** Los botones de alta/anulación se muestran siempre; la **autorización real** la impone la RPC (`FORBIDDEN` → mensaje humanizado). Ocultar por `has_permission` es polish de UX (P3).
- **R-A4I-5 — Dependencia `AUTORIZADO_ARCA`:** la cobranza solo lista facturas autorizadas; con ARCA en mock puede no haber facturas imputables (estado vacío manejado).
- **R-A4I-6 — Estilos:** se usaron clases del Design System + utilidades Tailwind para layout de tablas/forms; sin inventar primitivos. Ajuste fino visual queda para QA.

### ⚪ P3
- Nombres de cliente/proveedor; paginado/filtros de movimientos; `Sparkline` en flujo; skeletons/estados vacíos; i18n.

---

## 10. Veredicto

> # 🟢 READY FOR ERP-A5
>
> La capa visual de Tesorería está **implementada y verificada estáticamente**:
> - **6 pantallas** (`/tesoreria` + 5 submódulos) + **5 componentes** + grupo de navegación, todas compilando (`typecheck`/`lint`/`build` EXIT 0; 6 rutas en el árbol).
> - **D1** (saldos de `treasury_bank_balances`) y **D5** (cuenta corriente de `*_current_account`) **cumplidos**: ningún saldo se calcula en React; los KPIs son roll-up server-side sobre vistas; cero suma de movimientos.
> - **RPC-First** verificado: los 4 formularios consumen **solo** `actions.ts`; cero SQL/Supabase en la UI.
> - **Design System Nexus** reutilizado (`CountUp`/`Icon`/`ModuleUnavailable`/clases `page-*`/`btn`/`badge`/`input`); sin sistema visual nuevo.
> - Se apoya en ERP-A1/A2/A3 verificados en producción `arsksytgdnzukbmfgkju`.
>
> **Sin P0.** Los P1 son operativos: higiene de rama (archivos untracked) y la **verificación visual runtime que pertenece a ERP-A5 (E2E)**.
>
> **ERP-A4 (UI) queda CERRADO.** No se desplegó/mergeó/pusheó, no se inició ERP-A5. **Follow-up:** commitear los 11 archivos + push/merge de la rama.

---

## Anexo — Evidencia

| Check | Resultado |
|---|---|
| Pantallas en build | 6 rutas `/tesoreria*` (ƒ dynamic) |
| Componentes | 5 (`ui`, 4 forms) + Sidebar group |
| typecheck / lint / build | EXIT 0 / 0 / 0 |
| `.rpc/.from/supabase` en UI | 0 (solo `Array.from`) |
| forms → `actions.ts` | 4/4 |
| páginas suman movimientos para saldo | 0 |
| saldos desde vistas | `treasury_bank_balances`, `*_current_account`, `*_open_items` |
| Rama | `feature/erp-a-tesoreria` (HEAD `70de44b`); archivos untracked |
| main intacto | `1630f70` (= origin/main); no push/merge |

---

*Fin — Revisión de Implementación ERP-A4. Veredicto: READY FOR ERP-A5. UI creada y verificada (typecheck/lint/build EXIT 0); sin deploy/merge/push; ERP-A4 cerrado.*
