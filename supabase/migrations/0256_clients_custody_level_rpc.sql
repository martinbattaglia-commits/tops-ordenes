-- =========================================================================
-- 0256 · CUSTODIA NIVEL CONTRATADO — LA PERILLA DE CONTRATACION
--
-- Depende de: 0009 (has_permission, permissions) · 0241 (clients, client_events)
--             0242 (patron de mutacion atomica) · 0252 (clients.custody_level)
--             0255 (valor de enum 'custody_contract')
--
-- ─── QUE COSTURA CIERRA ──────────────────────────────────────────────────
--
-- `clients.custody_level` existe desde 0252 (default 1, check {1,2}) y el WMS lo
-- lee por `custody_client_level`. NINGUNA pantalla lo escribia: contratar
-- custodia digital a un cliente exigia SQL a mano.
--
-- ─── POR QUE UNA RPC HERMANA Y NO UN PARAMETRO DE client_update ───────────
--
-- Porque agregar un parametro a `client_update` NO la reemplaza: crea una
-- SOBRECARGA. Las dos quedarian vivas, la vieja con su `grant execute` de
-- 0242:438 y SIN la guarda del nivel, y las llamadas con argumentos nombrados
-- —`t-cli-a2-01:272` llama con tres— se vuelven ambiguas. Y la guarda de orden
-- de ROLLBACK_0241:27-30 identifica `client_update` por su firma literal de 17
-- argumentos: cambiarla apaga esa condicion. Es un `or` de tres, asi que la
-- guarda seguiria disparando por `client_create` y `client_set_active` —queda
-- DEBILITADA, no ciega—, pero se debilita sin necesidad.
--
-- El patron correcto ya estaba escrito al lado: `client_set_active` (0242:371)
-- resuelve exactamente esta forma —permiso propio, motivo obligatorio, sesion
-- del usuario, auditoria atomica— sin tocar la firma de nadie. Esto es su
-- gemela. No es una segunda via de escritura: es la MISMA via, con su puerta.
--
-- ─── EL PERMISO ES PROPIO, Y ESO ES LA DECISION ──────────────────────────
--
-- El nivel de custodia no es un dato del maestro: es la definicion del servicio
-- que se factura. El sistema ya separa el permiso de causar consecuencias de
-- custodia (`wms.custody.decide`) del de editar (`wms.edit`); corresponde la
-- misma separacion aca, y aplicada en la BASE, donde es fail-closed, no en la
-- pantalla donde es decorativa.
--
-- NACE SIN ASIGNAR. No se siembra ninguna fila en `role_permissions`. Mismo
-- criterio que 0222:70-80 para `wms.custody.decide`: una delegacion exige una
-- decision separada y visible en su propio diff.
--
-- ⚠ ALCANCE REAL DE «SIN ASIGNAR», ASENTADO A SABIENDAS: `has_permission`
-- (redefinida en 0246:330) termina en `or (select role = 'admin' from
-- public.profiles where id = auth.uid())`. Las cuentas con rol admin PUEDEN
-- contratar y rescindir desde el minuto cero sin recibir el permiso. Dirección
-- lo acepta con dos controles compensatorios —el motivo obligatorio con
-- auditoria atomica, y el gobierno del padron de admins por acta— y decide NO
-- crear una guarda que ignore el bypass, que seria la primera del codigo en
-- hacerlo. La rama de encargados de deposito (0246:309-323) retorna SIN ese
-- `or`: los encargados no puentean.
--
-- ─── EL 2→1 SE PERMITE, NUNCA EN SILENCIO ────────────────────────────────
--
-- Bajar el nivel es dar de baja un servicio contratado: desde ese momento la
-- mercaderia NUEVA de ese cliente deja de tener foto de egreso obligatoria,
-- analisis y compuerta. Tiene consecuencia comercial y de responsabilidad, asi
-- que exige motivo. Subir no lo exige: contratar no es un acto que haya que
-- justificar.
--
-- Lo YA MATERIALIZADO no se toca y no puede tocarse desde aca:
-- `custody_physical_units.custody_level` es una columna propia con default 2
-- (0252:135) e independiente del nivel del cliente. Bajar un cliente NO baja la
-- mercaderia que ya entro bajo custodia. Fijado por test contra SQL real.
--
-- Y la regla de 0252:72-74 —la recepcion ELEVA, NUNCA DEGRADA— no se toca:
-- vive en `receptions.custody_reforzada`, que es otra columna y otras
-- funciones. Este archivo no las menciona.
-- =========================================================================

begin;

-- ── 1 · El permiso, en el catalogo y sin dueño ─────────────────────────
insert into public.permissions (slug, module, action, label, description)
values ('clientes.custody.contract', 'clientes', 'custody_contract',
        'Clientes · contratar custodia digital',
        'Contratar o rescindir la custodia digital reforzada de un cliente')
on conflict (slug) do nothing;

-- La migracion aborta si el slot quedo ocupado por otra fila: un permiso que la
-- RPC exige y el catalogo no tiene es una denegacion permanente sin
-- explicacion. Mismo criterio que 0242:445.
do $$
begin
  if not exists (select 1 from public.permissions where slug = 'clientes.custody.contract') then
    raise exception 'PERMISO_NO_REGISTRADO: clientes.custody.contract no quedo en el catalogo';
  end if;
end $$;

-- ── 2 · La RPC ─────────────────────────────────────────────────────────
create or replace function public.client_set_custody_level(
  p_id                  uuid,
  p_level               smallint,
  p_motivo              text default null,
  p_expected_updated_at timestamptz default null
)
returns public.clients
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_actor  uuid := auth.uid();
  v_before public.clients;
  v_row    public.clients;
begin
  if v_actor is null then
    raise exception 'CLIENT_SIN_IDENTIDAD: exige un usuario autenticado' using errcode = '28000';
  end if;
  if not exists (
    select 1 from public.profiles p where p.id = v_actor and p.active
  ) then
    raise exception 'CLIENT_SIN_PERFIL_ACTIVO: la sesión no tiene un perfil activo'
      using errcode = '42501';
  end if;
  if public.has_permission('clientes.custody.contract') is distinct from true then
    raise exception 'CLIENT_DENEGADO: se requiere el permiso clientes.custody.contract'
      using errcode = '42501';
  end if;
  if p_level is null or p_level not in (1, 2) then
    raise exception 'CLIENT_NIVEL_INVALIDO: el nivel de custodia es 1 o 2' using errcode = '22023';
  end if;

  -- El lock se toma ANTES de fotografiar `before`, igual que en client_update:
  -- sin `for update` dos cambios concurrentes leen la misma version y dejan dos
  -- eventos que afirman partir del mismo estado.
  select * into v_before from public.clients where id = p_id for update;
  if not found then
    raise exception 'CLIENT_INEXISTENTE: %', p_id using errcode = 'P0002';
  end if;

  -- CAS OBLIGATORIO, como en client_update: una llamada directa no puede omitir
  -- el token para pisar en silencio una contratacion ya confirmada.
  if p_expected_updated_at is null then
    raise exception 'CLIENT_CONFLICTO_CONCURRENTE: falta la versión esperada de la ficha'
      using errcode = '40001';
  end if;
  if v_before.updated_at is distinct from p_expected_updated_at then
    raise exception
      'CLIENT_CONFLICTO_CONCURRENTE: la ficha cambió desde que fue abierta (esperado %, actual %)',
      p_expected_updated_at, v_before.updated_at using errcode = '40001';
  end if;

  -- Repetir el mismo nivel es idempotente y no fabrica un evento falso.
  if v_before.custody_level is not distinct from p_level then
    return v_before;
  end if;

  -- La BAJA exige motivo. La suba no: contratar no hay que justificarlo.
  if p_level < v_before.custody_level and btrim(coalesce(p_motivo, '')) = '' then
    raise exception 'CLIENT_MOTIVO_REQUERIDO: dar de baja la custodia digital exige un motivo'
      using errcode = '22023';
  end if;

  update public.clients set custody_level = p_level where id = p_id returning * into v_row;

  -- `custody_level` es columna de `clients`, asi que el cambio entra solo en el
  -- diff. Se registra acotado —el nivel y nada mas— porque el evento tiene que
  -- decir QUE cambio, no repetir la ficha entera.
  insert into public.client_events (client_id, kind, origin, before, after, motivo)
  values (
    p_id,
    'updated',
    'manual',
    jsonb_build_object('custody_level', v_before.custody_level),
    jsonb_build_object('custody_level', v_row.custody_level),
    nullif(btrim(coalesce(p_motivo, '')), '')
  );

  return v_row;
end;
$$;

-- ── 3 · Privilegios ────────────────────────────────────────────────────
-- Toda funcion nace con EXECUTE para PUBLIC y Supabase suma default privileges
-- por rol: se enumera completo, igual que 0242:437.
revoke execute on function public.client_set_custody_level(uuid, smallint, text, timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.client_set_custody_level(uuid, smallint, text, timestamptz)
  to authenticated;

commit;
