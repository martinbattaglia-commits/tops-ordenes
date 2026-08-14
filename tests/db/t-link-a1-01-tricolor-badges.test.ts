/**
 * T-LINK-A1-01 · NEXUS-LINK-NOTIFICATIONS-MEDIA-001 · FASE A.1
 *
 * Ensayo representativo de la migración 0234 y de su inversa, contra
 * PostgreSQL REAL, en una base efímera dedicada (sin tocar el cluster
 * compartido ni producción).
 *
 * ─── QUÉ DEMUESTRA ─────────────────────────────────────────────────────────
 *
 * El defecto original: `connect_messages.seq` es `generated always as
 * identity` a nivel de TABLA, o sea un ID GLOBAL. La vista 0145 calculaba
 * `unread_count = last_message_seq - last_read_seq`, restándole un cursor a un
 * ID global: toda conversación nunca abierta mostraba el ID del último mensaje
 * (los badges 1572 / 1570 / 1569 reportados por Dirección).
 *
 * La prueba REPRODUCE ese defecto sobre la definición vieja —cargando el
 * ROLLBACK, que es textualmente 0145— y luego demuestra que 0234 lo corrige,
 * con el mismo dato. No se afirma la corrección: se mide antes y después.
 *
 * El SQL bajo prueba es el REAL, leído de los archivos en disco. No hay copia
 * del cálculo dentro del test: si alguien edita la migración, esto lo ve.
 */

import { afterAll, beforeAll, describe, expect, it, inject } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Client } from "pg";
import { createWaSandbox, type WaSandbox } from "./harness/wa-sandbox";

const MIGRACION = resolve(
  __dirname, "..", "..", "supabase", "migrations",
  "0234_link_notification_badges_tricolor.sql",
);
const ROLLBACK = resolve(
  __dirname, "..", "..", "supabase", "migrations",
  "ROLLBACK_0234_link_notification_badges_tricolor.sql",
);
const MIGRACION_0235 = resolve(
  __dirname, "..", "..", "supabase", "migrations",
  "0235_link_notification_personal_read.sql",
);
const ROLLBACK_0235 = resolve(
  __dirname, "..", "..", "supabase", "migrations",
  "ROLLBACK_0235_link_notification_personal_read.sql",
);

/** Observadores del escenario. Identidades fijas: nada se infiere. */
const YO = "11111111-1111-4111-8111-111111111111";
const OTRO = "22222222-2222-4222-8222-222222222222";
/** Perfil con rol `admin`: la RLS le deja VER todo (rama de auditoría). */
const ADMIN = "33333333-3333-4333-8333-333333333333";

/**
 * Cierre acotado: exactamente las estructuras que las vistas de 0234 tocan,
 * con los MISMOS tipos y las MISMAS restricciones que 0143 —incluida la
 * identidad global de `seq`, que es la causa raíz, y los índices reales sobre
 * (conversation_id, seq) y (conversation_id, profile_id)—.
 *
 * `auth.uid()` se resuelve por GUC para poder cambiar de observador dentro de
 * la misma base sin recrear nada.
 */
const CIERRE_ACOTADO = `
  create extension if not exists pgcrypto;
  create schema if not exists auth;
  -- 0235 referencia auth.users(id): se reproduce la tabla mínima.
  create table auth.users (id uuid primary key);
  create or replace function auth.uid() returns uuid language sql stable as $fn$
    select nullif(current_setting('test.observer', true), '')::uuid
  $fn$;

  create type public.connect_conversation_kind_t as enum
    ('dm','group','channel','erp','incident','whatsapp','ai','task');
  create type public.connect_message_kind_t as enum
    ('text','system','ai','file','call_link','whatsapp','audio');

  create table public.connect_conversations (
    id                uuid primary key default gen_random_uuid(),
    context_id        uuid,
    kind              public.connect_conversation_kind_t not null,
    title             text,
    slug              text,
    topic             text,
    last_message_at   timestamptz,
    last_message_seq  bigint,
    archived_at       timestamptz
  );

  create table public.connect_participants (
    id               uuid primary key default gen_random_uuid(),
    conversation_id  uuid not null references public.connect_conversations(id) on delete cascade,
    profile_id       uuid,
    last_read_seq    bigint not null default 0,
    muted_until      timestamptz,
    is_favorite      boolean not null default false,
    unique (conversation_id, profile_id)
  );

  -- seq GLOBAL, igual que 0143: es el corazón del defecto que se corrige.
  create table public.connect_messages (
    id                 uuid primary key default gen_random_uuid(),
    conversation_id    uuid not null references public.connect_conversations(id) on delete cascade,
    seq                bigint generated always as identity,
    author_profile_id  uuid,
    kind               public.connect_message_kind_t not null default 'text',
    deleted_at         timestamptz,
    created_at         timestamptz not null default now()
  );
  create unique index connect_messages_conv_seq_uidx
    on public.connect_messages (conversation_id, seq);

  -- Trigger equivalente a 0144:34 / 0161:214 — copia el seq GLOBAL.
  create or replace function public.tg_touch_last_seq() returns trigger
    language plpgsql as $fn$
    begin
      update public.connect_conversations
         set last_message_seq = new.seq, last_message_at = now()
       where id = new.conversation_id;
      return new;
    end;
  $fn$;
  create trigger trg_touch_last_seq after insert on public.connect_messages
    for each row execute function public.tg_touch_last_seq();

  -- Perfiles y current_role(): REPRODUCCIÓN FIEL de 0005. Es SECURITY DEFINER
  -- y estable, y es la que habilita la rama de auditoría del admin.
  create type public.user_role_t as enum ('admin','operador','cliente');
  create table public.profiles (
    id   uuid primary key,
    role public.user_role_t not null default 'operador'
  );
  create or replace function public."current_role"() returns public.user_role_t
    language sql stable security definer set search_path = public, pg_temp as $fn$
      select role from public.profiles where id = auth.uid()
    $fn$;

  create table public.notifications (
    id           uuid primary key default gen_random_uuid(),
    user_id      uuid,
    role_target  public.user_role_t,
    delegated_to uuid,
    kind         text not null default 'system',
    title        text not null default '',
    message      text not null default '',
    entity       text,
    entity_id    uuid,
    read_at      timestamptz,
    remind_at    timestamptz,
    priority     text,
    created_at   timestamptz not null default now()
  );

  -- ─── C4 · B-2 ────────────────────────────────────────────────────────────
  -- La RLS REAL de producción, copiada literalmente de pg_policy (0004 + 0162),
  -- incluida la rama de auditoría current_role() = 'admin'. La versión
  -- anterior de este cierre inventaba una policy user_id = auth.uid() mucho
  -- más estricta que la real, así que el caso de aislamiento pasaba en verde
  -- aunque la vista no filtrara por destinatario. Con la policy verdadera, ese
  -- caso sólo pasa si el filtro está DENTRO de la vista.
  -- Son dos policies permisivas de SELECT y se combinan por OR. Verificado
  -- contra pg_policy de producción (2026-08-14): las dos coexisten —0162
  -- reemplaza "notifications read own or role", pero notifications_select_own
  -- de 0004 sigue viva—. La segunda es un subconjunto estricto de la primera,
  -- así que no cambia el resultado; se reproduce igual para no describir una
  -- RLS distinta de la real.
  alter table public.notifications enable row level security;
  create policy "notifications read own or role" on public.notifications
    for select using (
      user_id = auth.uid()
      or delegated_to = auth.uid()
      or (role_target is not null and role_target = public."current_role"())
      or public."current_role"() = 'admin'::public.user_role_t
    );
  create policy notifications_select_own on public.notifications
    for select using (user_id = auth.uid());

  -- Publicación de realtime: 0235 agrega notification_reads acá. En el
  -- sandbox no existe por defecto, así que se crea vacía para poder verificar
  -- que la migración la publica de verdad.
  create publication supabase_realtime;

  -- El rol se llama authenticated, igual que en producción: así los grant y
  -- revoke que traen las migraciones se aplican LITERALMENTE sobre el mismo
  -- rol que verifica la prueba, sin traducción intermedia.
  -- Los roles son de CLUSTER, no de base: el arnés compartido ya puede haberlo
  -- creado. Se reutiliza y no se borra al terminar, para no pisar otras suites.
  -- Los privilegios sí son por objeto y por base, así que los grant/revoke de
  -- esta prueba quedan confinados a su base efímera.
  do $rol$
  begin
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then
      create role authenticated nologin;
    end if;
  end $rol$;
  grant usage on schema public, auth to authenticated;
  grant select on public.connect_conversations, public.connect_participants,
                  public.connect_messages, public.notifications,
                  public.profiles to authenticated;
  grant execute on function public."current_role"() to authenticated;

  -- Estado que deja 0162 y que 0235 viene a cerrar (C4 3/3 · MEDIUM-2): policy
  -- de UPDATE con rama de admin + grant por columna. Sin reproducirlo, la
  -- prueba del revoke pasaría por una razón equivocada.
  create policy "notifications mark read own" on public.notifications
    for update
    using (user_id = auth.uid() or delegated_to = auth.uid()
           or public."current_role"() = 'admin'::public.user_role_t)
    with check (user_id = auth.uid() or delegated_to = auth.uid()
           or public."current_role"() = 'admin'::public.user_role_t);
  grant update (read_at, remind_at) on public.notifications to authenticated;
`;

let sb: WaSandbox;
let db: Client;

/** Ejecuta el archivo de migración REAL, tal como está en disco. */
async function aplicar(archivo: string): Promise<void> {
  await db.query(readFileSync(archivo, "utf8"));
  await db.query("grant select on public.v_connect_inbox, public.v_connect_unread_total to authenticated");
  const { rows } = await db.query(
    "select count(*)::int as n from information_schema.views where table_schema='public' and table_name='v_link_notification_badges'",
  );
  if (rows[0].n > 0) {
    await db.query("grant select on public.v_link_notification_badges to authenticated");
  }
  const { rows: v235 } = await db.query(
    "select count(*)::int as n from information_schema.views where table_schema='public' and table_name='v_link_my_notifications'",
  );
  if (v235[0].n > 0) {
    await db.query("grant select on public.v_link_my_notifications to authenticated");
    // La vista es security_invoker: el llamador necesita SELECT sobre la tabla
    // de marcas. En producción ese grant va a `authenticated` (0235).
    await db.query("grant select on public.notification_reads to authenticated");
    await db.query("grant execute on function public.connect_notif_mark_read(uuid) to authenticated");
    await db.query("grant execute on function public.connect_notif_mark_all_read() to authenticated");
  }
}

/** Ejecuta una sentencia COMO el observador dado (rol no-superusuario). */
async function ejecutarComo(uid: string, sql: string): Promise<void> {
  await db.query("set role authenticated");
  await db.query("select set_config('test.observer', $1, false)", [uid]);
  try {
    await db.query(sql);
  } finally {
    await db.query("reset role");
  }
}

/** Lee como `uid`, con RLS activa (rol no-superusuario). */
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

async function badges(uid: string) {
  const [r] = await comoObservador<{
    red_system_count: string; green_whatsapp_count: string; yellow_internal_count: string;
  }>(uid, "select * from public.v_link_notification_badges");
  return {
    rojo: Number(r.red_system_count),
    verde: Number(r.green_whatsapp_count),
    amarillo: Number(r.yellow_internal_count),
  };
}

async function badgePorConversacion(uid: string, titulo: string): Promise<number> {
  const rows = await comoObservador<{ unread_count: string }>(
    uid,
    `select unread_count from public.v_connect_inbox where title = '${titulo}'`,
  );
  return rows.length ? Number(rows[0].unread_count) : -1;
}

/** Alta de conversación + participantes. Devuelve el id. */
async function nuevaConversacion(
  kind: string, title: string,
  participantes: Array<{ uid: string; lastRead?: number; muted?: string | null }>,
  archivada = false,
): Promise<string> {
  const { rows } = await db.query(
    `insert into public.connect_conversations (kind, title, archived_at)
     values ($1::public.connect_conversation_kind_t, $2, $3) returning id`,
    [kind, title, archivada ? new Date().toISOString() : null],
  );
  const id = rows[0].id as string;
  for (const p of participantes) {
    await db.query(
      `insert into public.connect_participants (conversation_id, profile_id, last_read_seq, muted_until)
       values ($1,$2,$3,$4)`,
      [id, p.uid, p.lastRead ?? 0, p.muted ?? null],
    );
  }
  return id;
}

async function mensaje(
  conv: string, opts: { autor?: string | null; kind?: string; borrado?: boolean } = {},
): Promise<void> {
  await db.query(
    `insert into public.connect_messages (conversation_id, author_profile_id, kind, deleted_at)
     values ($1,$2,$3::public.connect_message_kind_t,$4)`,
    [conv, opts.autor ?? null, opts.kind ?? "text", opts.borrado ? new Date().toISOString() : null],
  );
}

beforeAll(async () => {
  sb = await createWaSandbox(inject("dbUrl"));
  db = sb.client;
  await db.query(CIERRE_ACOTADO);
  await db.query("insert into auth.users (id) values ($1),($2),($3)", [YO, OTRO, ADMIN]);
  await db.query(
    `insert into public.profiles (id, role) values
       ($1,'operador'::public.user_role_t),
       ($2,'operador'::public.user_role_t),
       ($3,'admin'::public.user_role_t)`,
    [YO, OTRO, ADMIN],
  );
}, 120_000);

afterAll(async () => {
  await sb?.destroy();
});

describe("T-LINK-A1-01 · el defecto original es real y reproducible", () => {
  it("con la definición VIEJA (ROLLBACK ≡ 0145) el badge es el ID global, no el conteo", async () => {
    await aplicar(ROLLBACK);

    // Ruido previo: empuja la identidad global bien lejos del conteo real.
    const ruido = await nuevaConversacion("channel", "ruido", [{ uid: OTRO }]);
    for (let i = 0; i < 40; i++) await mensaje(ruido, { autor: OTRO });

    const conv = await nuevaConversacion("whatsapp", "Contacto A", [{ uid: YO }]);
    await mensaje(conv); // 1 solo mensaje entrante REAL
    await mensaje(conv); // 2

    const viejo = await badgePorConversacion(YO, "Contacto A");
    // 42 mensajes globales → el badge viejo muestra el ID, no "2".
    expect(viejo).toBe(42);
    expect(viejo).not.toBe(2);
  });

  it("0234 corrige el MISMO dato: el badge pasa a ser el conteo real", async () => {
    await aplicar(MIGRACION);
    expect(await badgePorConversacion(YO, "Contacto A")).toBe(2);
  });
});

describe("T-LINK-A1-01 · contador exacto por conversación (aceptación 1 y 2)", () => {
  it("cuenta 0, 1, 2 y 10 mensajes no leídos", async () => {
    const c0 = await nuevaConversacion("dm", "n0", [{ uid: YO }]);
    const c1 = await nuevaConversacion("dm", "n1", [{ uid: YO }]);
    const c2 = await nuevaConversacion("dm", "n2", [{ uid: YO }]);
    const c10 = await nuevaConversacion("dm", "n10", [{ uid: YO }]);
    void c0;
    await mensaje(c1, { autor: OTRO });
    for (let i = 0; i < 2; i++) await mensaje(c2, { autor: OTRO });
    for (let i = 0; i < 10; i++) await mensaje(c10, { autor: OTRO });

    expect(await badgePorConversacion(YO, "n0")).toBe(0);
    expect(await badgePorConversacion(YO, "n1")).toBe(1);
    expect(await badgePorConversacion(YO, "n2")).toBe(2);
    expect(await badgePorConversacion(YO, "n10")).toBe(10);
  });

  it("lectura PARCIAL deja el resto pendiente; lectura TOTAL deja cero", async () => {
    const conv = await nuevaConversacion("dm", "parcial", [{ uid: YO }]);
    for (let i = 0; i < 5; i++) await mensaje(conv, { autor: OTRO });
    expect(await badgePorConversacion(YO, "parcial")).toBe(5);

    const { rows } = await db.query(
      "select seq from public.connect_messages where conversation_id=$1 order by seq", [conv],
    );
    const seqs = rows.map((r: { seq: string }) => Number(r.seq));

    await db.query(
      "update public.connect_participants set last_read_seq=$1 where conversation_id=$2 and profile_id=$3",
      [seqs[2], conv, YO],
    );
    expect(await badgePorConversacion(YO, "parcial")).toBe(2);

    await db.query(
      "update public.connect_participants set last_read_seq=$1 where conversation_id=$2 and profile_id=$3",
      [seqs[4], conv, YO],
    );
    expect(await badgePorConversacion(YO, "parcial")).toBe(0);
  });

  it("nunca es negativo aunque el cursor supere al último mensaje", async () => {
    const conv = await nuevaConversacion("dm", "cursor-adelantado", [{ uid: YO, lastRead: 999999 }]);
    await mensaje(conv, { autor: OTRO });
    expect(await badgePorConversacion(YO, "cursor-adelantado")).toBe(0);
  });
});

describe("T-LINK-A1-01 · qué NO se cuenta (aceptación 3)", () => {
  it("el mensaje propio del observador no incrementa el contador interno", async () => {
    const conv = await nuevaConversacion("group", "propios", [{ uid: YO }]);
    await mensaje(conv, { autor: YO });
    await mensaje(conv, { autor: YO });
    expect(await badgePorConversacion(YO, "propios")).toBe(0);

    await mensaje(conv, { autor: OTRO });
    expect(await badgePorConversacion(YO, "propios")).toBe(1);
  });

  it("en WhatsApp sólo cuentan los entrantes del contacto, no los salientes de Nexus", async () => {
    const conv = await nuevaConversacion("whatsapp", "wa-salientes", [{ uid: YO }]);
    await mensaje(conv, { autor: YO });    // saliente propio
    await mensaje(conv, { autor: OTRO });  // saliente de otro operador de Nexus
    expect(await badgePorConversacion(YO, "wa-salientes")).toBe(0);

    await mensaje(conv, { autor: null });  // entrante REAL del contacto
    expect(await badgePorConversacion(YO, "wa-salientes")).toBe(1);
  });

  it("no cuenta eventos técnicos (`system`) ni mensajes borrados", async () => {
    const conv = await nuevaConversacion("dm", "tecnicos", [{ uid: YO }]);
    await mensaje(conv, { autor: OTRO, kind: "system" });
    await mensaje(conv, { autor: OTRO, borrado: true });
    expect(await badgePorConversacion(YO, "tecnicos")).toBe(0);

    await mensaje(conv, { autor: OTRO });
    expect(await badgePorConversacion(YO, "tecnicos")).toBe(1);
  });
});

describe("T-LINK-A1-01 · tres indicadores independientes (aceptación 4 a 7)", () => {
  /** Base limpia por escenario: cada caso arma su propio universo. */
  async function limpiar() {
    await db.query("truncate public.connect_messages, public.connect_participants, public.connect_conversations, public.notifications restart identity cascade");
  }

  it("sin pendientes: los tres en cero", async () => {
    await limpiar();
    expect(await badges(YO)).toEqual({ rojo: 0, verde: 0, amarillo: 0 });
  });

  it("sólo VERDE: un entrante de WhatsApp no enciende rojo ni amarillo", async () => {
    await limpiar();
    const conv = await nuevaConversacion("whatsapp", "solo-verde", [{ uid: YO }]);
    await mensaje(conv);
    expect(await badges(YO)).toEqual({ rojo: 0, verde: 1, amarillo: 0 });
  });

  it("sólo AMARILLO: un mensaje interno no enciende rojo ni verde", async () => {
    await limpiar();
    const conv = await nuevaConversacion("dm", "solo-amarillo", [{ uid: YO }]);
    await mensaje(conv, { autor: OTRO });
    expect(await badges(YO)).toEqual({ rojo: 0, verde: 0, amarillo: 1 });
  });

  it("sólo ROJO: una notificación de sistema no enciende verde ni amarillo", async () => {
    await limpiar();
    await db.query("insert into public.notifications (user_id, kind) values ($1,'task_assigned')", [YO]);
    expect(await badges(YO)).toEqual({ rojo: 1, verde: 0, amarillo: 0 });
  });

  it("una tarea/incidente enciende AMARILLO por sus mensajes y ROJO por su aviso, sin suprimirse", async () => {
    await limpiar();
    const tarea = await nuevaConversacion("task", "TSK-1", [{ uid: YO }]);
    await mensaje(tarea, { autor: OTRO });
    await db.query("insert into public.notifications (user_id, kind) values ($1,'task_assigned')", [YO]);
    expect(await badges(YO)).toEqual({ rojo: 1, verde: 0, amarillo: 1 });
  });

  it("los tres simultáneos, cada uno con su cifra propia", async () => {
    await limpiar();
    const wa = await nuevaConversacion("whatsapp", "wa", [{ uid: YO }]);
    await mensaje(wa); await mensaje(wa); await mensaje(wa);
    const dm = await nuevaConversacion("dm", "dm", [{ uid: YO }]);
    await mensaje(dm, { autor: OTRO }); await mensaje(dm, { autor: OTRO });
    await db.query(
      "insert into public.notifications (user_id, kind) select $1,'x' from generate_series(1,4)", [YO],
    );
    expect(await badges(YO)).toEqual({ rojo: 4, verde: 3, amarillo: 2 });
  });

  it("limpiar una categoría NO limpia las otras dos", async () => {
    // Continúa el escenario anterior: se leen los mensajes de WhatsApp.
    await db.query(`
      update public.connect_participants p
         set last_read_seq = (select max(m.seq) from public.connect_messages m
                               where m.conversation_id = p.conversation_id)
        from public.connect_conversations c
       where c.id = p.conversation_id and c.kind = 'whatsapp'
    `);
    expect(await badges(YO)).toEqual({ rojo: 4, verde: 0, amarillo: 2 });

    await db.query("update public.notifications set read_at = now() where user_id = $1", [YO]);
    expect(await badges(YO)).toEqual({ rojo: 0, verde: 0, amarillo: 2 });
  });
});

describe("T-LINK-A1-01 · silenciadas, archivadas y aislamiento", () => {
  async function limpiar() {
    await db.query("truncate public.connect_messages, public.connect_participants, public.connect_conversations, public.notifications restart identity cascade");
  }

  it("una conversación silenciada no enciende verde ni amarillo mientras dure el silencio", async () => {
    await limpiar();
    const futuro = new Date(Date.now() + 3_600_000).toISOString();
    const wa = await nuevaConversacion("whatsapp", "muteada", [{ uid: YO, muted: futuro }]);
    await mensaje(wa);
    expect(await badges(YO)).toEqual({ rojo: 0, verde: 0, amarillo: 0 });
    // Pero su badge por conversación sigue informando el pendiente real.
    expect(await badgePorConversacion(YO, "muteada")).toBe(1);
  });

  it("al vencer el silencio, el pendiente reaparece si sigue sin leerse", async () => {
    const pasado = new Date(Date.now() - 1_000).toISOString();
    await db.query("update public.connect_participants set muted_until = $1", [pasado]);
    expect(await badges(YO)).toEqual({ rojo: 0, verde: 1, amarillo: 0 });
  });

  it("una conversación archivada no suma al agregado", async () => {
    await limpiar();
    const conv = await nuevaConversacion("dm", "archivada", [{ uid: YO }], true);
    await mensaje(conv, { autor: OTRO });
    expect(await badges(YO)).toEqual({ rojo: 0, verde: 0, amarillo: 0 });
  });

  it("no filtra pendientes de otro usuario ni notificaciones ajenas", async () => {
    await limpiar();
    const ajena = await nuevaConversacion("whatsapp", "de-otro", [{ uid: OTRO }]);
    await mensaje(ajena);
    await db.query("insert into public.notifications (user_id, kind) values ($1,'x')", [OTRO]);

    expect(await badges(YO)).toEqual({ rojo: 0, verde: 0, amarillo: 0 });
    expect(await badgePorConversacion(YO, "de-otro")).toBe(-1); // ni siquiera la ve
    expect(await badges(OTRO)).toEqual({ rojo: 1, verde: 1, amarillo: 0 });
  });
});

describe("T-LINK-A1-01 · el contador rojo cuenta MIS pendientes (C4 · B-1)", () => {
  async function limpiarNotif() {
    await db.query("truncate public.notifications");
    await db.query("truncate public.connect_messages, public.connect_participants, public.connect_conversations restart identity cascade");
  }

  it("un admin NO ve en su badge los pendientes de otros, aunque la RLS se los deje leer", async () => {
    await limpiarNotif();
    await db.query("insert into public.notifications (user_id) values ($1),($1),($2)", [YO, OTRO]);

    // La RLS de auditoría efectivamente le muestra las tres filas…
    const visibles = await comoObservador<{ n: string }>(
      ADMIN, "select count(*)::text as n from public.notifications",
    );
    expect(Number(visibles[0].n)).toBe(3);

    // …pero su badge cuenta CERO, porque ninguna está dirigida a él.
    expect((await badges(ADMIN)).rojo).toBe(0);
    // Y cada destinatario ve exactamente lo suyo.
    expect((await badges(YO)).rojo).toBe(2);
    expect((await badges(OTRO)).rojo).toBe(1);
  });

  it("el admin sí cuenta las suyas: puede llegar a cero por su propia acción", async () => {
    await limpiarNotif();
    await db.query("insert into public.notifications (user_id) values ($1),($2)", [ADMIN, OTRO]);
    expect((await badges(ADMIN)).rojo).toBe(1);

    await db.query("update public.notifications set read_at = now() where user_id = $1", [ADMIN]);
    expect((await badges(ADMIN)).rojo).toBe(0);
    // La pendiente ajena sigue existiendo y no lo afecta.
    expect((await badges(OTRO)).rojo).toBe(1);
  });

  it("un aviso delegado a mí cuenta como mío", async () => {
    await limpiarNotif();
    await db.query(
      "insert into public.notifications (user_id, delegated_to) values ($1,$2)", [OTRO, YO],
    );
    expect((await badges(YO)).rojo).toBe(1);
  });

  it("un broadcast por rol cuenta sólo para ese rol", async () => {
    await limpiarNotif();
    await db.query(
      "insert into public.notifications (role_target) values ('admin'::public.user_role_t)",
    );
    expect((await badges(ADMIN)).rojo).toBe(1);
    expect((await badges(YO)).rojo).toBe(0);
  });

  it("una notificación pospuesta no cuenta hasta su hora, y después sí", async () => {
    await limpiarNotif();
    const futuro = new Date(Date.now() + 3_600_000).toISOString();
    await db.query("insert into public.notifications (user_id, remind_at) values ($1,$2)", [YO, futuro]);
    expect((await badges(YO)).rojo).toBe(0);

    await db.query("update public.notifications set remind_at = now() - interval '1 minute'");
    expect((await badges(YO)).rojo).toBe(1);
  });
});

describe("T-LINK-A1-01 · fuente de verdad única y rendimiento", () => {
  it("el agregado por categoría es exactamente la suma de los badges por conversación", async () => {
    await db.query("truncate public.connect_messages, public.connect_participants, public.connect_conversations, public.notifications restart identity cascade");
    for (let i = 0; i < 25; i++) {
      const kind = i % 2 === 0 ? "whatsapp" : "dm";
      const conv = await nuevaConversacion(kind, `c${i}`, [{ uid: YO }]);
      for (let j = 0; j <= i % 4; j++) {
        await mensaje(conv, { autor: kind === "whatsapp" ? null : OTRO });
      }
    }
    const filas = await comoObservador<{ kind: string; unread_count: string }>(
      YO, "select kind, unread_count from public.v_connect_inbox where archived_at is null",
    );
    const sumaVerde = filas.filter((f) => f.kind === "whatsapp")
      .reduce((n, f) => n + Number(f.unread_count), 0);
    const sumaAmarillo = filas.filter((f) => f.kind !== "whatsapp")
      .reduce((n, f) => n + Number(f.unread_count), 0);

    const b = await badges(YO);
    expect(b.verde).toBe(sumaVerde);
    expect(b.amarillo).toBe(sumaAmarillo);

    // Y el total heredado sigue siendo la suma de ambas categorías.
    const [t] = await comoObservador<{ unread_total: string }>(
      YO, "select unread_total from public.v_connect_unread_total",
    );
    expect(Number(t.unread_total)).toBe(sumaVerde + sumaAmarillo);
  });

  it("el agregado NO se limita a las primeras 15 conversaciones", async () => {
    // 25 conversaciones sembradas arriba, 13 de ellas WhatsApp.
    const filas = await comoObservador<{ n: string }>(
      YO, "select count(*)::text as n from public.v_connect_inbox",
    );
    expect(Number(filas[0].n)).toBe(25);
    const b = await badges(YO);
    expect(b.verde + b.amarillo).toBeGreaterThan(0);
  });

  it("el conteo por conversación resuelve por índice (conversation_id, seq)", async () => {
    // Volumen representativo: con dos filas el planificador elige Seq Scan y
    // la prueba no diría nada. Se siembra hasta que el índice sea la opción
    // barata, que es la condición que importa en producción.
    const { rows: c } = await db.query("select id from public.connect_conversations limit 1");
    await db.query(
      `insert into public.connect_messages (conversation_id, author_profile_id)
       select $1, $2 from generate_series(1, 5000)`,
      [c[0].id, OTRO],
    );
    await db.query("analyze public.connect_messages");
    await db.query("analyze public.connect_participants");
    await db.query("analyze public.connect_conversations");
    // Sobre la VISTA REAL, con el observador real: es el plan que corre en
    // producción, no una consulta equivalente escrita a mano.
    const rows = await comoObservador<Record<string, unknown>>(
      YO, "explain (format json) select * from public.v_connect_inbox",
    );
    const plan = JSON.stringify(rows[0]["QUERY PLAN"]);
    // El índice real de 0143 resuelve el rango (conversation_id, seq).
    expect(plan).toContain("connect_messages_conv_seq_uidx");
    // Y `connect_messages` NO se recorre secuencialmente. Se comprueba sobre
    // ese nodo en particular: el Seq Scan sobre `connect_conversations` lo
    // introduce el `limit 1` de esta misma consulta, no el conteo.
    const nodoMensajes = /\{"Node Type":"([^"]+)"[^}]*"Relation Name":"connect_messages"/.exec(plan);
    expect(nodoMensajes?.[1]).not.toBe("Seq Scan");
  });
});

describe("T-LINK-A1-02 · lectura individual de broadcasts (0235)", () => {
  /** Deja 0234 + 0235 aplicadas y la base de notificaciones limpia. */
  async function preparar() {
    await aplicar(MIGRACION);
    await aplicar(MIGRACION_0235);
    await db.query("truncate public.notification_reads");
    await db.query("truncate public.notifications cascade");
    await db.query("truncate public.connect_messages, public.connect_participants, public.connect_conversations restart identity cascade");
  }

  async function idDelUnicoAviso(): Promise<string> {
    const { rows } = await db.query("select id from public.notifications limit 1");
    return rows[0].id as string;
  }

  it("dos destinatarios del MISMO broadcast lo ven pendiente por separado", async () => {
    await preparar();
    await db.query(
      "insert into public.notifications (role_target) values ('operador'::public.user_role_t)",
    );
    expect((await badges(YO)).rojo).toBe(1);
    expect((await badges(OTRO)).rojo).toBe(1);
    // Y un perfil de otro rol no lo ve.
    expect((await badges(ADMIN)).rojo).toBe(0);
  });

  it("uno lo marca leído y el OTRO lo conserva pendiente", async () => {
    const id = await idDelUnicoAviso();
    await ejecutarComo(YO, `select public.connect_notif_mark_read('${id}'::uuid)`);

    expect((await badges(YO)).rojo).toBe(0);
    expect((await badges(OTRO)).rojo).toBe(1);
  });

  it("la fila compartida NO fue modificada: el estado de terceros queda intacto", async () => {
    const { rows } = await db.query("select read_at from public.notifications");
    expect(rows[0].read_at).toBeNull();
    // La marca vive en la tabla personal, y sólo para quien la hizo.
    const { rows: reads } = await db.query(
      "select profile_id from public.notification_reads",
    );
    expect(reads).toHaveLength(1);
    expect(reads[0].profile_id).toBe(YO);
  });

  it("el segundo destinatario también puede llegar a cero, sin afectar al primero", async () => {
    const id = await idDelUnicoAviso();
    await ejecutarComo(OTRO, `select public.connect_notif_mark_read('${id}'::uuid)`);
    expect((await badges(OTRO)).rojo).toBe(0);
    expect((await badges(YO)).rojo).toBe(0);
    const { rows } = await db.query("select read_at from public.notifications");
    expect(rows[0].read_at).toBeNull();
  });

  it("marcar dos veces es idempotente", async () => {
    const id = await idDelUnicoAviso();
    await ejecutarComo(YO, `select public.connect_notif_mark_read('${id}'::uuid)`);
    const { rows } = await db.query("select count(*)::int as n from public.notification_reads");
    expect(rows[0].n).toBe(2); // YO y OTRO, una vez cada uno
  });

  it("cada quien ve SÓLO su propia marca de lectura", async () => {
    const vistas = await comoObservador<{ profile_id: string }>(
      YO, "select profile_id from public.notification_reads",
    );
    expect(vistas).toHaveLength(1);
    expect(vistas[0].profile_id).toBe(YO);
  });

  it("un no destinatario NO puede marcar el broadcast ajeno", async () => {
    const id = await idDelUnicoAviso();
    await expect(
      ejecutarComo(ADMIN, `select public.connect_notif_mark_read('${id}'::uuid)`),
    ).rejects.toThrow(/no está dirigida a este usuario/);
  });

  it("un admin NO puede marcar leída la notificación DIRECTA de otro", async () => {
    await preparar();
    await db.query("insert into public.notifications (user_id) values ($1)", [OTRO]);
    const id = await idDelUnicoAviso();
    await expect(
      ejecutarComo(ADMIN, `select public.connect_notif_mark_read('${id}'::uuid)`),
    ).rejects.toThrow(/dueño o el delegado/);
    expect((await badges(OTRO)).rojo).toBe(1);
  });

  it("el delegado sí puede marcarla, y la marca es la del aviso directo", async () => {
    await preparar();
    await db.query(
      "insert into public.notifications (user_id, delegated_to) values ($1,$2)", [OTRO, YO],
    );
    const id = await idDelUnicoAviso();
    await ejecutarComo(YO, `select public.connect_notif_mark_read('${id}'::uuid)`);
    const { rows } = await db.query("select read_at from public.notifications");
    expect(rows[0].read_at).not.toBeNull();
    expect((await badges(YO)).rojo).toBe(0);
  });

  it("marcar TODAS deja mi rojo en cero sin tocar a nadie más", async () => {
    await preparar();
    await db.query(`
      insert into public.notifications (user_id, role_target) values
        ('${YO}', null), ('${YO}', null),
        (null, 'operador'::public.user_role_t),
        ('${OTRO}', null)
    `);
    expect((await badges(YO)).rojo).toBe(3);   // 2 directas + 1 broadcast
    expect((await badges(OTRO)).rojo).toBe(2); // 1 directa + el mismo broadcast

    await ejecutarComo(YO, "select public.connect_notif_mark_all_read()");

    expect((await badges(YO)).rojo).toBe(0);
    // El otro conserva su directa Y el broadcast: nada suyo fue tocado.
    expect((await badges(OTRO)).rojo).toBe(2);
  });

  it("un aviso pospuesto no se marca ni se cuenta hasta su hora", async () => {
    await preparar();
    const futuro = new Date(Date.now() + 3_600_000).toISOString();
    await db.query(
      "insert into public.notifications (user_id, remind_at) values ($1,$2)", [YO, futuro],
    );
    expect((await badges(YO)).rojo).toBe(0);
    await ejecutarComo(YO, "select public.connect_notif_mark_all_read()");
    const { rows } = await db.query("select read_at from public.notifications");
    expect(rows[0].read_at).toBeNull(); // no se marcó lo que ni siquiera es debido
  });

  it("la lista del panel y el contador comparten semántica: misma cifra", async () => {
    await preparar();
    await db.query(`
      insert into public.notifications (user_id, role_target) values
        ('${YO}', null), (null, 'operador'::public.user_role_t), ('${OTRO}', null)
    `);
    const pendientesLista = await comoObservador<{ n: string }>(
      YO,
      "select count(*)::text as n from public.v_link_my_notifications where not is_read and is_due",
    );
    expect(Number(pendientesLista[0].n)).toBe((await badges(YO)).rojo);
    // Y la lista NO incluye el aviso ajeno.
    const filas = await comoObservador<{ user_id: string | null }>(
      YO, "select user_id from public.v_link_my_notifications",
    );
    expect(filas.every((f) => f.user_id === YO || f.user_id === null)).toBe(true);
  });

  it("un admin NO recibe como propias las notificaciones de la organización", async () => {
    // La RLS se las deja LEER; la vista personal no se las atribuye.
    const visibles = await comoObservador<{ n: string }>(
      ADMIN, "select count(*)::text as n from public.notifications",
    );
    expect(Number(visibles[0].n)).toBe(3);
    const mias = await comoObservador<{ n: string }>(
      ADMIN, "select count(*)::text as n from public.v_link_my_notifications",
    );
    expect(Number(mias[0].n)).toBe(0);
    expect((await badges(ADMIN)).rojo).toBe(0);
  });

  it("verde y amarillo siguen siendo independientes del rojo", async () => {
    const wa = await nuevaConversacion("whatsapp", "wa-0235", [{ uid: YO }]);
    await mensaje(wa);
    const dm = await nuevaConversacion("dm", "dm-0235", [{ uid: YO }]);
    await mensaje(dm, { autor: OTRO }); await mensaje(dm, { autor: OTRO });

    const antes = await badges(YO);
    expect(antes).toEqual({ rojo: 2, verde: 1, amarillo: 2 });

    await ejecutarComo(YO, "select public.connect_notif_mark_all_read()");
    const despues = await badges(YO);
    // Limpiar rojo no tocó las otras dos categorías.
    expect(despues).toEqual({ rojo: 0, verde: 1, amarillo: 2 });
  });
});

describe("T-LINK-A1-02 · realtime y cierre de la escritura directa (C4 3/3)", () => {
  it("0235 publica notification_reads en supabase_realtime", async () => {
    // C4 3/3 · MEDIUM-1: sin esto, marcar leído un broadcast no baja el rojo
    // del shell hasta una recarga dura, porque ya no escribe en `notifications`.
    const { rows } = await db.query(`
      select count(*)::int as n from pg_publication_tables
       where pubname='supabase_realtime' and schemaname='public'
         and tablename='notification_reads'
    `);
    expect(rows[0].n).toBe(1);
  });

  it("`authenticated` NO puede escribir notification_reads por vía directa", async () => {
    const id = await (async () => {
      const { rows } = await db.query("select id from public.notifications limit 1");
      return rows[0].id as string;
    })();
    await expect(
      ejecutarComo(YO, `insert into public.notification_reads (notification_id, profile_id)
                        values ('${id}'::uuid, '${YO}'::uuid)`),
    ).rejects.toThrow(/permission denied|denegado/i);
  });

  it("`authenticated` NO puede marcar leída una notificación por UPDATE directo", async () => {
    // C4 3/3 · MEDIUM-2: 0162 dejaba `grant update (read_at, remind_at)`, que
    // permitía a un admin apagar avisos ajenos y a cualquiera del rol silenciar
    // un broadcast para todos. 0235 lo revoca.
    const { rows } = await db.query("select id from public.notifications limit 1");
    await expect(
      ejecutarComo(YO, `update public.notifications set read_at = now() where id = '${rows[0].id}'::uuid`),
    ).rejects.toThrow(/permission denied|denegado/i);
  });

  it("la policy de UPDATE ya no tiene rama de admin", async () => {
    const { rows } = await db.query(`
      select pg_get_expr(polqual, polrelid) as q from pg_policy
       where polrelid='public.notifications'::regclass and polcmd='w'
         and polname='notifications mark read own'
    `);
    expect(rows[0].q).not.toMatch(/admin/);
    expect(rows[0].q).toMatch(/delegated_to/);
  });

  it("un broadcast ya leído globalmente NO se resucita (sin backfill)", async () => {
    await db.query("truncate public.notification_reads");
    await db.query("truncate public.notifications cascade");
    await db.query(`
      insert into public.notifications (role_target, read_at)
      values ('operador'::public.user_role_t, now())
    `);
    // Nadie tiene marca personal, pero la fila ya estaba apagada: queda leída.
    expect((await badges(YO)).rojo).toBe(0);
    expect((await badges(OTRO)).rojo).toBe(0);
  });

  it("una fila con user_id ajeno Y role_target propio NO se cuenta como mía", async () => {
    await db.query("truncate public.notifications cascade");
    await db.query(
      `insert into public.notifications (user_id, role_target)
       values ($1, 'operador'::public.user_role_t)`, [OTRO],
    );
    // La rama de rol exige `user_id is null`: es un aviso dirigido a OTRO.
    expect((await badges(YO)).rojo).toBe(0);
    expect((await badges(OTRO)).rojo).toBe(1);
  });

  it("el contrato de columnas del contador está fijado", async () => {
    const { rows } = await db.query(`
      select column_name, data_type from information_schema.columns
       where table_schema='public' and table_name='v_link_notification_badges'
       order by ordinal_position
    `);
    expect(rows).toEqual([
      { column_name: "red_system_count", data_type: "bigint" },
      { column_name: "green_whatsapp_count", data_type: "bigint" },
      { column_name: "yellow_internal_count", data_type: "bigint" },
    ]);
  });
});

describe("T-LINK-A1-02 · reversibilidad de 0235", () => {
  it("el ROLLBACK elimina vista, tabla y RPC, y restaura el contador de 0234", async () => {
    await db.query(readFileSync(ROLLBACK_0235, "utf8"));
    const { rows } = await db.query(`
      select
        (select count(*)::int from information_schema.views
          where table_schema='public' and table_name='v_link_my_notifications') as vista,
        (select count(*)::int from information_schema.tables
          where table_schema='public' and table_name='notification_reads') as tabla,
        (select count(*)::int from pg_proc p join pg_namespace n on n.oid=p.pronamespace
          where n.nspname='public' and p.proname like 'connect_notif_mark%') as rpcs,
        (select count(*)::int from information_schema.views
          where table_schema='public' and table_name='v_link_notification_badges') as badges
    `);
    expect(rows[0]).toEqual({ vista: 0, tabla: 0, rpcs: 0, badges: 1 });
  });

  it("ninguna notificación se perdió al revertir", async () => {
    const { rows } = await db.query("select count(*)::int as n from public.notifications");
    expect(rows[0].n).toBeGreaterThan(0);
  });

  it("ida y vuelta: reaplicar 0235 deja el sistema operativo otra vez", async () => {
    await aplicar(MIGRACION_0235);
    await db.query("truncate public.notifications cascade");
    await db.query("insert into public.notifications (role_target) values ('operador'::public.user_role_t)");
    const { rows } = await db.query("select id from public.notifications limit 1");
    await ejecutarComo(YO, `select public.connect_notif_mark_read('${rows[0].id}'::uuid)`);
    expect((await badges(YO)).rojo).toBe(0);
    expect((await badges(OTRO)).rojo).toBe(1);
  });
});

describe("T-LINK-A1-01 · reversibilidad", () => {
  it("el ROLLBACK restaura la definición previa y deja de existir la vista nueva", async () => {
    await aplicar(ROLLBACK);
    const { rows } = await db.query(
      "select count(*)::int as n from information_schema.views where table_schema='public' and table_name='v_link_notification_badges'",
    );
    expect(rows[0].n).toBe(0);

    // v_connect_inbox sigue existiendo, con el contrato de columnas intacto.
    const { rows: cols } = await db.query(
      "select column_name from information_schema.columns where table_schema='public' and table_name='v_connect_inbox' order by column_name",
    );
    const nombres = cols.map((c: { column_name: string }) => c.column_name);
    expect(nombres).toContain("unread_count");
    expect(nombres).toContain("last_read_seq");
    expect(nombres).toContain("muted_until");
  });

  it("0234 es idempotente: aplicarla dos veces seguidas no falla ni cambia el resultado", async () => {
    await aplicar(MIGRACION);
    const primera = await badges(YO);
    await aplicar(MIGRACION);
    expect(await badges(YO)).toEqual(primera);
  });
});
