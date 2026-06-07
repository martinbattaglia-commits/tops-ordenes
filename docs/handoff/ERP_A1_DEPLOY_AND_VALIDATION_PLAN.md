# ERP-A1 · PLAN DE DESPLIEGUE Y VALIDACIÓN

**Proyecto:** TOPS Nexus — Logística TOPS (Verotin S.A.)
**Presidente:** Martín Battaglia
**Documento:** `ERP_A1_DEPLOY_AND_VALIDATION_PLAN.md`
**Cubre:** aplicación segura de `0052_treasury_permission_module.sql` → `0053_treasury_core.sql`.
**Naturaleza:** plan formal. **No se aplica ni ejecuta nada.** Las queries son **referencia de verificación**, no un script ejecutable (ese artefacto se produce en un paso posterior autorizado).

> **Regla de oro:** primero **staging** (`tops-nexus-staging`, ref `vrxosunxlhohmqymxots`), validación completa GO, recién después **producción**. `0052` y `0053` **nunca** en la misma transacción.

---

## 0. Contexto verificado del entorno

| Ítem | Estado actual | Implicancia |
|---|---|---|
| Rama | `feature/crm-comercial-f2-1` | Las migraciones están **untracked** en una rama de CRM con cambios ajenos. **Mover a rama dedicada** antes de aplicar (Precondición P1). |
| Archivos A1 | `0052` y `0053` untracked (`??`) | No commiteados (correcto por ahora). |
| Working tree | Modificados ajenos (`comercial/contactos`, `clientify/client.ts`) + docs untracked | No mezclar en el commit de tesorería. |
| Supabase linkeado | `vrxosunxlhohmqymxots` = **staging** | Aplicar acá primero. Producción = otro `--project-ref`. |
| Backup | Sistema Google Drive (pg_dump) + `DISASTER_RECOVERY_PLAN.md` | Snapshot previo obligatorio (Precondición P3). |

---

## 1. Precondiciones (verificar ANTES de aplicar)

**P1 — Rama.**
- Crear rama dedicada desde `main` actualizado: `feature/erp-a-tesoreria` (no aplicar desde la rama de CRM).
- Mover **solo** `0052`, `0053` y los `docs/handoff/ERP_A_*`/`ERP_A1_*` a esa rama. No arrastrar los cambios de `clientify`/`contactos`.

**P2 — Working tree.**
- `git status` limpio salvo los archivos de tesorería. Sin cambios ajenos en el commit.
- Confirmar que `0052`/`0053` son los auditados (hash/última edición coincide con `ERP_A1_REWRITE_AUDIT.md`).

**P3 — Backup.**
- Backup lógico **fresco** del target ANTES de aplicar: `pg_dump` completo (esquema+datos) verificado *restaurable* (no solo generado). Referencia: `DISASTER_RECOVERY_PLAN.md`.
- Confirmar punto de restauración / PITR disponible en el proyecto Supabase.

**P4 — Entorno.**
- Confirmar a qué proyecto apunta el link (`supabase/.temp/project-ref`). Para staging debe ser `vrxosunxlhohmqymxots`.
- Variables de entorno del runner/CLI apuntando al proyecto correcto. **Nunca** ejecutar con credenciales de producción durante la fase de staging.

**P5 — Migraciones previas presentes en el target.** Verificar que existen (de lo contrario `0053` falla por dependencias):
```sql
-- referencia de verificación
select exists(select 1 from pg_type where typname='permission_module_t') as rbac_enum,            -- 0009
       to_regclass('public.clients')            is not null as clients,                            -- 0001
       to_regclass('public.vendors')            is not null as vendors,                            -- 0008
       to_regclass('public.customer_invoices')  is not null as customer_invoices,                  -- 0011
       to_regclass('public.supplier_invoices')  is not null as supplier_invoices,                  -- 0014
       (select count(*) from public.roles where slug in ('director_ops','admin','operaciones','compliance')) as roles_ok,  -- 0009 seed
       exists(select 1 from pg_proc where proname='current_role')   as current_role_fn,            -- 0001/0005
       exists(select 1 from pg_proc where proname='touch_updated_at') as touch_fn;                 -- 0009
-- esperado: todo true / clients=true / roles_ok=4
```

**P6 — No aplicado parcialmente.** Confirmar que A1 no está medio-aplicado (idempotencia segura, pero evita falsos positivos):
```sql
select to_regclass('public.treasury_movements') as already_tm,        -- debe ser null
       exists(select 1 from pg_enum e join pg_type t on t.oid=e.enumtypid
              where t.typname='permission_module_t' and e.enumlabel='tesoreria') as tesoreria_enum;  -- debe ser false
```

**P7 — Privilegios de storage (R8).**
- Confirmar que el rol con el que se aplica puede crear policies sobre `storage.objects` (modelado sobre `0015`, que **nunca se aplicó** → sin precedente probado). Si no, el bloque 10 de `0053` se aplica **por separado** vía Dashboard. Ver §3 (rollback storage).

**P8 — Ventana.** Producción: ventana de baja actividad; aviso a stakeholders; nadie operando tesorería (no hay usuarios aún → bajo riesgo, pero formalizar).

---

## 2. Orden exacto de ejecución (paso por paso)

> Cada migración en **su propia transacción**. `0052` debe **committearse** antes de `0053` (regla de enums de Postgres).

| Paso | Acción | Verificación inmediata |
|---|---|---|
| **S0** | Backup lógico del target (P3) y confirmar restaurable. | Archivo de dump + prueba de restore en sandbox. |
| **S1** | Aplicar **`0052`** en transacción aislada y **COMMIT**. (CLI: `supabase db push` corre cada archivo en su propia tx; SQL Editor: pegar SOLO 0052.) | `tesoreria_enum = true` (query P6). |
| **S2** | Recargar esquema PostgREST (`notify pgrst` ya está en 0052) / esperar reload. | — |
| **S3** | Aplicar **`0053`** envuelta en `begin; … commit;` (todo-o-nada). Si el bloque storage falla por privilegios (P7), abortar la tx y pasar a S3b. | Sin error; tx commit. |
| **S3b** | *(Solo si S3 falló por storage)* Reaplicar `0053` **sin** el bloque §10 (storage), y crear el bucket+policies `treasury` por Dashboard manualmente. | Bucket `treasury` privado existe. |
| **S4** | Ejecutar **checklist estructural** (§4). | 100% verde. |
| **S5** | Ejecutar **pruebas funcionales** (§5). | 100% verde. |
| **S6** | Ejecutar **pruebas adversariales** (§6). | Todos los bloqueos sostienen. |
| **S7** | Veredicto GO/NO-GO staging (§7). Si GO → repetir S0–S6 en **producción**. | — |

**Notas de aplicación:**
- En SQL Editor, **no** pegar `0052`+`0053` juntos (la creación-y-uso del enum `tesoreria` en una sola tx falla con *"unsafe use of new value of enum type"*).
- `0053` es idempotente (`create … if not exists`, `do $$ … exception`, `on conflict`), pero la corrida **canónica** es transaccional una sola vez sobre un esquema sin A1.

---

## 3. Plan de rollback

> Filosofía: `0053` se aplica **transaccional** ⇒ un fallo hace `rollback` automático y deja el esquema **limpio**. El rollback manual abajo es para fallas fuera de tx o aplicación parcial vía SQL Editor.

**Si falla `0052`:**
- `alter type … add value if not exists` es atómico: o se aplicó o no. Si falló, **no quedó estado** → corregir causa y reintentar (idempotente).
- ⚠️ Si `0052` **tuvo éxito** y luego se decide abortar TODO A1: el valor de enum **no se puede quitar** sin recrear `permission_module_t` (recast de `permissions.module` y dependencias). Procedimiento documentado pero **costoso** → preferir roll-forward. El valor `tesoreria` huérfano es inocuo (sin permisos que lo usen si no se aplicó `0053`).

**Si falla `0053` (dentro de tx):** `rollback` ⇒ nada creado. Reintentar tras corregir.

**Si falla `0053` aplicada por partes (SQL Editor) — teardown manual (referencia, orden inverso):**
```sql
-- 1) policies storage
drop policy if exists "treasury read internal"   on storage.objects;
drop policy if exists "treasury write internal"  on storage.objects;
drop policy if exists "treasury update internal" on storage.objects;
delete from storage.buckets where id='treasury';
-- 2) seeds RBAC + permisos tesoreria
delete from public.role_permissions rp using public.permissions p
  where rp.permission_id=p.id and p.module='tesoreria';
delete from public.permissions where module='tesoreria';
-- 3) seed cuentas (solo si se desea revertir)
delete from public.bank_accounts where bank_name in ('Caja','Banco Santander','Banco Galicia');
-- 4) tablas (drop cascade baja triggers, policies e índices propios)
drop table if exists public.payment_allocations cascade;
drop table if exists public.receipt_allocations cascade;
drop table if exists public.supplier_payments  cascade;
drop table if exists public.customer_receipts   cascade;
drop table if exists public.treasury_movements  cascade;
drop table if exists public.bank_accounts       cascade;
-- 5) funciones de trigger
drop function if exists public.tg_lock_treasury_movement, public.tg_lock_customer_receipt,
  public.tg_lock_supplier_payment, public.tg_forbid_delete_financial, public.guard_allocation_insert,
  public.tg_forbid_update_allocation, public.tg_protect_system_bank_account, public.tg_lock_bank_account_basis,
  public.guard_treasury_movement_insert, public.set_treasury_movement_public_id,
  public.set_customer_receipt_public_id, public.set_supplier_payment_public_id;
-- 6) sequences
drop sequence if exists public.treasury_movement_short_id_seq, public.customer_receipt_short_id_seq,
  public.supplier_payment_short_id_seq;
-- 7) enums treasury_* (NO tocar permission_module_t)
drop type if exists public.treasury_movement_type_t, public.treasury_direction_t, public.treasury_status_t,
  public.treasury_receipt_method_t, public.treasury_payment_method_t, public.treasury_doc_status_t;
```

**Falla RLS:** policies son idempotentes (`drop … create`). Reaplicar el bloque §9. Si una policy referencia `current_role()` inexistente → falta `0005` (corregir P5).

**Falla RBAC:** seeds `on conflict do nothing`. Si error por `module='tesoreria'` inválido → `0052` no se aplicó/committeó primero (corregir orden S1).

**Falla storage (R8):** ver S3b — aplicar `0053` sin §10 y crear bucket/policies por Dashboard. No bloquea el resto del dominio.

**Falla seed cuentas:** `on conflict (bank_name, account_name) do nothing` ⇒ idempotente. Si choca por constraint distinto → revisar que `unique(bank_name, account_name)` exista.

**Restauración total:** si algo grave, restaurar desde el backup S0 (DISASTER_RECOVERY_PLAN). En staging el costo es nulo.

---

## 4. Checklist de validación estructural (referencia)

> Ejecutar tras S3. Todo debe dar el valor esperado.

**4.1 Enums (6 treasury_* + tesoreria en RBAC):**
```sql
select typname, (select count(*) from pg_enum e where e.enumtypid=t.oid) n
from pg_type t where typname like 'treasury_%_t' order by 1;
-- esperado: treasury_direction_t(2), treasury_doc_status_t(2), treasury_movement_type_t(4),
--           treasury_payment_method_t(3), treasury_receipt_method_t(4), treasury_status_t(3)
select exists(select 1 from pg_enum e join pg_type t on t.oid=e.enumtypid
  where t.typname='permission_module_t' and e.enumlabel='tesoreria');  -- true
```

**4.2 Tablas (6):**
```sql
select count(*) from information_schema.tables where table_schema='public'
 and table_name in ('bank_accounts','treasury_movements','customer_receipts',
   'supplier_payments','receipt_allocations','payment_allocations');  -- 6
```

**4.3 Columnas críticas:**
```sql
-- numeric(15,2) lado ventas; bank_account_id NOT NULL en receipts; net_amount generated
select table_name, column_name, data_type, numeric_precision, numeric_scale, is_nullable, is_generated
from information_schema.columns
where table_schema='public' and (
  (table_name='customer_receipts' and column_name in ('gross_amount','retention_amount','net_amount','bank_account_id'))
  or (table_name='treasury_movements' and column_name='amount')
  or (table_name='receipt_allocations' and column_name='amount'))
order by 1,2;
-- esperado: precision=15 scale=2; receipts.bank_account_id is_nullable=NO; net_amount is_generated=ALWAYS
```

**4.4 Índices:** ≥ los definidos (bank, status, date, ref, transfer, type; FK de allocations).
```sql
select tablename, count(*) from pg_indexes where schemaname='public'
 and tablename in ('treasury_movements','customer_receipts','supplier_payments',
   'receipt_allocations','payment_allocations','bank_accounts')
group by 1 order by 1;
```

**4.5 Triggers (19 esperados):**
```sql
select event_object_table, count(*) from information_schema.triggers
where trigger_schema='public' and event_object_table in
 ('bank_accounts','treasury_movements','customer_receipts','supplier_payments',
  'receipt_allocations','payment_allocations')
group by 1 order by 1;
-- esperado: bank_accounts=3, treasury_movements=4, customer_receipts=3,
--           supplier_payments=3, receipt_allocations=3, payment_allocations=3  (total 19)
```

**4.6 Funciones (12):**
```sql
select count(*) from pg_proc where proname in
 ('tg_lock_treasury_movement','tg_lock_customer_receipt','tg_lock_supplier_payment',
  'tg_forbid_delete_financial','guard_allocation_insert','tg_forbid_update_allocation',
  'tg_protect_system_bank_account','tg_lock_bank_account_basis','guard_treasury_movement_insert',
  'set_treasury_movement_public_id','set_customer_receipt_public_id','set_supplier_payment_public_id');  -- 12
```

**4.7 Policies (18 en tablas + 3 storage):**
```sql
select tablename, count(*) from pg_policies where schemaname='public'
 and tablename in ('bank_accounts','treasury_movements','customer_receipts',
   'supplier_payments','receipt_allocations','payment_allocations')
group by 1 order by 1;
-- esperado: bank_accounts=2, treasury_movements=3, customer_receipts=3,
--           supplier_payments=3, receipt_allocations=2, payment_allocations=2 (total 18)
select count(*) from pg_policies where schemaname='storage' and tablename='objects'
 and policyname like 'treasury %';  -- 3
```

**4.8 CHECK constraints clave:**
```sql
select conname from pg_constraint where conname in
 ('treasury_movements_type_direction_ck','treasury_movements_reference_type_ck',
  'customer_receipts_retention_le_gross');  -- 3 filas
```

**4.9 Bucket treasury:**
```sql
select id, public from storage.buckets where id='treasury';  -- public=false
```

**4.10 Seed cuentas (CAJA + Santander + Galicia):**
```sql
select bank_name, account_name, account_type, is_system, opening_balance
from public.bank_accounts order by is_system desc, bank_name;
-- esperado: Caja(account_type=caja,is_system=true,0), Banco Galicia(cuenta_corriente,false,0),
--           Banco Santander(cuenta_corriente,false,0)
```

**4.11 RBAC seed:**
```sql
select p.slug, array_agg(r.slug order by r.slug) roles
from public.permissions p
join public.role_permissions rp on rp.permission_id=p.id
join public.roles r on r.id=rp.role_id
where p.module='tesoreria' group by p.slug order by p.slug;
-- esperado: view→{admin,compliance,director_ops,operaciones}; create/edit/admin→{admin,director_ops};
--           export→{admin,compliance,director_ops}
```

---

## 5. Pruebas funcionales (referencia)

> Requieren un usuario admin de prueba y simular contexto de RPC (`set_config('treasury.via_rpc','on',true)`).

| # | Caso | Acción | Resultado esperado |
|---|---|---|---|
| F1 | Alta `ajuste` directa (admin) | INSERT movimiento `type='ajuste',direction='ingreso',amount=100,bank=CAJA,status='confirmado'` | ✅ OK (ajuste admite alta directa) |
| F2 | Append-only UPDATE | `UPDATE … set amount=200` sobre el confirmado de F1 | ❌ `TREASURY_CONFIRMED_IMMUTABLE` |
| F3 | Void válido | `UPDATE … set status='anulado', voided_at=now(), voided_by=<uid>, void_reason='test'` | ✅ OK |
| F4 | Append-only DELETE | `DELETE` del movimiento | ❌ `TREASURY_APPEND_ONLY` |
| F5 | Allocation vía RPC | `set treasury.via_rpc='on'` + INSERT receipt + receipt_allocation | ✅ OK |
| F6 | Allocation directa | INSERT en `receipt_allocations` SIN via_rpc | ❌ `ALLOCATION_DIRECT_INSERT_FORBIDDEN` |
| F7 | Allocation UPDATE | `UPDATE receipt_allocations …` | ❌ `ALLOCATION_IMMUTABLE` |
| F8 | Protección CAJA delete | `DELETE bank_accounts where is_system` | ❌ `BANK_ACCOUNT_SYSTEM_PROTECTED` |
| F9 | R11 base inmutable | crear movimiento en Santander, luego `UPDATE bank_accounts set opening_balance=999` | ❌ `BANK_ACCOUNT_BASIS_LOCKED` |
| F10 | RLS write no-admin | como `operaciones`: INSERT movimiento `ajuste` | ❌ denegado por RLS |
| F11 | RLS read interno | como `operaciones`: SELECT treasury_movements | ✅ OK |
| F12 | RLS read cliente | como `cliente`: SELECT treasury_movements | ❌ 0 filas / denegado |
| F13 | RBAC | `select has_permission('tesoreria.create')` admin vs operaciones | admin=true, operaciones=false |

---

## 6. Pruebas adversariales (referencia — re-romper el diseño)

| # | Intento de romper | Resultado esperado |
|---|---|---|
| A1 | Editar `amount` de movimiento confirmado (admin/SQL) | ❌ bloqueado (lock trigger) |
| A2 | Mismo intento como **service-role** | ❌ bloqueado (los triggers se disparan igual) |
| A3 | Anular sin `voided_*` | ❌ `…_VOID_REQUIRES_AUDIT` |
| A4 | Half-void (`voided_*` con `status='confirmado'`) | ❌ única transición confirmado→anulado |
| A5 | Editar registro ya `anulado` | ❌ inmutable |
| A6 | Allocation directa que baje el saldo de una factura sin cobro | ❌ guard via_rpc |
| A7 | Insertar `cobranza` manual (sin RPC) | ❌ `TREASURY_DIRECT_INSERT_FORBIDDEN` |
| A8 | `cobranza` con `direction='egreso'` | ❌ `type_direction_ck` |
| A9 | `pago_proveedor` con `direction='ingreso'` | ❌ `type_direction_ck` |
| A10 | Borrar movimiento/recibo/pago/allocation | ❌ `TREASURY_APPEND_ONLY` |
| A11 | Borrar CAJA | ❌ protegida |
| A12 | Re-basar saldo: `opening_balance` con movimientos | ❌ `BANK_ACCOUNT_BASIS_LOCKED` |
| A13 | `cliente` leyendo finanzas | ❌ denegado |
| A14 | **Bypass conocido:** `set treasury.via_rpc='on'` y luego insertar `cobranza`/allocation a mano | ⚠️ **PASA (esperado)** — defensa-en-profundidad, no frontera. Documentado. Mitigación: acceso SQL/service-role = confianza total; toda escritura real va por RPC `0054`. |

> A14 **no es un fallo**: es el límite conocido del guard GUC. Si PASA → comportamiento esperado. Si A1–A13 PASAN → **NO-GO**.

---

## 7. Criterio GO / NO-GO

**GO (todas deben cumplirse):**
1. `0052` aplicada y committeada **aislada**; `tesoreria` en el enum.
2. `0053` aplicada limpia (transaccional) o vía S3b documentado.
3. **§4 estructural:** 6 enums, 6 tablas, columnas `numeric(15,2)`/NOT NULL/generated correctas, 19 triggers, 12 funciones, 18+3 policies, 3 CHECK, bucket `treasury` privado, 3 cuentas (CAJA `is_system`, Santander, Galicia, todas `opening_balance=0`), RBAC seed correcto.
4. **§5 funcional:** F1–F13 con el resultado esperado (append-only, void, allocations, CAJA, R11, RLS, RBAC).
5. **§6 adversarial:** A1–A13 **bloqueados**; A14 pasa (esperado/documentado).
6. Backup S0 verificado restaurable.
7. Ejecutado y verde en **staging** antes de producción.

**NO-GO (cualquiera lo dispara):**
- Alguna prueba A1–A13 **no** bloquea (append-only/allocations/CAJA/RLS/R11 vulnerados).
- `cliente` puede leer finanzas (A13 pasa).
- Escritura directa por rol ≠ admin (F10 pasa).
- Falta cualquier objeto estructural de §4.
- Storage falló y no se resolvió por S3b.
- Seed de cuentas/RBAC incompleto.
- Backup no restaurable.

**Política:** NO-GO ⇒ rollback (§3) + corrección + re-corrida completa en staging. Producción **solo** tras GO de staging firmado.

---

## Anexo — Resumen de la secuencia

```
P1–P8 precondiciones ─► S0 backup ─► S1 aplicar 0052 (aislada, commit) ─► verificar enum
   ─► S2 reload ─► S3 aplicar 0053 (tx) [S3b storage si falla] ─► S4 estructural
   ─► S5 funcional ─► S6 adversarial ─► S7 GO/NO-GO staging ─► (GO) repetir en producción
```

---

*Fin — Plan de Despliegue y Validación ERP-A1. No se aplicó, ejecutó ni commiteó nada; no se escribió `0054`. El script de validación ejecutable se generará en un paso posterior, bajo autorización.*
