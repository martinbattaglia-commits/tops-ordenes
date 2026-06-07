# ERP-A1 · PLAN DE EJECUCIÓN DEFINITIVO

**Proyecto:** TOPS Nexus — Logística TOPS (Verotin S.A.)
**Presidente:** Martín Battaglia
**Documento:** `ERP_A1_EXECUTION_PLAN.md`
**Fuente de verdad / destino de aplicación:** **`arsksytgdnzukbmfgkju` (tops-ordenes-prod)** — producción oficial. Sin staging/sandbox.
**Naturaleza:** plan definitivo. **No se ejecuta, no se crea rama, no se commitea, no se aplica nada.**

> **Alcance estricto:** solo ERP-A1 (rama + commits `0052/0053/docs` + aplicación de `0052/0053` a producción). **NO** `0054`, backend, server actions, UI, dashboards, automatismos. **NO** A2/A3/A4/A5.

---

## 0. Estado verificado + drift detectado

| Ítem | Valor |
|---|---|
| MAIN CANÓNICO declarado (readiness) | `019bb02` |
| **MAIN CANÓNICO actual** (`main`==`origin/main`) | **`710ae33`** |
| Delta `019bb02..710ae33` | **1 commit:** `710ae33 fix(tracking): provider acepta Traccar Client v9 (JSON) + legacy OsmAnd` (toca solo `src/lib/tracking/provider/traccar.ts`) |
| ¿`019bb02` ancestro de `710ae33`? | **SÍ** — avance lineal, historia **no** reescrita |
| ¿Migraciones cambiaron? | **No** — última sigue `0051`; `0052/0053` no están en main |
| Dependencias ERP-A | **idénticas** (el commit de tracking no toca migraciones ni objetos de `0053`) |

> ⚠️ **DRIFT BENIGNO:** el canónico avanzó un commit de tracking **no relacionado** con ERP-A. **No afecta dependencias.** **Recomendación:** ramificar ERP-A desde el **tip actual `710ae33`** (no desde `019bb02`), para no forkear atrasado. Ver §1.

**Producción (`arsksytgdnzukbmfgkju`) — estado pre-ejecución (verificado read-only):**
`bank_accounts` → 404 · `treasury_movements` → 404 (clean slate) · enum `'tesoreria'` → **ausente** (`22P02`) · `supplier_invoices` → 200 (dep. de `0053` presente). ⇒ **listo para aplicar.**

---

## 1. Creación de rama

| | Acción | Verificación | Esperado |
|---|---|---|---|
| 1.1 | `git fetch origin --prune` | `git rev-parse origin/main` | `710ae33` |
| 1.2 | `git tag safety/pre-erp-a1-$(git rev-parse --short main) main` | `git tag \| grep pre-erp-a1` | tag creado |
| 1.3 | **`git switch -c feature/erp-a-tesoreria main`** | `git rev-parse --abbrev-ref HEAD` | `feature/erp-a-tesoreria` desde `710ae33` |

> **Decisión de punto de rama:** se ramifica desde **`710ae33`** (tip canónico actual), que es descendiente lineal de `019bb02` + el fix de tracking. Branchear desde `019bb02` también funcionaría (deps idénticas) pero dejaría ERP-A atrasado un commit y forzaría un merge/rebase posterior. **Recomendado: `710ae33`.**
> Working tree: mantener `git add` **dirigido**; los demás artefactos untracked **no** se incorporan salvo en C3.

---

## 2. Secuencia exacta de commits

> Convención `tipo(scope): desc`. Cada commit con `git add` **explícito por archivo** (nunca `.`/`-A`).

| Commit | Comando de staging | Mensaje | Contenido |
|---|---|---|---|
| **C1** | `git add supabase/migrations/0052_treasury_permission_module.sql` | `feat(erp-a): 0052 treasury permission module — enum 'tesoreria' (aislada)` | **solo** `0052` |
| **C2** | `git add supabase/migrations/0053_treasury_core.sql` | `feat(erp-a): 0053 treasury core — C1–C8 + R11 (append-only, allocations, CAJA, RLS, CHECKs)` | **solo** `0053` |
| **C3** | `git add docs/handoff/ERP_A*.md docs/handoff/ERP_A1_*.md docs/handoff/NEXUS_BASELINE_INTEGRATION_AUDIT.md docs/handoff/MAIN_RECONCILIATION*.md docs/handoff/MAIN_CANONICAL_*.md` | `docs(erp-a): dossier ERP-A (diseño, auditorías, despliegue, baseline, runbook)` | **solo** docs ERP-A/canónico |

**Verificación por commit:** `git show --stat <commit>` debe listar **únicamente** el/los archivo(s) previstos. Si aparece cualquier otro (CRM, ARCA, compras, tracking) → **deshacer el staging** y rehacer dirigido.

> `0052` y `0053` en **commits separados** (paridad con la aplicación aislada + revert quirúrgico).
> Push de la rama (`git push -u origin feature/erp-a-tesoreria`) es opcional en A1; **no** se mergea a main en esta fase.

---

## 3. Procedimiento exacto para aplicar `0052` (PRODUCCIÓN, manual)

> **Destino:** Supabase Dashboard → proyecto **`tops-ordenes-prod` (`arsksytgdnzukbmfgkju`)** → **SQL Editor**. **Nunca** `supabase db push` (la tabla `schema_migrations` está vacía; `db push` reaplicaría 0001–0051 y fallaría).

| Paso | Acción | Verificación | Esperado |
|---|---|---|---|
| 3.0 | **Backup de producción** (dump fresco restaurable; o disparar el workflow de backup Drive y confirmar éxito) | `pg_restore --list` del dump | backup OK **antes** de tocar prod |
| 3.1 | Abrir SQL Editor del proyecto **arsks** (confirmar el ref en la URL del dashboard) | barra del proyecto = `tops-ordenes-prod` | proyecto correcto |
| 3.2 | Pegar el **contenido completo de `0052`** (solo `alter type … add value … 'tesoreria'` + `notify pgrst`) | — | — |
| 3.3 | **Run** | sin error | `ALTER TYPE` OK |
| 3.4 | **CONFIRMAR el enum** (transacción committeada) | `select 1 from pg_enum e join pg_type t on t.oid=e.enumtypid where t.typname='permission_module_t' and e.enumlabel='tesoreria';` | **1 fila** (valor presente) |

> **CRÍTICO:** `0052` se ejecuta y **confirma SOLO** (su propia ejecución en el SQL Editor = su propia transacción committeada). **No** pegar `0053` en el mismo run. Recién con el enum confirmado se pasa a §4 (regla Postgres: "unsafe use of new value of enum").

---

## 4. Procedimiento exacto para aplicar `0053` (PRODUCCIÓN, manual)

| Paso | Acción | Verificación | Esperado |
|---|---|---|---|
| 4.1 | En el **mismo** SQL Editor (proyecto arsks), **nuevo run**, pegar el **contenido completo de `0053`** | — | — |
| 4.2 | (Recomendado) envolver en `begin; … commit;` para atomicidad total | — | todo-o-nada |
| 4.3 | **Run** | sin error | enums/tablas/triggers/RLS/seed/RBAC creados |
| 4.4 | Si el bloque **storage** falla por privilegios | aplicar el resto OK; crear bucket `treasury` + policies por Dashboard (Storage) | bucket privado `treasury` existe |
| 4.5 | Ejecutar **Validaciones §5** | todas verdes | — |

> `0053` **después** de `0052` confirmado. **Nunca juntas. Nunca `db push`.**

---

## 5. Validaciones posteriores (en prod arsks)

> Ejecutar en SQL Editor (SQL) y/o confirmar por REST read-only.

**5.1 Enums (6):**
```sql
select typname from pg_type where typname like 'treasury_%_t' order by 1;
-- esperado: treasury_direction_t, treasury_doc_status_t, treasury_movement_type_t,
--           treasury_payment_method_t, treasury_receipt_method_t, treasury_status_t
```
**5.2 Tablas (6):**
```sql
select table_name from information_schema.tables where table_schema='public'
 and table_name in ('bank_accounts','treasury_movements','customer_receipts',
   'supplier_payments','receipt_allocations','payment_allocations') order by 1;  -- 6 filas
```
**5.3 Triggers (19):**
```sql
select event_object_table, count(*) from information_schema.triggers
 where trigger_schema='public' and event_object_table in
 ('bank_accounts','treasury_movements','customer_receipts','supplier_payments',
  'receipt_allocations','payment_allocations') group by 1 order by 1;
-- bank_accounts=3, treasury_movements=4, customer_receipts=3, supplier_payments=3,
-- receipt_allocations=3, payment_allocations=3  (total 19)
```
**5.4 RLS (policies 18 + storage 3):**
```sql
select tablename, count(*) from pg_policies where schemaname='public'
 and tablename like '%treasur%' or tablename in
 ('bank_accounts','customer_receipts','supplier_payments','receipt_allocations','payment_allocations')
 group by 1;   -- write=admin / read=internos
select count(*) from pg_policies where schemaname='storage' and policyname like 'treasury %';  -- 3
```
**5.5 RBAC (módulo tesoreria):**
```sql
select p.slug, array_agg(r.slug order by r.slug)
from public.permissions p join public.role_permissions rp on rp.permission_id=p.id
join public.roles r on r.id=rp.role_id
where p.module='tesoreria' group by p.slug order by p.slug;
-- view→{admin,compliance,director_ops,operaciones}; create/edit/admin→{admin,director_ops};
-- export→{admin,compliance,director_ops}
```
**5.6 Bucket `treasury`:**
```sql
select id, public from storage.buckets where id='treasury';   -- public=false
```
**5.7 Cuentas semilla — CAJA / Santander / Galicia:**
```sql
select bank_name, account_name, account_type, is_system, opening_balance
from public.bank_accounts order by is_system desc, bank_name;
-- Caja(account_type=caja, is_system=true, 0) · Banco Galicia(cuenta_corriente,false,0) ·
-- Banco Santander(cuenta_corriente,false,0)
```
**5.8 Equivalente REST (read-only, confirmación externa):**
`bank_accounts`→200 · `treasury_movements`→200 · `receipt_allocations`→200 · `permissions?module=eq.tesoreria`→5 filas · `bank_accounts?select=bank_name,is_system`→3 filas (Caja/Santander/Galicia).

**Criterio §5:** 6 enums · 6 tablas · 19 triggers · 18+3 policies · 5 permisos tesoreria · bucket privado · 3 cuentas (CAJA `is_system`, Santander, Galicia, `opening_balance=0`).

---

## 6. Rollback operativo

> **Principio:** git ≠ DB. Revertir el commit **no** deshace la aplicación. Rollback de DB = teardown SQL manual y/o restore del backup 3.0.

**`0052` (enum) — IRREVERSIBLE:**
- `alter type … add value` **no se puede deshacer**. Si se aborta ERP-A1 tras aplicar `0052`: el valor `'tesoreria'` queda **huérfano e inocuo** (sin permisos que lo usen si no se aplicó `0053`). **Forward-only.**
- Quitarlo de verdad exige recrear `permission_module_t` + recast de `permissions.module` (costoso, solo en ventana mayor). **No recomendado.**

**`0053` — teardown manual (orden inverso), si falla o se revierte:**
```sql
-- storage
drop policy if exists "treasury read internal"  on storage.objects;
drop policy if exists "treasury write internal" on storage.objects;
drop policy if exists "treasury update internal" on storage.objects;
delete from storage.buckets where id='treasury';
-- RBAC tesoreria
delete from public.role_permissions rp using public.permissions p
  where rp.permission_id=p.id and p.module='tesoreria';
delete from public.permissions where module='tesoreria';
-- seed cuentas
delete from public.bank_accounts where bank_name in ('Caja','Banco Santander','Banco Galicia');
-- tablas (cascade baja triggers/policies/índices)
drop table if exists public.payment_allocations, public.receipt_allocations,
  public.supplier_payments, public.customer_receipts, public.treasury_movements,
  public.bank_accounts cascade;
-- funciones
drop function if exists public.tg_lock_treasury_movement, public.tg_lock_customer_receipt,
  public.tg_lock_supplier_payment, public.tg_forbid_delete_financial, public.guard_allocation_insert,
  public.tg_forbid_update_allocation, public.tg_protect_system_bank_account,
  public.tg_lock_bank_account_basis, public.guard_treasury_movement_insert,
  public.set_treasury_movement_public_id, public.set_customer_receipt_public_id,
  public.set_supplier_payment_public_id;
-- sequences + enums treasury_* (NO tocar permission_module_t)
drop sequence if exists public.treasury_movement_short_id_seq,
  public.customer_receipt_short_id_seq, public.supplier_payment_short_id_seq;
drop type if exists public.treasury_movement_type_t, public.treasury_direction_t,
  public.treasury_status_t, public.treasury_receipt_method_t,
  public.treasury_payment_method_t, public.treasury_doc_status_t;
```
> Si `0053` se aplicó dentro de `begin/commit` y falló → rollback automático, esquema limpio. El teardown es para aplicación parcial o reversión deliberada.
> **Rollback git:** `git switch main` (intacto en `710ae33`); la rama `feature/erp-a-tesoreria` se descarta sin afectar main. Restore de prod desde backup 3.0 solo ante daño grave.

---

## 7. GO / NO-GO

> ## 🟢 ERP-A1 LISTO PARA EJECUCIÓN
>
> **Evidencia:**
> - **MAIN CANÓNICO** sano: `main==origin/main==710ae33`, descendiente lineal de `019bb02` (+1 commit de tracking irrelevante para ERP-A; migraciones intactas hasta `0051`).
> - **Producción `arsksytgdnzukbmfgkju`** (fuente de verdad): tesorería **ausente** (clean slate), enum `'tesoreria'` **ausente** (`22P02`), `supplier_invoices`/`cost_centers`/RBAC/`current_role` **presentes** → todas las dependencias de `0052/0053` satisfechas.
> - **`0052/0053`** íntegros (D1–D5, H1–H6, H12, R11) per `ERP_A_FINAL_READINESS_REPORT.md` (READY).
> - Plan de aplicación **manual aislado** (`0052`→confirmar→`0053`), backup previo, validaciones y rollback definidos.
>
> **Sin P0.** Condiciones operativas (P1) integradas al plan: backup prod previo (3.0), aplicación manual no-`db push`, `0052` aislado/confirmado antes de `0053`, `git add` dirigido.
>
> **Residual a tener presente:** no hay staging réplica para dry-run (staging drifteado sin `0014`); la mitigación es que `0052/0053` son **aditivos** (no `ALTER` sobre tablas existentes), están auditados GO, y se aplican con **backup previo** y opción transaccional.
>
> Pendiente: **autorización explícita** para EJECUTAR (este documento es solo el plan; no se creó rama, no se commiteó, no se aplicó nada).

---

## Anexo — Evidencia (read-only)

| Verificación | Resultado |
|---|---|
| `main`/`origin/main` | `710ae33` |
| `019bb02` ancestro de `710ae33` | SÍ (lineal) |
| Delta = 1 commit tracking | `traccar.ts` (no migraciones) |
| `0052/0053` en main | NO (untracked) |
| Prod tesorería | 404 (ausente) |
| Prod enum `'tesoreria'` | `22P02` (ausente) |
| Prod `supplier_invoices` | 200 (presente) |

---

*Fin — Plan de Ejecución Definitivo ERP-A1. Veredicto: LISTO PARA EJECUCIÓN. No se creó rama, no se commiteó, no se aplicó ninguna migración. Pendiente de autorización explícita para ejecutar.*
