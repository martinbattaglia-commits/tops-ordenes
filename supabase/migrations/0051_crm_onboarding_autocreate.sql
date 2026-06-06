-- =========================================================================
-- 0051_crm_onboarding_autocreate.sql — CRM Comercial · P0.2
--
-- ADDITIVE ONLY · SOLO FUNCIÓN + TRIGGER. Cierra la cadena del write-path:
--   Ganado → (auto) crm_onboarding + tasks → crm_complete_onboarding → Ocupado.
--
-- Diagnóstico (E2E write): ni crm_advance_stage ni crm_promote_lead creaban la
-- fila crm_onboarding al ganar; crm_complete_onboarding la exige (ONBOARDING_NOT_FOUND)
-- → la UI no podía llegar a "Ocupado". Este trigger la crea al transicionar a 'ganado'.
--
-- Diseño: trigger AFTER UPDATE OF estado (no reescribe advance_stage → sin drift).
-- Idempotente ("if not exists"); WHEN solo en la transición a ganado. SECURITY
-- DEFINER (efecto de sistema; el insert no debe depender del permiso del caller
-- más allá del que ya tuvo para la transición). search_path fijado.
--
-- NO aplicar a Supabase PROD. Solo staging.
-- =========================================================================

create or replace function public.crm_tg_create_onboarding_on_won()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_onb_id uuid;
begin
  -- Idempotencia: si ya hay onboarding para la oportunidad, no duplicar.
  if exists (select 1 from public.crm_onboarding where opportunity_id = new.id) then
    return new;
  end if;

  insert into public.crm_onboarding (opportunity_id, client_id, status, progress_pct, started_at)
  values (new.id, new.client_id, 'pendiente'::public.crm_onboarding_status_t, 0, now())
  returning id into v_onb_id;

  -- Checklist estándar (ONBOARDING_AUTOMATION_DESIGN). Tipos del enum crm_onboarding_task_t.
  insert into public.crm_onboarding_tasks (onboarding_id, tipo, titulo, orden)
  values
    (v_onb_id, 'rne'::public.crm_onboarding_task_t,           'Inscripción / RNE',            1),
    (v_onb_id, 'croquis'::public.crm_onboarding_task_t,       'Croquis del depósito',         2),
    (v_onb_id, 'plancheta'::public.crm_onboarding_task_t,     'Plancheta / habilitación',     3),
    (v_onb_id, 'accesos'::public.crm_onboarding_task_t,       'Alta de accesos',              4),
    (v_onb_id, 'documentacion'::public.crm_onboarding_task_t, 'Documentación del cliente',    5);

  return new;
end;
$$;

revoke all on function public.crm_tg_create_onboarding_on_won() from public;

-- Solo dispara cuando la etapa entra a 'ganado' (no en updates posteriores de un
-- opp ya ganado: complete_onboarding/reserve no tocan `estado`, así que ni siquiera
-- evalúan este trigger — es UPDATE OF estado).
drop trigger if exists trg_crm_create_onboarding_on_won on public.crm_opportunities;
create trigger trg_crm_create_onboarding_on_won
  after update of estado on public.crm_opportunities
  for each row
  when (new.estado = 'ganado'::public.crm_stage_t and old.estado is distinct from 'ganado'::public.crm_stage_t)
  execute function public.crm_tg_create_onboarding_on_won();

notify pgrst, 'reload schema';
