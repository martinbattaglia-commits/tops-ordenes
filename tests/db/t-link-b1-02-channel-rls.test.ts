/**
 * T-LINK-B1-02 · Frontera de canal ESTRUCTURAL (migración 0237).
 *
 * 0236 filtraba en `v_connect_inbox`. Esta prueba ataca todo lo que NO pasa por
 * esa vista: RLS de tablas (y por lo tanto realtime), búsqueda SECURITY DEFINER,
 * portón de signed URL y lectura directa de Storage conociendo la ruta.
 *
 * El escenario es adversarial de entrada: el Jefe de Deposito ES participante de
 * la conversación de WhatsApp y conserva `connect.view/create/edit`.
 *
 * Además demuestra las PREMISAS de endurecimiento de los helpers en vez de
 * suponerlas: dueño, `search_path`, grants, `FORCE ROW LEVEL SECURITY` y
 * ausencia de recursión.
 */

import { afterAll, beforeAll, describe, expect, it, inject } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Client } from "pg";
import { createWaSandbox, type WaSandbox } from "./harness/wa-sandbox";

const MIG = (f: string) => resolve(__dirname, "..", "..", "supabase", "migrations", f);
const M0236 = MIG("0236_nexus_link_channel_capabilities.sql");
const M0237 = MIG("0237_nexus_link_channel_rls.sql");
const R0237 = MIG("ROLLBACK_0237_nexus_link_channel_rls.sql");

const ENCARGADO = "11111111-1111-4111-8111-111111111111";
const COMERCIAL = "22222222-2222-4222-8222-222222222222";
const ADMIN_OK = "33333333-3333-4333-8333-333333333333";
const AJENO = "55555555-5555-4555-8555-555555555555";
/** Teléfono sintético de la contraparte. No es de nadie: sirve para atacarlo. */
const TEL_CONTRAPARTE = "+5491100000001";

/** Cierre acotado con storage real, RBAC real y los helpers de 0143/0144. */
const CIERRE = `
  create extension if not exists pgcrypto;
  create schema if not exists auth;
  create schema if not exists storage;
  create table auth.users (id uuid primary key);
  create or replace function auth.uid() returns uuid language sql stable as $fn$
    select nullif(current_setting('test.observer', true), '')::uuid
  $fn$;

  create type public.user_role_t as enum ('admin','operaciones','supervisor','comercial','cliente');
  create table public.profiles (id uuid primary key, role public.user_role_t not null default 'operaciones');
  create or replace function public."current_role"() returns public.user_role_t
    language sql stable security definer set search_path = public, pg_temp as $fn$
      select role from public.profiles where id = auth.uid() $fn$;
  create or replace function public.is_admin() returns boolean
    language sql stable security definer set search_path = public, pg_temp as $fn$
      select coalesce((select role = 'admin' from public.profiles where id = auth.uid()), false) $fn$;

  create table public.roles (id uuid primary key default gen_random_uuid(), slug text, name text unique);
  -- columna real es label, no name (medido contra 0009_rbac.sql y contra
  -- produccion; corregido junto con el mismo defecto en 0236, ver su cabecera).
  create table public.permissions (id uuid primary key default gen_random_uuid(), slug text unique not null,
    module text, action text, label text, description text);
  create table public.role_permissions (role_id uuid not null references public.roles(id) on delete cascade,
    permission_id uuid not null references public.permissions(id) on delete cascade,
    created_at timestamptz not null default now(), primary key (role_id, permission_id));
  create table public.user_roles (user_id uuid not null, role_id uuid not null references public.roles(id) on delete cascade,
    primary key (user_id, role_id));
  create or replace function public.has_permission(p_slug text) returns boolean
    language sql stable as $fn$
      select coalesce(exists (select 1 from public.user_roles ur
        join public.role_permissions rp on rp.role_id=ur.role_id
        join public.permissions p on p.id=rp.permission_id
        where ur.user_id=auth.uid() and p.slug=p_slug) or public."current_role"()='admin', false) $fn$;

  create table public.audit_log (id uuid primary key default gen_random_uuid(),
    user_id uuid, entity text, entity_id uuid, action text, payload jsonb,
    created_at timestamptz not null default now());

  create type public.connect_conversation_kind_t as enum
    ('dm','group','channel','erp','incident','whatsapp','ai','task');
  create type public.connect_message_kind_t as enum
    ('text','system','ai','file','call_link','whatsapp','audio');
  create table public.connect_conversations (
    id uuid primary key default gen_random_uuid(), context_id text,
    kind public.connect_conversation_kind_t not null, title text, slug text, topic text,
    visibility text default 'private',
    last_message_at timestamptz, last_message_seq bigint, archived_at timestamptz);
  -- participant_type y external_ref son las columnas REALES de 0143. El
  -- importador y la proyeccion del inbound escriben el telefono de la
  -- contraparte dentro de external_ref->>'phone'. Sin estas dos columnas el
  -- arnes no podia siquiera formular la pregunta.
  create table public.connect_participants (
    id uuid primary key default gen_random_uuid(),
    conversation_id uuid not null references public.connect_conversations(id) on delete cascade,
    profile_id uuid, participant_type text not null default 'user',
    external_ref jsonb, last_read_seq bigint not null default 0, muted_until timestamptz,
    is_favorite boolean not null default false, unique (conversation_id, profile_id));
  create table public.connect_messages (
    id uuid primary key default gen_random_uuid(),
    conversation_id uuid not null references public.connect_conversations(id) on delete cascade,
    seq bigint generated always as identity, author_profile_id uuid, body text,
    kind public.connect_message_kind_t not null default 'text',
    deleted_at timestamptz, created_at timestamptz not null default now());
  create table public.connect_attachments (
    id uuid primary key default gen_random_uuid(),
    conversation_id uuid not null references public.connect_conversations(id) on delete cascade,
    message_id uuid, storage_bucket text not null, storage_path text not null,
    sha256 text, mime_type text, file_size bigint, file_name text, uploaded_by uuid,
    scan_status text not null default 'pending',
    created_at timestamptz not null default now(), unique (storage_bucket, storage_path));
  create table public.connect_conversation_links (
    id uuid primary key default gen_random_uuid(), conversation_id uuid, entity_type text,
    entity_id uuid, entity_id_text text);

  create or replace function public._connect_is_member(p_conversation_id uuid) returns boolean
    language sql stable security definer set search_path = public, pg_temp as $fn$
      select exists (select 1 from public.connect_participants cp
        where cp.conversation_id=p_conversation_id and cp.profile_id=auth.uid()) $fn$;

  -- Storage mínimo, con la MISMA firma de storage.foldername.
  create table storage.objects (
    id uuid primary key default gen_random_uuid(), bucket_id text, name text,
    unique (bucket_id, name));
  create or replace function storage.foldername(name text) returns text[]
    language sql immutable as $fn$
      select string_to_array(regexp_replace(name, '/[^/]*$', ''), '/') $fn$;
  alter table storage.objects enable row level security;

  -- Policies previas a 0237 (0143/0148), para medir el ANTES.
  alter table public.connect_conversations enable row level security;
  alter table public.connect_messages      enable row level security;
  alter table public.connect_attachments   enable row level security;
  alter table public.connect_participants  enable row level security;
  -- Reproducida LITERAL de 0143:372-375, verificada contra producción el
  -- 2026-08-14: no tiene predicado de canal, y 0236/0237 no la tocan.
  create policy "connect_participants select" on public.connect_participants for select
    using (has_permission('connect.view')
           and (public._connect_is_member(conversation_id) or is_admin()));
  create policy "connect_conversations select" on public.connect_conversations for select
    using (has_permission('connect.view') and (public._connect_is_member(id)
      or (kind='channel' and visibility='public') or is_admin()));
  create policy "connect_messages select" on public.connect_messages for select
    using (has_permission('connect.view') and public._connect_is_member(conversation_id));
  create policy "connect_attachments select" on public.connect_attachments for select
    using (has_permission('connect.view') and public._connect_is_member(conversation_id));
  create policy "connect-files read members" on storage.objects for select to authenticated
    using (bucket_id='connect-files' and has_permission('connect.view'));

  create or replace function public.connect_emit_attachment_signed_url(p_attachment_id uuid)
  returns jsonb language plpgsql security definer set search_path = public, pg_temp as $fn$
  declare v_conv uuid; v_bucket text; v_path text; v_scan text;
  begin
    select conversation_id, storage_bucket, storage_path, scan_status
      into v_conv, v_bucket, v_path, v_scan from public.connect_attachments where id=p_attachment_id;
    if not found then raise exception 'adjunto inexistente' using errcode='no_data_found'; end if;
    if not (public.has_permission('connect.view') and public._connect_is_member(v_conv)) then
      raise exception 'no autorizado' using errcode='insufficient_privilege'; end if;
    insert into public.audit_log (user_id, entity, entity_id, action, payload)
    values (auth.uid(),'connect_attachment',p_attachment_id,'connect.attachment.access','{}'::jsonb);
    return jsonb_build_object('bucket',v_bucket,'path',v_path,'scan_status',v_scan);
  end; $fn$;

  create or replace function public.connect_search(p_query text, p_limit integer default 30)
  returns table(result_type text, conversation_id uuid, context_id text, kind text, title text,
    snippet text, entity_type text, entity_ref text, occurred_at timestamptz, sort_rank integer)
  language plpgsql security definer set search_path = public, pg_temp as $fn$
  declare v_uid uuid := auth.uid(); v_q tsquery; v_like text; v_lim int := 30;
  begin
    if not public.has_permission('connect.view') then
      raise exception 'Sin permiso connect.view' using errcode='insufficient_privilege'; end if;
    v_like := '%' || btrim(p_query) || '%'; v_q := websearch_to_tsquery('spanish', p_query);
    return query
    with my_convs as (select p.conversation_id from public.connect_participants p where p.profile_id=v_uid)
    select 'message'::text, m.conversation_id, c.context_id, c.kind::text,
           coalesce(c.title,'Mensaje')::text, left(m.body,180), null::text, null::text, m.created_at, 3
      from public.connect_messages m join public.connect_conversations c on c.id=m.conversation_id
     where m.deleted_at is null and m.conversation_id in (select mc.conversation_id from my_convs mc)
       and to_tsvector('spanish', coalesce(m.body,'')) @@ v_q
    union all
    select 'attachment'::text, a.conversation_id, c.context_id, c.kind::text,
           coalesce(a.file_name,'Adjunto')::text, a.mime_type, null::text, null::text, a.created_at, 4
      from public.connect_attachments a join public.connect_conversations c on c.id=a.conversation_id
     where a.conversation_id in (select mc.conversation_id from my_convs mc) and a.file_name ilike v_like
    order by 10 asc, 9 desc nulls last limit v_lim;
  end; $fn$;

  -- Realtime: postgres_changes sólo entrega filas que pasen la policy SELECT
  -- de la tabla para el rol suscripto. La publicación se reproduce acá para
  -- poder afirmar que el canal existe ANTES de razonar sobre qué filtra.
  -- connect_participants se publica desde 0147 y sigue publicada en produccion
  -- (medido el 2026-08-14). Se incluye para que el cierre no sea mas benigno
  -- que la realidad: omitirla escondia una superficie entera.
  create publication supabase_realtime for table
    public.connect_messages, public.connect_attachments, public.connect_conversations,
    public.connect_participants;

  do $rol$ begin
    if not exists (select 1 from pg_roles where rolname='authenticated') then
      create role authenticated nologin; end if; end $rol$;
  grant usage on schema public, auth, storage to authenticated;
  grant select on all tables in schema public to authenticated;
  grant select on storage.objects to authenticated;
  grant execute on all functions in schema public to authenticated;
  grant execute on function storage.foldername(text) to authenticated;
`;

let sb: WaSandbox;
let db: Client;
let convWa = "";
let convDm = "";
let attWaId = "";
let pathWa = "";
let pathDm = "";

async function como<T>(uid: string, sql: string): Promise<T[]> {
  await db.query("set role authenticated");
  await db.query("select set_config('test.observer', $1, false)", [uid]);
  try { const { rows } = await db.query(sql); return rows as T[]; }
  finally { await db.query("reset role"); }
}
const count = async (uid: string, sql: string): Promise<number> =>
  Number((await como<{ n: string }>(uid, sql))[0].n);

beforeAll(async () => {
  sb = await createWaSandbox(inject("dbUrl"));
  db = sb.client;
  await db.query(CIERRE);
  await db.query("insert into auth.users (id) values ($1),($2),($3),($4)",
    [ENCARGADO, COMERCIAL, ADMIN_OK, AJENO]);
  await db.query(`insert into public.profiles (id, role) values
      ($1,'operaciones'::public.user_role_t), ($2,'comercial'::public.user_role_t),
      ($3,'admin'::public.user_role_t), ($4,'operaciones'::public.user_role_t)`,
    [ENCARGADO, COMERCIAL, ADMIN_OK, AJENO]);
  await db.query(`
    insert into public.permissions (slug, module, action, label) values
      ('connect.view','connect','view','Ver'), ('connect.create','connect','create','Crear'),
      ('connect.edit','connect','edit','Editar'), ('connect.admin','connect','admin','Admin');
    insert into public.roles (slug, name) values
      ('jefe-deposito','Jefe de Deposito'), ('comercial','Comercial'),
      ('super-admin','Super Administrador'), ('ajeno','Ajeno');
    insert into public.role_permissions (role_id, permission_id)
    select r.id, p.id from public.roles r join public.permissions p on true
     where (r.name in ('Jefe de Deposito','Comercial','Ajeno')
            and p.slug in ('connect.view','connect.create','connect.edit'))
        or (r.name='Super Administrador' and p.slug like 'connect.%');
  `);
  await db.query(`insert into public.user_roles (user_id, role_id)
    select $1::uuid, id from public.roles where name='Jefe de Deposito'
    union all select $2::uuid, id from public.roles where name='Comercial'
    union all select $3::uuid, id from public.roles where name='Super Administrador'
    union all select $4::uuid, id from public.roles where name='Ajeno'`,
    [ENCARGADO, COMERCIAL, ADMIN_OK, AJENO]);

  // El context_id de un hilo de WhatsApp ES el teléfono de la contraparte
  // (convención wa:E164, fijada a la vez por el importador histórico y por la
  // proyección del inbound vivo). Se siembra tal cual para poder atacar ese
  // dato en particular, y no sólo la fila en abstracto.
  const { rows: w } = await db.query(
    `insert into public.connect_conversations (kind,title,context_id)
     values ('whatsapp'::public.connect_conversation_kind_t,'Cliente Comercial',$1) returning id`,
    [`wa:${TEL_CONTRAPARTE}`]);
  const { rows: d } = await db.query(
    `insert into public.connect_conversations (kind,title,context_id)
     values ('dm'::public.connect_conversation_kind_t,'Coordinacion Deposito','CTX-2026-000001')
     returning id`);
  convWa = w[0].id; convDm = d[0].id;
  // ADVERSARIAL: el encargado ES participante del hilo de WhatsApp.
  await db.query(`insert into public.connect_participants (conversation_id, profile_id) values
     ($1,$2),($1,$3),($4,$2),($4,$3)`, [convWa, ENCARGADO, COMERCIAL, convDm]);
  // Y el participante EXTERNO del hilo, tal como lo escriben el importador
  // (wa-import/ingest.ts) y la proyección del inbound vivo
  // (whatsapp/link-projection.supabase.ts): el teléfono, en claro, en el JSON.
  await db.query(
    `insert into public.connect_participants (conversation_id, profile_id, participant_type, external_ref)
     values ($1, null, 'whatsapp', jsonb_build_object(
        'phone', $2::text, 'side', 'counterpart', 'source', 'meta_cloud_api'))`,
    [convWa, TEL_CONTRAPARTE]);
  await db.query(`insert into public.connect_messages (conversation_id, author_profile_id, body)
     values ($1,null,'presupuesto confidencial del cliente'),($2,$3,'coordinamos la carga')`,
    [convWa, convDm, COMERCIAL]);

  pathWa = `${convWa}/audio/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa`;
  pathDm = `${convDm}/audio/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb`;
  const { rows: a } = await db.query(
    `insert into public.connect_attachments (conversation_id, storage_bucket, storage_path, file_name, mime_type)
     values ($1,'connect-files',$2,'voz-cliente.ogg','audio/ogg') returning id`, [convWa, pathWa]);
  attWaId = a[0].id;
  await db.query(
    `insert into public.connect_attachments (conversation_id, storage_bucket, storage_path, file_name, mime_type)
     values ($1,'connect-files',$2,'voz-deposito.ogg','audio/ogg')`, [convDm, pathDm]);
  await db.query("insert into storage.objects (bucket_id, name) values ('connect-files',$1),('connect-files',$2)",
    [pathWa, pathDm]);
}, 120_000);

afterAll(async () => { await sb?.destroy(); });

describe("T-LINK-B1-02 · el ANTES: cuatro superficies abiertas", () => {
  it("con las policies previas el encargado lee mensajes, adjuntos, busca y accede al bucket", async () => {
    expect(await count(ENCARGADO, `select count(*)::text n from public.connect_messages where conversation_id='${convWa}'`)).toBe(1);
    expect(await count(ENCARGADO, `select count(*)::text n from public.connect_attachments where conversation_id='${convWa}'`)).toBe(1);
    expect(await count(ENCARGADO, "select count(*)::text n from public.connect_search('presupuesto')")).toBe(1);
    // Y el objeto del bucket, conociendo la ruta.
    expect(await count(ENCARGADO, `select count(*)::text n from storage.objects where name='${pathWa}'`)).toBe(1);
    // Incluso uno de una conversación de la que NO es participante:
    expect(await count(AJENO, `select count(*)::text n from storage.objects where name='${pathDm}'`)).toBe(1);
  });
});

describe("T-LINK-B1-02 · después de 0236+0237: las nueve superficies", () => {
  it("se aplican las migraciones reales", async () => {
    await db.query(readFileSync(M0236, "utf8"));
    await db.query(readFileSync(M0237, "utf8"));
    await db.query("grant execute on all functions in schema public to authenticated");
    await db.query("grant select on all tables in schema public to authenticated");
  });

  it("1 · lectura de mensajes: DENEGADA (y con ella el realtime)", async () => {
    // `postgres_changes` aplica esta misma policy: sin fila visible no hay evento.
    expect(await count(ENCARGADO, `select count(*)::text n from public.connect_messages where conversation_id='${convWa}'`)).toBe(0);
  });

  it("2 · la conversación misma: DENEGADA", async () => {
    expect(await count(ENCARGADO, `select count(*)::text n from public.connect_conversations where id='${convWa}'`)).toBe(0);
  });

  it("3 · adjuntos: DENEGADOS", async () => {
    expect(await count(ENCARGADO, `select count(*)::text n from public.connect_attachments where conversation_id='${convWa}'`)).toBe(0);
  });

  it("4 · búsqueda por mensaje y por adjunto: sin resultados de WhatsApp", async () => {
    expect(await count(ENCARGADO, "select count(*)::text n from public.connect_search('presupuesto')")).toBe(0);
    expect(await count(ENCARGADO, "select count(*)::text n from public.connect_search('voz-cliente')")).toBe(0);
    // Pero su chat interno sigue buscándose.
    expect(await count(ENCARGADO, "select count(*)::text n from public.connect_search('coordinamos')")).toBe(1);
  });

  it("5 · signed URL: conocer el UUID del adjunto no alcanza", async () => {
    await expect(
      como(ENCARGADO, `select public.connect_emit_attachment_signed_url('${attWaId}'::uuid)`),
    ).rejects.toThrow(/no autorizado/);
  });

  it("6 · Storage: conocer la ruta exacta no alcanza", async () => {
    expect(await count(ENCARGADO, `select count(*)::text n from storage.objects where name='${pathWa}'`)).toBe(0);
  });

  it("7 · un ajeno tampoco accede al objeto de una conversación que no integra", async () => {
    expect(await count(AJENO, `select count(*)::text n from storage.objects where name='${pathDm}'`)).toBe(0);
  });

  it("8 · legacy connect.view/create/edit sigue concedido y NO es bypass", async () => {
    expect(await count(ENCARGADO,
      `select count(*)::text n from public.user_roles ur
         join public.role_permissions rp on rp.role_id=ur.role_id
         join public.permissions p on p.id=rp.permission_id
        where ur.user_id=auth.uid() and p.slug like 'connect.%'`)).toBe(3);
    expect(await count(ENCARGADO, `select count(*)::text n from public.connect_messages where conversation_id='${convWa}'`)).toBe(0);
  });

  it("9 · profiles.role='admin' sin asignación administrativa NO es bypass", async () => {
    await db.query("update public.profiles set role='admin'::public.user_role_t where id=$1", [ENCARGADO]);
    try {
      expect(await count(ENCARGADO, `select count(*)::text n from public.connect_messages where conversation_id='${convWa}'`)).toBe(0);
      expect(await count(ENCARGADO, `select count(*)::text n from public.connect_conversations where id='${convWa}'`)).toBe(0);
      expect(await count(ENCARGADO, `select count(*)::text n from storage.objects where name='${pathWa}'`)).toBe(0);
    } finally {
      await db.query("update public.profiles set role='operaciones'::public.user_role_t where id=$1", [ENCARGADO]);
    }
  });
});

describe("T-LINK-B1-02 · sin regresiones para quien SÍ tiene la capacidad", () => {
  it("el operador comercial conserva mensajes, adjuntos, búsqueda, signed URL y objeto", async () => {
    expect(await count(COMERCIAL, `select count(*)::text n from public.connect_messages where conversation_id='${convWa}'`)).toBe(1);
    expect(await count(COMERCIAL, `select count(*)::text n from public.connect_attachments where conversation_id='${convWa}'`)).toBe(1);
    expect(await count(COMERCIAL, "select count(*)::text n from public.connect_search('presupuesto')")).toBe(1);
    expect(await count(COMERCIAL, `select count(*)::text n from storage.objects where name='${pathWa}'`)).toBe(1);
    const r = await como<{ x: Record<string, string> }>(
      COMERCIAL, `select public.connect_emit_attachment_signed_url('${attWaId}'::uuid) as x`);
    expect(r[0].x.path).toBe(pathWa);
  });

  it("el administrador real conserva acceso", async () => {
    expect(await count(ADMIN_OK, `select count(*)::text n from public.connect_conversations where id='${convWa}'`)).toBe(1);
  });

  it("el chat interno del encargado sigue completo: lectura, adjunto y objeto", async () => {
    expect(await count(ENCARGADO, `select count(*)::text n from public.connect_messages where conversation_id='${convDm}'`)).toBe(1);
    expect(await count(ENCARGADO, `select count(*)::text n from public.connect_attachments where conversation_id='${convDm}'`)).toBe(1);
    expect(await count(ENCARGADO, `select count(*)::text n from storage.objects where name='${pathDm}'`)).toBe(1);
  });
});

describe("T-LINK-B1-02 · Storage: la autoridad es el REGISTRO, no la ruta", () => {
  it("ruta con prefijo engañoso (conversación propia) pero sin registro: DENEGADA", async () => {
    const enganosa = `${convDm}/audio/no-registrada`;
    await db.query("insert into storage.objects (bucket_id, name) values ('connect-files',$1)", [enganosa]);
    expect(await count(ENCARGADO, `select count(*)::text n from storage.objects where name='${enganosa}'`)).toBe(0);
  });

  it("registro cuya ruta NO coincide con su conversación: DENEGADO", async () => {
    const discrepante = `${convDm}/audio/discrepante`;
    await db.query(
      `insert into public.connect_attachments (conversation_id, storage_bucket, storage_path, file_name)
       values ($1,'connect-files',$2,'x.ogg')`, [convWa, discrepante]); // registro dice WA, ruta dice DM
    await db.query("insert into storage.objects (bucket_id, name) values ('connect-files',$1)", [discrepante]);
    expect(await count(ENCARGADO, `select count(*)::text n from storage.objects where name='${discrepante}'`)).toBe(0);
    expect(await count(COMERCIAL, `select count(*)::text n from storage.objects where name='${discrepante}'`)).toBe(0);
  });

  it("ruta malformada, sin UUID o de conversación inexistente: DENEGADA", async () => {
    for (const n of ["sin-carpeta.ogg", "no-es-uuid/audio/x", "00000000-0000-4000-8000-000000000000/audio/y"]) {
      await db.query("insert into storage.objects (bucket_id, name) values ('connect-files',$1)", [n]);
      expect(await count(COMERCIAL, `select count(*)::text n from storage.objects where name='${n}'`), n).toBe(0);
    }
  });

  it("los objetos legítimos preexistentes siguen accesibles para su participante", async () => {
    expect(await count(COMERCIAL, `select count(*)::text n from storage.objects where name='${pathWa}'`)).toBe(1);
    expect(await count(ENCARGADO, `select count(*)::text n from storage.objects where name='${pathDm}'`)).toBe(1);
  });

  it("ningún objeto quedó públicamente legible: sin sesión no se ve nada", async () => {
    await db.query("set role authenticated");
    await db.query("select set_config('test.observer','',false)");
    try {
      const { rows } = await db.query("select count(*)::int n from storage.objects");
      expect(rows[0].n).toBe(0);
    } finally { await db.query("reset role"); }
  });
});

describe("T-LINK-B1-02 · premisas de endurecimiento de los helpers (demostradas)", () => {
  it("dueño de funciones == dueño de tablas, y FORCE RLS apagado ⇒ sin recursión", async () => {
    const { rows } = await db.query(`
      select
        (select count(*)::int from pg_class c join pg_namespace n on n.oid=c.relnamespace
          where n.nspname='public'
            and c.relname in ('connect_conversations','connect_messages','connect_attachments',
                              'connect_participants','permissions','role_permissions','user_roles','profiles')
            and c.relforcerowsecurity) as con_force_rls,
        (select count(distinct pg_get_userbyid(c.relowner))::int from pg_class c join pg_namespace n on n.oid=c.relnamespace
          where n.nspname='public' and c.relname in ('connect_conversations','connect_attachments')) as duenos_tablas,
        (select count(distinct pg_get_userbyid(p.proowner))::int from pg_proc p join pg_namespace n on n.oid=p.pronamespace
          where n.nspname='public' and p.proname in ('_connect_channel_allowed','_connect_storage_object_allowed','nexus_link_can')) as duenos_fns
    `);
    // Si alguien activara FORCE, el definer volvería a entrar por la policy.
    expect(rows[0].con_force_rls, "FORCE ROW LEVEL SECURITY rompería la premisa").toBe(0);
    expect(rows[0].duenos_tablas).toBe(1);
    expect(rows[0].duenos_fns).toBe(1);
  });

  it("los tres helpers son SECDEF con search_path fijo", async () => {
    const { rows } = await db.query(`
      select p.proname, p.prosecdef, coalesce(array_to_string(p.proconfig,','),'') as cfg
        from pg_proc p join pg_namespace n on n.oid=p.pronamespace
       where n.nspname='public'
         and p.proname in ('_connect_channel_allowed','_connect_storage_object_allowed','nexus_link_can')
       order by p.proname`);
    expect(rows).toHaveLength(3);
    for (const r of rows) {
      expect(r.prosecdef, r.proname).toBe(true);
      expect(r.cfg, r.proname).toContain("search_path=public");
    }
  });

  it("no exponen EXECUTE a PUBLIC ni a anon", async () => {
    const { rows } = await db.query(`
      select p.proname, coalesce(array_to_string(p.proacl,','),'') as acl
        from pg_proc p join pg_namespace n on n.oid=p.pronamespace
       where n.nspname='public'
         and p.proname in ('_connect_channel_allowed','_connect_storage_object_allowed','nexus_link_can')`);
    for (const r of rows) {
      expect(r.acl, `${r.proname} no debe conceder a PUBLIC`).not.toMatch(/(^|,)=X/);
      expect(r.acl, `${r.proname} no debe conceder a anon`).not.toContain("anon=");
      expect(r.acl, `${r.proname} debe conceder a authenticated`).toContain("authenticated=X");
    }
  });

  it("no hay recursión: la consulta resuelve sin agotar la pila", async () => {
    // Una policy recursiva se manifestaría como stack depth exceeded o cuelgue.
    const r = await como<{ n: string }>(COMERCIAL,
      "select count(*)::text n from public.connect_conversations");
    expect(Number(r[0].n)).toBeGreaterThan(0);
  });
});

describe("T-LINK-B1-02 · Realtime AUTENTICADO", () => {
  /**
   * Realtime no tiene un filtro propio: `postgres_changes` entrega un cambio a
   * un suscriptor sólo si la POLICY SELECT de la tabla lo deja ver esa fila,
   * evaluada con SU identidad. Por eso lo que se ejercita acá es exactamente
   * eso —el predicado bajo cada observador—, y no un cliente de websocket: el
   * websocket no agrega ninguna decisión que no esté ya en la policy.
   */
  it("las cuatro tablas están publicadas: hay canal del que hablar", async () => {
    const { rows } = await db.query(
      `select tablename from pg_publication_tables
        where pubname='supabase_realtime' order by 1`);
    expect(rows.map((r) => r.tablename)).toEqual(
      ["connect_attachments", "connect_conversations", "connect_messages",
       "connect_participants"]);
  });

  it("el encargado NO recibe eventos de WhatsApp, aunque sea participante", async () => {
    // Es el caso adversarial: participa del hilo y conserva connect.view.
    expect(await count(ENCARGADO,
      `select count(*)::text n from public.connect_messages where conversation_id='${convWa}'`)).toBe(0);
    expect(await count(ENCARGADO,
      `select count(*)::text n from public.connect_attachments where conversation_id='${convWa}'`)).toBe(0);
    expect(await count(ENCARGADO,
      `select count(*)::text n from public.connect_conversations where id='${convWa}'`)).toBe(0);
  });

  it("el encargado SÍ sigue recibiendo los de su chat interno", async () => {
    // La frontera es de CANAL, no una mordaza: si esto fuera 0, el arreglo
    // habría roto la operación en vez de acotarla.
    expect(await count(ENCARGADO,
      `select count(*)::text n from public.connect_messages where conversation_id='${convDm}'`)).toBe(1);
    expect(await count(ENCARGADO,
      `select count(*)::text n from public.connect_conversations where id='${convDm}'`)).toBe(1);
  });

  it("el comercial SÍ recibe los de WhatsApp", async () => {
    // Se compara CONTRA el encargado en la misma consulta, en vez de fijar un
    // número: lo que importa es que uno vea y el otro no, y un total exacto
    // ataría este caso a cuántas filas dejaron los anteriores.
    const q = (t: string) =>
      `select count(*)::text n from public.${t} where conversation_id='${convWa}'`;
    for (const tabla of ["connect_messages", "connect_attachments"]) {
      expect(await count(COMERCIAL, q(tabla))).toBeGreaterThan(0);
      expect(await count(ENCARGADO, q(tabla))).toBe(0);
    }
  });

  it("ningún payload prohibido llega al cliente: el cuerpo del mensaje tampoco", async () => {
    // No alcanza con que el conteo sea 0: si la fila viajara con el texto
    // adentro, el contador podría mentir y el contenido filtrarse igual.
    const filas = await como<{ body: string }>(ENCARGADO,
      `select body from public.connect_messages where conversation_id='${convWa}'`);
    expect(filas).toEqual([]);
    const adjuntos = await como<{ file_name: string }>(ENCARGADO,
      `select file_name from public.connect_attachments where conversation_id='${convWa}'`);
    expect(adjuntos).toEqual([]);
  });

  it("un INSERT nuevo tampoco se le entrega al encargado", async () => {
    // El evento que Realtime emitiría es sobre esta fila recién creada.
    const q = `select count(*)::text n from public.connect_messages where conversation_id='${convWa}'`;
    const antes = await count(COMERCIAL, q);
    const { rows } = await db.query(
      `insert into public.connect_messages (conversation_id, author_profile_id, body)
       values ($1, $2, 'nuevo presupuesto del cliente') returning id`, [convWa, COMERCIAL]);
    try {
      // El comercial ve la fila nueva; el encargado sigue sin ver ninguna.
      expect(await count(COMERCIAL, q)).toBe(antes + 1);
      expect(await count(ENCARGADO, q)).toBe(0);
    } finally {
      // El caso deja el hilo como lo encontró: los que siguen cuentan filas y
      // un residuo mío haría fallar pruebas ajenas por una causa inventada.
      await db.query("delete from public.connect_messages where id=$1", [rows[0].id]);
    }
  });
});

describe("T-LINK-B1-02 · el TELÉFONO del contacto (ficha de contacto, FASE B)", () => {
  /**
   * La ficha «Información del contacto» no agrega una fuente nueva: lee el
   * `context_id` de la conversación, que ya contenía el teléfono desde el día
   * uno. Por eso su superficie de fuga es exactamente la de la fila, y es esa
   * la que se ataca acá — nombrando el dato, no la tabla.
   *
   * Medido en producción (2026-08-14, sólo lectura): 20 de 20 conversaciones
   * `kind='whatsapp'` tienen `context_id like 'wa:%'` y las 20 validan E.164.
   * `wa_identities` cubre 5 de 20 y tiene RLS activa con CERO políticas, así
   * que `authenticated` no puede leerla en ningún caso: por eso NO es la
   * fuente de la ficha.
   *
   * ⚠️ Lo de acá abajo cubre `connect_conversations`, `connect_messages`,
   * `connect_attachments` y la búsqueda. NO cubre `connect_participants`, que
   * guarda el mismo teléfono y SIGUE ABIERTA: ver el describe siguiente.
   */

  it("el teléfono vive en el context_id, y el usuario autorizado lo obtiene", async () => {
    const r = await como<{ context_id: string }>(COMERCIAL,
      `select context_id from public.connect_conversations where id='${convWa}'`);
    expect(r).toHaveLength(1);
    expect(r[0].context_id).toBe(`wa:${TEL_CONTRAPARTE}`);
  });

  it("b · el encargado NO recibe el teléfono, aunque sea participante del hilo", async () => {
    expect(await count(ENCARGADO,
      `select count(*)::text n from public.connect_conversations
        where id='${convWa}' and context_id is not null`)).toBe(0);
  });

  it("c · conocer el UUID exacto no cambia nada: misma respuesta que si no existiera", async () => {
    const real = await como(ENCARGADO,
      `select context_id from public.connect_conversations where id='${convWa}'`);
    const inventado = await como(ENCARGADO,
      "select context_id from public.connect_conversations where id='99999999-9999-4999-8999-999999999999'");
    expect(real).toEqual([]);
    expect(inventado).toEqual([]);
  });

  it("tampoco por barrido: pedir TODOS los context_id de WhatsApp devuelve cero", async () => {
    // Un atacante que ni siquiera sepa el UUID podría intentar el patrón.
    expect(await count(ENCARGADO,
      "select count(*)::text n from public.connect_conversations where context_id like 'wa:%'")).toBe(0);
    // Y el comercial, que sí puede, lo ve: la consulta no está rota.
    expect(await count(COMERCIAL,
      "select count(*)::text n from public.connect_conversations where context_id like 'wa:%'")).toBe(1);
  });

  it("la búsqueda tampoco lo devuelve: connect_search proyecta context_id", async () => {
    // `connect_search` incluye `context_id` entre sus columnas: si filtrara por
    // conversación pero no por canal, el teléfono saldría por acá.
    expect(await count(ENCARGADO,
      `select count(*)::text n from public.connect_search('presupuesto')
        where context_id is not null and context_id like 'wa:%'`)).toBe(0);
  });

  it("d · el chat interno sigue entero: su propio context_id se lee sin problema", async () => {
    const r = await como<{ context_id: string }>(ENCARGADO,
      `select context_id from public.connect_conversations where id='${convDm}'`);
    expect(r).toHaveLength(1);
    expect(r[0].context_id).toBe("CTX-2026-000001");
  });

  it("g · barrido con SEÑAL REAL por conversación, mensaje y adjunto", async () => {
    // El barrido no sirve de nada si el número no está en ninguna de las
    // columnas barridas: pasaría igual con la RLS apagada. Así que se planta
    // el teléfono EN los tres lugares, se mide, y se retira.
    const { rows: m } = await db.query(
      `insert into public.connect_messages (conversation_id, author_profile_id, body)
       values ($1, null, $2) returning id`,
      [convWa, `llamar al ${TEL_CONTRAPARTE} por el remito`]);
    const { rows: a } = await db.query(
      `insert into public.connect_attachments (conversation_id, storage_bucket, storage_path, file_name, mime_type)
       values ($1,'connect-files',$2,$3,'image/jpeg') returning id`,
      [convWa, `${convWa}/files/cccccccc-cccc-4ccc-8ccc-cccccccccccc`,
       `remito-${TEL_CONTRAPARTE}.jpg`]);
    const barrido = `
      select (
        (select count(*) from public.connect_conversations
          where coalesce(context_id,'')||coalesce(title,'')||coalesce(topic,'') like '%${TEL_CONTRAPARTE}%')
      + (select count(*) from public.connect_messages where coalesce(body,'') like '%${TEL_CONTRAPARTE}%')
      + (select count(*) from public.connect_attachments where coalesce(file_name,'') like '%${TEL_CONTRAPARTE}%')
      )::text n`;
    try {
      // CONTROL POSITIVO: el comercial encuentra las tres apariciones.
      expect(await count(COMERCIAL, barrido)).toBe(3);
      // Y el encargado, ninguna.
      expect(await count(ENCARGADO, barrido)).toBe(0);
    } finally {
      await db.query("delete from public.connect_attachments where id=$1", [a[0].id]);
      await db.query("delete from public.connect_messages where id=$1", [m[0].id]);
    }
  });

  it("la búsqueda del comercial SÍ devuelve el hilo: la consulta no está rota", async () => {
    // Control positivo del caso anterior sobre connect_search: sin él, un cero
    // para el encargado podría deberse a que la búsqueda no devuelve nada a
    // nadie, y no a la frontera de canal.
    expect(await count(COMERCIAL,
      `select count(*)::text n from public.connect_search('presupuesto')
        where context_id = 'wa:${TEL_CONTRAPARTE}'`)).toBe(1);
  });
});

describe("T-LINK-B1-02 · HALLAZGO ABIERTO · el teléfono TAMBIÉN vive en connect_participants", () => {
  /**
   * ─── ESTE BLOQUE DOCUMENTA UNA FUGA QUE SIGUE ABIERTA ────────────────────
   *
   * `context_id` no es el único lugar donde está el teléfono. El importador
   * (`connect/wa-import/ingest.ts`) y la proyección del inbound vivo
   * (`whatsapp/link-projection.supabase.ts`) escriben el número EN CLARO dentro
   * de `connect_participants.external_ref->>'phone'`.
   *
   * Y la policy SELECT de esa tabla —`0143:372-375`, reproducida literal en el
   * cierre de esta suite— NO tiene predicado de canal. Ni `0236` ni `0237` la
   * tocan: `0237` enumera las superficies que cierra y `connect_participants`
   * no está entre ellas.
   *
   * Medido en producción el 2026-08-14 (sólo lectura):
   *   · 26 participantes `participant_type='whatsapp'`
   *   · 21 con un E.164 válido en `external_ref->>'phone'`
   *   · la tabla está publicada en `supabase_realtime`
   *
   * Los casos de abajo AFIRMAN LA FUGA. Cuando se cierre, van a fallar, y ese
   * fallo es la señal correcta: obliga a actualizar este bloque en el mismo
   * commit que la corrige, en vez de dejar una prueba verde que ya no describe
   * nada. Un test que afirmara lo contrario hoy sería sencillamente falso.
   */

  it("el encargado SIN capacidad de WhatsApp lee el teléfono de la contraparte", async () => {
    const r = await como<{ phone: string }>(ENCARGADO,
      `select external_ref->>'phone' as phone from public.connect_participants
        where participant_type='whatsapp'`);
    expect(r).toHaveLength(1);
    expect(r[0].phone).toBe(TEL_CONTRAPARTE); // ⇠ fuga confirmada
  });

  it("y le llega por realtime, porque la tabla está publicada", async () => {
    // `postgres_changes` entrega la fila si la policy SELECT la deja ver. Ya se
    // demostró que la deja; falta sólo que exista el canal.
    const { rows } = await db.query(
      `select count(*)::int n from pg_publication_tables
        where pubname='supabase_realtime' and tablename='connect_participants'`);
    expect(rows[0].n).toBe(1);
  });

  it("un usuario AJENO al hilo no la ve: la membresía sigue rigiendo", async () => {
    // Acota el alcance del hallazgo: no es una tabla pública. La fuga alcanza a
    // participantes del hilo —el escenario exacto que 0236 declara amenaza— y a
    // `is_admin()`, que 0236 quitó a propósito de `nexus_link_can()`.
    expect(await count(AJENO,
      "select count(*)::text n from public.connect_participants where participant_type='whatsapp'"))
      .toBe(0);
    expect(await count(ADMIN_OK,
      "select count(*)::text n from public.connect_participants where participant_type='whatsapp'"))
      .toBe(1);
  });
});

describe("T-LINK-B1-02 · reversibilidad", () => {
  it("el ROLLBACK restaura las cuatro superficies previas", async () => {
    await db.query(readFileSync(R0237, "utf8"));
    await db.query("grant execute on all functions in schema public to authenticated");
    expect(await count(ENCARGADO, `select count(*)::text n from public.connect_messages where conversation_id='${convWa}'`)).toBe(1);
    expect(await count(ENCARGADO, `select count(*)::text n from storage.objects where name='${pathWa}'`)).toBe(1);
    const { rows } = await db.query(
      `select count(*)::int n from pg_proc p join pg_namespace nn on nn.oid=p.pronamespace
        where nn.nspname='public' and p.proname in ('_connect_channel_allowed','_connect_storage_object_allowed')`);
    expect(rows[0].n).toBe(0);
  });
});
