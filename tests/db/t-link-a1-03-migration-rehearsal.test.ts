/**
 * T-LINK-A1-03 · NEXUS-LINK-NOTIFICATIONS-MEDIA-001 · FASE A · PRE-C4 (A).
 *
 * Ensayo de las DOS migraciones sobre una base PROD-SHAPED, contra PostgreSQL
 * real, en una base efímera dedicada.
 *
 * ─── QUÉ SIGNIFICA "PROD-SHAPED" ACÁ, CON HONESTIDAD ───────────────────────
 *
 * El replay de la historia COMPLETA no es reproducible sobre PostgreSQL
 * vanilla: 0016/0017/0036/0126 exigen PostGIS, y por eso el manifiesto del
 * arnés (tests/db/harness/manifest.ts) trabaja con un cierre determinista
 * documentado. Lo que se hace acá es lo más cercano y verificable: se levantan
 * los objetos base de los que dependen 0234/0235 y se ejecutan DESDE DISCO las
 * migraciones reales que definen el estado previo de `notifications`:
 *
 *     0147_connect_notifications_ext.sql   (priority / remind_at / delegated_to)
 *     0162_connect_notification_actions.sql (policies, grant por columna, RPCs)
 *
 * Es decir: las policies, los grants y las RPC contra los que se mide el
 * endurecimiento NO son una transcripción del autor, son los archivos reales.
 *
 * ─── QUÉ DEMUESTRA ─────────────────────────────────────────────────────────
 *
 *  1. 0234 se aplica SOLA, sin depender de ningún objeto que cree 0235.
 *  2. 0234 → 0235 en orden deja el estado final esperado.
 *  3. ROLLBACK 0235 → ROLLBACK 0234, en orden inverso, no deja residuos:
 *     ni tabla, ni policies, ni grants, ni publicación realtime, ni funciones.
 *  4. Reaplicar ambas deja un estado IDÉNTICO al de la primera aplicación,
 *     comparado por huella del catálogo, no por inspección a ojo.
 *  5. El snooze de 0162 sigue funcionando por su camino autorizado después del
 *     endurecimiento.
 */

import { afterAll, beforeAll, describe, expect, it, inject } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Client } from "pg";
import { createWaSandbox, type WaSandbox } from "./harness/wa-sandbox";

const MIG = (f: string) => resolve(__dirname, "..", "..", "supabase", "migrations", f);
const M0147 = MIG("0147_connect_notifications_ext.sql");
const M0162 = MIG("0162_connect_notification_actions.sql");
const M0234 = MIG("0234_link_notification_badges_tricolor.sql");
const R0234 = MIG("ROLLBACK_0234_link_notification_badges_tricolor.sql");
const M0235 = MIG("0235_link_notification_personal_read.sql");
const R0235 = MIG("ROLLBACK_0235_link_notification_personal_read.sql");

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const ADMIN = "33333333-3333-4333-8333-333333333333";

/**
 * Base previa: lo mínimo de 0004/0005/0143/0145 de lo que dependen 0147, 0162,
 * 0234 y 0235. Todo lo que viene DESPUÉS se ejecuta desde los archivos reales.
 */
const BASE_PREVIA = `
  create extension if not exists pgcrypto;
  create schema if not exists auth;
  create table auth.users (id uuid primary key);
  create or replace function auth.uid() returns uuid language sql stable as $fn$
    select nullif(current_setting('test.observer', true), '')::uuid
  $fn$;
  create publication supabase_realtime;

  create type public.user_role_t as enum
    ('admin','operaciones','supervisor','operador','cliente');
  create table public.profiles (
    id        uuid primary key,
    role      public.user_role_t not null default 'operador',
    active    boolean not null default true,
    client_id uuid
  );
  create or replace function public."current_role"() returns public.user_role_t
    language sql stable security definer set search_path = public, pg_temp as $fn$
      select role from public.profiles where id = auth.uid()
    $fn$;

  create table public.audit_log (
    id uuid primary key default gen_random_uuid(),
    user_id uuid, entity text, entity_id uuid, action text,
    payload jsonb, created_at timestamptz not null default now()
  );

  -- notifications tal como la deja 0004 (0147 le agrega las columnas nuevas).
  create table public.notifications (
    id          uuid primary key default gen_random_uuid(),
    user_id     uuid,
    role_target public.user_role_t,
    kind        text not null default 'system',
    title       text not null default '',
    message     text not null default '',
    entity      text,
    entity_id   uuid,
    read_at     timestamptz,
    created_at  timestamptz not null default now()
  );
  alter table public.notifications enable row level security;
  create policy notifications_select_own on public.notifications
    for select using (user_id = auth.uid());

  -- Cadena Connect mínima para v_connect_inbox (0143/0145).
  create type public.connect_conversation_kind_t as enum
    ('dm','group','channel','erp','incident','whatsapp','ai','task');
  create type public.connect_message_kind_t as enum
    ('text','system','ai','file','call_link','whatsapp','audio');
  create table public.connect_conversations (
    id uuid primary key default gen_random_uuid(), context_id uuid,
    kind public.connect_conversation_kind_t not null, title text, slug text, topic text,
    last_message_at timestamptz, last_message_seq bigint, archived_at timestamptz
  );
  create table public.connect_participants (
    id uuid primary key default gen_random_uuid(),
    conversation_id uuid not null references public.connect_conversations(id) on delete cascade,
    profile_id uuid, last_read_seq bigint not null default 0,
    muted_until timestamptz, is_favorite boolean not null default false,
    unique (conversation_id, profile_id)
  );
  create table public.connect_messages (
    id uuid primary key default gen_random_uuid(),
    conversation_id uuid not null references public.connect_conversations(id) on delete cascade,
    seq bigint generated always as identity, author_profile_id uuid,
    kind public.connect_message_kind_t not null default 'text',
    deleted_at timestamptz, created_at timestamptz not null default now()
  );
  create unique index connect_messages_conv_seq_uidx
    on public.connect_messages (conversation_id, seq);

  -- 0147 publica estas tablas en supabase_realtime; existen en 0143. Se crean
  -- como esqueletos para que la migración real corra VERBATIM, sin editarla.
  create table public.connect_message_reactions (id uuid primary key default gen_random_uuid());
  create table public.connect_message_mentions  (id uuid primary key default gen_random_uuid());
  create table public.connect_attachments       (id uuid primary key default gen_random_uuid());
  create table public.connect_conversation_links(id uuid primary key default gen_random_uuid());
  create table public.connect_pinned            (id uuid primary key default gen_random_uuid());

  -- Vistas 0145 (las que 0234 redefine).
  create or replace view public.v_connect_inbox
  with (security_invoker = true) as
  select c.id as conversation_id, c.context_id, c.kind, c.title, c.slug, c.topic,
         c.last_message_at, c.last_message_seq, p.last_read_seq,
         greatest(coalesce(c.last_message_seq,0) - coalesce(p.last_read_seq,0), 0) as unread_count,
         p.is_favorite, p.muted_until, c.archived_at
    from public.connect_conversations c
    join public.connect_participants p
      on p.conversation_id = c.id and p.profile_id = auth.uid();
  create or replace view public.v_connect_unread_total
  with (security_invoker = true) as
  select coalesce(sum(greatest(coalesce(c.last_message_seq,0) - coalesce(p.last_read_seq,0), 0)),0)
           as unread_total
    from public.connect_conversations c
    join public.connect_participants p
      on p.conversation_id = c.id and p.profile_id = auth.uid()
   where (p.muted_until is null or p.muted_until < now());

  do $rol$
  begin
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then
      create role authenticated nologin;
    end if;
  end $rol$;
  grant usage on schema public, auth to authenticated;
  grant select on public.notifications, public.profiles,
                  public.connect_conversations, public.connect_participants,
                  public.connect_messages to authenticated;
  grant execute on function public."current_role"() to authenticated;
`;

let sb: WaSandbox;
let db: Client;

const ejecutarArchivo = (f: string) => db.query(readFileSync(f, "utf8"));

/**
 * Huella del catálogo relevante: objetos, policies, grants, publicación y
 * firmas de función. Sirve para comparar estados sin inspeccionarlos a mano.
 */
async function huellaCatalogo(): Promise<string> {
  const { rows } = await db.query(`
    select string_agg(linea, E'\\n' order by linea) as h from (
      select 'view:'||table_name||':'||string_agg(column_name||':'||data_type, ',' order by ordinal_position) as linea
        from information_schema.columns
       where table_schema='public' and table_name like 'v_%'
       group by table_name
      union all
      select 'table:'||tablename from pg_tables where schemaname='public'
      union all
      select 'policy:'||polrelid::regclass::text||':'||polname||':'||polcmd::text||':'||coalesce(pg_get_expr(polqual,polrelid),'')
        from pg_policy where polrelid::regclass::text like '%notification%'
      union all
      select 'grant:'||table_name||':'||privilege_type||':'||coalesce(column_name,'*')
        from information_schema.column_privileges
       where table_schema='public' and grantee='authenticated' and table_name like '%notification%'
      union all
      select 'tablegrant:'||table_name||':'||privilege_type
        from information_schema.table_privileges
       where table_schema='public' and grantee='authenticated' and table_name like '%notification%'
      union all
      select 'pub:'||tablename from pg_publication_tables where pubname='supabase_realtime'
      union all
      select 'fn:'||p.proname||':'||pg_get_function_identity_arguments(p.oid)
        from pg_proc p join pg_namespace n on n.oid=p.pronamespace
       where n.nspname='public' and p.proname like 'connect_notif%'
    ) s
  `);
  return rows[0].h as string;
}

async function badgesDe(uid: string): Promise<number> {
  await db.query("set role authenticated");
  await db.query("select set_config('test.observer', $1, false)", [uid]);
  try {
    const { rows } = await db.query("select red_system_count from public.v_link_notification_badges");
    return Number(rows[0].red_system_count);
  } finally {
    await db.query("reset role");
  }
}

async function ejecutarComo(uid: string, sql: string): Promise<void> {
  await db.query("set role authenticated");
  await db.query("select set_config('test.observer', $1, false)", [uid]);
  try {
    await db.query(sql);
  } finally {
    await db.query("reset role");
  }
}

let huellaTrasPrimeraAplicacion: string;
let huellaPrevia: string;

beforeAll(async () => {
  sb = await createWaSandbox(inject("dbUrl"));
  db = sb.client;
  await db.query(BASE_PREVIA);
  await db.query("insert into auth.users (id) values ($1),($2),($3)", [A, B, ADMIN]);
  await db.query(
    `insert into public.profiles (id, role) values
       ($1,'operaciones'::public.user_role_t),
       ($2,'operaciones'::public.user_role_t),
       ($3,'admin'::public.user_role_t)`,
    [A, B, ADMIN],
  );
  // Estado previo REAL: las migraciones de disco, no una transcripción.
  await ejecutarArchivo(M0147);
  await ejecutarArchivo(M0162);
}, 120_000);

afterAll(async () => {
  await sb?.destroy();
});

describe("T-LINK-A1-03 · orden de aplicación", () => {
  it("el estado previo es el REAL de 0147+0162: grant por columna y policy con rama admin", async () => {
    const { rows: g } = await db.query(`
      select column_name from information_schema.column_privileges
       where table_schema='public' and table_name='notifications'
         and grantee='authenticated' and privilege_type='UPDATE'
       order by column_name
    `);
    expect(g.map((r: { column_name: string }) => r.column_name)).toEqual(["read_at", "remind_at"]);

    const { rows: p } = await db.query(`
      select pg_get_expr(polqual, polrelid) as q from pg_policy
       where polrelid='public.notifications'::regclass and polname='notifications mark read own'
    `);
    expect(p[0].q).toMatch(/admin/);
    huellaPrevia = await huellaCatalogo();
  });

  it("0234 se aplica SOLA: no depende de ningún objeto que cree 0235", async () => {
    await ejecutarArchivo(M0234);
    await db.query("grant select on public.v_link_notification_badges to authenticated");
    // Y funciona: la vista de contadores responde sin 0235 en el sistema.
    const { rows } = await db.query(`
      select count(*)::int as n from information_schema.tables
       where table_schema='public' and table_name in ('notification_reads','v_link_my_notifications')
    `);
    expect(rows[0].n).toBe(0);
    await db.query("insert into public.notifications (user_id) values ($1)", [A]);
    expect(await badgesDe(A)).toBe(1);
  });

  it("0235 se aplica encima y deja el sistema completo", async () => {
    await ejecutarArchivo(M0235);
    await db.query("grant select on public.v_link_my_notifications to authenticated");
    const { rows } = await db.query(`
      select
        (select count(*)::int from information_schema.tables
          where table_schema='public' and table_name='notification_reads') as tabla,
        (select count(*)::int from information_schema.views
          where table_schema='public' and table_name='v_link_my_notifications') as vista,
        (select count(*)::int from pg_proc p join pg_namespace n on n.oid=p.pronamespace
          where n.nspname='public' and p.proname like 'connect_notif_mark%') as rpcs,
        (select count(*)::int from pg_publication_tables
          where pubname='supabase_realtime' and tablename='notification_reads') as pub
    `);
    expect(rows[0]).toEqual({ tabla: 1, vista: 1, rpcs: 2, pub: 1 });
    huellaTrasPrimeraAplicacion = await huellaCatalogo();
  });

  it("el endurecimiento quedó efectivo: sin grant de UPDATE y sin rama admin", async () => {
    const { rows: g } = await db.query(`
      select count(*)::int as n from information_schema.column_privileges
       where table_schema='public' and table_name='notifications'
         and grantee='authenticated' and privilege_type='UPDATE'
    `);
    expect(g[0].n).toBe(0);
    const { rows: p } = await db.query(`
      select pg_get_expr(polqual, polrelid) as q from pg_policy
       where polrelid='public.notifications'::regclass and polname='notifications mark read own'
    `);
    expect(p[0].q).not.toMatch(/admin/);
  });

  it("el snooze de 0162 sigue funcionando por su camino autorizado", async () => {
    const { rows } = await db.query("select id from public.notifications limit 1");
    const cuando = new Date(Date.now() + 3_600_000).toISOString();
    await ejecutarComo(
      A, `select public.connect_notif_snooze('${rows[0].id}'::uuid, '${cuando}'::timestamptz)`,
    );
    const { rows: n } = await db.query("select remind_at from public.notifications where id = $1", [rows[0].id]);
    expect(n[0].remind_at).not.toBeNull();
    // Y el aviso pospuesto deja de contar.
    expect(await badgesDe(A)).toBe(0);
    await db.query("update public.notifications set remind_at = null");
  });
});

describe("T-LINK-A1-03 · rollback en orden inverso y sin residuos", () => {
  it("ROLLBACK 0235 devuelve el contador de 0234 y restituye 0162", async () => {
    await ejecutarArchivo(R0235);
    const { rows } = await db.query(`
      select
        (select count(*)::int from information_schema.tables
          where table_schema='public' and table_name='notification_reads') as tabla,
        (select count(*)::int from information_schema.views
          where table_schema='public' and table_name='v_link_my_notifications') as vista,
        (select count(*)::int from pg_proc p join pg_namespace n on n.oid=p.pronamespace
          where n.nspname='public' and p.proname like 'connect_notif_mark%') as rpcs,
        (select count(*)::int from pg_publication_tables
          where pubname='supabase_realtime' and tablename='notification_reads') as pub,
        (select count(*)::int from information_schema.column_privileges
          where table_schema='public' and table_name='notifications'
            and grantee='authenticated' and privilege_type='UPDATE') as grants
    `);
    expect(rows[0]).toEqual({ tabla: 0, vista: 0, rpcs: 0, pub: 0, grants: 2 });
    // El contador sigue en pie, con la definición de 0234.
    expect(await badgesDe(A)).toBe(1);
  });

  it("ROLLBACK 0234 restaura las vistas de 0145 y elimina la de contadores", async () => {
    await ejecutarArchivo(R0234);
    const { rows } = await db.query(`
      select count(*)::int as n from information_schema.views
       where table_schema='public' and table_name='v_link_notification_badges'
    `);
    expect(rows[0].n).toBe(0);
    // Y v_connect_inbox volvió a la resta de secuencias de 0145.
    const { rows: def } = await db.query(
      "select pg_get_viewdef('public.v_connect_inbox'::regclass) as d",
    );
    expect(def[0].d).toMatch(/GREATEST/i);
    expect(def[0].d).not.toMatch(/count\(\*\)/i);
  });

  it("no quedan residuos: el catálogo vuelve al estado previo a 0234", async () => {
    expect(await huellaCatalogo()).toBe(huellaPrevia);
  });

  it("ninguna notificación se perdió en el camino", async () => {
    const { rows } = await db.query("select count(*)::int as n from public.notifications");
    expect(rows[0].n).toBe(1);
  });
});

describe("T-LINK-A1-03 · reaplicación idéntica", () => {
  it("aplicar 0234 y 0235 otra vez deja un catálogo IDÉNTICO al de la primera vez", async () => {
    await ejecutarArchivo(M0234);
    await db.query("grant select on public.v_link_notification_badges to authenticated");
    await ejecutarArchivo(M0235);
    await db.query("grant select on public.v_link_my_notifications to authenticated");
    expect(await huellaCatalogo()).toBe(huellaTrasPrimeraAplicacion);
  });

  it("y el sistema queda operativo: lectura individual de broadcast", async () => {
    await db.query("truncate public.notifications cascade");
    await db.query(
      "insert into public.notifications (role_target) values ('operaciones'::public.user_role_t)",
    );
    expect(await badgesDe(A)).toBe(1);
    expect(await badgesDe(B)).toBe(1);

    const { rows } = await db.query("select id from public.notifications limit 1");
    await ejecutarComo(A, `select public.connect_notif_mark_read('${rows[0].id}'::uuid)`);

    expect(await badgesDe(A)).toBe(0);
    expect(await badgesDe(B)).toBe(1);
    const { rows: n } = await db.query("select read_at from public.notifications");
    expect(n[0].read_at).toBeNull();
  });
});

describe("T-LINK-A1-03 · aislamiento con A, B y administrador", () => {
  it("A no ve ni puede apagar la notificación privada de B, y viceversa", async () => {
    await db.query("truncate public.notification_reads");
    await db.query("truncate public.notifications cascade");
    await db.query("insert into public.notifications (user_id) values ($1),($2)", [A, B]);

    expect(await badgesDe(A)).toBe(1);
    expect(await badgesDe(B)).toBe(1);

    const { rows } = await db.query("select id from public.notifications where user_id = $1", [B]);
    await expect(
      ejecutarComo(A, `select public.connect_notif_mark_read('${rows[0].id}'::uuid)`),
    ).rejects.toThrow(/dueño o el delegado/);
    expect(await badgesDe(B)).toBe(1);
  });

  it("el administrador no recibe como propias las notificaciones de la organización", async () => {
    // La RLS de auditoría se las deja LEER…
    await db.query("set role authenticated");
    await db.query("select set_config('test.observer', $1, false)", [ADMIN]);
    const { rows: ve } = await db.query("select count(*)::int as n from public.notifications");
    await db.query("reset role");
    expect(ve[0].n).toBe(2);
    // …pero su badge es cero.
    expect(await badgesDe(ADMIN)).toBe(0);
  });

  it("el administrador NO puede apagar avisos ajenos por PostgREST directo", async () => {
    const { rows } = await db.query("select id from public.notifications where user_id = $1", [A]);
    await expect(
      ejecutarComo(ADMIN, `update public.notifications set read_at = now() where id = '${rows[0].id}'::uuid`),
    ).rejects.toThrow(/permission denied|denegado/i);
    await expect(
      ejecutarComo(ADMIN, `select public.connect_notif_mark_read('${rows[0].id}'::uuid)`),
    ).rejects.toThrow(/dueño o el delegado/);
    expect(await badgesDe(A)).toBe(1);
  });

  it("las RPC no aceptan una identidad por parámetro: sólo auth.uid()", async () => {
    // Estructural: las dos funciones toman (uuid) y () respectivamente. No hay
    // ningún parámetro por el que el cliente pueda declarar quién dice ser.
    const { rows } = await db.query(`
      select p.proname, pg_get_function_identity_arguments(p.oid) as args
        from pg_proc p join pg_namespace n on n.oid=p.pronamespace
       where n.nspname='public' and p.proname like 'connect_notif_mark%'
       order by p.proname
    `);
    expect(rows).toEqual([
      { proname: "connect_notif_mark_all_read", args: "" },
      { proname: "connect_notif_mark_read", args: "p_id uuid" },
    ]);
    // Y sin sesión no hacen nada: fail-closed.
    await db.query("set role authenticated");
    await db.query("select set_config('test.observer', '', false)");
    try {
      await expect(db.query("select public.connect_notif_mark_all_read()"))
        .rejects.toThrow(/sesión no autenticada/);
    } finally {
      await db.query("reset role");
    }
  });

  it("la escritura directa de read_at y remind_at queda denegada para todos", async () => {
    const { rows } = await db.query("select id from public.notifications where user_id = $1", [A]);
    for (const col of ["read_at", "remind_at"]) {
      await expect(
        ejecutarComo(A, `update public.notifications set ${col} = now() where id = '${rows[0].id}'::uuid`),
      ).rejects.toThrow(/permission denied|denegado/i);
    }
    // Y su propia notificación sigue pendiente: nada se coló.
    expect(await badgesDe(A)).toBe(1);
  });
});
