-- SQL exacto del commit 1d0075eab1e6cd8245850ec7a4f4018e50a5a1c7
-- SHA-256 del archivo: 1df97eab3a98edb7a71d97e3fa3df80e2801a5d94f031be565efab06114b782b
-- Se omiten únicamente el `begin;`/`commit;` explícitos: apply_migration ya ejecuta
-- de forma atómica y un BEGIN anidado cerraría su transacción antes de registrar la
-- migración. Ninguna sentencia se altera, agrega ni reordena.

-- ── 1 · Columna de referencia inmutable ─────────────────────────────────────
alter table public.ai_suggestions   add column if not exists conversation_ref jsonb;
alter table public.ai_analysis_runs add column if not exists conversation_ref jsonb;

comment on column public.ai_suggestions.conversation_ref is
  'Identidad INMUTABLE del hilo analizado, sin FK: sobrevive al borrado de la conversacion. Sin PII: ni titulo, ni context_id, ni su hash. La construye SIEMPRE el trigger (descarta lo que venga en el INSERT) y queda bloqueada contra UPDATE.';
comment on column public.ai_analysis_runs.conversation_ref is
  'Identidad INMUTABLE del hilo analizado, sin FK: sobrevive al borrado de la conversacion. Sin PII: ni titulo, ni context_id, ni su hash. La construye SIEMPRE el trigger (descarta lo que venga en el INSERT) y queda bloqueada contra UPDATE.';

-- ── 2 · Constructor de la referencia ────────────────────────────────────────
-- SECURITY DEFINER acotado: necesita leer `connect_conversations` en el INSERT de
-- auditoría, y quien inserta puede no poder verla por RLS. Devuelve sólo metadata
-- no identificatoria. `search_path` fijo con `pg_temp` último (lección de las
-- funciones endurecidas): evita secuestro por search_path.
-- ⚠️ Justamente porque esquiva la RLS, NO se concede a `authenticated`: ver el
-- revoke más abajo y el hallazgo A-3.
create or replace function public.ai_build_conversation_ref(
  p_conversation_id uuid,
  p_evidence_sha256 text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
stable
as $$
declare c record; ref jsonb;
begin
  if p_conversation_id is null then
    return jsonb_build_object(
      'conversation_id', null,
      'captured_at', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'evidence_sha256', p_evidence_sha256
    );
  end if;

  select id, kind::text as kind, slug, context_id, created_at
    into c
  from public.connect_conversations
  where id = p_conversation_id;

  ref := jsonb_build_object(
    'conversation_id', p_conversation_id,
    -- Identificador técnico seguro. NUNCA `title` (contiene nombres de personas).
    'slug', c.slug,
    'kind', c.kind,
    -- Sólo el ESQUEMA del context_id ('wa' de 'wa:+549…'): dice por dónde llegó
    -- la conversación, nunca con quién. Ni el valor ni su hash se guardan (A-2).
    'context_scheme', case when c.context_id is null then null
                           else split_part(c.context_id, ':', 1) end,
    'conversation_created_at', c.created_at,
    'evidence_sha256', p_evidence_sha256,
    'captured_at', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  );
  return ref;
end $$;

-- A-3: NO se concede a `authenticated`. Al ser SECURITY DEFINER, esta función
-- esquiva la RLS de connect_conversations por diseño (la necesita el trigger, que
-- corre en el INSERT de auditoría de un usuario que quizá no vea el hilo). Pero
-- expuesta como función pública era un oráculo: cualquier autenticado podía pasar
-- un uuid ajeno y obtener existencia, slug, kind y fecha de creación de hilos que
-- la RLS le niega. La revisión adversarial lo demostró con RLS deny-all real.
-- Los triggers NO requieren EXECUTE sobre la función que invocan: el privilegio se
-- verifica al CREATE TRIGGER, no al disparar. Por eso revocarla no rompe el flujo.
revoke all on function public.ai_build_conversation_ref(uuid, text) from public, anon, authenticated;

-- ── 3 · Backfill de filas existentes ────────────────────────────────────────
-- Hoy ambas tablas están vacías, pero la migración debe ser correcta con datos.
-- La evidencia de cada tabla es distinta: las corridas ya guardan `input_sha256`;
-- las sugerencias se hashean sobre sus `citations` (los message_id que las sustentan).
update public.ai_analysis_runs r
   set conversation_ref = public.ai_build_conversation_ref(r.conversation_id, r.input_sha256)
 where r.conversation_ref is null;

update public.ai_suggestions s
   set conversation_ref = public.ai_build_conversation_ref(
         s.conversation_id,
         encode(sha256(convert_to(coalesce(s.citations, '[]'::jsonb)::text, 'UTF8')), 'hex'))
 where s.conversation_ref is null;

-- ── 4 · Poblado automático en el INSERT ─────────────────────────────────────
-- La referencia la construye SIEMPRE la base, y **descarta** lo que venga en el
-- INSERT. Sin esto la garantía era falsa: la revisión adversarial (A-1) demostró
-- que un admin autenticado podía insertar
--   conversation_ref = '{"conversation_id":null,"captured_at":null,"telefono":"+549…"}'
-- y el trigger la respetaba, el CHECK la aceptaba —sólo miraba presencia de claves,
-- no valores— y el guard de inmutabilidad la sellaba después, de modo que ni
-- service_role podía corregir la evidencia falsa. El propósito de la migración
-- quedaba invertido: la auditoría certificaba identidad forjada.
-- Ahora el valor entrante se ignora por completo. No hay forma de forjarla.
create or replace function public.ai_set_conversation_ref()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare ev text;
begin
  if tg_table_name = 'ai_analysis_runs' then
    ev := new.input_sha256;
  else
    ev := encode(sha256(convert_to(coalesce(new.citations, '[]'::jsonb)::text, 'UTF8')), 'hex');
  end if;
  -- Asignación INCONDICIONAL: lo que el llamador mandó en conversation_ref se
  -- descarta. La identidad del hilo auditado no es un dato de entrada.
  new.conversation_ref := public.ai_build_conversation_ref(new.conversation_id, ev);
  return new;
end $$;

revoke all on function public.ai_set_conversation_ref() from public, anon, authenticated;

drop trigger if exists ai_suggestions_set_ref on public.ai_suggestions;
create trigger ai_suggestions_set_ref
  before insert on public.ai_suggestions
  for each row execute function public.ai_set_conversation_ref();

drop trigger if exists ai_analysis_runs_set_ref on public.ai_analysis_runs;
create trigger ai_analysis_runs_set_ref
  before insert on public.ai_analysis_runs
  for each row execute function public.ai_set_conversation_ref();

-- ── 5 · Inmutabilidad de la referencia ──────────────────────────────────────
-- Sin esto, «inmutable» sería sólo una intención escrita en un comentario.
-- Nota: la acción referencial ON DELETE SET NULL ejecuta un UPDATE sobre
-- `conversation_id`; este guard NO lo bloquea porque sólo mira `conversation_ref`.
create or replace function public.ai_freeze_conversation_ref()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if old.conversation_ref is not null
     and new.conversation_ref is distinct from old.conversation_ref then
    raise exception
      'conversation_ref es inmutable: la identidad del hilo auditado no se reescribe (tabla %, fila %)',
      tg_table_name, old.id
      using errcode = 'check_violation';
  end if;
  -- A-7: `conversation_id` sólo puede ir a NULL (acción referencial al borrarse el
  -- hilo). Re-apuntar una fila de auditoría a OTRA conversación quedaría invisible
  -- —la ref seguiría nombrando el hilo original— y la evidencia mentiría.
  if old.conversation_id is not null
     and new.conversation_id is not null
     and new.conversation_id is distinct from old.conversation_id then
    raise exception
      'conversation_id de una fila de auditoría no se reapunta a otra conversación (tabla %, fila %)',
      tg_table_name, old.id
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists ai_suggestions_freeze_ref on public.ai_suggestions;
create trigger ai_suggestions_freeze_ref
  before update on public.ai_suggestions
  for each row execute function public.ai_freeze_conversation_ref();

drop trigger if exists ai_analysis_runs_freeze_ref on public.ai_analysis_runs;
create trigger ai_analysis_runs_freeze_ref
  before update on public.ai_analysis_runs
  for each row execute function public.ai_freeze_conversation_ref();

-- ── 6 · La referencia es obligatoria Y BIEN FORMADA ─────────────────────────
-- El CHECK anterior sólo miraba PRESENCIA de claves (`?`), no valores: aceptaba
-- `{"conversation_id":null,"captured_at":null,"telefono":"+549…"}` (A-1). Ahora
-- exige `captured_at` con valor y una LISTA BLANCA de claves, así ninguna fila
-- puede llevar campos extra —y menos PII— ni siquiera insertada por el owner.
create or replace function public.ai_conversation_ref_valido(ref jsonb)
returns boolean
language sql
immutable
as $$
  select ref is not null
     and jsonb_typeof(ref) = 'object'
     and (ref ->> 'captured_at') is not null
     and ref ? 'conversation_id'
     and not exists (
       select 1 from jsonb_object_keys(ref) k
       where k not in ('conversation_id','slug','kind','context_scheme',
                       'conversation_created_at','evidence_sha256','captured_at')
     )
$$;

-- CHECK en vez de NOT NULL: nombra el requisito y valida forma, no sólo presencia.
do $$
begin
  if not exists (select 1 from pg_constraint
                 where conname = 'ai_suggestions_conversation_ref_required') then
    alter table public.ai_suggestions
      add constraint ai_suggestions_conversation_ref_required
      check (public.ai_conversation_ref_valido(conversation_ref));
  end if;
  if not exists (select 1 from pg_constraint
                 where conname = 'ai_analysis_runs_conversation_ref_required') then
    alter table public.ai_analysis_runs
      add constraint ai_analysis_runs_conversation_ref_required
      check (public.ai_conversation_ref_valido(conversation_ref));
  end if;
end $$;

-- ── 7 · conversation_id pasa a ser opcional ─────────────────────────────────
alter table public.ai_suggestions   alter column conversation_id drop not null;
alter table public.ai_analysis_runs alter column conversation_id drop not null;

-- ── 8 · CASCADE → SET NULL ──────────────────────────────────────────────────
-- El corazón de la migración. Guardado por catálogo: sólo reemplaza si sigue
-- siendo CASCADE, de modo que re-aplicar es inocuo.
do $$
declare r record;
begin
  for r in
    select conrelid::regclass::text as tabla, conname
    from pg_constraint
    where contype = 'f'
      and confrelid = 'public.connect_conversations'::regclass
      and conrelid in ('public.ai_suggestions'::regclass, 'public.ai_analysis_runs'::regclass)
      and confdeltype = 'c'   -- 'c' = CASCADE
  loop
    execute format('alter table %s drop constraint %I', r.tabla, r.conname);
    execute format(
      'alter table %s add constraint %I foreign key (conversation_id) '
      'references public.connect_conversations(id) on delete set null',
      r.tabla, r.conname);
    raise notice 'FK % de % : CASCADE → SET NULL', r.conname, r.tabla;
  end loop;
end $$;

-- ── 9 · Índices ─────────────────────────────────────────────────────────────
-- Los de 0213 siguen intactos. Se agrega el que permite ATRIBUIR auditoría a un
-- hilo por su id original, incluida la huérfana (`conversation_id` ya en NULL),
-- que de otro modo sólo se alcanzaría por Seq Scan.
-- Nota honesta: este índice NO acelera `where conversation_id is null` —esa consulta
-- sigue siendo Seq Scan—; sirve para buscar POR el id original dentro de la ref.
create index if not exists ai_suggestions_conv_ref_idx
  on public.ai_suggestions ((conversation_ref ->> 'conversation_id'));
create index if not exists ai_analysis_runs_conv_ref_idx
  on public.ai_analysis_runs ((conversation_ref ->> 'conversation_id'));

-- ── 10 · INTEGRIDAD DE ORIGEN (E-1) ────────────────────────────────────────
-- El problema que cierra: quitar UPDATE (0216) impide REESCRIBIR una sugerencia,
-- pero no impedía que NACIERA ya decidida. La revisión adversarial insertó, como
-- admin autenticado y sin trucos, una sugerencia con `status='aceptada'`,
-- `decided_by` de otro usuario, `decided_at` retroactivo y `created_entity_type`
-- cargado. Y como nadie tiene UPDATE, esa decisión falsa era IRRECTIFICABLE.
-- Sin esto, «mínimo privilegio» habría sido una garantía sólo aparente.
--
-- Se valida en la BASE, no en TypeScript: la app puede cambiar, la policy no.

-- (a) La autoría se DERIVA de auth.uid(); no se acepta un actor enviado por el
--     cliente. El trigger sobrescribe, así que no hay nada que suplantar.
-- SECURITY DEFINER a propósito: sólo copia `auth.uid()` (una GUC de sesión) al
-- campo de autoría. Así el guard no depende de que `authenticated` tenga USAGE en
-- el esquema `auth` —lo tiene en producción, verificado, pero un guard de
-- integridad no debería apoyarse en un privilegio que no necesita—.
create or replace function public.ai_set_run_actor()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is not null then
    new.requested_by := auth.uid();
  end if;
  return new;
end $$;

revoke all on function public.ai_set_run_actor() from public, anon, authenticated;

drop trigger if exists ai_analysis_runs_set_actor on public.ai_analysis_runs;
create trigger ai_analysis_runs_set_actor
  before insert on public.ai_analysis_runs
  for each row execute function public.ai_set_run_actor();

-- (b) Una sugerencia sólo puede nacer PENDIENTE y sin decisión.
--     Reemplaza la policy homónima de 0213, que sólo exigía is_admin().
drop policy if exists "ai_suggestions admin insert" on public.ai_suggestions;
create policy "ai_suggestions admin insert" on public.ai_suggestions
  for insert to authenticated
  with check (
    public.is_admin()
    and status = 'pendiente'          -- jamás nace aceptada ni descartada
    and decided_by is null            -- ningún actor de decisión al nacer
    and decided_at is null            -- ninguna fecha de decisión, menos retroactiva
    and created_entity_type is null   -- ninguna entidad de negocio pre-atribuida
    and created_entity_id is null
  );

-- (c) La misma regla, también como CHECK: una policy protege de `authenticated`;
--     el CHECK protege además de cualquier inserción por otro camino.
do $$
begin
  if not exists (select 1 from pg_constraint
                 where conname = 'ai_suggestions_decision_fechada') then
    alter table public.ai_suggestions
      add constraint ai_suggestions_decision_fechada
      check (
        -- «Decidida ⇒ fechada». El estado inicial lo garantiza la POLICY de (b);
        -- este CHECK cubre además cualquier otra vía de escritura.
        -- Deliberadamente NO exige que `pendiente` tenga decided_at nulo: la UI
        -- permite REABRIR una sugerencia (volverla a 'pendiente') y el canal
        -- gobernado fija decided_by/decided_at en la misma sentencia. Prohibirlo
        -- habría roto un flujo real por un invariante que nadie pidió.
        status = 'pendiente' or decided_at is not null
      );
  end if;
end $$;

-- (d) Una corrida se audita a nombre de quien la pidió, o de nadie.
drop policy if exists "ai_analysis_runs own insert" on public.ai_analysis_runs;
create policy "ai_analysis_runs own insert" on public.ai_analysis_runs
  for insert to authenticated
  with check (requested_by is null or requested_by = auth.uid());

-- Nota honesta sobre la lista de Dirección: `ai_suggestions` NO tiene columna
-- `outcome` —esa vive en `ai_analysis_runs`, donde es NOT NULL y es el resultado
-- legítimo de la corrida (`ok`/`killed`/`denied`/`budget`/`invalid_output`/`error`)—.
-- Por eso el invariante «outcome IS NULL» no se puede aplicar a la sugerencia: su
-- equivalente real es el trío status/decided_by/decided_at, que sí se exige arriba.
