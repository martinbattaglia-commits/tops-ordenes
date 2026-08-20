/**
 * T-0261-0261A · REMEDIACIÓN 0261 Y PRECURSORA 0261A.
 *
 * Verificación focal contra PostgreSQL real en sandbox efímero aislado:
 *  1. 0260 define public.connect_archive_conversation(uuid).
 *  2. 0261 (corregida in-place) elimina explícitamente la firma (uuid) antes de
 *     crear (uuid, boolean DEFAULT false).
 *  3. Invocación con 1 parámetro y con 2 parámetros resuelve SIN ambigüedad.
 *  4. ROLLBACK_0261 elimina (uuid, boolean) y restaura (uuid) sin residuos.
 *  5. 0261a agrega 'finanzas' a permission_module_t y 'plan', 'approve' a permission_action_t.
 *  6. 0261a es idempotente (ADD VALUE IF NOT EXISTS).
 *  7. ROLLBACK_0261a es un no-op deliberado seguro (estándar canónico ROLLBACK_0235a).
 *  8. La cadena completa 0261a → permissions ejecuta sin errores.
 */

import { afterAll, beforeAll, describe, expect, it, inject } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Client } from "pg";
import { createWaSandbox, type WaSandbox } from "./harness/wa-sandbox";

const MIG = (f: string) => resolve(__dirname, "..", "..", "supabase", "migrations", f);

const M0260 = MIG("0260_nexus_link_handover_archived.sql");
const M0261 = MIG("0261_connect_archive_force_override.sql");
const R0261 = MIG("ROLLBACK_0261_connect_archive_force_override.sql");
const M0261A = MIG("0261a_finance_permission_enums.sql");
const R0261A = MIG("ROLLBACK_0261a_finance_permission_enums.sql");

const USER_OWNER = "11111111-1111-4111-8111-111111111111";

let sb: WaSandbox;
let db: Client;

const ejecutar = (f: string) => db.query(readFileSync(f, "utf8"));

beforeAll(async () => {
  sb = await createWaSandbox(inject("dbUrl"));
  db = sb.client;

  // Schema base mínimo para Connect y RBAC
  await db.query(`
    create extension if not exists pgcrypto;
    create schema if not exists auth;
    create table if not exists auth.users (id uuid primary key);
    create or replace function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('test.observer', true), '')::uuid
    $$;

    do $$
    begin
      if not exists (select 1 from pg_roles where rolname = 'authenticated') then
        create role authenticated nologin;
      end if;
      if not exists (select 1 from pg_roles where rolname = 'anon') then
        create role anon nologin;
      end if;
    end $$;

    -- Enums y tablas requeridas para permisos y connect
    create type public.permission_module_t as enum ('connect', 'wms', 'clientes');
    create type public.permission_action_t as enum ('view', 'edit', 'admin');

    create table public.permissions (
      id uuid primary key default gen_random_uuid(),
      code text unique not null,
      module public.permission_module_t not null,
      action public.permission_action_t not null,
      description text
    );

    create table public.role_permissions (
      role text not null,
      permission_id uuid not null references public.permissions(id),
      primary key (role, permission_id)
    );

    create or replace function public.is_admin() returns boolean language sql stable as $$
      select false;
    $$;

    create or replace function public.has_permission(p_code text) returns boolean language sql stable as $$
      select false;
    $$;

    create type public.connect_conversation_kind_t as enum ('dm', 'group', 'channel', 'task', 'whatsapp');
    create type public.connect_member_role_t as enum ('owner', 'moderator', 'member');
    create type public.connect_participant_type_t as enum ('profile', 'external', 'system', 'staff');

    create table public.connect_conversations (
      id uuid primary key default gen_random_uuid(),
      kind public.connect_conversation_kind_t not null default 'group',
      title text,
      archived_at timestamptz
    );

    create table public.connect_participants (
      id uuid primary key default gen_random_uuid(),
      conversation_id uuid not null references public.connect_conversations(id) on delete cascade,
      profile_id uuid not null,
      member_role public.connect_member_role_t not null default 'member',
      participant_type public.connect_participant_type_t not null default 'profile',
      unique (conversation_id, profile_id)
    );

    create table public.connect_messages (
      id uuid primary key default gen_random_uuid(),
      conversation_id uuid not null references public.connect_conversations(id) on delete cascade,
      author_participant_id uuid references public.connect_participants(id),
      author_profile_id uuid,
      created_at timestamptz not null default now()
    );

    create table public.connect_conversation_links (
      id uuid primary key default gen_random_uuid(),
      conversation_id uuid not null references public.connect_conversations(id) on delete cascade,
      entity_type text not null default 'order',
      entity_id uuid not null default gen_random_uuid(),
      created_at timestamptz not null default now()
    );

    create table public.connect_tasks (
      id uuid primary key default gen_random_uuid(),
      estado text not null default 'completada'
    );

    create or replace function public._connect_is_member(p_conv_id uuid) returns boolean language sql stable as $$
      select exists(select 1 from public.connect_participants where conversation_id = p_conv_id and profile_id = auth.uid());
    $$;
  `);
}, 120_000);

afterAll(async () => {
  await sb?.destroy();
});

describe("T-0261 · Remediación de sobrecarga en connect_archive_conversation", () => {
  it("1 · Aplica 0260 y crea connect_archive_conversation(uuid)", async () => {
    await ejecutar(M0260);

    const { rows } = await db.query(`
      select p.proname, pg_get_function_identity_arguments(p.oid) as args
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'connect_archive_conversation'
    `);

    expect(rows).toHaveLength(1);
    expect(rows[0].args).toBe("p_conversation_id uuid");
  });

  it("2 · Aplica 0261 (in-place remediada) y elimina la sobrecarga mono-argumento", async () => {
    await ejecutar(M0261);

    const { rows } = await db.query(`
      select p.proname,
             pg_get_function_identity_arguments(p.oid) as args,
             pg_get_function_arguments(p.oid) as full_args
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'connect_archive_conversation'
    `);

    // Exactamente UNA función en el catálogo (no 2 sobrecargas)
    expect(rows).toHaveLength(1);
    expect(rows[0].args).toBe("p_conversation_id uuid, p_force boolean");
    expect(rows[0].full_args).toBe("p_conversation_id uuid, p_force boolean DEFAULT false");
  });

  it("3 · Invoca connect_archive_conversation con 1 y 2 parámetros sin ambigüedad", async () => {
    // Crear conversación y participante owner
    const conv1 = (await db.query(`
      insert into public.connect_conversations (title) values ('Conv Test 1') returning id
    `)).rows[0].id;

    await db.query(`
      insert into public.connect_participants (conversation_id, profile_id, member_role)
      values ($1, $2, 'owner')
    `, [conv1, USER_OWNER]);

    // Actuar como owner
    await db.query(`set local test.observer = '${USER_OWNER}'`);

    // Llamada con 1 parámetro: debe resolver a (uuid, boolean default false) sin error 42725
    await db.query(`select public.connect_archive_conversation($1)`, [conv1]);

    const res1 = (await db.query(`select archived_at from public.connect_conversations where id = $1`, [conv1])).rows[0];
    expect(res1.archived_at).not.toBeNull();

    // Crear conversación 2 y archivar con 2 parámetros (force = true)
    const conv2 = (await db.query(`
      insert into public.connect_conversations (title) values ('Conv Test 2') returning id
    `)).rows[0].id;

    await db.query(`
      insert into public.connect_participants (conversation_id, profile_id, member_role)
      values ($1, $2, 'owner')
    `, [conv2, USER_OWNER]);

    await db.query(`select public.connect_archive_conversation($1, true)`, [conv2]);

    const res2 = (await db.query(`select archived_at from public.connect_conversations where id = $1`, [conv2])).rows[0];
    expect(res2.archived_at).not.toBeNull();
  });

  it("4 · ROLLBACK_0261 elimina la firma bi-argumento y restaura mono-argumento", async () => {
    await ejecutar(R0261);

    const { rows } = await db.query(`
      select p.proname, pg_get_function_identity_arguments(p.oid) as args
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'connect_archive_conversation'
    `);

    expect(rows).toHaveLength(1);
    expect(rows[0].args).toBe("p_conversation_id uuid");
  });

  it("5 · Re-aplicación de 0261 restablece la firma bi-argumento limpiamente", async () => {
    await ejecutar(M0261);

    const { rows } = await db.query(`
      select p.proname,
             pg_get_function_identity_arguments(p.oid) as args,
             pg_get_function_arguments(p.oid) as full_args
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'connect_archive_conversation'
    `);

    expect(rows).toHaveLength(1);
    expect(rows[0].args).toBe("p_conversation_id uuid, p_force boolean");
    expect(rows[0].full_args).toBe("p_conversation_id uuid, p_force boolean DEFAULT false");
  });
});

describe("T-0261a · Precursora RBAC Enums de Finanzas", () => {
  it("6 · Aplica 0261a y agrega los valores requeridos a los enums", async () => {
    await ejecutar(M0261A);

    const { rows: modRows } = await db.query(`
      select enumlabel from pg_enum
       where enumtypid = 'public.permission_module_t'::regtype
       order by enumsortorder
    `);
    const modules = modRows.map((r) => r.enumlabel);
    expect(modules).toContain("finanzas");

    const { rows: actRows } = await db.query(`
      select enumlabel from pg_enum
       where enumtypid = 'public.permission_action_t'::regtype
       order by enumsortorder
    `);
    const actions = actRows.map((r) => r.enumlabel);
    expect(actions).toContain("plan");
    expect(actions).toContain("approve");
  });

  it("7 · 0261a es idempotente cuando se ejecuta nuevamente", async () => {
    await expect(ejecutar(M0261A)).resolves.toBeDefined();
  });

  it("8 · ROLLBACK_0261a ejecuta como un no-op seguro", async () => {
    await expect(ejecutar(R0261A)).resolves.toBeDefined();

    // Los valores de enum siguen presentes sin degradación estructural
    const { rows: modRows } = await db.query(`
      select enumlabel from pg_enum
       where enumtypid = 'public.permission_module_t'::regtype and enumlabel = 'finanzas'
    `);
    expect(modRows).toHaveLength(1);
  });

  it("9 · Cadena 0261a → permissions permite usar los nuevos enums", async () => {
    // 0261a ya fue aplicada en la base de prueba. Ahora se pueden insertar permisos con 'finanzas' y 'plan'/'approve'.
    await db.query(`
      insert into public.permissions (code, module, action, description)
      values
        ('finanzas.view', 'finanzas', 'view', 'Ver módulo de finanzas'),
        ('finanzas.plan', 'finanzas', 'plan', 'Planificar supuestos financieros'),
        ('finanzas.approve', 'finanzas', 'approve', 'Aprobar proyecciones financieras')
    `);

    const { rows } = await db.query(`
      select code, module, action from public.permissions where module = 'finanzas' order by code
    `);
    expect(rows).toEqual([
      { code: "finanzas.approve", module: "finanzas", action: "approve" },
      { code: "finanzas.plan", module: "finanzas", action: "plan" },
      { code: "finanzas.view", module: "finanzas", action: "view" },
    ]);
  });
});
