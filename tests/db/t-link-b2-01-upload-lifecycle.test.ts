/**
 * T-LINK-B2-01 · Ciclo de vida de la subida (migración 0238) sobre PostgreSQL real.
 *
 * Lo que se demuestra acá no se puede demostrar con dobles: que finalize y
 * limpieza NO pueden ganar los dos, que un finalize gemelo no rompe ni duplica,
 * y que conocer una ruta ajena no alcanza para adoptarla.
 *
 * Las carreras se fuerzan con TRANSACCIONES ABIERTAS en conexiones distintas,
 * no con `Promise.all` y esperanza: una conexión toma el candado y la otra
 * queda bloqueada de verdad contra el mismo registro. El resultado es
 * determinista y reproduce el comportamiento real del motor, incluido el
 * `skip locked` del barrido.
 */

import { afterAll, beforeAll, describe, expect, it, inject } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Client } from "pg";
import { createWaSandbox, type WaSandbox } from "./harness/wa-sandbox";

const MIG = (f: string) => resolve(__dirname, "..", "..", "supabase", "migrations", f);
const M0236 = MIG("0236_nexus_link_channel_capabilities.sql");
const M0237 = MIG("0237_nexus_link_channel_rls.sql");
const M0238 = MIG("0238_nexus_link_upload_lifecycle.sql");
const R0238 = MIG("ROLLBACK_0238_nexus_link_upload_lifecycle.sql");

const COMERCIAL = "22222222-2222-4222-8222-222222222222";
const ENCARGADO = "11111111-1111-4111-8111-111111111111";
const AJENO = "55555555-5555-4555-8555-555555555555";

/** Cierre acotado: lo mínimo que 0236/0237/0238 necesitan para existir. */
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
  create table public.permissions (id uuid primary key default gen_random_uuid(), slug text unique not null,
    module text, action text, name text, description text);
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
  create table public.connect_participants (
    id uuid primary key default gen_random_uuid(),
    conversation_id uuid not null references public.connect_conversations(id) on delete cascade,
    profile_id uuid, last_read_seq bigint not null default 0, muted_until timestamptz,
    is_favorite boolean not null default false, unique (conversation_id, profile_id));
  create table public.connect_messages (
    id uuid primary key default gen_random_uuid(),
    conversation_id uuid not null references public.connect_conversations(id) on delete cascade,
    seq bigint generated always as identity, author_profile_id uuid,
    author_participant_id uuid, body text, body_format text default 'text',
    client_msg_id uuid,
    kind public.connect_message_kind_t not null default 'text',
    deleted_at timestamptz, created_at timestamptz not null default now());
  -- Reproducción EXACTA del índice productivo connect_messages_client_msg_uidx
  -- (medido 2026-08-14): es lo que hace que un lote publique UN solo mensaje.
  create unique index connect_messages_client_msg_uidx on public.connect_messages
    (conversation_id, author_profile_id, client_msg_id) where client_msg_id is not null;
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

  create table storage.objects (
    id uuid primary key default gen_random_uuid(), bucket_id text, name text,
    unique (bucket_id, name));
  create table storage.buckets (
    id text primary key, public boolean default false,
    file_size_limit bigint, allowed_mime_types text[]);
  insert into storage.buckets (id, file_size_limit, allowed_mime_types) values
    ('connect-files', 26214400, array[
      'image/jpeg','image/png','image/webp','image/gif',
      'application/pdf','text/plain','text/csv',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'audio/webm','audio/mp4','audio/ogg','audio/mpeg']);
  create or replace function storage.foldername(name text) returns text[]
    language sql immutable as $fn$
      select string_to_array(regexp_replace(name, '/[^/]*$', ''), '/') $fn$;
  alter table storage.objects enable row level security;

  alter table public.connect_conversations enable row level security;
  alter table public.connect_messages      enable row level security;
  alter table public.connect_attachments   enable row level security;
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
    return jsonb_build_object('bucket',v_bucket,'path',v_path,'scan_status',v_scan);
  end; $fn$;

  create or replace function public.connect_search(p_query text, p_limit integer default 30)
  returns table(result_type text, conversation_id uuid, context_id text, kind text, title text,
    snippet text, entity_type text, entity_ref text, occurred_at timestamptz, sort_rank integer)
  language plpgsql security definer set search_path = public, pg_temp as $fn$
  begin
    return query select null::text, null::uuid, null::text, null::text, null::text,
      null::text, null::text, null::text, null::timestamptz, null::integer where false;
  end; $fn$;

  do $rol$ begin
    if not exists (select 1 from pg_roles where rolname='authenticated') then
      create role authenticated nologin; end if;
    if not exists (select 1 from pg_roles where rolname='service_role') then
      create role service_role nologin; end if;
    if not exists (select 1 from pg_roles where rolname='anon') then
      create role anon nologin; end if;
  end $rol$;
  grant usage on schema public, auth, storage to authenticated, service_role;
  grant select on all tables in schema public to authenticated;
  grant select on storage.objects to authenticated;
  grant execute on all functions in schema public to authenticated;
`;

let sb: WaSandbox;
let db: Client;
let convDm = "";
let convOtra = "";
let convWa = "";

/** Ejecuta como `authenticated` con un observador dado. */
async function como<T>(c: Client, uid: string, sql: string, params: unknown[] = []): Promise<T[]> {
  await c.query("set role authenticated");
  await c.query("select set_config('test.observer', $1, false)", [uid]);
  try {
    const { rows } = await c.query(sql, params);
    return rows as T[];
  } finally {
    await c.query("reset role");
  }
}

/** Abre una subida y devuelve su path (elegido por el servidor). */
async function abrir(conv: string, uid = COMERCIAL): Promise<string> {
  const r = await como<{ object_path: string }>(
    db, uid, "select * from public.connect_upload_begin($1::uuid)", [conv],
  );
  return r[0].object_path;
}

const claim = async (c: Client, uid: string, conv: string, path: string): Promise<string> =>
  (await como<{ connect_upload_claim_finalize: string }>(
    c, uid, "select public.connect_upload_claim_finalize($1::uuid,'connect-files',$2)", [conv, path],
  ))[0].connect_upload_claim_finalize;

/**
 * Deja la conexión lista para atacar y devuelve el disparo como una sola
 * consulta.
 *
 * Importa: si el `set role` viajara junto con el ataque dentro de la misma
 * promesa, el commit de la otra conexión podría llegar ANTES de que la consulta
 * conflictiva siquiera empiece, y la carrera no ocurriría — la prueba pasaría
 * sin haber probado nada. Preparando la sesión por separado, lo único pendiente
 * es la consulta que tiene que bloquearse.
 */
async function armar(c: Client, uid: string): Promise<void> {
  await c.query("set role authenticated");
  await c.query("select set_config('test.observer', $1, false)", [uid]);
}

const disparar = (c: Client, conv: string, path: string): Promise<string> =>
  c.query("select public.connect_upload_claim_finalize($1::uuid,'connect-files',$2) v", [conv, path])
    .then((r) => r.rows[0].v as string);

const estado = async (path: string): Promise<string> =>
  (await db.query("select status from public.connect_pending_uploads where storage_path=$1", [path]))
    .rows[0]?.status;

/**
 * Envejece la subida sin esperar el reloj.
 *
 * Se mueve TAMBIÉN `created_at`, no sólo los vencimientos: el CHECK
 * `purgeable_at >= created_at + upload_url_ttl_seconds` rechaza cualquier fila
 * cuya purga se abra antes de que el token pueda morir, y una fila «nacida
 * ahora pero ya purgable» es justamente esa fila imposible. Envejecerla entera
 * es la simulación honesta; la otra sería falsificar el invariante.
 */
const vencer = async (path: string): Promise<void> => {
  await db.query(
    `update public.connect_pending_uploads
        set created_at        = now() - interval '4 hours',
            finalize_deadline = now() - interval '1 hour',
            purgeable_at      = now() - interval '1 minute'
      where storage_path = $1`, [path]);
};

/**
 * Abre SÓLO la ventana del barrido, dejando el finalize todavía vivo.
 *
 * En producción esto no puede pasar: `purgeable_at` es siempre posterior a
 * `finalize_deadline`, así que las dos ventanas son disjuntas y la carrera no
 * llega a existir. Se la fabrica igual, porque una propiedad que sólo se
 * sostiene mientras nadie toque las constantes no es una garantía: se exige que
 * la transición decida bien aunque las ventanas se superpongan.
 */
const abrirBarridoAntesDeTiempo = async (path: string): Promise<void> => {
  // El CHECK sigue respetándose: la fila se envejece lo justo para que su
  // ventana de purga ya esté abierta, dejando el finalize todavía vivo.
  await db.query(
    `update public.connect_pending_uploads
        set created_at   = now() - interval '3 hours',
            purgeable_at = now() - interval '1 minute'
      where storage_path = $1`, [path]);
};

const barrer = async (c: Client = db, limite = 100) =>
  (await c.query("select * from public.connect_upload_reclaim_expired($1)", [limite])).rows as
    Array<{ upload_id: string; bucket_id: string; object_path: string }>;

beforeAll(async () => {
  sb = await createWaSandbox(inject("dbUrl"));
  db = sb.client;
  await db.query(CIERRE);
  await db.query("insert into auth.users (id) values ($1),($2),($3)", [COMERCIAL, ENCARGADO, AJENO]);
  await db.query(`insert into public.profiles (id, role) values
      ($1,'comercial'::public.user_role_t), ($2,'operaciones'::public.user_role_t),
      ($3,'operaciones'::public.user_role_t)`, [COMERCIAL, ENCARGADO, AJENO]);
  await db.query(`
    insert into public.permissions (slug, module, action, name) values
      ('connect.view','connect','view','Ver'), ('connect.create','connect','create','Crear'),
      ('connect.edit','connect','edit','Editar'), ('connect.admin','connect','admin','Admin');
    insert into public.roles (slug, name) values
      ('comercial','Comercial'), ('jefe-deposito','Jefe de Deposito'), ('ajeno','Ajeno');
    insert into public.role_permissions (role_id, permission_id)
    select r.id, p.id from public.roles r join public.permissions p on true
     where p.slug in ('connect.view','connect.create','connect.edit');
  `);
  await db.query(`insert into public.user_roles (user_id, role_id)
    select $1::uuid, id from public.roles where name='Comercial'
    union all select $2::uuid, id from public.roles where name='Jefe de Deposito'
    union all select $3::uuid, id from public.roles where name='Ajeno'`,
    [COMERCIAL, ENCARGADO, AJENO]);

  // 0236 → 0237 → 0238, en el orden en que se aplican en producción.
  await db.query(readFileSync(M0236, "utf8"));
  await db.query(readFileSync(M0237, "utf8"));
  await db.query(readFileSync(M0238, "utf8"));

  const mk = async (kind: string, title: string): Promise<string> =>
    (await db.query(
      `insert into public.connect_conversations (kind,title)
       values ($1::public.connect_conversation_kind_t,$2) returning id`, [kind, title])).rows[0].id;
  convDm = await mk("dm", "Coordinacion");
  convOtra = await mk("dm", "Otra coordinacion");
  convWa = await mk("whatsapp", "Cliente");
  // ADVERSARIAL: el encargado ES participante del hilo de WhatsApp, así que la
  // negación tiene que venir de la CAPACIDAD DE CANAL y no de la membresía.
  await db.query(`insert into public.connect_participants (conversation_id, profile_id) values
     ($1,$2),($1,$3),($4,$2),($4,$3),($5,$2),($5,$3)`,
    [convDm, COMERCIAL, ENCARGADO, convOtra, convWa]);
}, 120_000);

afterAll(async () => { await sb?.destroy(); });

// ═══════════════════ apertura: la identidad la pone el servidor ═══════════

describe("connect_upload_begin · la propiedad no viene del navegador", () => {
  it("el path lo elige el servidor y cae bajo la conversación", async () => {
    const path = await abrir(convDm);
    expect(path.startsWith(`${convDm}/files/`)).toBe(true);
    // Dos aperturas nunca colisionan: el nonce es del servidor.
    expect(await abrir(convDm)).not.toBe(path);
  });

  it("registra dueño, canal y las dos ventanas", async () => {
    const path = await abrir(convDm);
    const { rows } = await db.query(
      `select initiated_by, channel::text, status,
              finalize_deadline > now() as vigente,
              purgeable_at > finalize_deadline as gracia
         from public.connect_pending_uploads where storage_path=$1`, [path]);
    expect(rows[0]).toMatchObject({
      initiated_by: COMERCIAL, channel: "dm", status: "pending", vigente: true, gracia: true,
    });
  });

  it("sin membresía no se puede abrir una subida", async () => {
    await expect(abrir(convDm, AJENO)).rejects.toThrow(/No tenés acceso/);
  });

  it("sin capacidad de canal tampoco: el encargado no abre subidas de WhatsApp", async () => {
    await expect(abrir(convWa, ENCARGADO)).rejects.toThrow(/No tenés acceso/);
  });
});

// ═══════════════════ adopción: conocer la ruta no alcanza ═════════════════

describe("adopción ajena", () => {
  it("otro usuario NO puede adoptar el objeto aunque conozca el path", async () => {
    const path = await abrir(convDm);
    expect(await claim(db, ENCARGADO, convDm, path)).toBe("denied");
    expect(await estado(path)).toBe("pending"); // intacta
  });

  it("otra conversación NO puede adoptarlo", async () => {
    const path = await abrir(convDm);
    expect(await claim(db, COMERCIAL, convOtra, path)).toBe("denied");
    expect(await estado(path)).toBe("pending");
  });

  it("una subida vencida ya no se puede finalizar", async () => {
    const path = await abrir(convDm);
    await vencer(path);
    expect(await claim(db, COMERCIAL, convDm, path)).toBe("denied");
  });

  it("un path inexistente responde igual que uno ajeno: sin oráculo", async () => {
    expect(await claim(db, COMERCIAL, convDm, `${convDm}/files/no-existe`)).toBe("denied");
  });
});

// ═══════════════════ carreras reales, con candados de verdad ══════════════

describe("carreras", () => {
  it("dos finalize simultáneos idénticos: uno gana, el otro sigue idempotente", async () => {
    const path = await abrir(convDm);
    const a = await sb.connect();
    const b = await sb.connect();
    try {
      await armar(a, COMERCIAL);
      await armar(b, COMERCIAL);
      await a.query("begin");
      expect(await disparar(a, convDm, path)).toBe("claimed");
      // B ataca la MISMA fila mientras A la tiene tomada: queda bloqueado.
      const enCurso = disparar(b, convDm, path);
      await a.query("commit");
      // Al liberarse, B reevalúa la condición y ve que ya está finalizada.
      expect(await enCurso).toBe("already_finalized");
      expect(await estado(path)).toBe("finalized");
    } finally {
      await a.end().catch(() => {});
      await b.end().catch(() => {});
    }
  });

  it("finalize simultáneo INCOMPATIBLE: el que trae otra conversación no entra", async () => {
    const path = await abrir(convDm);
    const a = await sb.connect();
    const b = await sb.connect();
    try {
      await armar(a, COMERCIAL);
      await armar(b, COMERCIAL);
      await a.query("begin");
      expect(await disparar(a, convDm, path)).toBe("claimed");
      const enCurso = disparar(b, convOtra, path);
      await a.query("commit");
      expect(await enCurso).toBe("denied");
    } finally {
      await a.end().catch(() => {});
      await b.end().catch(() => {});
    }
  });

  it("finalize contra cleanup: si el finalize ganó la fila, el barrido la SALTEA", async () => {
    const path = await abrir(convDm);
    await abrirBarridoAntesDeTiempo(path);
    const a = await sb.connect();
    try {
      await armar(a, COMERCIAL);
      await a.query("begin");
      expect(await disparar(a, convDm, path)).toBe("claimed"); // candado tomado
      // `skip locked`: el barrido no espera ni fuerza, simplemente no la toma.
      expect((await barrer()).some((r) => r.object_path === path)).toBe(false);
      await a.query("commit");
      // Y una vez confirmada como 'finalized', ya no vuelve a ser candidata.
      expect((await barrer()).some((r) => r.object_path === path)).toBe(false);
      expect(await estado(path)).toBe("finalized");
    } finally {
      await a.end().catch(() => {});
    }
  });

  it("cleanup contra finalize: reclamada primero, el finalize ya no puede ganar", async () => {
    const path = await abrir(convDm);
    await abrirBarridoAntesDeTiempo(path);
    const limpiador = await sb.connect();
    const finalizador = await sb.connect();
    try {
      await armar(finalizador, COMERCIAL);
      await limpiador.query("begin");
      const tomadas = await barrer(limpiador);
      expect(tomadas.some((r) => r.object_path === path)).toBe(true);
      // El finalize choca contra el candado del barrido y espera.
      const enCurso = disparar(finalizador, convDm, path);
      await limpiador.query("commit");
      // Al liberarse ve 'reclaiming': un objeto marcado para borrar no resucita.
      expect(await enCurso).toBe("denied");
      expect(await estado(path)).toBe("reclaiming");
    } finally {
      await limpiador.end().catch(() => {});
      await finalizador.end().catch(() => {});
    }
  });
});

// ═══════════════════ barrido: qué toca y qué jamás toca ═══════════════════

describe("connect_upload_reclaim_expired", () => {
  it("reclama la vencida", async () => {
    const path = await abrir(convDm);
    await vencer(path);
    expect((await barrer()).some((r) => r.object_path === path)).toBe(true);
    expect(await estado(path)).toBe("reclaiming");
  });

  it("NUNCA toca una subida vigente", async () => {
    const path = await abrir(convDm);
    expect((await barrer()).some((r) => r.object_path === path)).toBe(false);
    expect(await estado(path)).toBe("pending");
  });

  it("NUNCA toca una subida finalizada, aunque esté vencida", async () => {
    const path = await abrir(convDm);
    expect(await claim(db, COMERCIAL, convDm, path)).toBe("claimed");
    await vencer(path);
    expect((await barrer()).some((r) => r.object_path === path)).toBe(false);
    expect(await estado(path)).toBe("finalized");
  });

  it("ante la duda conserva: si hay adjunto registrado, autocorrige a finalized", async () => {
    const path = await abrir(convDm);
    await vencer(path);
    // Se simula el camino que saltea el trigger (por ejemplo, una carga masiva).
    await db.query("alter table public.connect_attachments disable trigger connect_attachments_upload_binding");
    await db.query(
      `insert into public.connect_attachments (conversation_id, storage_bucket, storage_path, file_name)
       values ($1,'connect-files',$2,'remito.pdf')`, [convDm, path]);
    await db.query("alter table public.connect_attachments enable trigger connect_attachments_upload_binding");
    expect((await barrer()).some((r) => r.object_path === path)).toBe(false);
    expect(await estado(path)).toBe("finalized");
  });

  it("un fallo de Storage queda REINTENTABLE: sin mark_purged vuelve a salir", async () => {
    const path = await abrir(convDm);
    await vencer(path);
    const uno = (await barrer()).find((r) => r.object_path === path);
    expect(uno).toBeDefined();
    // No se llama a mark_purged: es el escenario "el borrado en Storage falló".
    const dos = (await barrer()).find((r) => r.object_path === path);
    expect(dos).toBeDefined();
    const { rows } = await db.query(
      "select reclaim_attempts from public.connect_pending_uploads where storage_path=$1", [path]);
    expect(rows[0].reclaim_attempts).toBeGreaterThanOrEqual(2);

    // Recién con el borrado confirmado sale de circulación para siempre.
    expect((await db.query("select public.connect_upload_mark_purged($1)", [uno!.upload_id]))
      .rows[0].connect_upload_mark_purged).toBe(true);
    expect((await barrer()).some((r) => r.object_path === path)).toBe(false);
    expect(await estado(path)).toBe("purged");
  });

  it("mark_purged sólo cierra lo que fue reclamado", async () => {
    const path = await abrir(convDm);
    const { rows } = await db.query(
      "select id from public.connect_pending_uploads where storage_path=$1", [path]);
    expect((await db.query("select public.connect_upload_mark_purged($1)", [rows[0].id]))
      .rows[0].connect_upload_mark_purged).toBe(false);
    expect(await estado(path)).toBe("pending");
  });

  it("el barrido no recibe rutas: no hay forma de apuntarle a un adjunto ajeno", async () => {
    // La garantía es de FIRMA, no de disciplina: si la función no puede recibir
    // un bucket ni un path, nadie puede usarla para borrar un objeto elegido.
    const { rows } = await db.query(
      `select pg_get_function_arguments(p.oid) as args
         from pg_proc p join pg_namespace nsp on nsp.oid = p.pronamespace
        where nsp.nspname = 'public' and p.proname = 'connect_upload_reclaim_expired'`);
    expect(rows).toHaveLength(1);
    // Los OUT de la RETURNS TABLE aparecen acá; los de ENTRADA son sólo el tope.
    const entrada = String(rows[0].args)
      .split(",")
      .map((a: string) => a.trim())
      .filter((a: string) => !a.startsWith("OUT "));
    expect(entrada).toEqual(["p_limit integer DEFAULT 100"]);
  });

  it("un usuario autenticado NO puede barrer ni cerrar el barrido", async () => {
    await expect(como(db, COMERCIAL, "select public.connect_upload_reclaim_expired(10)"))
      .rejects.toThrow(/permission denied/i);
    await expect(como(db, COMERCIAL, "select public.connect_upload_mark_purged(gen_random_uuid())"))
      .rejects.toThrow(/permission denied/i);
  });
});

// ═══════════════════ la atadura estructural del adjunto ═══════════════════

describe("trigger connect_attachments_upload_binding", () => {
  const insertar = (conv: string, path: string, uploader: string | null) =>
    db.query(
      `insert into public.connect_attachments
         (conversation_id, storage_bucket, storage_path, file_name, uploaded_by)
       values ($1,'connect-files',$2,'remito.pdf',$3)`, [conv, path, uploader]);

  it("rechaza el adjunto sobre una subida NO finalizada", async () => {
    const path = await abrir(convDm);
    await expect(insertar(convDm, path, COMERCIAL)).rejects.toThrow(/no está finalizada/);
  });

  it("rechaza el adjunto sobre una subida reclamada por el barrido", async () => {
    const path = await abrir(convDm);
    await vencer(path);
    await barrer();
    await expect(insertar(convDm, path, COMERCIAL)).rejects.toThrow(/no está finalizada/);
  });

  it("rechaza el adjunto en OTRA conversación", async () => {
    const path = await abrir(convDm);
    await claim(db, COMERCIAL, convDm, path);
    await expect(insertar(convOtra, path, COMERCIAL)).rejects.toThrow(/otra conversación/);
  });

  it("rechaza el adjunto de OTRO usuario", async () => {
    const path = await abrir(convDm);
    await claim(db, COMERCIAL, convDm, path);
    await expect(insertar(convDm, path, ENCARGADO)).rejects.toThrow(/otro usuario/);
  });

  it("acepta el adjunto de la subida finalizada por su dueño", async () => {
    const path = await abrir(convDm);
    await claim(db, COMERCIAL, convDm, path);
    await expect(insertar(convDm, path, COMERCIAL)).resolves.toBeDefined();
  });

  it("es INERTE para rutas sin subida pendiente: audio y lo previo siguen igual", async () => {
    const legado = `${convDm}/audio/legado-0001`;
    await expect(insertar(convDm, legado, COMERCIAL)).resolves.toBeDefined();
  });
});

// ═══════════════════ superficie y alineación ══════════════════════════════

describe("superficie de la tabla y MIME del bucket", () => {
  it("connect_pending_uploads no está expuesta a la API", async () => {
    const { rows } = await db.query(
      `select count(*)::int n from information_schema.role_table_grants
        where table_schema='public' and table_name='connect_pending_uploads'
          and grantee in ('anon','authenticated','public')`);
    expect(rows[0].n).toBe(0);
  });

  it("el bucket acepta HEIC y PPTX, que el validador ya aceptaba", async () => {
    const { rows } = await db.query(
      "select allowed_mime_types from storage.buckets where id='connect-files'");
    const mimes: string[] = rows[0].allowed_mime_types;
    expect(mimes).toContain("image/heic");
    expect(mimes).toContain("image/heif");
    expect(mimes).toContain(
      "application/vnd.openxmlformats-officedocument.presentationml.presentation");
    // Y no se amplió más allá de eso.
    expect(mimes).toHaveLength(16);
  });

  it("el rollback deja el catálogo y la lista MIME como estaban", async () => {
    const sb2 = await createWaSandbox(inject("dbUrl"));
    try {
      await sb2.client.query(CIERRE);
      await sb2.client.query(readFileSync(M0236, "utf8"));
      await sb2.client.query(readFileSync(M0237, "utf8"));
      await sb2.client.query(readFileSync(M0238, "utf8"));
      await sb2.client.query(readFileSync(R0238, "utf8"));
      const { rows: t } = await sb2.client.query(
        `select count(*)::int n from information_schema.tables
          where table_schema='public' and table_name='connect_pending_uploads'`);
      expect(t[0].n).toBe(0);
      const { rows: f } = await sb2.client.query(
        `select count(*)::int n from pg_proc p join pg_namespace nsp on nsp.oid=p.pronamespace
          where nsp.nspname='public' and p.proname like 'connect_upload_%'`);
      expect(f[0].n).toBe(0);
      const { rows: tg } = await sb2.client.query(
        `select count(*)::int n from information_schema.triggers
          where trigger_name='connect_attachments_upload_binding'`);
      expect(tg[0].n).toBe(0);
      const { rows: m } = await sb2.client.query(
        "select allowed_mime_types from storage.buckets where id='connect-files'");
      expect(m[0].allowed_mime_types).toHaveLength(13);
      expect(m[0].allowed_mime_types).not.toContain("image/heic");
    } finally {
      await sb2.destroy();
    }
  }, 120_000);
});

// ═══════════════ la ventana de purga se DERIVA del token ══════════════════

describe("vencimiento del token de subida", () => {
  it("la purga se habilita SIEMPRE después de que el token pueda morir", async () => {
    const path = await abrir(convDm);
    const { rows } = await db.query(
      `select upload_url_ttl_seconds as ttl,
              extract(epoch from (purgeable_at - created_at))::int as ventana
         from public.connect_pending_uploads where storage_path = $1`, [path]);
    // 7200 s de vida del token, por contrato oficial de Supabase.
    expect(rows[0].ttl).toBe(7200);
    // Y la ventana los supera con margen explícito, no por casualidad.
    expect(rows[0].ventana).toBeGreaterThan(rows[0].ttl);
  });

  it("NINGUNA fila puede existir con la purga abierta antes de morir el token", async () => {
    // La garantía no es que la función calcule bien: es que la fila no se puede
    // escribir. Se intenta a mano, con privilegios de dueño, y la base la rechaza.
    await expect(db.query(
      `insert into public.connect_pending_uploads
         (conversation_id, channel, storage_bucket, storage_path, initiated_by,
          finalize_deadline, purgeable_at, upload_url_ttl_seconds)
       values ($1,'dm','connect-files',$2,$3, now()+interval '30 min',
               now()+interval '10 min', 7200)`,
      [convDm, `${convDm}/files/forzado`, COMERCIAL],
    )).rejects.toThrow(/purge_after_token/);
  });

  it("un token todavía vivo no puede recrear un adjunto sobre un registro purgado", async () => {
    const path = await abrir(convDm);
    await vencer(path);
    // Se busca LA fila de este path: el barrido devuelve todo lo vencido, y
    // tomar la primera purgaría el residuo de otro caso.
    const tomada = (await barrer()).find((r) => r.object_path === path)!;
    expect(tomada).toBeDefined();
    await db.query("select public.connect_upload_mark_purged($1)", [tomada.upload_id]);
    expect(await estado(path)).toBe("purged");
    // Aunque el objeto reapareciera en Storage, las dos barreras lo rechazan:
    expect(await claim(db, COMERCIAL, convDm, path)).toBe("denied");   // la CAS
    await expect(db.query(                                             // y el trigger
      `insert into public.connect_attachments
         (conversation_id, storage_bucket, storage_path, file_name, uploaded_by)
       values ($1,'connect-files',$2,'tardio.pdf',$3)`, [convDm, path, COMERCIAL],
    )).rejects.toThrow(/no está finalizada/);
  });
});

// ═══════════════ un mensaje lógico, varios adjuntos ═══════════════════════

describe("identidad del mensaje frente a la de cada adjunto", () => {
  const ligar = async (conv: string, path: string, nombre: string, msg: string) => {
    const { rows } = await db.query(
      `insert into public.connect_attachments
         (conversation_id, storage_bucket, storage_path, file_name, uploaded_by, message_id)
       values ($1,'connect-files',$2,$3,$4,$5) returning id`,
      [conv, path, nombre, COMERCIAL, msg]);
    return rows[0].id as string;
  };

  const crearMensaje = (clientMsgId: string, body: string) =>
    db.query(
      `insert into public.connect_messages
         (conversation_id, author_profile_id, client_msg_id, body, kind)
       values ($1,$2,$3,$4,'file') returning id`,
      [convDm, COMERCIAL, clientMsgId, body]);

  it("el mismo client_msg_id NO puede publicar dos mensajes", async () => {
    const lote = "aaaaaaaa-0000-4000-8000-000000000001";
    await crearMensaje(lote, "Remito de hoy");
    // El segundo adjunto del lote intentaría crear el mensaje otra vez: la base
    // se lo impide, y por eso el adaptador adopta el existente en vez de duplicar.
    await expect(crearMensaje(lote, "Remito de hoy")).rejects.toThrow(/duplicate|unique/i);
    const { rows } = await db.query(
      "select count(*)::int n from public.connect_messages where client_msg_id=$1", [lote]);
    expect(rows[0].n).toBe(1);
  });

  it("cinco subidas distintas cuelgan del MISMO mensaje, con el texto una sola vez", async () => {
    const lote = "aaaaaaaa-0000-4000-8000-000000000002";
    const { rows: m } = await crearMensaje(lote, "Cinco remitos");
    const msg = m[0].id as string;
    const paths: string[] = [];
    for (let i = 0; i < 5; i++) {
      const path = await abrir(convDm);
      expect(await claim(db, COMERCIAL, convDm, path)).toBe("claimed");
      await ligar(convDm, path, `remito-${i}.pdf`, msg);
      paths.push(path);
    }
    expect(new Set(paths).size).toBe(5); // cada subida, su identidad
    const { rows: a } = await db.query(
      "select count(*)::int n from public.connect_attachments where message_id=$1", [msg]);
    expect(a[0].n).toBe(5);              // cada adjunto, su fila
    const { rows: t } = await db.query(
      "select count(*)::int n from public.connect_messages where body='Cinco remitos'");
    expect(t[0].n).toBe(1);              // el texto, una sola vez
  });

  it("un segundo adjunto legítimo no es un replay: paths distintos, ambos aceptados", async () => {
    const lote = "aaaaaaaa-0000-4000-8000-000000000003";
    const { rows: m } = await crearMensaje(lote, "Dos fotos");
    const msg = m[0].id as string;
    const p1 = await abrir(convDm);
    const p2 = await abrir(convDm);
    expect(p1).not.toBe(p2);
    for (const p of [p1, p2]) expect(await claim(db, COMERCIAL, convDm, p)).toBe("claimed");
    await ligar(convDm, p1, "a.jpg", msg);
    await ligar(convDm, p2, "b.jpg", msg);
    const { rows } = await db.query(
      "select count(*)::int n from public.connect_attachments where message_id=$1", [msg]);
    expect(rows[0].n).toBe(2);
  });

  it("el MISMO path no puede ligarse dos veces: el adjunto también tiene unicidad propia", async () => {
    const lote = "aaaaaaaa-0000-4000-8000-000000000004";
    const { rows: m } = await crearMensaje(lote, "Uno solo");
    const msg = m[0].id as string;
    const path = await abrir(convDm);
    await claim(db, COMERCIAL, convDm, path);
    await ligar(convDm, path, "remito.pdf", msg);
    await expect(ligar(convDm, path, "remito.pdf", msg)).rejects.toThrow(/duplicate|unique/i);
  });

  it("ninguna carrera desliga un adjunto ya publicado", async () => {
    // El barrido excluye por construcción todo objeto referenciado; se verifica
    // con el adjunto YA ligado a su mensaje y la fila pendiente vencida.
    const lote = "aaaaaaaa-0000-4000-8000-000000000005";
    const { rows: m } = await crearMensaje(lote, "Publicado");
    const path = await abrir(convDm);
    await claim(db, COMERCIAL, convDm, path);
    await ligar(convDm, path, "remito.pdf", m[0].id as string);
    await vencer(path);
    expect((await barrer()).some((r) => r.object_path === path)).toBe(false);
    const { rows } = await db.query(
      "select message_id from public.connect_attachments where storage_path=$1", [path]);
    expect(rows[0].message_id).toBe(m[0].id);
  });
});
