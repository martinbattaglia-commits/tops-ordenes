/**
 * T-LINK-B1-01 · Frontera de canal de Nexus Link (migración 0236).
 *
 * La prueba central es la ADVERSARIAL que fijó Dirección:
 *
 *     Jefe de Deposito
 *   + participante de una conversación kind='whatsapp'
 *   + connect.view / connect.create / connect.edit legacy
 *   = ACCESO DENEGADO
 *
 * Es el caso que el modelo anterior NO cubría: hasta 0236 la única barrera era
 * no ser participante, así que agregar al encargado a la conversación le daba
 * acceso completo. Acá se lo agrega A PROPÓSITO y se exige que siga denegado.
 *
 * El SQL bajo prueba es el REAL, leído de disco.
 */

import { afterAll, beforeAll, describe, expect, it, inject } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Client } from "pg";
import { createWaSandbox, type WaSandbox } from "./harness/wa-sandbox";

const MIG = (f: string) => resolve(__dirname, "..", "..", "supabase", "migrations", f);
const M0236 = MIG("0236_nexus_link_channel_capabilities.sql");
const R0236 = MIG("ROLLBACK_0236_nexus_link_channel_capabilities.sql");

/** Encargado de depósito: chat interno sí, WhatsApp no. */
const ENCARGADO = "11111111-1111-4111-8111-111111111111";
/** Operador comercial: opera WhatsApp. */
const COMERCIAL = "22222222-2222-4222-8222-222222222222";
/** Administrador legítimo (rol asignado con connect.admin). */
const ADMIN_OK = "33333333-3333-4333-8333-333333333333";
/**
 * Perfil con profiles.role='admin' pero SIN asignación administrativa real y
 * SIN concesión de capacidades: su único camino posible sería el bypass, que es
 * justamente lo que debe fallar.
 */
const ADMIN_FALSO = "44444444-4444-4444-8444-444444444444";

const CIERRE = `
  create extension if not exists pgcrypto;
  create schema if not exists auth;
  create table auth.users (id uuid primary key);
  create or replace function auth.uid() returns uuid language sql stable as $fn$
    select nullif(current_setting('test.observer', true), '')::uuid
  $fn$;

  create type public.user_role_t as enum ('admin','operaciones','supervisor','comercial','cliente');
  create table public.profiles (id uuid primary key, role public.user_role_t not null default 'operaciones');
  create or replace function public."current_role"() returns public.user_role_t
    language sql stable security definer set search_path = public, pg_temp as $fn$
      select role from public.profiles where id = auth.uid()
    $fn$;

  -- RBAC real: roles / permissions / role_permissions / user_roles.
  create table public.roles (id uuid primary key default gen_random_uuid(), slug text, name text unique);
  -- columna real es label, no name (medido contra 0009_rbac.sql y contra
  -- produccion; corregido junto con el mismo defecto en 0236, ver su cabecera).
  create table public.permissions (
    id uuid primary key default gen_random_uuid(), slug text unique not null,
    module text, action text, label text, description text
  );
  create table public.role_permissions (
    role_id uuid not null references public.roles(id) on delete cascade,
    permission_id uuid not null references public.permissions(id) on delete cascade,
    created_at timestamptz not null default now(),
    primary key (role_id, permission_id)
  );
  create table public.user_roles (
    user_id uuid not null, role_id uuid not null references public.roles(id) on delete cascade,
    primary key (user_id, role_id)
  );

  -- Cadena Connect mínima.
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

  do $rol$ begin
    if not exists (select 1 from pg_roles where rolname='authenticated') then
      create role authenticated nologin;
    end if;
  end $rol$;
  grant usage on schema public, auth to authenticated;
  grant select on public.connect_conversations, public.connect_participants,
                  public.connect_messages, public.profiles, public.permissions,
                  public.roles, public.role_permissions, public.user_roles to authenticated;
  grant execute on function public."current_role"() to authenticated;
`;

let sb: WaSandbox;
let db: Client;

async function comoObservador<T>(uid: string, sql: string): Promise<T[]> {
  await db.query("set role authenticated");
  await db.query("select set_config('test.observer', $1, false)", [uid]);
  try {
    const { rows } = await db.query(sql);
    return rows as T[];
  } finally {
    await db.query("reset role");
  }
}

const puede = async (uid: string, cap: string): Promise<boolean> => {
  const r = await comoObservador<{ p: boolean }>(uid, `select public.nexus_link_can('${cap}') as p`);
  return r[0].p;
};

const bandeja = async (uid: string): Promise<string[]> => {
  const r = await comoObservador<{ kind: string; title: string }>(
    uid, "select kind::text as kind, title from public.v_connect_inbox order by title",
  );
  return r.map((x) => `${x.kind}:${x.title}`);
};

beforeAll(async () => {
  sb = await createWaSandbox(inject("dbUrl"));
  db = sb.client;
  await db.query(CIERRE);

  await db.query("insert into auth.users (id) values ($1),($2),($3),($4)",
    [ENCARGADO, COMERCIAL, ADMIN_OK, ADMIN_FALSO]);
  await db.query(
    `insert into public.profiles (id, role) values
       ($1,'operaciones'::public.user_role_t), ($2,'comercial'::public.user_role_t),
       ($3,'admin'::public.user_role_t), ($4,'admin'::public.user_role_t)`,
    [ENCARGADO, COMERCIAL, ADMIN_OK, ADMIN_FALSO]);

  // Permisos legacy y roles, tal como existen hoy.
  await db.query(`
    insert into public.permissions (slug, module, action, label) values
      ('connect.view','connect','view','Ver'), ('connect.create','connect','create','Crear'),
      ('connect.edit','connect','edit','Editar'), ('connect.admin','connect','admin','Admin');
    insert into public.roles (slug, name) values
      ('jefe-deposito','Jefe de Deposito'), ('comercial','Comercial'),
      ('super-admin','Super Administrador'), ('sin-admin','Rol sin admin');
  `);
  // Jefe de Deposito y Comercial: los tres legacy. Super Admin: los cuatro.
  await db.query(`
    insert into public.role_permissions (role_id, permission_id)
    select r.id, p.id from public.roles r join public.permissions p on true
     where (r.name in ('Jefe de Deposito','Comercial')
            and p.slug in ('connect.view','connect.create','connect.edit'))
        or (r.name = 'Rol sin admin' and p.slug = 'connect.edit')
        or (r.name = 'Super Administrador'
            and p.slug in ('connect.view','connect.create','connect.edit','connect.admin'));
  `);
  await db.query(`
    insert into public.user_roles (user_id, role_id)
    select $1::uuid, id from public.roles where name='Jefe de Deposito'
    union all select $2::uuid, id from public.roles where name='Comercial'
    union all select $3::uuid, id from public.roles where name='Super Administrador'
    union all select $4::uuid, id from public.roles where name='Rol sin admin';
  `, [ENCARGADO, COMERCIAL, ADMIN_OK, ADMIN_FALSO]);

  // Vista 0234/0235 previa (sin frontera de canal) para medir el ANTES.
  await db.query(`
    create or replace view public.v_connect_inbox with (security_invoker = true) as
    select c.id as conversation_id, c.context_id, c.kind, c.title, c.slug, c.topic,
           c.last_message_at, c.last_message_seq, p.last_read_seq,
           (select count(*) from public.connect_messages m
             where m.conversation_id=c.id and m.seq > coalesce(p.last_read_seq,0)
               and m.deleted_at is null and m.kind <> 'system'
               and case when c.kind='whatsapp' then m.author_profile_id is null
                        else coalesce(m.author_profile_id,'00000000-0000-0000-0000-000000000000'::uuid)
                             is distinct from p.profile_id end)::bigint as unread_count,
           p.is_favorite, p.muted_until, c.archived_at
      from public.connect_conversations c
      join public.connect_participants p on p.conversation_id=c.id and p.profile_id=auth.uid();
    grant select on public.v_connect_inbox to authenticated;
  `);

  // ESCENARIO ADVERSARIAL: al encargado se lo agrega A PROPÓSITO como
  // participante de una conversación de WhatsApp.
  const { rows: wa } = await db.query(
    `insert into public.connect_conversations (kind, title)
     values ('whatsapp'::public.connect_conversation_kind_t,'Cliente Comercial') returning id`);
  const { rows: dm } = await db.query(
    `insert into public.connect_conversations (kind, title)
     values ('dm'::public.connect_conversation_kind_t,'Coordinacion Deposito') returning id`);
  await db.query(
    `insert into public.connect_participants (conversation_id, profile_id) values
       ($1,$2),($1,$3),($4,$2),($4,$3)`,
    [wa[0].id, ENCARGADO, COMERCIAL, dm[0].id]);
  await db.query(
    "insert into public.connect_messages (conversation_id, author_profile_id) values ($1,null),($2,$3)",
    [wa[0].id, dm[0].id, COMERCIAL]);
}, 120_000);

afterAll(async () => { await sb?.destroy(); });

describe("T-LINK-B1-01 · el ANTES: la membresía alcanzaba", () => {
  it("sin 0236, el encargado VE la conversación de WhatsApp por ser participante", async () => {
    // Éste es el agujero que 0236 cierra. Se mide, no se supone.
    expect(await bandeja(ENCARGADO)).toEqual([
      "whatsapp:Cliente Comercial",
      "dm:Coordinacion Deposito",
    ]);
  });
});

describe("T-LINK-B1-01 · ADVERSARIAL · Jefe de Deposito + participante + legacy = DENEGADO", () => {
  it("se aplica 0236", async () => {
    await db.query(readFileSync(M0236, "utf8"));
    await db.query("grant execute on function public.nexus_link_can(text) to authenticated");
    await db.query("grant select on public.v_connect_inbox to authenticated");
  });

  it("el encargado conserva las tres capacidades de chat interno", async () => {
    expect(await puede(ENCARGADO, "nexus_link.internal_chat.read")).toBe(true);
    expect(await puede(ENCARGADO, "nexus_link.internal_chat.send")).toBe(true);
    expect(await puede(ENCARGADO, "nexus_link.internal_chat.media")).toBe(true);
  });

  it("y NINGUNA de WhatsApp, pese a conservar connect.view/create/edit", async () => {
    expect(await puede(ENCARGADO, "nexus_link.whatsapp.read")).toBe(false);
    expect(await puede(ENCARGADO, "nexus_link.whatsapp.send")).toBe(false);
    expect(await puede(ENCARGADO, "nexus_link.whatsapp.media")).toBe(false);
  });

  it("los permisos legacy NO son bypass: siguen concedidos y no habilitan el canal", async () => {
    const legacy = await comoObservador<{ slug: string }>(
      ENCARGADO,
      `select p.slug from public.user_roles ur
         join public.role_permissions rp on rp.role_id=ur.role_id
         join public.permissions p on p.id=rp.permission_id
        where ur.user_id=auth.uid() and p.slug like 'connect.%' order by p.slug`);
    expect(legacy.map((l) => l.slug)).toEqual(["connect.create", "connect.edit", "connect.view"]);
    expect(await puede(ENCARGADO, "nexus_link.whatsapp.read")).toBe(false);
  });

  it("SIGUE SIENDO PARTICIPANTE y aun así la conversación desaparece de su bandeja", async () => {
    const { rows } = await db.query(
      `select count(*)::int as n from public.connect_participants pa
         join public.connect_conversations c on c.id=pa.conversation_id
        where pa.profile_id=$1 and c.kind='whatsapp'`, [ENCARGADO]);
    expect(rows[0].n, "la membresía adversarial debe seguir en pie").toBe(1);

    expect(await bandeja(ENCARGADO)).toEqual(["dm:Coordinacion Deposito"]);
  });

  it("el operador comercial no pierde nada: sigue viendo ambas", async () => {
    expect(await bandeja(COMERCIAL)).toEqual([
      "whatsapp:Cliente Comercial",
      "dm:Coordinacion Deposito",
    ]);
    expect(await puede(COMERCIAL, "nexus_link.whatsapp.read")).toBe(true);
    expect(await puede(COMERCIAL, "nexus_link.whatsapp.send")).toBe(true);
    expect(await puede(COMERCIAL, "nexus_link.whatsapp.media")).toBe(true);
  });
});

describe("T-LINK-B1-01 · el bypass administrativo exige rol administrativo real", () => {
  it("un admin legítimo (profiles.role='admin' + asignación con connect.admin) pasa", async () => {
    expect(await puede(ADMIN_OK, "nexus_link.whatsapp.read")).toBe(true);
  });

  it("profiles.role='admin' SIN asignación administrativa NO alcanza", async () => {
    // Defensa contra un dato inconsistente en la columna denormalizada: no
    // puede convertir a nadie en administrador ni atravesar la prohibición.
    expect(await puede(ADMIN_FALSO, "nexus_link.whatsapp.read")).toBe(false);
  });

  it("el bypass no convierte a un Jefe de Deposito en administrador", async () => {
    await db.query("update public.profiles set role='admin'::public.user_role_t where id=$1", [ENCARGADO]);
    try {
      // Aunque alguien le escriba 'admin' en profiles.role, no tiene asignación
      // con connect.admin: la prohibición se sostiene.
      expect(await puede(ENCARGADO, "nexus_link.whatsapp.read")).toBe(false);
      expect(await bandeja(ENCARGADO)).toEqual(["dm:Coordinacion Deposito"]);
    } finally {
      await db.query("update public.profiles set role='operaciones'::public.user_role_t where id=$1", [ENCARGADO]);
    }
  });
});

describe("T-LINK-B1-01 · autoridad del importador: las cuatro combinaciones", () => {
  /**
   * El importador de WhatsApp Comercial ve historial de clientes. Su autoridad
   * exige administrador CANÓNICO (doble evidencia) Y capacidad de canal, ambas.
   * `profiles.role` por sí solo no prueba nada.
   */
  const autoridad = async (uid: string): Promise<{ admin: boolean; canal: boolean; importa: boolean }> => {
    const r = await comoObservador<{ a: boolean; c: boolean }>(
      uid,
      "select public.nexus_link_is_admin() as a, public.nexus_link_can('nexus_link.whatsapp.read') as c",
    );
    return { admin: r[0].a, canal: r[0].c, importa: r[0].a && r[0].c };
  };

  it("(1) sólo profiles.role='admin', sin asignación canónica ni capacidad → DENEGADO", async () => {
    // ADMIN_FALSO: columna en 'admin', rol asignado sin connect.admin ni capacidades.
    const a = await autoridad(ADMIN_FALSO);
    expect(a.admin, "la columna sola no prueba autoridad").toBe(false);
    expect(a.canal).toBe(false);
    expect(a.importa).toBe(false);
  });

  it("(2) capacidad de WhatsApp sin rol administrativo real → DENEGADO", async () => {
    // COMERCIAL: tiene las tres capacidades de WhatsApp, no es administrador.
    const a = await autoridad(COMERCIAL);
    expect(a.canal, "el comercial sí opera el canal").toBe(true);
    expect(a.admin).toBe(false);
    expect(a.importa).toBe(false);
  });

  it("(3) administrador canónico SIN capacidad del canal → DENEGADO", async () => {
    // Se le retira la capacidad al Super Administrador, conservando connect.admin.
    await db.query(`
      delete from public.role_permissions rp
       using public.permissions p, public.roles r
       where p.id = rp.permission_id and r.id = rp.role_id
         and r.name = 'Super Administrador' and p.slug = 'nexus_link.whatsapp.read'`);
    try {
      const a = await autoridad(ADMIN_OK);
      expect(a.admin, "sigue siendo administrador canónico").toBe(true);
      expect(a.canal).toBe(false);
      expect(a.importa).toBe(false);
    } finally {
      await db.query(`
        insert into public.role_permissions (role_id, permission_id)
        select r.id, p.id from public.roles r, public.permissions p
         where r.name='Super Administrador' and p.slug='nexus_link.whatsapp.read'
        on conflict do nothing`);
    }
  });

  it("(4) sólo la combinación canónica completa habilita la importación", async () => {
    const a = await autoridad(ADMIN_OK);
    expect(a.admin).toBe(true);
    expect(a.canal).toBe(true);
    expect(a.importa).toBe(true);
  });

  it("y un Jefe de Deposito jamás la obtiene, ni escribiéndole 'admin' a la columna", async () => {
    await db.query("update public.profiles set role='admin'::public.user_role_t where id=$1", [ENCARGADO]);
    try {
      const a = await autoridad(ENCARGADO);
      expect(a.admin).toBe(false);
      expect(a.canal).toBe(false);
      expect(a.importa).toBe(false);
    } finally {
      await db.query("update public.profiles set role='operaciones'::public.user_role_t where id=$1", [ENCARGADO]);
    }
  });
});

describe("T-LINK-B1-01 · membresía y capacidad son ACUMULATIVAS", () => {
  it("la capacidad no da acceso a conversaciones ajenas", async () => {
    const { rows } = await db.query(
      `insert into public.connect_conversations (kind, title)
       values ('whatsapp'::public.connect_conversation_kind_t,'Ajena') returning id`);
    // COMERCIAL tiene whatsapp.read pero NO es participante de ésta.
    expect(await bandeja(COMERCIAL)).not.toContain("whatsapp:Ajena");
    await db.query("delete from public.connect_conversations where id=$1", [rows[0].id]);
  });

  it("la membresía no alcanza sin la capacidad (ya demostrado con el encargado)", async () => {
    expect(await bandeja(ENCARGADO)).toEqual(["dm:Coordinacion Deposito"]);
  });
});

describe("T-LINK-B1-01 · FASE A intacta", () => {
  it("el verde del encargado es CERO sin consultar información prohibida", async () => {
    // El filtro vive en la vista: la fila de WhatsApp no llega a la suma. No hay
    // un `case when` posterior que deje pasar el dato y lo tape después.
    const r = await comoObservador<{ verde: string; amarillo: string }>(
      ENCARGADO,
      `select coalesce(sum(unread_count) filter (where kind='whatsapp'),0)::text as verde,
              coalesce(sum(unread_count) filter (where kind<>'whatsapp'),0)::text as amarillo
         from public.v_connect_inbox`);
    expect(Number(r[0].verde)).toBe(0);
    expect(Number(r[0].amarillo)).toBe(1);
  });

  it("el contrato de columnas de v_connect_inbox no cambió", async () => {
    const { rows } = await db.query(
      `select column_name from information_schema.columns
        where table_schema='public' and table_name='v_connect_inbox' order by ordinal_position`);
    expect(rows.map((r: { column_name: string }) => r.column_name)).toEqual([
      "conversation_id", "context_id", "kind", "title", "slug", "topic",
      "last_message_at", "last_message_seq", "last_read_seq", "unread_count",
      "is_favorite", "muted_until", "archived_at",
    ]);
  });

  it("para quien tiene la capacidad, el conteo es idéntico al de 0234", async () => {
    const r = await comoObservador<{ unread_count: string }>(
      COMERCIAL, "select unread_count from public.v_connect_inbox where kind='whatsapp'");
    expect(Number(r[0].unread_count)).toBe(1);
  });
});

describe("T-LINK-B1-01 · reversibilidad", () => {
  it("el ROLLBACK devuelve el estado previo y no toca los permisos legacy", async () => {
    await db.query(readFileSync(R0236, "utf8"));
    await db.query("grant select on public.v_connect_inbox to authenticated");

    const { rows: caps } = await db.query(
      "select count(*)::int as n from public.permissions where slug like 'nexus_link.%'");
    expect(caps[0].n).toBe(0);
    const { rows: fn } = await db.query(
      `select count(*)::int as n from pg_proc p join pg_namespace n on n.oid=p.pronamespace
        where n.nspname='public' and p.proname='nexus_link_can'`);
    expect(fn[0].n).toBe(0);
    // Legacy intacto.
    const { rows: legacy } = await db.query(
      "select count(*)::int as n from public.permissions where slug like 'connect.%'");
    expect(legacy[0].n).toBe(4);
    // Y vuelve el estado anterior: el encargado ve WhatsApp otra vez.
    expect(await bandeja(ENCARGADO)).toEqual([
      "whatsapp:Cliente Comercial",
      "dm:Coordinacion Deposito",
    ]);
  });
});
