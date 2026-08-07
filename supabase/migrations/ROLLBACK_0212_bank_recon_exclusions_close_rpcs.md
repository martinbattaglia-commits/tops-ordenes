# ROLLBACK 0212 — bank_recon_exclusions_close_rpcs (TREAS-RECON-001 · E2)

Reversa completa de la migración funcional. La baseline `0211` NO requiere
rollback (documental/idempotente: no altera un entorno coincidente).

Orden de reversa (inverso al de aplicación):

```sql
-- 1. RPC nuevas
drop function if exists public.tesoreria_recon_add_exclusion(uuid, text, text, uuid, jsonb);
drop function if exists public.tesoreria_recon_create_adjustment(uuid, uuid);
drop function if exists public.tesoreria_recon_accept_systemic_batch(uuid);

-- 1 bis. Índice único de idempotencia (M5)
drop index if exists public.uq_recon_adjustment_activo;

-- 2. reference_type: restaurar el CHECK original (lista cerrada previa)
--    ⚠️ PRECONDICIÓN: no deben existir movimientos con los valores nuevos.
--    Verificar antes:
--      select count(*) from treasury_movements
--       where reference_type in ('recon_systemic_batch','recon_line_adjustment');
--    Si hay filas, anularlas primero (anulación gobernada) o NO revertir este paso.
alter table public.treasury_movements drop constraint if exists treasury_movements_reference_type_ck;
alter table public.treasury_movements add constraint treasury_movements_reference_type_ck
  check (reference_type is null or reference_type = any (array[
    'customer_receipt','supplier_payment','transfer','manual'
  ]));

-- 3. tesoreria_recon_ingest y tesoreria_recon_accept: restaurar los cuerpos
--    as-built SIN validación de cuenta ni guard de exclusiones.
--    Fuente exacta: supabase/migrations/0211_bank_recon_baseline_asbuilt.sql
--    (re-ejecutar sólo los bloques `create or replace function` de
--    tesoreria_recon_ingest y tesoreria_recon_accept).
--    ⚠️ El accept as-built devuelve void y sella `limit 1`: revertir a él
--    reintroduce el defecto B2 (N:M parcial). Sólo tiene sentido junto con la
--    reversa del carve-out del paso 4, que vuelve a impedir todo sello.
--    ⚠️ Cambia el tipo de retorno (jsonb → void): hay que DROPEAR primero y
--    re-otorgar los grants después:
--      drop function if exists public.tesoreria_recon_accept(uuid);
--      -- (recrear desde 0211)
--      revoke all on function public.tesoreria_recon_accept(uuid) from public, anon;
--      grant execute on function public.tesoreria_recon_accept(uuid) to authenticated, service_role;

-- 4. Lock de movimientos confirmados: restaurar el cuerpo original SIN el
--    carve-out de reconciled_*. Cuerpo original capturado en E0 (md5 y texto
--    en TREAS-RECON-001 — E0 BASELINE REPORT §2 y en el diff de esta rama):
--    volver a crear public.tg_lock_treasury_movement() con el bloque
--    `if old.status='confirmado'` en su forma previa (sin la primera rama).

-- 5. Helper y tabla de exclusiones
drop function if exists public._recon_movement_excluido(uuid);
drop trigger  if exists trg_forbid_delete_recon_exclusion on public.treasury_reconciliation_exclusions;
drop trigger  if exists trg_touch_recon_exclusion        on public.treasury_reconciliation_exclusions;
drop function if exists public.tg_touch_recon_exclusion();
--    ⚠️ La tabla contiene registro de gobierno. Si el data-op de blindados ya
--    corrió, exportar las filas como evidencia ANTES de:
drop table if exists public.treasury_reconciliation_exclusions;
```

Notas:
- Ningún paso toca `MOV-2026-000017` / `MOV-2026-000018` ni ningún saldo.
- Los ajustes creados por las RPC de cierre (si existieran) se revierten por
  **anulación gobernada** (`status='anulado'` + `void_reason` citando el
  expediente), nunca por DELETE (trigger lo prohíbe).
- El rollback del código TS es el revert del commit de la rama
  `feat/treas-recon-001-e2-20260728`.
