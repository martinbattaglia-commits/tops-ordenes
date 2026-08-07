# ROLLBACK 0210 — Caja Chica Multimoneda (CCN-002)

**Precondición:** el rollback restituye el estado 0198/0196 exacto. Ejecutar SOLO
con resolución expresa de Dirección. Idempotente.

**⚠️ Si ya existen movimientos en la caja USD**, el rollback de la RPC NO los
elimina (append-only G10): quedan como historia auditada de su cuenta. En ese
escenario, antes de volver a la RPC solo-ARS hay que desactivar la cuenta USD
(`update bank_accounts set active=false where account_type='caja' and currency='USD'`)
para que ningún flujo pueda seguir operándola. Nunca borrar la cuenta ni sus
movimientos.

## 1. Restituir la RPC de alta (cuerpo 0198 §1, firma de 6 argumentos)

```sql
drop function if exists public.caja_chica_registrar_movimiento(
  date, public.treasury_direction_t, numeric, text, uuid, text, text
);
-- Recrear EXACTAMENTE la función de 0198 §1 (fuente canónica:
-- ~/CODE/EXPEDIENTE-CAJA-CHICA-NATIVA/F2_SQL/0198_caja_chica_rpcs.sql,
-- líneas «1. ALTA · caja_chica_registrar_movimiento»), incluido su
-- grant execute (date, treasury_direction_t, numeric, text, uuid, text).
```

## 2. Restituir la vista (cuerpo 0196 §5, sin bank_account_id/currency)

`create or replace view` no permite QUITAR columnas ⇒ drop + recreate:

```sql
drop view if exists public.v_cash_box_libro;
-- Recrear EXACTAMENTE la vista de 0196 §5 (fuente canónica:
-- ~/CODE/EXPEDIENTE-CAJA-CHICA-NATIVA/F1_SQL/0196_caja_chica_foundation.sql)
-- con security_invoker = true, y reponer:
grant select on public.v_cash_box_libro to authenticated;
```

## 3. Quitar el índice de unicidad

```sql
drop index if exists public.bank_accounts_caja_activa_por_moneda_uq;
```

## 4. Refrescar PostgREST y verificar

```sql
notify pgrst, 'reload schema';
-- select pg_get_function_identity_arguments('public.caja_chica_registrar_movimiento'::regproc);
--   esperado: termina en «p_observations text» (6 args, sin p_currency)
-- select count(*) from information_schema.columns
--   where table_name='v_cash_box_libro' and column_name in ('bank_account_id','currency');
--   esperado: 0
```

## 5. Frontend

El código CCN-002 requiere 0210 (query `.eq('currency')` y `p_currency`): el
rollback de base exige también volver al artefacto de frontend anterior
(deploy previo), en ese orden: primero frontend, después base.
