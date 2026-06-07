# ERP-A2 · REPORTE DE EJECUCIÓN — C4 (0054)

**Proyecto:** TOPS Nexus — Logística TOPS (Verotin S.A.)
**Presidente:** Martín Battaglia
**Documento:** `ERP_A2_C4_EXECUTION_REPORT.md`
**Fuente de verdad / destino:** **`arsksytgdnzukbmfgkju` (tops-ordenes-prod)**.
**Resultado:** 🟢 **0054 aplicado y validado en producción.**

> Alcance respetado: **solo C4** (commit `0054` + aplicación + validación). **No** backend, UI, Server Actions, ni ERP-A3/A4/A5.

---

## 1. Commit generado (hash exacto)

| Campo | Valor |
|---|---|
| **Hash C4** | **`70de44bc47fdf5dd25ea706279664e5f0286559d`** (`70de44b`) |
| Mensaje | `feat(erp-a): 0054 treasury functions — RPCs + vistas derivadas (F1/F4/R2)` |
| Archivos | **1** — `supabase/migrations/0054_treasury_functions.sql` (449 insertions) |
| Rama | `feature/erp-a-tesoreria` (C1 `c6910af` → C2 `67d1e08` → **C4 `70de44b`**) |

### ⚠️ Incidente de rama — detectado y corregido (transparencia)
Entre turnos, el working dir había quedado en **`main`** (el usuario sumó `1630f70 fix(build): Netlify Node 22`). El primer intento de commit de `0054` cayó por error en `main` (`caa5d75`), dejando `main` con `0054` **sin** `0052/0053` (lineage rota). **Corrección aplicada:**
1. `0054` movido a `feature/erp-a-tesoreria` (cherry-pick → `70de44b`).
2. `main` restaurado a **`1630f70` = `origin/main`** (limpio, sin migraciones treasury).
3. **Nada se pusheó** (`caa5d75` quedó desreferenciado, sin efecto). Sin pérdida de trabajo.

---

## 2. Aplicación de `0054` (PROD `arsksytgdnzukbmfgkju`)

**Método:** Management API `POST /database/query`, payload `begin; <0054>; commit;` (atómico). **No `db push`.** Backup físico diario vigente (COMPLETED 2026-06-06T09:16Z); `0054` es **funciones+vistas** (`create or replace`, aditivo, **cero impacto de datos**).

| | Resultado |
|---|---|
| Pre-check | `0` funciones `tesoreria_*` antes |
| Aplicación | respuesta **`[]`** (sin error) → tx committeada |

---

## 3. Validación RPCs (4/4)

`pg_proc` (catálogo real prod): `tesoreria_register_receipt`, `tesoreria_register_payment`, `tesoreria_register_transfer`, `tesoreria_void_movement` — **las 4 presentes**, `security_definer=true`, `search_path=public, pg_temp`, `has_permission` en las 4, `grant execute → authenticated` (4). ✅

---

## 4. Validación Vistas (6/6)

`pg_views`: `treasury_bank_balances`, `customer_open_items`, `supplier_open_items`, `customer_current_account`, `supplier_current_account`, `treasury_cashflow_projection` — **las 6 presentes**, todas `security_invoker=true`. `treasury_bank_balances` responde: 3 cuentas (Caja/Santander/Galicia) con `balance=0.00` (derivado de `opening_balance`, sin movimientos). ✅

---

## 5. Validación F1 (catálogo real)

`pg_get_functiondef` de las RPC de alta:
- `tesoreria_register_receipt`: contiene `order by id for update` ✅
- `tesoreria_register_payment`: contiene `order by id for update` ✅

Lock **sobre las facturas**, ordenado (anti-deadlock), **nunca sobre allocations**. ✅

---

## 6. Validación F4 (definición real de vistas)

`pg_views.definition`: `treasury_bank_balances`, `customer_open_items`, `supplier_open_items` contienen el filtro `confirmado`. Las cuentas corrientes y el cashflow derivan de los open_items ⇒ anulados/voided excluidos en toda la capa. ✅

---

## 7. Validación R2 (catálogo real)

`pg_get_functiondef`: `tesoreria_register_receipt/_payment/_transfer` contienen `set_config(... treasury.via_rpc ...)`. `tesoreria_void_movement` **no** lo usa (correcto: solo hace UPDATE confirmado→anulado, gobernado por los lock triggers de `0053`, no por el guard de INSERT). ✅

---

## 8. Auditoría rápida post-aplicación

| Verificación | Resultado |
|---|---|
| RPCs `security definer` + `search_path` | 4/4 ✅ |
| `has_permission` en RPCs | 4/4 ✅ |
| Vistas `security_invoker` | 6/6 ✅ |
| F1 `order by id for update` | receipt + payment ✅ |
| F4 vistas `confirmado` | ✅ |
| R2 `via_rpc` en altas / ausente en void | ✅ |
| `treasury_bank_balances` operativa | 3 cuentas, balance derivado 0.00 ✅ |
| Grants execute → authenticated | 4 ✅ |
| Tablas `0053` intactas / RBAC intacto | sin cambios (0054 solo agrega funciones+vistas) ✅ |

---

## 9. Riesgos remanentes

### 🟠 P1
- **R-C4-1 — Rama `feature/erp-a-tesoreria` local, no pusheada, no mergeada.** Tiene `0052/0053/0054` (3 commits); **producción ya los tiene aplicados** pero `main` (`1630f70`) **no** los incluye. Recomendado: **pushear la rama** (durabilidad) + PR de merge a main para alinear árbol↔DB. *(Fuera de C4.)*
- **R-C4-2 — Higiene de rama activa.** El working dir puede quedar en `main` entre sesiones; **verificar `git branch` antes de commitear** ERP-A (lección del incidente §1, ya corregido).

### 🟡 P2
- **R-C4-3 — Dependencia de `AUTORIZADO_ARCA`:** `register_receipt` solo imputa a facturas autorizadas; con ARCA en mock puede no haber facturas imputables hasta activar emisión real.
- **R-C4-4 — Vistas heredan RLS de `customer_invoices`/`supplier_invoices`** para existencia de facturas; el dato de pago/cobro sí está gated.
- **R-C4-5 — Performance de vistas** a volumen → materialized view futura.
- **R-C4-6 — Tracking `schema_migrations` desincronizado** (método manual de la casa).

### ⚪ P3
- Factura duplicada en allocations (mensaje crudo); redondeo de decimales; mensajes más amigables.

---

## 10. Veredicto final

> # 🟢 ERP-A2 COMPLETADO
>
> La **capa de uso de Tesorería** está **desplegada y validada en producción (`arsksytgdnzukbmfgkju`)**:
> - **4 RPCs** (`register_receipt/_payment/_transfer/void_movement`) — `security definer`, `search_path`, `has_permission`, grants.
> - **6 vistas derivadas** (`treasury_bank_balances`, `customer/supplier_open_items`, `customer/supplier_current_account`, `treasury_cashflow_projection`) — `security_invoker`.
> - **F1** (lock `order by id for update` sobre facturas) · **F4** (vistas solo `confirmado`) · **R2** (`via_rpc` en altas) — **verificados en el catálogo real de producción**.
> - **D1/D5 preservados** (saldos y cuenta corriente derivados; sin `current_balance`, sin tablas de cuenta corriente).
> - Aplicado **atómicamente** (`BEGIN/COMMIT`) con backup vigente. Tablas/RBAC de `0053` **intactos**.
> - Incidente de rama **detectado y corregido**; `main` limpio (`= origin/main`), nada pusheado.
>
> **ERP-A2 (capa de uso) queda CERRADO.** No se avanzó a backend, UI, Server Actions ni ERP-A3.
>
> **Habilitado (requiere autorización aparte):** evaluación de **ERP-A3** (backend + server actions + capa de uso). **Follow-up:** push de `feature/erp-a-tesoreria` (3 commits) + merge a main (R-C4-1).

---

## Anexo — Evidencia (Management API, prod `arsksytgdnzukbmfgkju`)

| Verificación | Resultado |
|---|---|
| Pre `tesoreria_*` | 0 |
| Apply `0054` (begin/commit) | `[]` |
| RPCs | 4 (security definer + search_path + has_permission) |
| Vistas | 6 (security_invoker) |
| F1 `order by id for update` | receipt + payment ✅ |
| F4 `confirmado` en vistas | ✅ |
| R2 `via_rpc` en 3 altas / ausente en void | ✅ |
| `treasury_bank_balances` | 3 cuentas, balance 0.00 |
| Grants execute → authenticated | 4 |
| Commit C4 | `70de44bc47fdf5dd25ea706279664e5f0286559d` |
| main | `1630f70` (= origin/main, limpio) |

---

*Fin — Reporte de Ejecución C4 (0054). Veredicto: ERP-A2 COMPLETADO. Capa de uso desplegada y validada en producción. No se avanzó a backend/UI/ERP-A3.*
