# ERP-A · INFORME FINAL DE READINESS

**Proyecto:** TOPS Nexus — Logística TOPS (Verotin S.A.)
**Presidente:** Martín Battaglia
**Documento:** `ERP_A_FINAL_READINESS_REPORT.md`
**Baseline:** MAIN CANÓNICO `019bb02` · **Fuente de verdad: `arsksytgdnzukbmfgkju` (tops-ordenes-prod)**.
**Naturaleza:** informe de readiness. **No se aplicó ni ejecutó `0052`/`0053` ni ninguna migración.**

> **Directiva aplicada:** la única referencia es **producción `arsksytgdnzukbmfgkju`**. Staging no se usa como referencia. Donde hubo contradicción (gate de DB anterior detectó staging sin `0014`), **prevalece producción**, que **sí** tiene `0014`.

---

## 1. Estado actual

| Ítem | Estado |
|---|---|
| MAIN CANÓNICO | `main` == `origin/main` == **`019bb02`** ✓ |
| Migraciones en canónico | 49 trackeadas (0001–0051; incl. 0040–0051) |
| `0052`/`0053` | **untracked** (fuera del canónico, como corresponde) ✓ |
| Integridad `0053` | 12 funciones · 19 triggers · 6 enums · 6 tablas (== versión auditada GO) ✓ |
| `0052` | `alter type permission_module_t add value if not exists 'tesoreria'` + `notify pgrst` ✓ |
| Producción (fuente de verdad) | `0040–0051` aplicadas; `0014` presente; tesorería ausente (clean slate) ✓ |

No hay drift entre el contenido auditado de `0052/0053` y los archivos actuales; no hay drift entre las dependencias del baseline (`main`) y las de producción.

---

## 2. Compatibilidad de `0052` con MAIN CANÓNICO `019bb02`

| Verificación | Resultado |
|---|---|
| Depende de `permission_module_t` (enum de `0009`) | ✓ presente en canónico y en prod (tablas RBAC operativas) |
| Valor `'tesoreria'` ya existente | ❌ **NO existe** — prod devolvió `22P02: invalid input value for enum permission_module_t: "tesoreria"`. ⇒ `0052` es **necesario** y **no duplica**. |
| Idempotencia | `add value if not exists` → seguro aunque se reintente |
| Regla de aislamiento | debe aplicarse **en su propia transacción y committearse antes de `0053`** (regla de enums Postgres) — documentada |

**Veredicto `0052`: COMPATIBLE.** Sin conflictos.

---

## 3. Compatibilidad de `0053` con MAIN CANÓNICO `019bb02`

| Verificación | Resultado |
|---|---|
| FK `clients(id)` | ✓ existe en canónico y en prod |
| FK `vendors(id)` | ✓ |
| FK `customer_invoices(id)` | ✓ |
| FK `supplier_invoices(id)` (**0014**) | ✓ **presente en producción** (la fuente de verdad) |
| `cost_centers` (0014, contexto AP) | ✓ presente en prod |
| Usa `touch_updated_at()` (0009) | ✓ |
| Usa `current_role()` (0001/0005) | ✓ (expuesta como RPC en prod) + `has_permission()` ✓ |
| Seed RBAC requiere roles `director_ops/admin/operaciones/compliance` | ✓ los 4 existen en prod |
| Tablas treasury_* ya existentes | ❌ NO existen en prod (`bank_accounts` 404) ⇒ clean slate, sin colisión |
| Enums `treasury_*` (prefijo) | sin colisión con enums existentes (verificado en auditorías previas: `movement_type_t` etc. son WMS) |

**Veredicto `0053`: COMPATIBLE.** Todas las dependencias satisfechas en la fuente de verdad; destino limpio.

---

## 4. Dependencias verificadas

### 4.1 Re-verificación D1–D5 (en `0053`, congeladas)
| D | Verificación | OK |
|---|---|:--:|
| D1 saldo derivado | `opening_balance` presente; **sin** columna `current_balance` mutable | ✅ |
| D2 allocations N:M | `receipt_allocations` + `payment_allocations` (2/2) | ✅ |
| D3 numeración automática | 3 sequences `*_short_id_seq` + triggers `set_*_public_id` | ✅ |
| D4 retención simplificada | solo `retention_amount`; sin `regimen`/`certificate` | ✅ |
| D5 cuenta corriente derivada | **sin** tablas `*_current_account` | ✅ |

### 4.2 Re-verificación H1–H6 / H12 / R11
| Hallazgo | Verificación | OK |
|---|---|:--:|
| H1 append-only UPDATE | `tg_lock_treasury_movement/_customer_receipt/_supplier_payment` (6 refs) | ✅ |
| H2 allocations protegidas | `guard_allocation_insert` (3) + `tg_forbid_update_allocation` (3) | ✅ |
| H3 CAJA / efectivo | `account_type … 'caja'` CHECK; seed `Caja Efectivo` (`is_system=true`); receipts `bank_account_id NOT NULL` | ✅ |
| H4 RLS write = admin | `current_role() = 'admin'` ×13 (policies write) | ✅ |
| H5 RLS read internos | `current_role() in ('admin','operaciones','supervisor')` ×9 (read) | ✅ |
| H6 type↔direction | `treasury_movements_type_direction_ck` + `reference_type_ck` | ✅ |
| H12 precisión | `numeric(15,2)` ×7 (lado ventas) | ✅ |
| R11 base inmutable | `tg_lock_bank_account_basis` (2 refs) | ✅ |

### 4.3 Dependencias en PRODUCCIÓN (`arsksytgdnzukbmfgkju`) — evidencia REST
| Dependencia | Estado |
|---|---|
| `permissions` / `roles` / `role_permissions` (0009) | ✅ HTTP 200 |
| `clients` (0001) / `vendors` (0008) | ✅ |
| `customer_invoices` / `fiscal_config` (0011) | ✅ |
| **`supplier_invoices` / `cost_centers` (0014)** | ✅ **presentes en prod** |
| `current_role()` / `has_permission()` RPC | ✅ expuestas |
| Roles `director_ops/admin/operaciones/compliance` | ✅ existen |
| `permission_module_t` con valor `'tesoreria'` | ❌ ausente (correcto; lo agrega `0052`) |
| Tesorería `0052/0053` | ❌ ausente (clean slate) |

---

## 5. Riesgos abiertos

### 🔴 P0
**Ninguno.** Contra la fuente de verdad (`arsksytgdnzukbmfgkju`), todas las dependencias de `0052/0053` están satisfechas y el destino está limpio.

### 🟠 P1
- **R-RDY-1 — Método de aplicación: manual (SQL Editor), NO `db push`.** La tabla `schema_migrations` está vacía (migraciones aplicadas a mano). `supabase db push` intentaría reaplicar 0001–0051 y fallaría. **`0052/0053` deben aplicarse manualmente**, respetando: `0052` aislado y committeado **antes** de `0053`.
- **R-RDY-2 — Orden de enum (0052 → 0053).** Aplicar `0053` (que usa el valor `'tesoreria'` en el seed RBAC) en la misma transacción que `0052` falla ("unsafe use of new value of enum"). Aplicar `0052`, confirmar, luego `0053`.

### 🟡 P2
- **R-RDY-3 — `0040` (PII lockdown) verificada por inferencia, no por catálogo.** Es una *policy* sobre `profiles`, no REST-verificable. No es dependencia de `0052/0053`, pero conviene confirmar por dashboard/catálogo en una pasada de seguridad.
- **R-RDY-4 — `.env.local` apunta a producción.** Riesgo de mutaciones accidentales corriendo la app local contra prod. No bloquea ERP-A; revisar wiring de entornos.
- **R-RDY-5 — Drift de staging (sin `0014`).** Solo relevante **si** en el futuro se autoriza usar staging para validar ERP-A: staging debería normalizarse (aplicar `0014`) primero. Bajo la directiva vigente, **no es bloqueante** (staging no es referencia).

### ⚪ P3
- **R-RDY-6 — Huecos de numeración** (0012/0028 ausentes históricamente): cosmético, el runner aplica por nombre.
- **R-RDY-7 — Higiene** del working tree (artefactos untracked): mantener `git add` dirigido al crear la rama ERP-A.

---

## 6. Recomendación ejecutiva

**¿ERP-A está listo para iniciar ejecución?** → **Sí.**

Contra la **fuente de verdad `arsksytgdnzukbmfgkju`**, el baseline operativo (`0001–0051`, incluida `0014` y el RBAC) está **completo**, el espacio de nombres de tesorería está **limpio** (sin `0052/0053`), y el valor de enum `'tesoreria'` **no existe** (confirmando que `0052` es la pieza faltante correcta). `0052` y `0053` son **compatibles** con `019bb02`, y conservan **íntegros** D1–D5, H1–H6, H12 y R11 de la auditoría adversarial GO.

El único cuidado real es **operativo** (P1): aplicar `0052/0053` **manualmente** vía SQL Editor (no `db push`), con `0052` aislado y committeado **antes** de `0053`. No hay bloqueantes de dependencia contra producción.

**Secuencia de arranque autorizable (ERP-A1):**
1. `feature/erp-a-tesoreria` ← desde `019bb02`.
2. Commits `C1=0052`, `C2=0053`, `C3=docs` (tesoreria-only, `git add` dirigido).
3. Aplicar a producción (fuente de verdad) por el método manual: `0052` (aislado, commit) → `0053` → validación estructural/funcional/adversarial → GO.

---

## 7. Veredicto final

> # 🟢 READY FOR ERP-A1
>
> `0052` y `0053` son compatibles con MAIN CANÓNICO `019bb02`; D1–D5, H1–H6, H12 y R11 intactos; todas las dependencias verificadas en la fuente de verdad `arsksytgdnzukbmfgkju` (RBAC, `0014`/`supplier_invoices`/`cost_centers`, `current_role`, `permissions`, `touch_updated_at`); destino de tesorería limpio; valor de enum `'tesoreria'` ausente (correcto). **Sin P0.**
>
> Condiciones operativas a respetar al ejecutar (P1, no bloquean el READY): aplicación **manual** (SQL Editor), `0052` aislado **antes** de `0053`.
>
> Pendiente: **autorización explícita del presidente** para iniciar ERP-A1 (crear rama, commitear `0052/0053`, aplicar `0052`).

---

## Anexo — Evidencia (read-only)

| Verificación | Resultado |
|---|---|
| `main`/`origin/main` | `019bb02` (idénticos) |
| Estructura `0053` | 12 fn · 19 trg · 6 enum · 6 tabla |
| D1–D5 / H1–H6 / H12 / R11 | markers presentes (grep `0053`) |
| Prod RBAC + 0014 + funciones | HTTP 200 / RPC expuestas |
| Prod enum `'tesoreria'` | `22P02` (no existe) |
| Prod tesorería | HTTP 404 (clean slate) |

---

*Fin — Informe Final de Readiness ERP-A. Veredicto: READY FOR ERP-A1. No se aplicó ni ejecutó ninguna migración. Pendiente de autorización explícita para iniciar ERP-A1.*
