# ERP-A1 · PLAN DE REESCRITURA DE 0053_treasury_core.sql

**Proyecto:** TOPS Nexus — Logística TOPS (Verotin S.A.)
**Presidente:** Martín Battaglia
**Documento:** `ERP_A1_REWRITE_PLAN.md`
**Decisión aprobada:** reescribir `0053` de origen (no `0053b`, no migración correctiva).
**Resuelve:** hallazgos H1–H6 de `ERP_A1_MIGRATION_AUDIT.md`.
**Naturaleza:** plan. **Todavía NO se modifica `0053`.** Sin código, sin migraciones nuevas, sin `0054`.
**Congelado e intocable:** D1, D2, D3, D4, D5.

> Los fragmentos SQL son **especificación** de lo que se cambiará, no la migración. `0053` se reescribe recién con tu autorización tras este plan.

---

## 1. Cambios exactos a realizar en 0053

### C1 (H1) — Append-only real: lock de UPDATE en registros confirmados
Agregar **3 triggers `before update`** (uno por tabla financiera: `treasury_movements`, `customer_receipts`, `supplier_payments`). Patrón = `tg_lock_authorized_invoice` (`0011:257-281`).

Regla:
- Fila `anulado` ⇒ **inmutable** (cualquier UPDATE se rechaza).
- Fila `confirmado` ⇒ única transición permitida: `→ anulado`, y **obliga** `voided_at`, `voided_by`, `void_reason` no nulos; **ninguna** columna financiera puede cambiar.
- Cualquier otro cambio ⇒ `raise exception`.

Especificación (ejemplo `treasury_movements`):
```sql
create or replace function public.tg_lock_treasury_movement()
returns trigger language plpgsql as $$
begin
  if old.status = 'anulado' then
    raise exception 'TREASURY_IMMUTABLE: movimiento anulado es inmutable' using errcode='check_violation';
  end if;
  if old.status = 'confirmado' then
    if new.status = 'anulado' then
      if new.voided_at is null or new.voided_by is null
         or new.void_reason is null or btrim(new.void_reason) = '' then
        raise exception 'TREASURY_VOID_REQUIRES_AUDIT: voided_at/by/reason obligatorios' using errcode='check_violation';
      end if;
      if (new.amount, new.direction, new.type, new.bank_account_id, new.date,
          new.reference_type, new.reference_id, new.transfer_group_id, new.public_id)
         is distinct from
         (old.amount, old.direction, old.type, old.bank_account_id, old.date,
          old.reference_type, old.reference_id, old.transfer_group_id, old.public_id) then
        raise exception 'TREASURY_NO_FINANCIAL_EDIT_ON_VOID: no se pueden alterar datos al anular' using errcode='check_violation';
      end if;
    else
      raise exception 'TREASURY_CONFIRMED_IMMUTABLE: solo se permite confirmado→anulado' using errcode='check_violation';
    end if;
  end if;
  return new;
end; $$;
```
Equivalente para `customer_receipts` (bloquea cambios a `gross_amount, retention_amount, client_id, payment_method, bank_account_id, payment_date`) y `supplier_payments` (`amount, vendor_id, payment_method, bank_account_id, payment_date, operation_number`).

### C2 (H1+H2) — Append-only hard: bloqueo de DELETE por trigger
Las policies ausentes solo frenan PostgREST; **service-role borra**. Agregar **5 triggers `before delete`** que **siempre rechazan** (sobre `treasury_movements`, `customer_receipts`, `supplier_payments`, `receipt_allocations`, `payment_allocations`). El modelo de void nunca borra: el DELETE no tiene caso de uso legítimo.
```sql
create or replace function public.tg_forbid_delete_financial()
returns trigger language plpgsql as $$
begin
  raise exception 'TREASURY_APPEND_ONLY: prohibido eliminar registros financieros (usar anulación)' using errcode='check_violation';
end; $$;
```
*(Solo superusuario con triggers deshabilitados o TRUNCATE puede saltarlo — residual documentado.)*

### C3 (H2) — Allocations: solo nacen de RPC y son inmutables
- **INSERT:** extender el guard `treasury.via_rpc` (filosofía F6) a `receipt_allocations` y `payment_allocations` — **sin** excepción de tipo (toda allocation exige RPC).
- **UPDATE:** trigger `before update` que **siempre rechaza** (allocation inmutable).
- **DELETE:** cubierto por C2.
- **FK:** cambiar `receipt_allocations.receipt_id` y `payment_allocations.payment_id` de `on delete cascade` → **`on delete restrict`** (refuerza append-only: no se puede borrar el padre teniendo allocations).
```sql
create or replace function public.guard_allocation_insert()
returns trigger language plpgsql as $$
begin
  if coalesce(current_setting('treasury.via_rpc', true),'off') <> 'on' then
    raise exception 'ALLOCATION_DIRECT_INSERT_FORBIDDEN: allocations solo vía RPC de tesorería' using errcode='check_violation';
  end if;
  return new;
end; $$;
```

### C4 (H3) — Circuito efectivo: cuenta CAJA (ver análisis §1.1)
- Extender el CHECK de `account_type` para admitir `'caja'`.
- Agregar `is_system boolean not null default false` a `bank_accounts` (protege cuentas de sistema).
- **Sembrar** cuenta `('Caja','Caja Efectivo','caja','ARS', is_system=true)`.
- Hacer **`customer_receipts.bank_account_id` NOT NULL** (elimina el NULL semántico). El efectivo imputa a la cuenta CAJA.
- `treasury_movements.bank_account_id` permanece **NOT NULL** (sin cambios).
- Proteger CAJA de borrado/edición destructiva (vía `is_system` en la policy de write de `bank_accounts`).

### C5 (H4) — Alinear RLS con RBAC (RLS nunca otorga más que RBAC)
- **Escritura (INSERT/UPDATE)** en las 5 tablas financieras + `bank_accounts`: `current_role() = 'admin'` (Administración financiera). `operaciones`/`supervisor` pierden escritura directa (RBAC dice operaciones=solo view; supervisor no es rol granular).
- El control fino (director_ops, etc.) se ejerce en las **RPC** (`0054`) vía `has_permission('tesoreria.create' | '.edit' | '.admin')`. Las RPC son `security definer` → no dependen de la RLS de tabla.
- INSERT directo de movimientos queda: `type='ajuste'` **y** `current_role()='admin'` **y** (guard F6) — manual solo para Administración.

### C6 (H5) — Confidencialidad: cerrar lectura a roles internos
- **Lectura** en las 6 tablas: `current_role() in ('admin','operaciones','supervisor')`. **Excluye `cliente`** (y cualquier `cliente_b2b` futuro).
- Storage `treasury`: ya es interno (sin cambio).

### C7 (H6) — Coherencia type ↔ direction (CHECK de esquema)
Agregar a `treasury_movements`:
```sql
constraint treasury_movements_type_direction_ck check (
  (type = 'cobranza'       and direction = 'ingreso') or
  (type = 'pago_proveedor' and direction = 'egreso')  or
  (type = 'transferencia') or       -- par controlado por RPC (ambas direcciones válidas)
  (type = 'ajuste')                  -- explícito (ingreso o egreso)
)
```
**Bonus (H16, P3):** `check (reference_type in ('customer_receipt','supplier_payment','transfer','manual') or reference_type is null)`.

### C8 (opcional, H12 — tu decisión) — Precisión numérica
Unificar montos del lado ventas a `numeric(15,2)` (igual que `customer_invoices.total`) en `customer_receipts` (gross/retention/net), `receipt_allocations.amount` y `treasury_movements.amount`. **No es un D**; lo dejo como recomendación marcada, no incluida salvo que la apruebes.

---

### 1.1 Análisis de H3 — arquitectura del efectivo (decisión a confirmar)

| Opción | Descripción | Pros | Contras | Veredicto |
|---|---|---|---|---|
| **A — Cuenta CAJA** (recomendada) | El efectivo es una `bank_account` especial (`account_type='caja'`, `is_system=true`). | Modelo uniforme; `bank_account_id` siempre NOT NULL (sin NULL semántico); saldo de caja = otra balance derivada (D1 intacto); depósito de efectivo = transferencia CAJA→banco natural; vistas/queries sin casos especiales. | "Caja" vive en una tabla llamada `bank_accounts` (cosmético; se mitiga con `is_system`/`account_type='caja'`). | ✅ **Adoptar** |
| B — `bank_account_id` nullable + caja aparte | Movimientos de efectivo con banco NULL. | "Honesto" semánticamente. | NULL en todas las queries/vistas; transferencias caja↔banco incómodas; el freeze pidió **evitar NULL semánticos**. | ❌ Rechazada |
| C — Tabla `cash_movements` separada | Libro de caja independiente. | Separación conceptual. | Rompe fuente única de verdad (movimientos); duplica lógica; sobre-ingeniería para A. | ❌ Rechazada |

**Recomendación:** Opción A. Coincide con tu sugerencia y elimina la excepción/NULL. **Requiere tu confirmación** como parte de autorizar la reescritura.

---

## 2. Impacto de cada corrección

| Cambio | Impacto | ¿Toca D1–D5? | ¿Rompe algo existente? |
|---|---|---|---|
| C1 lock UPDATE | Registros confirmados inmutables salvo void auditado. Las RPC de void (`0054`) deben cumplir el trigger (setear `voided_*`, solo cambiar `status`). | No | No (tablas nuevas) |
| C2 forbid DELETE | Append-only hard, incluso ante service-role. | No | No |
| C3 allocations guard+inmutables+RESTRICT | Cuenta corriente (D5) solo se altera vía RPC. La RPC de void anula el **padre**, no borra allocations. | Refuerza D2/D5 | No |
| C4 CAJA | Efectivo operativo; `customer_receipts.bank_account_id` NOT NULL. Suma un registro semilla. | No (saldo CAJA derivado = D1) | No |
| C5 RLS=admin write | `operaciones`/`supervisor` pierden write directo; siguen operando vía RPC si tienen permiso granular. | No | Posible: si algún flujo asumía write directo de operaciones (no existe aún) |
| C6 read interno | `cliente` deja de ver finanzas. | No | No (sin portal cliente activo) |
| C7 type↔direction CK | Imposible cargar movimiento con signo incoherente. | No | No |
| C8 numeric 15,2 (opcional) | Evita overflow vs `customer_invoices`. | No | No |

**Dependencia hacia `0054`:** las RPC deberán (a) `set_config('treasury.via_rpc','on',true)` para insertar movimientos no-`ajuste` y allocations; (b) cumplir el trigger de void (C1); (c) imputar efectivo a CAJA (C4); (d) chequear `has_permission` (C5). Todo esto ya estaba previsto para A4; el plan solo lo formaliza.

---

## 3. Validación contra D1–D5 (congeladas)

| Decisión | ¿Se respeta? | Cómo |
|---|---|---|
| **D1** saldo derivado | ✅ | Ninguna corrección persiste saldo. CAJA es otra cuenta cuyo saldo se deriva igual. Lock/append-only solo afectan integridad, no la fórmula. |
| **D2** allocations N:M | ✅ | Se mantienen ambas tablas N:M; C3 las endurece (solo RPC, inmutables) sin cambiar la cardinalidad. |
| **D3** numeración | ✅ | Sin cambios a sequences/triggers de `public_id`. |
| **D4** retención simplificada | ✅ | Solo `retention_amount`; C7/C1 no agregan campos de retención. |
| **D5** cuenta corriente derivada | ✅ | Sigue derivada de facturas+allocations; C3 garantiza que nadie la corrompa por fuera de las RPC. |

**Conclusión:** las 6 correcciones son **aditivas a la integridad** y no alteran ninguna decisión congelada.

---

## 4. Validación contra F1–F6

| Hallazgo freeze | Antes (auditoría) | Después (plan) |
|---|---|---|
| **F1** concurrencia | ⏳ RPC (0054) | ⏳ sin cambio (lock por factura sigue en 0054); C3 evita además allocations espurias |
| **F2** retención CHECK | ✅ | ✅ (sin cambio; C8 opcional mejora precisión) |
| **F3** append-only | ⚠️ parcial (solo DELETE policy) | ✅ **completo**: C1 (UPDATE lock) + C2 (DELETE forbid trigger) |
| **F4** vistas confirmado | ⏳ RPC/vistas (0054) | ⏳ sin cambio |
| **F5** auditoría void | ⚠️ socavado por UPDATE libre | ✅ **enforced**: C1 exige `voided_at/by/reason` para anular |
| **F6** guard insert | ⚠️ solo movimientos | ✅ **extendido**: C3 aplica el guard a allocations |

**Resultado:** F3, F5 y F6 pasan de parcial/socavado a **cerrados**. F1 y F4 quedan correctamente diferidos a `0054` (ya documentado).

---

## 5. Nuevo análisis adversarial rápido (sobre el plan)

- **¿El lock C1 frena al service-role?** Sí: los triggers se disparan también para service-role (a diferencia de RLS). Solo superusuario deshabilitando triggers o `TRUNCATE`/`DROP` lo evita → **residual documentado** (service-role = confianza total, fuera del modelo de amenaza).
- **¿El guard C3 es evadible por GUC?** Igual que F6 (H7): un actor con SQL puede setear `treasury.via_rpc`. **Es defensa-en-profundidad, no frontera.** Mitigación: las RPC usan `set_config(...,true)` (scope txn) para no filtrar por pgbouncer. Documentar.
- **¿C1 bloquea la propia RPC de void?** No: la RPC cumple (cambia solo `status` + setea `voided_*`). Verificado contra la regla del trigger.
- **¿C7 bloquea el void?** No: void cambia `status`, no `type/direction` → CHECK sigue satisfecho.
- **CAJA (C4): ¿transferencia caja↔banco?** `register_transfer(from=CAJA, to=Santander)` → 2 movimientos `transferencia`; C7 permite ambas direcciones para `transferencia`. ✅
- **CAJA: ¿se puede borrar/desactivar?** `is_system=true` + RLS write=admin + C2 (no delete) → protegida.
- **¿C5/C6 dejan sin acceso a alguien legítimo?** Internos (`admin/operaciones/supervisor`) leen; escribe `admin` directo y cualquiera con permiso granular vía RPC. `cliente` excluido (correcto). director_ops sin legacy-admin opera por RPC. **Aceptable.**
- **Edge remanente net=0 (H9):** sigue siendo de `0054` (la RPC omite el movimiento si `net=0`). No corresponde a `0053`.
- **Deadlock multi-factura (H10):** de `0054` (orden de lock determinístico). No corresponde a `0053`.

**Sin hallazgos nuevos P0/P1 introducidos por el plan.** Quedan abiertos solo los ítems explícitamente diferidos a `0054` (H9, H10, F1, F4) y los residuales de service-role/superusuario (inherentes a Postgres/Supabase).

---

## 6. Veredicto

> ## 🟢 GO — reescribir 0053
>
> El plan resuelve **H1–H6 de origen**, respeta D1–D5 y **cierra F3, F5 y F6** sin introducir regresiones. El análisis adversarial sobre el propio plan no encontró nuevos P0/P1; los residuales son inherentes (service-role/superusuario) y los diferidos pertenecen legítimamente a `0054`.
>
> **Autorización pendiente de tu parte sobre 2 puntos antes de reescribir:**
> 1. **H3 → Opción A (cuenta CAJA `is_system`).** ¿Confirmás?
> 2. **C8 (numeric 15,2, opcional).** ¿Incluir o dejar `14,2`?
>
> Con esas dos respuestas, reescribo `0053_treasury_core.sql` final (C1–C7 [+C8 si aprobás]). No modifico nada hasta tu OK.

---

## Anexo — Resumen de objetos que sumará/ajustará la reescritura

**Nuevas funciones/triggers:** `tg_lock_treasury_movement`, `tg_lock_customer_receipt`, `tg_lock_supplier_payment` (UPDATE); `tg_forbid_delete_financial` (DELETE ×5); `guard_allocation_insert` (INSERT ×2); `tg_forbid_update_allocation` (UPDATE ×2).
**Constraints nuevos:** `treasury_movements_type_direction_ck`, `reference_type` CHECK, `account_type` CHECK extendido (`+caja`).
**Columnas nuevas:** `bank_accounts.is_system`.
**Cambios de columna:** `customer_receipts.bank_account_id` → NOT NULL; FK allocations → `on delete restrict`.
**RLS:** write → `admin`; read → internos (excluye `cliente`).
**Seed:** + cuenta CAJA (`is_system=true`).
**Sin cambios:** enums `treasury_*`, sequences, `public_id` triggers, RBAC seed, bucket `treasury`, seed Santander/Galicia, guard F6 de movimientos.

---

*Fin — Plan de Reescritura ERP-A1. Veredicto: GO. No se modificó 0053 ni se generó código.*
