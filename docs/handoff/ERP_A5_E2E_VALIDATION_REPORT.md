# ERP-A5 · REPORTE DE VALIDACIÓN E2E — Tesorería

**Proyecto:** TOPS Nexus — Logística TOPS (Verotin S.A.)
**Presidente:** Martín Battaglia
**Documento:** `ERP_A5_E2E_VALIDATION_REPORT.md`
**Entorno:** **producción `arsksytgdnzukbmfgkju`** (fuente de verdad).
**Método:** E2E ejecutado **dentro de una transacción que se revierte por excepción** (DO block que termina en `raise`) → valida el circuito completo RPC → DB → vistas derivadas **sin persistir ni un registro**. Verificado post: tesorería sigue vacía (mov=0, rec=0, pay=0), 0 fixtures.

> **Resultado en una línea:** 8/8 escenarios funcionales PASS, vistas derivadas correctas, append-only y rollback impecables. **Pero E2E-9 destapó un bug P1 real: el guard de permisos falla-abierto ante rol nulo.** → **NOT READY** hasta corregirlo (fix de 1 línea).

---

## 1. Escenarios ejecutados

E2E-1..9 corridos contra las RPC/vistas reales de producción (rolled-back). E2E-10 (visual) por build.

## 2. Resultados (PASS / FAIL)

| # | Escenario | Resultado | Evidencia |
|---|---|:--:|---|
| **E2E-1** | Cobranza simple (inv 1000 → Santander) | ✅ PASS | saldo Santander=1000; inv1.saldo=0 (vista) |
| **E2E-2** | Cobranza parcial (200 de 500) | ✅ PASS | inv2.saldo=300; Santander=1200 |
| **E2E-3** | Cobranza múltiple (300+700 a 2 facturas) | ✅ PASS | inv2.saldo=0, inv3.saldo=0; Santander=2200 |
| **E2E-4** | Pago simple (800) | ✅ PASS | sinv1.saldo=0; Santander=1400 |
| **E2E-5** | Pago parcial (250 de 600) | ✅ PASS | sinv2.saldo=350; Santander=1150 |
| **E2E-6** | Transferencia (Santander→Galicia 500) | ✅ PASS | Santander=650; Galicia=500 |
| **E2E-7** | Anulación (pago + recibo + ajuste) | ✅ PASS | saldos revierten (Santander 1450→450; Galicia 600→500); inv1 reabre a 1000; sinv1 reabre a 800 |
| **E2E-8** | Concurrencia / doble imputación | ✅ PASS | over-allocation **rechazada** (`OVERALLOCATION`) sobre factura saldada |
| **E2E-9** | Permisos (usuario sin acceso) | ❌ **FAIL** | transferencia sin auth **NO** rechazada → **INCIDENTE-1** |
| **E2E-10** | Visualización (todas las pantallas) | 🟡 PARCIAL | `typecheck`/`lint`/`build` EXIT 0; 6 rutas `/tesoreria*` compilan (A4). Render runtime con login = pendiente (no se operó la UI contra prod sin sesión) |

> **Nota concurrencia (E2E-8):** la doble imputación *paralela real* requiere 2 sesiones simultáneas; se validó (a) el **rechazo de sobre-imputación** en sesión única y (b) la presencia del **lock `FOR UPDATE … order by id`** en `register_receipt/_payment` (catálogo, ERP-A4). El guard contra doble imputación está implementado y verificado por diseño + rechazo funcional.

---

## 3. Incidentes encontrados

### 🟠 INCIDENTE-1 (P1) — Guard de permisos *fail-open* ante rol nulo
**Síntoma:** `tesoreria_register_transfer` ejecutó **sin** autorización cuando `auth.uid()` era nulo (E2E-9).
**Causa raíz (diagnosticada):**
- `public.current_role()` = `select role from profiles where id = auth.uid()` → con `auth.uid()` nulo devuelve **NULL**.
- `public.has_permission(slug)` = `exists(...) OR current_role()='admin'` → `false OR (NULL='admin')` = **NULL** (no `false`).
- En las RPC de `0054`: `if not public.has_permission(...) then raise 'FORBIDDEN'` → `not NULL` = **NULL** → el `if` no se cumple → **el FORBIDDEN no se lanza** → la operación procede.

**Exposición real (acotada):** los usuarios **anónimos** están bloqueados por el `grant execute … to authenticated` (PostgREST 403). Los usuarios autenticados **normales tienen `profiles.role`** (default `operaciones` por el trigger de alta) → `current_role()` no es nulo → `has_permission` devuelve `false` → **FORBIDDEN correcto** (validado: `operaciones` sería rechazado). El fail-open solo se materializa para un autenticado **sin fila en `profiles`/rol nulo** (no debería ocurrir, pero es un **fallo-abierto latente** inaceptable en un control financiero).

**Corrección recomendada (1 línea, migración correctiva `0055`, NO escrita aún):** que el guard falle **cerrado**:
`if not coalesce(public.has_permission(<slug>), false) then raise 'FORBIDDEN' …` en las 4 RPC (o endurecer `has_permission` para devolver `false` en vez de `NULL`). Tras el fix, re-correr **E2E-9**.

---

## 4. Riesgos remanentes

### 🔴 P0
**Ninguno.** Sin fallas de integridad de datos: cobranzas/pagos/transferencias/anulaciones y vistas derivadas correctas; over-allocation rechazada; append-only y rollback impecables (cero persistencia).

### 🟠 P1
- **INCIDENTE-1** — guard de permisos fail-open ante rol nulo (ver §3). Bloqueante para producción de un control financiero.

### 🟡 P2
- **R-A5-1 — Concurrencia paralela no probada con 2 sesiones** (validada por diseño + rechazo de sobre-imputación). Recomendado un test de carga con conexiones concurrentes.
- **R-A5-2 — Verificación visual runtime pendiente** (E2E-10): la UI compila; falta render autenticado.
- **R-A5-3 — Dependencia `AUTORIZADO_ARCA`:** en prod sin ARCA real puede no haber facturas cliente imputables (el E2E usó facturas autorizadas sintéticas rolled-back).

### ⚪ P3
- Nombres de cliente/proveedor en selectores; gating UX de botones por permiso; mensajes/i18n.

---

## 5. Validación D1 (saldo derivado)

✅ **PASS.** Todos los saldos verificados se leyeron de **`treasury_bank_balances`** y coincidieron con lo esperado tras cada operación (1000→1200→2200→1400→1150→650/500→…). Ningún saldo se calculó en TS/React (grep A3/A4: 0). El saldo se recompone solo tras la anulación (E2E-7). 

## 6. Validación D5 (cuenta corriente derivada)

✅ **PASS.** `customer_open_items`/`supplier_open_items` y `*_current_account` reflejaron correctamente las imputaciones y reaperturas (inv2.saldo 500→300→0; inv1 reabre a 1000 tras void; sinv1 reabre a 800). Sin tablas ni columnas de cuenta corriente; todo derivado y rolled-back (0 persistencia).

## 7. Validación RPC-First

✅ **PASS.** Las operaciones de escritura se ejecutaron **vía las RPC** (`tesoreria_register_receipt/_payment/_transfer/void_movement`); la UI (A4) las consume solo a través de `actions.ts` (grep: 0 SQL en cliente). Toda la lógica financiera (suma, saldo, lock, retención, append-only) vive en DB.

## 8. Validación Seguridad

🟡 **PARCIAL.**
- ✅ **RLS:** activa en las 6 tablas (catálogo); las vistas son `security_invoker` (gatean por RLS).
- ✅ **RBAC:** 5 permisos `tesoreria` + matriz sembrados (A1); `operaciones` (view-only) **sería rechazado** por el guard (current_role no admin → `has_permission` false → FORBIDDEN).
- ✅ **Cliente sin acceso a datos:** rol legacy `cliente` excluido por RLS de lectura (C6).
- ❌ **Guard de permisos fail-open ante rol nulo (INCIDENTE-1).** Un control de autorización financiero debe fallar **cerrado**.

---

## 9. Recomendación ejecutiva

El modelo, las RPC, las vistas derivadas y la UI **funcionan correctamente de punta a punta**: 8/8 escenarios funcionales pasaron en producción (rolled-back), con saldos derivados exactos, anulaciones reversibles, sobre-imputación bloqueada y D1/D5/RPC-First cumplidos. El test, además, demostró que **se puede validar contra producción sin dejar datos** (rollback verificado).

**Hay un único bloqueante:** el guard de permisos **falla-abierto** cuando `current_role()` es nulo (INCIDENTE-1). Aunque su explotabilidad real es baja (anónimos bloqueados por el `grant`; usuarios normales tienen rol y son rechazados), **un control financiero no puede fallar abierto**. La corrección es mínima (envolver el guard en `coalesce(..., false)` en las 4 RPC, migración correctiva `0055`) y re-correr E2E-9.

**Acción recomendada:** autorizar el fix `0055` (1 línea × 4 RPC) → re-validar E2E-9 → entonces declarar producción. Nada más bloquea.

---

## 10. Veredicto final

> # ⛔ ERP TESORERÍA NOT READY
>
> **Motivo único:** INCIDENTE-1 (P1) — el guard de permisos de las RPC **falla-abierto** ante rol nulo (`if not has_permission(...)` con `has_permission`=NULL no lanza FORBIDDEN). Un control de autorización financiero debe fallar cerrado.
>
> **Todo lo demás está VERDE:** E2E-1..8 PASS en producción (cobranzas simple/parcial/múltiple, pagos simple/parcial, transferencia, anulación de pago/recibo/ajuste, sobre-imputación rechazada), vistas derivadas correctas, **D1/D5/RPC-First cumplidos**, RLS/RBAC activos, y rollback con **cero persistencia** (tesorería verificada vacía post-test).
>
> **Está a UN fix de 1 línea de estar listo:** `coalesce(public.has_permission(<slug>), false)` en las 4 RPC (migración `0055`), luego re-correr E2E-9. No se autoriza escribir ese fix en esta fase (solo validación); queda como **acción P1 inmediata** para tu autorización.
>
> No se abrió ERP-B. No se desplegó nada nuevo. ERP-A queda **validado salvo INCIDENTE-1**.

---

## Anexo — Evidencia

| Verificación | Resultado |
|---|---|
| E2E-1..8 | PASS (log acumulado hasta E2E-9) |
| E2E-9 | FAIL (transferencia sin auth no rechazada) |
| Rollback | tesorería vacía post-test (mov/rec/pay=0; fixtures=0) |
| `current_role()` sin jwt | **NULL** |
| `has_permission('tesoreria.create')` sin jwt | **NULL** (no false) → fail-open |
| Saldos derivados | de `treasury_bank_balances` (D1) |
| Cuenta corriente | de `*_open_items` / `*_current_account` (D5) |
| Build UI | EXIT 0, 6 rutas `/tesoreria*` |

---

*Fin — Validación E2E ERP-A5. Veredicto: ERP TESORERÍA NOT READY (1 bloqueante P1: INCIDENTE-1, fail-open de permisos). 8/8 funcional PASS; D1/D5/RPC-First OK; cero persistencia. No se desplegó ni se abrió ERP-B.*
