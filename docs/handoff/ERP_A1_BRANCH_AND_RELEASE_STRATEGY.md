# ERP-A1 · ESTRATEGIA DE BRANCHING Y RELEASE

**Proyecto:** TOPS Nexus — Logística TOPS (Verotin S.A.)
**Presidente:** Martín Battaglia
**Documento:** `ERP_A1_BRANCH_AND_RELEASE_STRATEGY.md`
**Objetivo:** aislar el frente ERP-A para ejecución futura **sin contaminar CRM, ARCA, Compras ni Producción**.
**Naturaleza:** solo estrategia. **No se crean ramas, no se commitea, no se mueven archivos, no se aplica nada.**

> **Contexto congelado:** `0052` y `0053` escritos, auditados (GO adversarial), R11 cerrado, plan de despliegue validado. Todo lo demás detenido.

---

## 0. Estado real del repositorio (verificado — condiciona la estrategia)

| Hecho | Evidencia | Consecuencia |
|---|---|---|
| Rama activa `feature/crm-comercial-f2-1`, **+26 commits sobre `main`** | `git rev-list --count main..HEAD = 26` | CRM **no está mergeado** a main. |
| `0052`/`0053` y docs ERP-A están **untracked** | `git status ?? …` | No commiteados (correcto). |
| Última migración **trackeada** = `0051` (CRM) | `git ls-files supabase/migrations | tail` | `0052/0053` continúan la lineage de la rama CRM. |
| `main` local (`c3fb359`) ≠ `origin/main` (`073339d`) | `git log -1 main` vs `origin/main` | **main no es canónico**: diverge del remoto. |
| Migraciones CRM `0041–0051` **no están en main** | (consecuencia de +26) | Ramificar desde main dejaría una lineage sin `0041–0051`. |
| Dependencias reales de `0052/0053` | auditorías previas | Solo `0001/0005/0008/0009/0011/0014` (todas **pre-0041**, presentes en main). **No** dependen de ninguna migración CRM. |

**Tensión central de release:** `0052/0053` están **numerados después** de las migraciones CRM (`…0051`) pero **no dependen** de ellas. Si se ramifica ERP-A desde un `main` que carece de `0041–0051`, la lineage de archivos queda con huecos y un rebuild-from-scratch fallaría, aunque la DB de staging (que ya tiene CRM aplicado) los aplique igual. **La base de la rama ERP-A debe ser un commit que represente el baseline realmente desplegado (CRM incluido).**

---

## 1. Estrategia de ramas

### Recomendación: rama integradora + ramas por fase (superior a 3 ramas sueltas)

```
main  (baseline canónico, CRM incluido)            ← gate de merge final
 └─ feature/erp-a-tesoreria   (INTEGRADORA, larga, solo ERP-A)
     ├─ erp-a/a1-schema        → 0052, 0053, docs handoff ERP-A
     ├─ erp-a/a1-validation    → script de validación ejecutable (futuro)
     ├─ erp-a/a4-functions     → 0054 (RPCs + vistas) (futuro)
     ├─ erp-a/a2-backend       → src/lib/tesoreria/* (futuro)
     ├─ erp-a/a3-ui            → (app)/tesoreria/* (futuro)
     └─ erp-a/a5-e2e           → validación E2E (futuro)
```

**Por qué esta forma y no tres ramas planas (`erp-a-tesoreria` / `erp-a-validation` / `erp-a-a4`):**
- **Aislamiento total de CRM:** la rama integradora solo contiene archivos de tesorería. CRM/ARCA/Compras nunca aparecen en su diff.
- **Gates por fase:** cada `erp-a/*` entra a la integradora con su propio PR + review. Si una fase falla, no arrastra a las otras.
- **Despliegue parcial posible:** se puede aplicar A1 a staging desde la integradora sin esperar A4/A2/A3.
- **Un solo PR limpio a main:** la integradora se mergea a main cuando ERP-A alcanza un hito desplegable (mínimo A1+A4 = esquema usable), como **un** PR coherente y no seis dispersos.
- Las tres ramas planas que propusiste son válidas, pero pierden el punto de integración común y obligan a coordinar dependencias entre PRs sueltos contra main (más superficie de conflicto con lo que se mueva en main mientras tanto).

### Base de la rama integradora (decisión crítica)

| Opción | Base | Pros | Contras | Veredicto |
|---|---|---|---|---|
| **B1 (preferida)** | **Mergear CRM→main primero**, luego `feature/erp-a-tesoreria` **desde main** | Lineage limpia (0041–0051 en main); PR de ERP-A sin diffs de CRM; rebuild-from-scratch funciona | Depende de cerrar el merge de CRM (CRM está "cerrado y validado" → debería poder mergearse) | ✅ **Recomendada** |
| **B2 (fallback)** | `feature/erp-a-tesoreria` **desde el tip de la rama CRM** | No bloquea por el merge de CRM; lineage continua (0052 sigue a 0051) | La integradora hereda commits CRM; al PR-ear a main mezcla con CRM si CRM no mergeó antes | ⚠️ Aceptable si se **rebasa** sobre main tras mergear CRM |
| B3 | `feature/erp-a-tesoreria` desde `main` actual (sin CRM) | PR diff limpio | Lineage con hueco 0041–0051; rebuild roto; main diverge de origin | ❌ Rechazada |

> Prerrequisito transversal a B1/B2: **reconciliar `main` local con `origin/main`** (hoy divergen) antes de usar main como base o destino de merge.

---

## 2. Estrategia de commits (secuencia exacta — diseñada, no ejecutada)

> Convención de la casa: `tipo(scope): descripción` (estilo `feat(crm): …`). Scope nuevo: `erp-a`.
> Regla: **`git add` archivo por archivo**; jamás barrer el working tree (hay cambios CRM ajenos sin commitear: `clientify/client.ts`, `comercial/contactos` — esos van en la **rama CRM**, no acá).

En `erp-a/a1-schema`:

| # | Commit | Archivos | Por qué separado |
|---|---|---|---|
| **C1** | `feat(erp-a): 0052 treasury permission module — enum 'tesoreria' (aislada)` | `supabase/migrations/0052_treasury_permission_module.sql` | Espeja la **aplicación aislada** (enum en su propia tx/commit); revert independiente |
| **C2** | `feat(erp-a): 0053 treasury core schema — C1–C8 + R11 (append-only, allocations, CAJA, RLS, CHECKs)` | `supabase/migrations/0053_treasury_core.sql` | Revert independiente de C1; un solo archivo cohesivo |
| **C3** | `docs(erp-a): dossier de diseño/auditoría/despliegue ERP-A` | `docs/handoff/ERP_A_*.md`, `docs/handoff/ERP_A1_*.md` | Documentación separada del código |

Futuras ramas (no ahora):
- `erp-a/a1-validation` → **C4** `test(erp-a): script de validación A1 (estructural+funcional+adversarial)`
- `erp-a/a4-functions` → **C5** `feat(erp-a): 0054 treasury fns + vistas (F1/F4, via_rpc is_local=true)`
- A2/A3/A5 → commits análogos.

**Reglas de commit:**
- `0052` y `0053` **siempre en commits separados** (revert quirúrgico + paridad con el orden de aplicación).
- Ningún commit de ERP-A toca archivos de CRM/ARCA/Compras (verificable: `git show --stat` debe listar solo `supabase/migrations/005[23]_*` o `docs/handoff/ERP_A*`).
- No commitear los cambios ajenos del working tree.

---

## 3. Estrategia de promoción (con gates explícitos)

```
DESARROLLO ──G1──► INTEGRACIÓN ──G2──► STAGING ──G3──► VALIDACIÓN ──G4──► PRODUCCIÓN
 (erp-a/*)         (feature/erp-a-       (vrxosunxlh…    (deploy plan      (otro project-ref)
                    tesoreria)            staging)        §4–§6)
```

| Gate | De → A | Condición de paso |
|---|---|---|
| **G1** | `erp-a/a1-schema` → integradora | PR + code review GO; archivos solo-ERP-A; auditoría adversarial ya GO |
| **G2** | integradora → aplicar en **staging** | Precondiciones P1–P8 del deploy plan OK; backup restaurable |
| **G3** | staging aplicado → **validación** | Orden S0–S3 ejecutado limpio (0052 aislada → 0053 tx) |
| **G4** | validación → **producción** | §4 estructural + §5 funcional + §6 adversarial 100%; A14 esperado; **GO firmado de staging** |
| **G5** | integradora → **main** | Hito desplegable (mín. A1+A4); PR único limpio; CRM ya en main |
| **G6** | main → **producción** | Backup prod; ventana; sign-off ejecutivo; aplicar 0052 aislada → 0053 |

**Principio:** el `ERP_A1_DEPLOY_AND_VALIDATION_PLAN.md` es el **runbook** de G2–G4/G6. Esta estrategia define **cuándo** y **desde qué rama**; el deploy plan define **cómo**.

---

## 4. Estrategia de rollback (operativo, nivel release)

> **Principio rector:** **git y la base de datos están desacoplados.** Un `git revert` **no deshace** una migración ya aplicada. El rollback de DB se hace con el teardown del deploy plan §3 y/o restore del backup.

**Rollback de git (código):**
- `0052` y `0053` en commits separados ⇒ `git revert <sha>` quirúrgico por migración.
- Nunca `force-push` sobre ramas compartidas. Revert por encima, no reescritura de historia.

**Rollback de DB por componente:**

| Componente | Riesgo | Rollback operativo |
|---|---|---|
| **Enum `0052` (IRREVERSIBLE)** | `alter type add value` **no se puede deshacer**; revert del commit borra el archivo, **no** el valor aplicado | **Forward-only.** Si ERP-A se abandona, dejar el valor `tesoreria` huérfano (inocuo, sin permisos que lo usen tras teardown de `0053`). Quitarlo de verdad exige recrear `permission_module_t` + recast de `permissions.module` (costoso, solo en ventana mayor) |
| **Storage** | bucket/policies; puede haberse aplicado por Dashboard (S3b) | Teardown: drop policies `treasury *` + `delete from storage.buckets where id='treasury'`. Si fue por Dashboard, revertir por Dashboard |
| **RBAC** | seeds `permissions`/`role_permissions` de `tesoreria` | `delete role_permissions … where permission.module='tesoreria'` → `delete permissions where module='tesoreria'`. Idempotente. Cuidar `user_roles` que ya referencien (cascade) |
| **RLS** | policies de las 6 tablas | `drop policy` de las treasury (o `drop table … cascade` baja todo) |
| **Tablas/seed** | `0053` completo | Teardown en orden inverso del deploy plan §3 (policies → seeds → tablas → funciones → sequences → enums treasury_*) |

**Rollback total:** restaurar desde el backup S0 (DISASTER_RECOVERY_PLAN). En staging, costo nulo; en producción, ventana + verificación.

**Regla de oro de rollback:** ante duda en producción, **restore de backup** > teardown manual parcial (evita estados intermedios inconsistentes).

---

## 5. Riesgos de release

### 🔴 P0
**Ninguno.** ERP-A es puramente aditivo; no altera tablas/código de CRM/ARCA/Compras.

### 🟠 P1
- **R-REL-1 — Lineage/baseline mismatch.** Ramificar ERP-A desde un `main` sin `0041–0051` deja huecos de migración y rompe rebuild-from-scratch. *Mitigación:* Opción B1 (mergear CRM→main primero) o B2 (base = tip CRM + rebase posterior).
- **R-REL-2 — `main` diverge de `origin/main`.** Base/destino no canónico. *Mitigación:* reconciliar `main`↔`origin/main` **antes** de cualquier branch/merge de release.
- **R-REL-3 — `git revert` ≠ rollback de DB (enum 0052 irreversible).** Riesgo de creer revertido algo que sigue aplicado. *Mitigación:* tratar `0052` como forward-only; rollback de DB siempre por teardown/backup, documentado.

### 🟡 P2
- **R-REL-4 — Contaminación CRM en el PR de ERP-A** (si base = tip CRM y CRM no mergea antes). *Mitigación:* mantener commits ERP-A 100% tesoreria-only + rebase sobre main tras merge de CRM.
- **R-REL-5 — Barrido del working tree.** Cambios CRM ajenos sin commitear podrían colarse en un commit de ERP-A. *Mitigación:* `git add` por archivo; verificar `git show --stat`.
- **R-REL-6 — Privilegio storage (R8).** El bloque storage puede fallar en prod. *Mitigación:* S3b (aplicar storage aparte por Dashboard).

### ⚪ P3
- **R-REL-7 — Hueco de numeración** 0041–0051 ausentes en la rama si se eligiera B3 (descartada). Cosmético si el runner tolera gaps.
- **R-REL-8 — Higiene:** muchos docs untracked en el working tree; commitear ordenado por scope.

---

## 6. Recomendación ejecutiva

> **¿Cuál es la forma más segura de introducir ERP-A en Nexus sin afectar CRM, ARCA, Compras ni Producción?**

**ERP-A es de blast-radius casi nulo:** crea objetos **nuevos** (6 tablas, 6 enums `treasury_*`, triggers, policies, bucket `treasury`) y solo toca **aditivamente** dos objetos compartidos —el enum RBAC (`+tesoreria`) y `storage.objects` (policies acotadas al bucket `treasury`)—. **No hace `ALTER` sobre `customer_invoices`/`supplier_invoices`** (solo las referencia por FK), **no toca código** de CRM/ARCA/Compras, y su RLS no modifica políticas existentes. El riesgo funcional sobre los frentes vivos es **mínimo y contenido**.

**Camino recomendado (secuencia segura):**
1. **Reconciliar `main` ↔ `origin/main`** (resolver la divergencia) — prerrequisito de higiene.
2. **Mergear CRM ("cerrado y validado") → main** (Opción B1). Si no es posible ahora, usar B2 (base = tip CRM) y planificar rebase.
3. Crear **`feature/erp-a-tesoreria`** (integradora) desde ese baseline, y **`erp-a/a1-schema`** debajo.
4. Commits **C1 (0052)**, **C2 (0053)**, **C3 (docs)** — solo archivos de tesorería, separados.
5. PR `erp-a/a1-schema` → integradora (**G1**).
6. Aplicar a **staging** (`vrxosunxlhohmqymxots`) por el deploy plan: **0052 aislada → 0053 tx** (**G2/G3**), backup previo.
7. **Validación** §4–§6 (estructural + funcional + adversarial); **GO firmado** (**G4**).
8. PR integradora → **main** en el hito desplegable (**G5**), un solo PR limpio.
9. **Producción** (otro `project-ref`): backup + ventana + sign-off; **0052 aislada → 0053** (**G6**).

**Garantías de no-contaminación:**
- Todo commit de ERP-A es **tesoreria-only** (verificable por `git show --stat`).
- Rollback de DB **siempre por teardown/backup**, nunca asumido por `git revert` (enum irreversible).
- Staging **siempre** antes de producción, con gate firmado.
- CRM, ARCA y Compras **nunca** aparecen en el diff ni en la lógica de ERP-A.

**En una línea:** mergear/estabilizar el baseline (main+CRM), aislar ERP-A en una rama integradora con fases, validar en staging con gates firmados, y promover a producción forward-only con backup — manteniendo cada commit estrictamente de tesorería.

---

*Fin — Estrategia de Branching y Release ERP-A1. No se crearon ramas, no se commiteó, no se movieron archivos, no se aplicó nada. Frente ERP-A detenido a la espera de autorización.*
