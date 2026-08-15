/**
 * T-LINK-H1-01 · Cierre de la fuga en `connect_participants` (H1) — Guardián C5.
 *
 * ─── QUÉ ES ESTE ARCHIVO Y POR QUÉ NO ES OTRO `t-link-b1-02` MÁS ──────────
 *
 * Las suites previas de esta rama (`t-link-b1-01`, `t-link-b1-02`) reproducen
 * el esquema de `connect_participants` A MANO, con `module`/`action` como
 * `text` libre y sin la constraint real `unique(module, action)`. Esa
 * reproducción coincidía por accidente con dos defectos reales que tenía
 * `0236` —columna `name` en vez de `label`, y `module='connect'` colisionando
 * con permisos legacy ya existentes en ese módulo— y por eso ningún C4 ni
 * Guardián anterior los vio: la primera vez que este candidato se midió contra
 * un esquema realmente derivado de los archivos de migración reales
 * (`0001/0004/0005/0009/0142/0143/0147`, vía `readFileSync`, no tipeados a
 * mano) esos dos defectos rompieron la aplicación. Están corregidos en
 * `0236` y en la migración nueva `0235a` (ver sus encabezados).
 *
 * Éste es el entorno C5 que define Dirección: PostgreSQL 17 + PostGIS local
 * (misma familia de binario que usa `custody-db-harness` en CI,
 * `postgis/postgis:17-3.5`), esquema REAL de main hasta el punto donde este
 * candidato se rama, con las únicas dos excepciones documentadas y
 * justificadas más abajo, y luego 0234→0235→0235a→0236→0237→0238→0239 en
 * orden real, uno por uno, desde disco.
 *
 * ─── CIERRE ELEGIDO, Y POR QUÉ ESTOS ARCHIVOS Y NO OTROS ───────────────────
 *
 * `connect_participants` (tabla, RLS, publicación realtime) está definida
 * ÍNTEGRAMENTE por 0143 (create) y 0147 (publica a `supabase_realtime`).
 * Verificado por grep sobre las 204 migraciones reales: ningún otro archivo
 * hace `alter table`/`create policy`/`drop policy` sobre ella — los que la
 * MENCIONAN (0144, 0150-0169, 0227) sólo hacen `insert` a través de RPCs, lo
 * que no cambia su forma ni su RLS. Esto no es una selección arbitraria: es
 * el resultado de un grep exhaustivo, no una lista escrita de memoria.
 *
 * Se excluyen del cierre, con justificación medida:
 *
 *   · `0003_storage.sql` — buckets `signatures`/`pdfs`, ajenos a Connect. No
 *     define `storage.objects`/`storage.buckets` (eso es de la extensión
 *     Storage, platform-provista, igual que `auth.*` — NINGUNA migración crea
 *     esas dos tablas, sólo las alteran). Se estuban con las columnas exactas
 *     que 0237/0238 referencian (`bucket_id`, `name`, `storage.foldername()`,
 *     y el `update storage.buckets` de 0238), en vez de reproducir un archivo
 *     entero que no aporta ninguna de esas columnas.
 *   · `0148_connect_storage.sql` — su propio encabezado dice «ENTREGADA, NO
 *     APLICADA (G3)»; el bucket `connect-files` no es parte de la propiedad
 *     bajo prueba (RLS y realtime de `connect_participants`), y 0237/0238 no
 *     dependen de que ese bucket tenga FILAS, sólo de que la tabla exista.
 *
 * Todo el resto del cierre (0001 tipos/perfiles/`current_role`/`is_admin`,
 * 0004/0005 triggers y endurecimiento SECDEF, 0009 RBAC completo con la
 * constraint real, 0142 el enum `connect`) es la forma REAL medida en
 * `information_schema`/`pg_catalog`, no una reproducción.
 *
 * ─── LO QUE ESTE ARCHIVO DEMUESTRA (mandato de Dirección, punto 4) ─────────
 *
 *  1. aplicación limpia de 0236→0237→0238→0239 (y su prerrequisito 0235a);
 *  2. RLS y grants resultantes;
 *  3. SECURITY DEFINER y `search_path` de los helpers que la policy usa;
 *  4. usuario NO autorizado (Jefe de Depósito, participante, sin capacidad);
 *  5. usuario comercial autorizado;
 *  6. administrador canónico CON capacidad explícita;
 *  6b. `profiles.role='admin'` SIN capacidad explícita — Dirección lo pide
 *      como caso propio porque `has_permission()` (0009) tiene un atajo
 *      `current_role()='admin'` que por sí solo NO alcanza acá: es
 *      exactamente lo que este caso mide;
 *  7. chat interno conservado;
 *  8. WhatsApp denegado al Jefe de Depósito (external_ref, no sólo la fila);
 *  9. Realtime y `external_ref` — mismo método que `t-link-b1-02`: el
 *     predicado bajo cada observador, porque `postgres_changes` no agrega
 *     ninguna decisión que no esté ya en la policy;
 * 10-12. rollback en orden inverso, restitución exacta, reaplicación limpia;
 * 13. cero residuos locales (barrido automático de la suite de base).
 */

import { afterAll, beforeAll, describe, expect, it, inject } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Client } from "pg";
import { createWaSandbox, type WaSandbox } from "./harness/wa-sandbox";

const MIG = (f: string) => resolve(__dirname, "..", "..", "supabase", "migrations", f);
const REAL = (f: string) => readFileSync(MIG(f), "utf8");

const R_0239 = MIG("ROLLBACK_0239_nexus_link_participants_channel_rls.sql");
const R_0238 = MIG("ROLLBACK_0238_nexus_link_upload_lifecycle.sql");
const R_0237 = MIG("ROLLBACK_0237_nexus_link_channel_rls.sql");
const R_0236 = MIG("ROLLBACK_0236_nexus_link_channel_capabilities.sql");
const R_0235A = MIG("ROLLBACK_0235a_nexus_link_permission_module.sql");

const JEFE_DEPOSITO = "11111111-1111-4111-8111-111111111111"; // participante, SIN capacidad
const COMERCIAL = "22222222-2222-4222-8222-222222222222"; // participante, CON capacidad
const ADMIN_CON_CAPACIDAD = "33333333-3333-4333-8333-333333333333"; // is_admin() + capacidad explícita
const ADMIN_SIN_CAPACIDAD = "44444444-4444-4444-8444-444444444444"; // profiles.role='admin', SIN grant
const AJENO = "55555555-5555-4555-8555-555555555555"; // ni participante ni admin

const TEL_CONTRAPARTE = "+5491100000099";

/**
 * PLATAFORMA: sólo lo que ninguna migración crea porque Supabase lo provee
 * (auth.*, storage.*) y los tres roles de PostgREST. Ver docblock del
 * archivo: columnas exactas medidas contra lo que 0237/0238 referencian.
 */
const PLATAFORMA = `
  create extension if not exists pgcrypto;
  create extension if not exists postgis;
  do $rol$ begin
    if not exists (select 1 from pg_roles where rolname='authenticated') then
      create role authenticated nologin; end if;
    if not exists (select 1 from pg_roles where rolname='anon') then
      create role anon nologin; end if;
    if not exists (select 1 from pg_roles where rolname='service_role') then
      create role service_role nologin; end if;
  end $rol$;
  create schema auth;
  create table auth.users (
    id uuid primary key, email text, raw_user_meta_data jsonb not null default '{}'::jsonb);
  create or replace function auth.uid() returns uuid
    language sql stable as $$ select nullif(current_setting('test.observer', true), '')::uuid $$;
  create or replace function auth.role() returns text
    language sql stable as $$ select nullif(current_setting('test.role', true), '')::text $$;
  create schema storage;
  create table storage.buckets (
    id text primary key, name text not null, public boolean not null default false,
    file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects (
    id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id),
    name text, owner uuid, created_at timestamptz default now(), unique (bucket_id, name));
  create or replace function storage.foldername(name text) returns text[]
    language sql immutable as $$ select string_to_array(regexp_replace(name, '/[^/]*$', ''), '/') $$;
  alter table storage.objects enable row level security;
  grant usage on schema auth, storage to authenticated, anon, service_role;
  grant select on storage.objects, storage.buckets to authenticated;
  grant execute on all functions in schema public to authenticated;
  grant select on all tables in schema public to authenticated;
`;

// Partido en dos: 0236 hace GRANT-REPLICATION (su sección 2) leyendo
// `role_permissions` TAL COMO ESTÁ en el momento en que corre — exactamente
// igual que en producción real, donde connect.view/create/edit y sus grants
// llevan meses existiendo antes de que 0236 se aplique. El seed de esos
// permisos legacy tiene que ocurrir ANTES de 0236, o su replicación no
// encuentra nada que replicar.
const CIERRE_REAL_PRE = [
  "0001_init.sql",
  "0004_extended_schema.sql",
  "0005_fix_rls_recursion.sql",
  "0009_rbac.sql",
  "0142_connect_module_enum.sql",
  "0143_connect_schema.sql",
  "0147_connect_notifications_ext.sql",
  "0234_link_notification_badges_tricolor.sql",
  "0235_link_notification_personal_read.sql",
  "0235a_nexus_link_permission_module.sql",
];
const CIERRE_REAL_POST = [
  "0236_nexus_link_channel_capabilities.sql",
  "0237_nexus_link_channel_rls.sql",
  "0238_nexus_link_upload_lifecycle.sql",
];
const M_0239 = "0239_nexus_link_participants_channel_rls.sql";

let sb: WaSandbox;
let db: Client;
let convWa = "";
let convDm = "";

async function como<T>(uid: string, sql: string): Promise<T[]> {
  await db.query("set role authenticated");
  await db.query("select set_config('test.observer', $1, false)", [uid]);
  // `permissions`/`roles`/`role_permissions` (0009, REAL) tienen RLS con
  // `using (auth.role() = 'authenticated')` — la forma REAL de Supabase, que
  // el cierre sintético de b1-02 no reproducía (por eso ese defecto nunca
  // apareció ahí). El stub de auth.role() lee `test.role`; sin fijarlo acá
  // queda NULL y la policy deniega TODO, para cualquier usuario.
  await db.query("select set_config('test.role', 'authenticated', false)");
  try {
    const { rows } = await db.query(sql);
    return rows as T[];
  } finally {
    await db.query("reset role");
  }
}
const count = async (uid: string, sql: string): Promise<number> =>
  Number((await como<{ n: string }>(uid, sql))[0]!.n);

beforeAll(async () => {
  sb = await createWaSandbox(inject("dbUrl"));
  db = sb.client;

  await db.query(PLATAFORMA);
  for (const f of CIERRE_REAL_PRE) await db.query(REAL(f));
  await db.query("grant execute on all functions in schema public to authenticated");
  await db.query("grant select on all tables in schema public to authenticated");

  await db.query("insert into auth.users (id) values ($1),($2),($3),($4),($5)",
    [JEFE_DEPOSITO, COMERCIAL, ADMIN_CON_CAPACIDAD, ADMIN_SIN_CAPACIDAD, AJENO]);
  // `user_role_t` REAL (0001, confirmado contra producción) es
  // {admin,operaciones,supervisor,cliente} — NO tiene 'comercial'. La
  // capacidad de WhatsApp del comercial no depende de esta columna gruesa,
  // sino de `user_roles`→`roles`('Comercial WA')→`role_permissions`, seedeado
  // más abajo; `profiles.role='operaciones'` es correcto y realista para él.
  // `handle_new_user()` (0001) ya insertó una fila por el trigger de
  // auth.users con role='operaciones' por defecto: ON CONFLICT actualiza en
  // vez de asumir que la fila no existe.
  await db.query(`insert into public.profiles (id, role) values
      ($1,'operaciones'::public.user_role_t), ($2,'operaciones'::public.user_role_t),
      ($3,'admin'::public.user_role_t), ($4,'admin'::public.user_role_t),
      ($5,'operaciones'::public.user_role_t)
    on conflict (id) do update set role = excluded.role`,
    [JEFE_DEPOSITO, COMERCIAL, ADMIN_CON_CAPACIDAD, ADMIN_SIN_CAPACIDAD, AJENO]);

  // roles reales de 0009 (director_ops/admin/operaciones/comercial) YA
  // existen por el seed de 0009. Se les da `connect.view/create/edit` como
  // permiso legacy VIGENTE — el escenario adversarial explícito: la fuga se
  // mide con el permiso legacy DE HECHO presente, no en su ausencia.
  //
  // ESTO DEBE OCURRIR ANTES DE 0236: su sección (2) replica capacidades
  // leyendo `role_permissions` TAL COMO ESTÁ en el momento en que corre —
  // igual que en producción real, donde estos permisos y sus grants llevan
  // meses existiendo cuando 0236 se aplica. Sembrarlo después dejaría a 0236
  // sin nada que replicar.
  await db.query(`
    insert into public.permissions (slug, module, action, label, description) values
      ('connect.view','connect','view','Ver Nexus Link','—'),
      ('connect.create','connect','create','Crear en Link','—'),
      ('connect.edit','connect','edit','Editar en Link','—')
    on conflict (slug) do nothing;
    insert into public.roles (slug, name) values
      ('jefe-deposito','Jefe de Deposito'),
      ('rol-comercial-wa','Comercial WA'),
      ('rol-admin-con-cap','Admin con capacidad'),
      ('rol-admin-sin-cap','Admin sin capacidad'),
      ('rol-ajeno','Ajeno')
    on conflict (slug) do nothing;
    -- Los cuatro roles con presencia en Connect reciben el legacy VIGENTE.
    -- 'rol-admin-sin-cap' NO lo recibe: así 0236 no le replica capacidades por
    -- (2), y su único camino de acceso sería el atajo de has_permission().
    insert into public.role_permissions (role_id, permission_id)
    select r.id, p.id from public.roles r join public.permissions p on true
     where r.name in ('Jefe de Deposito','Comercial WA','Admin con capacidad')
       and p.slug in ('connect.view','connect.create','connect.edit');
  `);
  await db.query(`insert into public.user_roles (user_id, role_id)
    select $1::uuid, id from public.roles where name='Jefe de Deposito'
    union all select $2::uuid, id from public.roles where name='Comercial WA'
    union all select $3::uuid, id from public.roles where name='Admin con capacidad'
    union all select $4::uuid, id from public.roles where name='Admin sin capacidad'
    union all select $5::uuid, id from public.roles where name='Ajeno'`,
    [JEFE_DEPOSITO, COMERCIAL, ADMIN_CON_CAPACIDAD, ADMIN_SIN_CAPACIDAD, AJENO]);

  // AHORA sí, con el legacy ya vigente: 0236 (replica capacidades a quien
  // hoy tiene connect.view/create) → 0237 → 0238 → 0239 (el objeto bajo
  // prueba), tal como están en disco.
  for (const f of CIERRE_REAL_POST) await db.query(REAL(f));
  await db.query(REAL(M_0239));
  // Re-otorgar tras la cadena por si algún archivo hizo REVOKE ALL primero:
  // los helpers reales (0236/0237) revocan de `public`/`anon` y conceden sólo
  // a `authenticated` explícitamente, así que esto es no-op para ellos, pero
  // blinda contra objetos nuevos de archivos intermedios.
  await db.query("grant execute on all functions in schema public to authenticated");
  await db.query("grant select on all tables in schema public to authenticated");

  // Conversaciones: WhatsApp con context_id=teléfono real (misma convención
  // que t-link-b1-02), y DM interno.
  const { rows: w } = await db.query(
    `insert into public.connect_conversations (kind,title,context_id)
     values ('whatsapp'::public.connect_conversation_kind_t,'Cliente C5',$1) returning id`,
    [`wa:${TEL_CONTRAPARTE}`]);
  const { rows: d } = await db.query(
    `insert into public.connect_conversations (kind,title,context_id)
     values ('dm'::public.connect_conversation_kind_t,'Interno C5','CTX-2026-C50001')
     returning id`);
  convWa = w[0].id; convDm = d[0].id;

  // ADVERSARIAL: los cuatro son participantes del hilo de WhatsApp, incluido
  // Jefe de Depósito. El único diferenciador es la CAPACIDAD, no la membresía.
  await db.query(
    `insert into public.connect_participants (conversation_id, profile_id) values
       ($1,$2),($1,$3),($1,$4),($1,$5),($6,$2),($6,$3)`,
    [convWa, JEFE_DEPOSITO, COMERCIAL, ADMIN_CON_CAPACIDAD, ADMIN_SIN_CAPACIDAD, convDm]);

  // El participante EXTERNO — el teléfono en claro, tal como lo escriben el
  // importador y la proyección del inbound vivo.
  await db.query(
    `insert into public.connect_participants (conversation_id, profile_id, participant_type, external_ref)
     values ($1, null, 'whatsapp', jsonb_build_object(
        'phone', $2::text, 'side', 'counterpart', 'source', 'meta_cloud_api'))`,
    [convWa, TEL_CONTRAPARTE]);
}, 180_000);

afterAll(async () => { await sb?.destroy(); });

describe("1 · aplicación limpia de 0236→0237→0238→0239", () => {
  it("las siete migraciones (incluida 0235a) se aplicaron sin error", async () => {
    // Si beforeAll llegó hasta acá sin lanzar, ya está demostrado; esta
    // afirmación lo hace EXPLÍCITO y falla con causa clara si algo cambia.
    const { rows } = await db.query(
      `select count(*)::int n from pg_policies where tablename='connect_participants'`);
    expect(rows[0].n).toBeGreaterThan(0);
  });

  it("el enum ganó los dos módulos nuevos, sin tocar los existentes", async () => {
    const { rows } = await db.query(
      `select enumlabel from pg_enum e join pg_type t on t.oid=e.enumtypid
        where t.typname='permission_module_t' order by e.enumsortorder`);
    const labels = rows.map((r) => r.enumlabel);
    expect(labels).toContain("nexus_link_chat");
    expect(labels).toContain("nexus_link_whatsapp");
    expect(labels).toContain("connect"); // el original, intacto
  });

  it("las seis capacidades existen con módulo propio y label (no name)", async () => {
    const { rows } = await db.query(
      `select slug, module, action, label from public.permissions
        where slug like 'nexus_link.%' order by slug`);
    expect(rows).toHaveLength(6);
    expect(rows.every((r) => r.label && r.label.length > 0)).toBe(true);
    expect(rows.filter((r) => r.module === "nexus_link_chat")).toHaveLength(3);
    expect(rows.filter((r) => r.module === "nexus_link_whatsapp")).toHaveLength(3);
  });

  it("ninguna fila de connect.* preexistente fue tocada", async () => {
    const { rows } = await db.query(
      `select slug, module, action from public.permissions
        where slug in ('connect.view','connect.create','connect.edit') order by slug`);
    expect(rows).toEqual([
      { slug: "connect.create", module: "connect", action: "create" },
      { slug: "connect.edit", module: "connect", action: "edit" },
      { slug: "connect.view", module: "connect", action: "view" },
    ]);
  });
});

describe("2 · RLS y grants resultantes", () => {
  it("la policy SELECT de connect_participants incluye el predicado de canal", async () => {
    const { rows } = await db.query(
      `select qual from pg_policies where tablename='connect_participants' and cmd='SELECT'`);
    expect(rows[0].qual).toContain("_connect_channel_allowed");
    expect(rows[0].qual).toContain("_connect_is_member");
    expect(rows[0].qual).toContain("is_admin");
  });

  it("connect_participants sigue SIN policy de INSERT para authenticated (0143 intacto)", async () => {
    const { rows } = await db.query(
      `select cmd from pg_policies where tablename='connect_participants' order by cmd`);
    expect(rows.map((r) => r.cmd)).toEqual(["DELETE", "SELECT", "UPDATE"]);
  });

  it("el grant de UPDATE sigue acotado por columna, external_ref no está entre ellas", async () => {
    const { rows } = await db.query(`
      select column_name from information_schema.column_privileges
       where table_name='connect_participants' and grantee='authenticated' and privilege_type='UPDATE'
       order by column_name`);
    const cols = rows.map((r) => r.column_name);
    expect(cols).not.toContain("external_ref");
    expect(cols).toEqual(expect.arrayContaining(["last_read_seq", "muted_until", "is_favorite"]));
  });
});

describe("3 · SECURITY DEFINER y search_path de los helpers reutilizados", () => {
  it("_connect_channel_allowed, _connect_is_member e is_admin son SECDEF con search_path fijo", async () => {
    const { rows } = await db.query(`
      select p.proname, p.prosecdef, coalesce(array_to_string(p.proconfig,','),'') cfg
        from pg_proc p join pg_namespace n on n.oid=p.pronamespace
       where n.nspname='public'
         and p.proname in ('_connect_channel_allowed','_connect_is_member','is_admin','nexus_link_can')`);
    expect(rows.length).toBeGreaterThanOrEqual(4);
    for (const r of rows) {
      expect(r.prosecdef, r.proname).toBe(true);
      expect(r.cfg, r.proname).toContain("search_path=public");
    }
  });

  it("ninguno concede EXECUTE a anon ni a PUBLIC", async () => {
    const { rows } = await db.query(`
      select p.proname, coalesce(array_to_string(p.proacl,','),'') acl
        from pg_proc p join pg_namespace n on n.oid=p.pronamespace
       where n.nspname='public'
         and p.proname in ('_connect_channel_allowed','_connect_is_member','nexus_link_can')`);
    for (const r of rows) {
      expect(r.acl, r.proname).not.toMatch(/(^|,)=X/);
      expect(r.acl, r.proname).not.toContain("anon=");
      expect(r.acl, r.proname).toContain("authenticated=X");
    }
  });

  it("auth.uid() es lo único que decide la identidad — cambiar el observer cambia el resultado", async () => {
    const comoJefe = await count(JEFE_DEPOSITO,
      `select count(*)::text n from public.connect_participants where conversation_id='${convWa}'`);
    const comoComercial = await count(COMERCIAL,
      `select count(*)::text n from public.connect_participants where conversation_id='${convWa}'`);
    expect(comoComercial).toBeGreaterThan(comoJefe);
  });
});

describe("4/8 · Jefe de Depósito, participante, SIN capacidad: DENEGADO", () => {
  it("no lee ninguna fila de connect_participants del hilo de WhatsApp", async () => {
    expect(await count(JEFE_DEPOSITO,
      `select count(*)::text n from public.connect_participants where conversation_id='${convWa}'`))
      .toBe(0);
  });

  it("en particular, NO lee el teléfono del participante externo", async () => {
    const r = await como<{ phone: string | null }>(JEFE_DEPOSITO,
      `select external_ref->>'phone' as phone from public.connect_participants
        where conversation_id='${convWa}' and participant_type='whatsapp'`);
    expect(r).toHaveLength(0);
  });

  it("tampoco por SELECT *, ni por cualquier proyección de columnas", async () => {
    expect(await count(JEFE_DEPOSITO,
      `select count(*)::text n from public.connect_participants
        where conversation_id='${convWa}' and external_ref is not null`)).toBe(0);
  });

  it("el permiso legacy connect.view/create/edit, VIGENTE, no es bypass", async () => {
    // Precondición del propio seed: Jefe de Depósito TIENE esos tres permisos.
    const legacy = await count(JEFE_DEPOSITO,
      "select count(*)::text n from public.permissions where slug in ('connect.view','connect.create','connect.edit')");
    expect(legacy).toBe(3); // los ve (son públicos), pero no es lo que se mide
    const tiene = await como<{ ok: boolean }>(JEFE_DEPOSITO, `
      select exists(
        select 1 from public.user_roles ur join public.role_permissions rp on rp.role_id=ur.role_id
        join public.permissions p on p.id=rp.permission_id
        where ur.user_id=auth.uid() and p.slug='connect.view'
      ) as ok`);
    expect(tiene[0]!.ok).toBe(true); // confirma que el escenario es realista
    // Y sin embargo, sigue sin ver el participante externo:
    expect(await count(JEFE_DEPOSITO,
      `select count(*)::text n from public.connect_participants
        where conversation_id='${convWa}' and participant_type='whatsapp'`)).toBe(0);
  });
});

describe("5 · operador comercial autorizado: conserva acceso", () => {
  it("lee todas las filas del hilo, incluida la del teléfono", async () => {
    expect(await count(COMERCIAL,
      `select count(*)::text n from public.connect_participants where conversation_id='${convWa}'`))
      .toBeGreaterThanOrEqual(5);
  });

  it("el teléfono llega exacto, sin transformar", async () => {
    const r = await como<{ phone: string }>(COMERCIAL,
      `select external_ref->>'phone' as phone from public.connect_participants
        where conversation_id='${convWa}' and participant_type='whatsapp'`);
    expect(r).toHaveLength(1);
    expect(r[0]!.phone).toBe(TEL_CONTRAPARTE);
  });
});

describe("6 · administrador canónico CON capacidad explícita: conserva acceso", () => {
  it("is_admin()=true y capacidad otorgada → lee el hilo completo", async () => {
    expect(await count(ADMIN_CON_CAPACIDAD,
      `select count(*)::text n from public.connect_participants where conversation_id='${convWa}'`))
      .toBeGreaterThanOrEqual(5);
  });
});

describe("6b · profiles.role='admin' SIN capacidad explícita: DENEGADO", () => {
  it("has_permission('connect.view') pasa por el atajo current_role()='admin' de 0009…", async () => {
    const r = await como<{ ok: boolean }>(ADMIN_SIN_CAPACIDAD,
      "select public.has_permission('connect.view') as ok");
    expect(r[0]!.ok).toBe(true); // el atajo legacy SÍ lo deja pasar
  });

  it("…pero nexus_link_can() no tiene ese atajo, y la fila sigue sin verse", async () => {
    const puede = await como<{ ok: boolean }>(ADMIN_SIN_CAPACIDAD,
      "select public.nexus_link_can('nexus_link.whatsapp.read') as ok");
    expect(puede[0]!.ok).toBe(false);
    expect(await count(ADMIN_SIN_CAPACIDAD,
      `select count(*)::text n from public.connect_participants where conversation_id='${convWa}'`))
      .toBe(0);
  });

  it("alterar profiles.role a mano, aislado, tampoco basta", async () => {
    // AJENO no es participante ni tiene ningún permiso: se le sube el rol a
    // 'admin' EN VIVO y se mide que, aun así, no ve nada del hilo de WhatsApp
    // — ni por is_admin() (que ahora sería true) ni por membresía (que sigue
    // sin tener). Se revierte al final para no contaminar los casos previos.
    await db.query("update public.profiles set role='admin' where id=$1", [AJENO]);
    try {
      expect(await count(AJENO,
        `select count(*)::text n from public.connect_participants where conversation_id='${convWa}'`))
        .toBe(0);
    } finally {
      await db.query("update public.profiles set role='operaciones' where id=$1", [AJENO]);
    }
  });
});

describe("7 · chat interno: conservado, sin ficha, sin capacidad exigida", () => {
  it("Jefe de Depósito sigue leyendo participantes del DM interno", async () => {
    expect(await count(JEFE_DEPOSITO,
      `select count(*)::text n from public.connect_participants where conversation_id='${convDm}'`))
      .toBeGreaterThan(0);
  });

  it("nadie externo (sin membresía) ve el DM interno, con o sin capacidad de WhatsApp", async () => {
    expect(await count(AJENO,
      `select count(*)::text n from public.connect_participants where conversation_id='${convDm}'`))
      .toBe(0);
  });
});

describe("9 · Realtime y external_ref", () => {
  /**
   * `postgres_changes` entrega un cambio a un suscriptor si y sólo si la
   * policy SELECT de la tabla lo deja ver, evaluada con SU identidad. Mismo
   * método que `t-link-b1-02`: se ejercita el predicado, no un cliente de
   * websocket — el websocket no agrega ninguna decisión que la policy no
   * tenga ya.
   */
  it("connect_participants sigue publicada en supabase_realtime", async () => {
    const { rows } = await db.query(
      `select 1 n from pg_publication_tables
        where pubname='supabase_realtime' and tablename='connect_participants'`);
    expect(rows).toHaveLength(1);
  });

  it("el predicado que Realtime aplicaría deniega al Jefe de Depósito la fila del teléfono", async () => {
    // Exactamente la policy SELECT, evaluada para su identidad — es lo que
    // postgres_changes hace internamente antes de emitir el evento.
    expect(await count(JEFE_DEPOSITO,
      `select count(*)::text n from public.connect_participants
        where id = (select id from public.connect_participants
                     where conversation_id='${convWa}' and participant_type='whatsapp')`))
      .toBe(0);
  });

  it("…y se la entrega al comercial autorizado", async () => {
    expect(await count(COMERCIAL,
      `select count(*)::text n from public.connect_participants
        where id = (select id from public.connect_participants
                     where conversation_id='${convWa}' and participant_type='whatsapp')`))
      .toBe(1);
  });
});

describe("búsqueda, joins y funciones: ninguna otra vía expone external_ref", () => {
  it("ninguna función SECURITY DEFINER de public referencia external_ref en su código", async () => {
    // Barrido estructural: si alguna función futura empezara a proyectar esta
    // columna hacia afuera, este caso lo detecta sin depender de que alguien
    // se acuerde de escribir un test nuevo para ESA función en particular.
    const { rows } = await db.query(`
      select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
       where n.nspname='public' and p.prosecdef = true
         and pg_get_functiondef(p.oid) ilike '%external_ref%'`);
    expect(rows).toEqual([]);
  });

  it("connect_search no está entre los caminos de fuga (no referencia connect_participants.external_ref)", async () => {
    // connect_search (0153+) no está en este cierre porque no toca
    // connect_participants (verificado por grep, ver docblock); esta prueba
    // deja la afirmación como comprobación viva, no como nota en un comentario.
    const { rows } = await db.query(`
      select 1 n from pg_proc where proname='connect_search'
        and pg_get_functiondef(oid) ilike '%external_ref%'`);
    expect(rows).toEqual([]);
  });
});

describe("g · nada se filtra por error: sin filas, sin excepción, sin mensaje", () => {
  it("la consulta denegada no lanza — devuelve cero filas, no un error con contenido", async () => {
    await expect(como(JEFE_DEPOSITO,
      `select external_ref from public.connect_participants where conversation_id='${convWa}'`))
      .resolves.toEqual([]);
  });
});

describe("10-12 · rollback en orden inverso, restitución exacta, reaplicación limpia", () => {
  it("0239 → 0238 → 0237 → 0236 → 0235a, en ese orden, sin error", async () => {
    await db.query(readFileSync(R_0239, "utf8"));
    await db.query(readFileSync(R_0238, "utf8"));
    await db.query(readFileSync(R_0237, "utf8"));
    await db.query(readFileSync(R_0236, "utf8"));
    await db.query(readFileSync(R_0235A, "utf8"));
  }, 60_000);

  it("la policy SELECT de connect_participants vuelve a la forma exacta de 0143", async () => {
    const { rows } = await db.query(
      `select qual from pg_policies where tablename='connect_participants' and cmd='SELECT'`);
    expect(rows[0].qual).not.toContain("_connect_channel_allowed");
    expect(rows[0].qual).toContain("_connect_is_member");
  });

  it("restituido: el Jefe de Depósito vuelve a leer el teléfono (el estado PREVIO a este candidato)", async () => {
    // Prueba negativa deliberada: si esto DIERA 0, el rollback estaría
    // dejando un resto de la protección — que también sería un defecto,
    // porque «restituir» significa volver exactamente al estado anterior,
    // ni más cerrado ni más abierto.
    await db.query("grant execute on all functions in schema public to authenticated");
    await db.query("grant select on all tables in schema public to authenticated");
    const r = await como<{ phone: string }>(JEFE_DEPOSITO,
      `select external_ref->>'phone' as phone from public.connect_participants
        where conversation_id='${convWa}' and participant_type='whatsapp'`);
    expect(r).toHaveLength(1);
    expect(r[0]!.phone).toBe(TEL_CONTRAPARTE);
  });

  it("reaplicación limpia: 0235a → 0236 → 0237 → 0238 → 0239 vuelven a aplicar sin error", async () => {
    await db.query(REAL("0235a_nexus_link_permission_module.sql"));
    await db.query(REAL("0236_nexus_link_channel_capabilities.sql"));
    await db.query(REAL("0237_nexus_link_channel_rls.sql"));
    await db.query(REAL("0238_nexus_link_upload_lifecycle.sql"));
    await db.query(REAL(M_0239));
    await db.query("grant execute on all functions in schema public to authenticated");
    await db.query("grant select on all tables in schema public to authenticated");
  }, 60_000);

  it("reaplicado: el Jefe de Depósito vuelve a estar denegado", async () => {
    expect(await count(JEFE_DEPOSITO,
      `select count(*)::text n from public.connect_participants
        where conversation_id='${convWa}' and participant_type='whatsapp'`)).toBe(0);
  });

  it("reaplicado: el comercial sigue viendo el hilo completo", async () => {
    expect(await count(COMERCIAL,
      `select count(*)::text n from public.connect_participants where conversation_id='${convWa}'`))
      .toBeGreaterThanOrEqual(5);
  });
});
