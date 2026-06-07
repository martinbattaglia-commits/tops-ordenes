# ERP-A5.1 · REVISIÓN DEL HOTFIX DE SEGURIDAD — `0055_treasury_security_fix.sql`

**Proyecto:** TOPS Nexus — Logística TOPS (Verotin S.A.)
**Presidente:** Martín Battaglia
**Documento:** `ERP_A5_SECURITY_FIX_REVIEW.md`
**Corrige:** INCIDENTE-1 de `ERP_A5_E2E_VALIDATION_REPORT.md` (guard de permisos *fail-open* ante rol nulo).
**Naturaleza:** escritura del archivo + revisión. **No se aplicó, ejecutó ni se tocó producción.**

> **Resultado:** el cambio es **mínimo, quirúrgico y demostrablemente fail-closed**; las 4 RPC quedan byte-idénticas a `0054` salvo el guard; sin cambio funcional/financiero/de negocio; sin regresión para roles reales. **READY FOR 0055 DEPLOY.**

---

## 1. Descripción exacta del cambio

Una sola transformación, repetida en el guard de las 4 RPC:

```sql
-- ANTES (0054, fail-open):
if not public.has_permission('<permiso>') then  raise 'FORBIDDEN' ...

-- DESPUÉS (0055, fail-closed):
if not coalesce(public.has_permission('<permiso>'), false) then  raise 'FORBIDDEN' ...
```

`0055` redefine (`create or replace function`) **únicamente las 4 RPC**, con cuerpos **idénticos** a `0054` excepto esa línea. **No** toca `has_permission`, RBAC, RLS, vistas, ni `0052/0053/0054`. No incluye las vistas/grants (quedan intactas de `0054`).

**Prueba de identidad:** diff de los cuerpos de las 4 funciones (`0055` con el `coalesce` revertido) contra `0054` → **sin diferencias de código** (solo headers de comentario acortados y el bloque de vistas/grants que `0055` deliberadamente no incluye). Estructura: 8 `$$` (4 funciones), 4 guards `coalesce`, 0 guards sin coalesce.

---

## 2. RPCs afectadas (4)

| RPC | Permiso del guard | Cambio |
|---|---|---|
| `tesoreria_register_receipt` | `tesoreria.create` | guard → `coalesce(..., false)` |
| `tesoreria_register_payment` | `tesoreria.create` | ídem |
| `tesoreria_register_transfer` | `tesoreria.create` | ídem |
| `tesoreria_void_movement` | `tesoreria.edit` | ídem |

Ninguna otra función, vista, tabla o policy se modifica.

---

## 3. Validación de seguridad — NULL ↓ FALSE

`coalesce(NULL, false) = false` ⇒ el guard nunca recibe `NULL`. Tabla de verdad (`h = has_permission`):

| `h` | ANTES `not h` | Efecto | DESPUÉS `not coalesce(h,false)` | Efecto |
|---|---|---|---|---|
| TRUE | `not TRUE` = FALSE | procede ✅ | `not TRUE` = FALSE | procede ✅ (igual) |
| FALSE | `not FALSE` = TRUE | FORBIDDEN ✅ | `not FALSE` = TRUE | FORBIDDEN ✅ (igual) |
| **NULL** | `not NULL` = **NULL** → IF no se cumple → **NO lanza** ⛔ FAIL-OPEN | **NULL** ↓ **FALSE** ⇒ `not FALSE` = TRUE → **FORBIDDEN** ✅ FAIL-CLOSED | **CORREGIDO** |

**Demostrado:** el único comportamiento que cambia es `NULL → fail-closed`. Para `TRUE`/`FALSE` el comportamiento es **idéntico**. El control ahora **falla cerrado**.

---

## 4. Validación de regresión (admin / director_ops / compliance / operaciones)

`has_permission(slug)` = `exists(user_roles→role_permissions con slug)` **OR** `current_role()='admin'`. El `coalesce` solo actúa cuando el resultado es `NULL` (es decir, cuando `current_role()` es `NULL`, sin usuario). Para todo rol real `current_role()` es no-nulo ⇒ `has_permission` ∈ {true, false} ⇒ `coalesce` no altera nada.

| Rol | `has_permission('tesoreria.create')` | ANTES | DESPUÉS | ¿Cambia? |
|---|---|---|---|---|
| **admin** (legacy `current_role='admin'`) | `… OR true` = **true** | procede | procede | **No** ✅ |
| **director_ops** (granular con `tesoreria.create/edit/admin`) | `exists()` = **true** | procede | procede | **No** ✅ |
| **compliance** (solo `view`+`export`) | create/edit: **false** | FORBIDDEN | FORBIDDEN | **No** ✅ (correctamente bloqueado) |
| **operaciones** (solo `view`) | create/edit: **false** | FORBIDDEN | FORBIDDEN | **No** ✅ (correctamente bloqueado) |
| *(sin usuario / rol nulo)* | **NULL** | fail-open ⛔ | **FORBIDDEN** ✅ | **Sí — corregido** |

**Conclusión:** cero regresión. Los 4 roles reales mantienen su comportamiento exacto; solo se cierra el agujero del rol nulo.

> Nota: `compliance` para `void` usa `tesoreria.edit` (no lo tiene) → FORBIDDEN, igual antes y después. `director_ops`/`admin` tienen `edit` → proceden.

---

## 5. Auditoría adversarial — re-ejecución conceptual de E2E-9

**E2E-9 (usuario sin acceso → transferencia):** con `auth.uid()` nulo → `current_role()` = NULL → `has_permission('tesoreria.create')` = NULL → `coalesce(NULL, false)` = **false** → `not false` = **true** → **`raise FORBIDDEN`** → la transferencia se **rechaza**. ⇒ **E2E-9 pasaría ahora.** ✅

**Intentos de romper el control nuevamente:**
- ¿`coalesce` enmascara un `true` legítimo? No — `coalesce(true,false)=true`. Solo NULL→false.
- ¿Un usuario puede forzar `has_permission` a algo ≠ {true,false,null}? No — es boolean.
- ¿Anónimo? Bloqueado por `grant execute … to authenticated` (sin cambios). Doble candado.
- ¿Se rompió algún otro consumidor de `has_permission`? No — `0055` **no toca** `has_permission`; el cambio está acotado a las 4 RPC. Otros callers quedan exactamente como estaban.
- ¿Cambió alguna ruta financiera (suma, saldo, lock, append-only)? No — diff prueba cuerpos idénticos salvo el guard.

**No se encontró forma de evadir el control tras el fix.**

---

## 6. Riesgos

### 🔴 P0
**Ninguno.**

### 🟠 P1
**Ninguno** — el fix cierra el P1 (INCIDENTE-1). *(Recordatorio operativo: el fix corrige la producción solo cuando se **aplique** `0055`; hasta entonces las RPC en prod siguen fail-open.)*

### 🟡 P2
- **R-FIX-1 — Causa raíz en `has_permission` sigue devolviendo NULL.** No se corrige en la fuente porque el alcance autorizado excluye RBAC/`0009`. Otros callers futuros de `has_permission` que no hagan `coalesce` repetirían el fail-open. *Recomendación (fuera de este alcance):* endurecer `has_permission` para devolver `false` en vez de `NULL`, en un cambio RBAC-scoped aparte.

### ⚪ P3
- **R-FIX-2 — Divergencia cosmética:** los headers de comentario de las RPC se acortaron en `0055` vs `0054` (sin efecto en código). Trazabilidad menor.

---

## 7. Veredicto

> # 🟢 READY FOR 0055 DEPLOY
>
> `0055_treasury_security_fix.sql` corrige INCIDENTE-1 con el mínimo cambio posible: envuelve el guard de las **4 RPC** en `coalesce(public.has_permission(<permiso>), false)` ⇒ **NULL ↓ FALSE ⇒ fail-closed**.
> - **Identidad probada:** cuerpos byte-idénticos a `0054` salvo el guard (diff de código vacío); 0 cambios funcionales/financieros/de negocio; no toca `has_permission`/RBAC/RLS/vistas/`0052/0053/0054`.
> - **Seguridad demostrada:** tabla de verdad confirma que solo `NULL` cambia (a fail-closed); `TRUE`/`FALSE` intactos.
> - **Sin regresión:** admin/director_ops/compliance/operaciones mantienen comportamiento exacto.
> - **Adversarial:** E2E-9 pasaría (transferencia sin auth rechazada); no se halló evasión.
>
> Sin P0/P1 abiertos. Apto para aplicar a producción `arsksytgdnzukbmfgkju` (procedimiento manual `BEGIN/COMMIT`), y re-correr **E2E-9** post-deploy para confirmar.
>
> Pendiente: **autorización explícita** para aplicar `0055`. Este documento es solo escritura + auditoría.

---

## Anexo — Evidencia

| Check | Resultado |
|---|---|
| funciones en `0055` | 4 |
| guards `coalesce(has_permission,…)` | 4 |
| guards sin coalesce | 0 |
| vistas/grants en `0055` | 0 (no las toca) |
| `$$` balanceados | 8 |
| diff cuerpos vs `0054` (guard revertido) | sin diferencias de código |
| truth table NULL↓FALSE | demostrada |
| regresión roles reales | sin cambios |
| Rama | `feature/erp-a-tesoreria`; `0055` untracked, no aplicado |

---

*Fin — Revisión del Hotfix de Seguridad `0055`. Veredicto: READY FOR 0055 DEPLOY. Escrito y auditado; no aplicado, no ejecutado, sin tocar producción.*
