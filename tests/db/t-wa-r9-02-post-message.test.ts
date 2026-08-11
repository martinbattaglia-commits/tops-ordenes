/**
 * T-WA-R9-02 · H-2 — `connect_post_message` contra PostgreSQL REAL.
 *
 * El defecto: la RPC insertaba SIN `meta`, así que una fila saliente de
 * WhatsApp nacía sin dirección ni procedencia. Consecuencia directa: los fallos
 * anteriores al transporte (`sandbox_denied`, `audit_unavailable`) no se podían
 * persistir —no había hecho previo del servidor que respetar— y se perdían al
 * recargar. La corrección vive en la sección (6) de 0227.
 *
 * ─── CIERRE MÍNIMO Y FIEL ──────────────────────────────────────────────────
 *
 * El manifiesto A0 es el cierre de dependencias WMS y no carga la cadena
 * Connect (0142+). Arrastrarla entera metería decenas de migraciones ajenas al
 * objeto de prueba y tocaría el harness de WMS.
 *
 * Se monta entonces un cierre propio con la forma EXACTA que la RPC toca, y las
 * guardas (`has_permission`, `_connect_is_member`, `_connect_assert_not_archived`,
 * `auth.uid`) como funciones controlables desde el test. Eso permite además
 * probar el camino DENEGADO, que con las funciones reales exigiría todo el RBAC.
 *
 * La RPC bajo prueba es la REAL, leída del archivo 0227 en disco.
 *
 * LÍMITE DECLARADO: no se prueban RLS ni los triggers de notificación, que
 * pertenecen a la cadena Connect completa.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, inject } from "vitest";
import type { Client } from "pg";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createWaSandbox, type WaSandbox } from "./harness/wa-sandbox";

const MIGRACION = resolve(
  __dirname, "..", "..", "supabase", "migrations", "0227_wa_atomic_status.sql",
);
const CORTE = "-- (6) NACIMIENTO CANÓNICO DEL INTENTO";

let client: Client;

let sandbox: WaSandbox;

const ACTOR = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const OTRO_ACTOR = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb";
const CONV_WA = "cccccccc-3333-4333-8333-cccccccccccc";
const CONV_DM = "dddddddd-4444-4444-8444-dddddddddddd";
const PART = "eeeeeeee-5555-4555-8555-eeeeeeeeeeee";

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

beforeAll(async () => {
  // HIGH-2 · base efímera DEDICADA. Antes este archivo SUSTITUÍA `auth.uid()` y
  // `has_permission()` en el cluster compartido y las restauraba en el teardown
  // —una restauración parcial que dependía de que el teardown corriera, corriera
  // entero y en el orden correcto—. Con base propia esas guardas se crean acá y
  // no existen en ningún otro lado: no hay nada que restaurar.
  sandbox = await createWaSandbox(inject("dbUrl"));
  client = sandbox.client;

  await client.query(`
    -- ── Esquema mínimo: sólo lo que la RPC toca ──────────────────────────
    create table if not exists public.connect_conversations (
      id uuid primary key, kind text not null, archived_at timestamptz
    );
    create table if not exists public.connect_participants (
      id uuid primary key, conversation_id uuid, profile_id uuid
    );
    create table if not exists public.connect_messages (
      id uuid primary key default gen_random_uuid(),
      seq bigserial,
      conversation_id uuid,
      author_participant_id uuid,
      author_profile_id uuid,
      kind text,
      body text,
      reply_to_message_id uuid,
      client_msg_id text,
      external_msg_id text,
      meta jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now()
    );
    create table if not exists public.connect_attachments (
      id uuid primary key, conversation_id uuid, message_id uuid
    );
    create table if not exists public.connect_message_mentions (
      message_id uuid, mentioned_participant_id uuid,
      primary key (message_id, mentioned_participant_id)
    );

  `);

  // ── Guardas controlables por GUC. Permiten ejercitar los caminos DENEGADOS
  //    sin montar el RBAC completo, que es cadena ajena al objeto de prueba.
  await client.query(`
    create schema if not exists auth;

    create function auth.uid() returns uuid language sql stable as $fn$
      select nullif(current_setting('test.actor', true), '')::uuid $fn$;

    create function public.has_permission(p text) returns boolean language sql stable as $fn$
      select coalesce(nullif(current_setting('test.permiso', true), '')::boolean, true) $fn$;

    create function public._connect_is_member(c uuid) returns boolean language sql stable as $fn$
      select coalesce(nullif(current_setting('test.miembro', true), '')::boolean, true) $fn$;

    create function public._connect_assert_not_archived(c uuid) returns void language plpgsql as $fn$
      begin
        if exists (select 1 from public.connect_conversations
                    where id = c and archived_at is not null) then
          raise exception 'conversación archivada' using errcode = 'check_violation';
        end if;
      end $fn$;

    create function public._connect_my_participant(c uuid) returns uuid language sql stable as $fn$
      select '${PART}'::uuid $fn$;
  `);

  // Las funciones REALES: helpers de 0227 + la RPC corregida.
  const sql = readFileSync(MIGRACION, "utf8");
  const idx = sql.indexOf(CORTE);
  if (idx < 0) throw new Error("marca de corte ausente en 0227");
  // Helpers (hasta el corte) y luego la sección (6).
  await client.query(sql.slice(0, idx));
  await client.query(sql.slice(idx));

  await client.query(
    `insert into public.connect_conversations (id, kind) values ($1,'whatsapp'), ($2,'dm')
       on conflict (id) do nothing`,
    [CONV_WA, CONV_DM],
  );
  await client.query(
    `insert into public.connect_participants (id, conversation_id, profile_id)
     values ($1,$2,$3) on conflict (id) do nothing`,
    [PART, CONV_WA, ACTOR],
  );
});

afterAll(async () => {
  // Se destruye la base entera. Cero `drop ... cascade`, cero restauración
  // parcial, cero dependencia del orden de los archivos.
  await sandbox?.destroy();
});

beforeEach(async () => {
  await client.query("delete from public.connect_messages");
  await client.query("select set_config('test.actor',$1,false)", [ACTOR]);
  await client.query("select set_config('test.permiso','true',false)");
  await client.query("select set_config('test.miembro','true',false)");
  await client.query("update public.connect_conversations set archived_at = null");
});

/** Llama la RPC real. */
async function postear(conv: string, body: string, clientMsgId: string | null) {
  const { rows } = await client.query(
    "select * from public.connect_post_message($1,$2,null,$3,null,null)",
    [conv, body, clientMsgId],
  );
  return rows[0] as { id: string; seq: string };
}

async function fila(id: string) {
  const { rows } = await client.query(
    "select author_profile_id, author_participant_id, kind, body, meta, created_at, client_msg_id" +
      " from public.connect_messages where id = $1",
    [id],
  );
  return rows[0];
}

// ══ 1 · METADATA CANÓNICA DEL INTENTO SALIENTE ═════════════════════════════
describe("T-WA-R9-02 · H-2 · una fila de WhatsApp nace con metadata outbound", () => {
  it("dirección, estado, procedencia e instante los pone el SERVIDOR", async () => {
    const { id } = await postear(CONV_WA, "hola", "cid-1");
    const wa = (await fila(id)).meta.wa;

    expect(wa.direction).toBe("outbound");
    expect(wa.status).toBe("queued");
    expect(wa.status_source).toBe("server");
    // Instante canónico ISO-UTC con milisegundos, como exige `isCanonicalIsoUtc`.
    expect(wa.status_at).toMatch(ISO);
  });

  it("el estado inicial es CLAIMABLE: `claimSending` puede reclamarlo", async () => {
    const { id } = await postear(CONV_WA, "hola", "cid-2");
    // El canon admite queued → sending; ése es el arranque del egress.
    const { rows } = await client.query(
      "select public._wa_can_transition($1,'sending') as ok",
      [(await fila(id)).meta.wa.status],
    );
    expect(rows[0].ok).toBe(true);
  });

  it("H-2 · la fila recién creada YA admite persistir un fallo pre-egress", async () => {
    // Éste es el defecto exacto: antes no había `meta.wa`, así que
    // `sandbox_denied` no se podía persistir y se perdía al recargar.
    const { id } = await postear(CONV_WA, "hola", "cid-3");
    const { rows } = await client.query(
      "select public.connect_wa_apply_status(p_message_id => $1, p_status => 'failed'," +
        " p_source => 'server', p_error => 'sandbox_denied') as o",
      [id],
    );
    expect(rows[0].o).toBe("applied");

    const wa = (await fila(id)).meta.wa;
    expect(wa.status).toBe("failed");
    expect(wa.error).toBe("sandbox_denied");
    expect(wa.status_source).toBe("server");
  });

  it.each(["sandbox_denied", "audit_unavailable"])(
    "el motivo `%s` queda durable y sobrevive a una relectura",
    async (motivo) => {
      const { id } = await postear(CONV_WA, "hola", `cid-${motivo}`);
      await client.query(
        "select public.connect_wa_apply_status(p_message_id => $1, p_status => 'failed'," +
          " p_source => 'server', p_error => $2)",
        [id, motivo],
      );
      // Relectura independiente: es lo que hace la hidratación al recargar.
      const { rows } = await client.query(
        "select meta->'wa'->>'error' as e, meta->'wa'->>'status' as s" +
          " from public.connect_messages where id = $1",
        [id],
      );
      expect(rows[0]).toEqual({ e: motivo, s: "failed" });
    },
  );
});

// ══ 2 · NINGÚN OTRO KIND DE CONNECT SE VE AFECTADO ═════════════════════════
describe("T-WA-R9-02 · regresión Connect no-WhatsApp", () => {
  it("una conversación `dm` NO recibe metadata de WhatsApp", async () => {
    const { id } = await postear(CONV_DM, "nota interna", "cid-dm");
    const r = await fila(id);
    expect(r.meta).toEqual({});
    expect(r.meta.wa).toBeUndefined();
  });

  it("el resto de la fila es idéntico entre kinds", async () => {
    const wa = await fila((await postear(CONV_WA, "x", "cid-a")).id);
    const dm = await fila((await postear(CONV_DM, "x", "cid-b")).id);
    expect(dm.kind).toBe(wa.kind);
    expect(dm.body).toBe(wa.body);
    expect(dm.author_profile_id).toBe(wa.author_profile_id);
  });
});

// ══ 3 · EL LLAMADOR NO DECLARA NADA AUTORITATIVO ═══════════════════════════
describe("T-WA-R9-02 · actor, dirección, fuente e instante son server-side", () => {
  it("el autor sale de auth.uid(), no de un parámetro", async () => {
    const { id } = await postear(CONV_WA, "hola", "cid-actor");
    expect((await fila(id)).author_profile_id).toBe(ACTOR);

    // Cambia el actor de sesión: la fila siguiente lo refleja sola.
    await client.query("select set_config('test.actor',$1,false)", [OTRO_ACTOR]);
    const { id: id2 } = await postear(CONV_WA, "hola", "cid-actor-2");
    expect((await fila(id2)).author_profile_id).toBe(OTRO_ACTOR);
  });

  it("la firma NO expone dirección, fuente, actor ni timestamp", async () => {
    const { rows } = await client.query(`
      select p.parameter_name
        from information_schema.parameters p
        join information_schema.routines r
          on r.specific_name = p.specific_name
       where r.routine_name = 'connect_post_message'
         -- Sólo los parámetros de ENTRADA: 'id' y 'seq' son OUT de la returns table.
         and p.parameter_mode = 'IN'
       order by p.ordinal_position`);
    const nombres = rows.map((r) => r.parameter_name).filter(Boolean);
    // Igualdad EXACTA del conjunto: cualquier parámetro nuevo —incluido uno que
    // dejara al llamador declarar dirección, fuente, actor o instante— rompe
    // esta prueba. Una comprobación por subcadena sería inútil acá ("at" está
    // dentro de casi cualquier identificador).
    expect(nombres.sort()).toEqual([
      "p_attachment_ids", "p_body", "p_client_msg_id",
      "p_conversation_id", "p_mentions", "p_reply_to",
    ]);
  });

  it("el instante lo pone la base, no el cliente: dos filas difieren", async () => {
    const a = (await fila((await postear(CONV_WA, "1", "cid-t1")).id)).meta.wa.status_at;
    await client.query("select pg_sleep(0.01)");
    const b = (await fila((await postear(CONV_WA, "2", "cid-t2")).id)).meta.wa.status_at;
    expect(a).toMatch(ISO);
    expect(b).toMatch(ISO);
    expect(b >= a).toBe(true);
  });
});

// ══ 4 · BINDING E IDEMPOTENCIA POR clientMsgId ═════════════════════════════
describe("T-WA-R9-02 · binding conversación / actor / clientMsgId", () => {
  it("reintento con el MISMO contenido devuelve la MISMA fila", async () => {
    const a = await postear(CONV_WA, "hola", "cid-rep");
    const b = await postear(CONV_WA, "hola", "cid-rep");
    expect(b.id).toBe(a.id);
    const { rows } = await client.query("select count(*)::int as n from public.connect_messages");
    expect(rows[0].n).toBe(1);
  });

  it("mismo clientMsgId con contenido DISTINTO no crea una segunda fila", async () => {
    // El binding es por (conversación, autor, clientMsgId): el reintento no
    // puede convertirse en un mensaje nuevo con otro texto.
    const a = await postear(CONV_WA, "hola", "cid-dup");
    const b = await postear(CONV_WA, "OTRO TEXTO", "cid-dup");
    expect(b.id).toBe(a.id);
    // Y el cuerpo original NO se pisa.
    expect((await fila(a.id)).body).toBe("hola");
    const { rows } = await client.query("select count(*)::int as n from public.connect_messages");
    expect(rows[0].n).toBe(1);
  });

  it("otro actor con el mismo clientMsgId SÍ crea su propia fila", async () => {
    const a = await postear(CONV_WA, "hola", "cid-cross");
    await client.query("select set_config('test.actor',$1,false)", [OTRO_ACTOR]);
    const b = await postear(CONV_WA, "hola", "cid-cross");
    expect(b.id).not.toBe(a.id);
  });

  it("otra conversación con el mismo clientMsgId también es fila propia", async () => {
    const a = await postear(CONV_WA, "hola", "cid-conv");
    const b = await postear(CONV_DM, "hola", "cid-conv");
    expect(b.id).not.toBe(a.id);
  });

  it("el reintento idempotente NO reinicia el estado ya avanzado", async () => {
    const a = await postear(CONV_WA, "hola", "cid-adv");
    await client.query(
      "select public.connect_wa_apply_status(p_message_id => $1, p_status => 'sending'," +
        " p_source => 'server')",
      [a.id],
    );
    // Un reintento del cliente no puede devolver la fila a `queued`.
    const b = await postear(CONV_WA, "hola", "cid-adv");
    expect(b.id).toBe(a.id);
    expect((await fila(a.id)).meta.wa.status).toBe("sending");
  });

  it("sin clientMsgId cada llamada es un mensaje nuevo", async () => {
    const a = await postear(CONV_WA, "hola", null);
    const b = await postear(CONV_WA, "hola", null);
    expect(b.id).not.toBe(a.id);
  });
});

// ══ 5 · CAMINOS DENEGADOS ══════════════════════════════════════════════════
describe("T-WA-R9-02 · RBAC, membresía y archivado son fail-closed", () => {
  it("sin permiso connect.create no se crea NADA", async () => {
    await client.query("select set_config('test.permiso','false',false)");
    await expect(postear(CONV_WA, "hola", "cid-rbac")).rejects.toThrow(/permiso/i);
    const { rows } = await client.query("select count(*)::int as n from public.connect_messages");
    expect(rows[0].n).toBe(0);
  });

  it("no miembro de la conversación tampoco crea fila", async () => {
    await client.query("select set_config('test.miembro','false',false)");
    await expect(postear(CONV_WA, "hola", "cid-mem")).rejects.toThrow(/miembro/i);
    const { rows } = await client.query("select count(*)::int as n from public.connect_messages");
    expect(rows[0].n).toBe(0);
  });

  it("conversación archivada: cero filas y cero metadata huérfana", async () => {
    await client.query("update public.connect_conversations set archived_at = now() where id = $1", [CONV_WA]);
    await expect(postear(CONV_WA, "hola", "cid-arch")).rejects.toThrow(/archivada/i);
    const { rows } = await client.query("select count(*)::int as n from public.connect_messages");
    expect(rows[0].n).toBe(0);
  });
});
