# ROLLBACK 0193 + 0194 · Beneficiario formal de Tesorería (T-004)

Revierte `0194_treasury_beneficiaries.sql` y, en lo posible, `0193_…_add_honorarios_sueldo.sql`.

Ambas son **aditivas**: no tocan datos ni objetos preexistentes. `0194` sí
**reemplaza** la RPC `tesoreria_register_operational_movement` (drop de la firma
de 7 args + create de la de 11), por lo que el rollback debe **restaurar la
firma anterior** o el alta operativa queda sin RPC.

> ⚠️ Aplica Martín a mano en el SQL Editor (G3). El asistente NO ejecuta.
> Si ya se registraron movimientos operativos con beneficiario, **exportarlos
> antes**: el paso 3 borra el vínculo y el paso 4 el catálogo.

## Limitación conocida — el enum NO es reversible

PostgreSQL **no permite quitar un valor de un enum**. Los valores `'honorarios'`
y `'adelanto_sueldo'` agregados por `0193` quedan en
`treasury_operational_category_t` para siempre. Esto es inocuo: sin las filas
que los usen, son etiquetas inertes.

Revertirlos de verdad exigiría recrear el tipo (crear `_new`, migrar todas las
columnas que lo referencian, dropear el viejo, renombrar) — **operación
destructiva sobre `treasury_movements`, fuera del alcance de un rollback**. Si
Dirección lo exigiera, va por expediente propio con su propio gate.

Consecuencia práctica: **tras el rollback hay que verificar que no queden
movimientos en esas dos categorías** (paso 1), porque el CHECK que exigía
beneficiario ya no existirá para protegerlos.

## SQL de rollback (idempotente)

```sql
-- 0. VERIFICACIÓN PREVIA — si devuelve > 0, EXPORTAR antes de continuar.
select count(*) as movimientos_con_beneficiario
  from public.treasury_movements where beneficiary_id is not null;

select public_id, date, operational_category, amount, beneficiary_id
  from public.treasury_movements
 where operational_category in ('honorarios','adelanto_sueldo')
 order by date;

-- 1. Vista de lectura
drop view if exists public.treasury_operational_movements;

-- 2. RPC — restaurar la firma de 7 args (estado 0190 + 0191)
drop function if exists public.tesoreria_register_operational_movement(
  date, public.treasury_operational_category_t, public.treasury_direction_t, uuid, numeric, text,
  uuid, text, public.treasury_beneficiary_kind_t, text, text
);

create or replace function public.tesoreria_register_operational_movement(
  p_date            date,
  p_category        public.treasury_operational_category_t,
  p_direction       public.treasury_direction_t,
  p_bank_account_id uuid,
  p_amount          numeric,
  p_concept         text,
  p_observations    text default null
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_desc text; v_cur text; v_active boolean; v_mov uuid; v_pub text;
begin
  perform set_config('treasury.via_rpc', 'on', true);
  if not coalesce(public.has_permission('tesoreria.create'), false) then
    raise exception 'FORBIDDEN: requiere permiso tesoreria.create' using errcode='42501';
  end if;
  if p_concept is null or btrim(p_concept) = '' then
    raise exception 'OPMOV_CONCEPT_REQUIRED: el concepto es obligatorio' using errcode='check_violation';
  end if;
  if p_direction is null then
    raise exception 'OPMOV_DIRECTION_INVALID: dirección requerida (ingreso|egreso)' using errcode='check_violation';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'INVALID_AMOUNT: el importe debe ser > 0' using errcode='check_violation';
  end if;
  select currency, active into v_cur, v_active from public.bank_accounts where id = p_bank_account_id;
  if not found then raise exception 'BANK_INVALID' using errcode='check_violation'; end if;
  if not v_active then raise exception 'BANK_INACTIVE' using errcode='check_violation'; end if;
  if v_cur <> 'ARS' then raise exception 'CURRENCY_UNSUPPORTED: solo ARS' using errcode='check_violation'; end if;
  v_desc := btrim(p_concept);
  insert into public.treasury_movements(date, type, direction, bank_account_id, amount, description,
       reference_type, operational_category, status, created_by)
  values (coalesce(p_date, current_date), 'movimiento_operativo', p_direction, p_bank_account_id, p_amount, v_desc,
       'manual', p_category, 'confirmado', v_uid)
  returning id, public_id into v_mov, v_pub;
  return jsonb_build_object('movement_id', v_mov, 'public_id', v_pub);
end; $$;

grant execute on function public.tesoreria_register_operational_movement(
  date, public.treasury_operational_category_t, public.treasury_direction_t, uuid, numeric, text, text
) to authenticated;

-- 3. Constraints + columna de vínculo
alter table public.treasury_movements drop constraint if exists treasury_movements_beneficiary_required_ck;
alter table public.treasury_movements drop constraint if exists treasury_movements_beneficiary_scope_ck;
drop index if exists public.treasury_movements_beneficiary_idx;
alter table public.treasury_movements drop column if exists beneficiary_id;

-- 4. Catálogo (el DROP TABLE se lleva policies e índices)
drop table if exists public.treasury_beneficiaries;
drop type  if exists public.treasury_beneficiary_kind_t;

notify pgrst, 'reload schema';
```

## Post-verificación

```sql
select count(*) as rpcs_operativas   -- esperado: 1 (la de 7 args)
  from pg_proc where proname = 'tesoreria_register_operational_movement';

select count(*) as debe_ser_0
  from information_schema.columns
 where table_name = 'treasury_movements' and column_name = 'beneficiary_id';

select count(*) as movimientos_intactos from public.treasury_movements;  -- no debe bajar
```
