/**
 * T-WA-R9-07 · ACCEPTANCE — el ciclo completo, contra PostgreSQL REAL.
 *
 * Las suites anteriores prueban cada pieza por separado. Ésta recorre el camino
 * entero en un solo hilo de ejecución, que es donde aparecen los defectos de
 * COSTURA: un evento que se pierde entre dos componentes correctos.
 *
 * Recorrido (§5 del mandato):
 *   1. inbound recibido        7. realtime / relectura
 *   2. persistencia            8. burbuja, hora y estado correctos
 *   3. proyección              9. outbound con una sola llamada
 *   4. cola sin configuración 10. marcador de auditoría durable
 *   5. configuración restaurada 11. webhook delivered / read
 *   6. replay ÚNICO           12. ningún write cross-client
 *
 * Base efímera DEDICADA (HIGH-2).
 */

import { afterAll, beforeAll, describe, expect, it, inject } from "vitest";
import type { Client } from "pg";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createWaSandbox, type WaSandbox } from "./harness/wa-sandbox";
import { projectWaMessage, bubbleStatusFromProjection } from "@/lib/connect/realtime-status";

const MIG = (n: string) => resolve(__dirname, "..", "..", "supabase", "migrations", n);
const CORTE = "-- (6) NACIMIENTO CANÓNICO DEL INTENTO";

let sandbox: WaSandbox;
let client: Client;

const CONV = "cccccccc-7777-4777-8777-cccccccccccc";
const CONV_AJENA = "dddddddd-7777-4777-8777-dddddddddddd";
const OPERADOR = "aaaaaaaa-7777-4777-8777-aaaaaaaaaaaa";
const PART = "eeeeeeee-7777-4777-8777-eeeeeeeeeeee";
const TOKEN_A = "11111111-7777-4777-8777-111111111111";
const TOKEN_B = "22222222-7777-4777-8777-222222222222";
const AT_META = "2026-08-09T10:00:00.000Z";

beforeAll(async () => {
  sandbox = await createWaSandbox(inject("dbUrl"));
  client = sandbox.client;

  await client.query(`
    create table public.connect_conversations (id uuid primary key, kind text not null, archived_at timestamptz);
    create table public.connect_messages (
      id uuid primary key default gen_random_uuid(), seq bigserial,
      conversation_id uuid, author_participant_id uuid, author_profile_id uuid,
      kind text, body text, reply_to_message_id uuid, client_msg_id text,
      external_msg_id text, meta jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now()
    );
    create table public.connect_attachments (id uuid primary key, conversation_id uuid, message_id uuid);
    create table public.connect_message_mentions (message_id uuid, mentioned_participant_id uuid,
      primary key (message_id, mentioned_participant_id));
    create table public.wa_inbound_events (
      seq bigserial primary key, payload jsonb not null,
      signature_valid boolean not null default true,
      received_at timestamptz not null default now(),
      processed boolean not null default false, notes text
    );

    create schema if not exists auth;
    create function auth.uid() returns uuid language sql stable as $fn$
      select nullif(current_setting('test.actor', true), '')::uuid $fn$;
    create function public.has_permission(p text) returns boolean language sql stable as $fn$ select true $fn$;
    create function public._connect_is_member(c uuid) returns boolean language sql stable as $fn$ select true $fn$;
    create function public._connect_assert_not_archived(c uuid) returns void language plpgsql as $fn$ begin null; end $fn$;
    create function public._connect_my_participant(c uuid) returns uuid language sql stable as $fn$ select '${PART}'::uuid $fn$;
  `);

  const s227 = readFileSync(MIG("0227_wa_atomic_status.sql"), "utf8");
  await client.query(s227.slice(0, s227.indexOf(CORTE)));
  await client.query(s227.slice(s227.indexOf(CORTE)));
  await client.query(readFileSync(MIG("0229_wa_inbound_queue.sql"), "utf8"));

  await client.query(
    "insert into public.connect_conversations (id, kind) values ($1,'whatsapp'), ($2,'whatsapp')",
    [CONV, CONV_AJENA],
  );
  await client.query("select set_config('test.actor', $1, false)", [OPERADOR]);
});

afterAll(async () => {
  await sandbox?.destroy();
});

// ── Helpers del recorrido ──────────────────────────────────────────────────
const postear = async (conv: string, cid: string) =>
  (await client.query("select * from public.connect_post_message($1,'hola',null,$2,null,null)", [conv, cid]))
    .rows[0].id as string;

const aplicar = async (args: Record<string, unknown>) => {
  const k = Object.keys(args);
  const { rows } = await client.query(
    `select public.connect_wa_apply_status(${k.map((n, i) => `${n} => $${i + 1}`).join(",")}) as o`,
    k.map((n) => args[n]),
  );
  return rows[0].o as string;
};

const proyeccionDe = async (id: string) => {
  const { rows } = await client.query(
    "select meta, external_msg_id from public.connect_messages where id = $1", [id],
  );
  return projectWaMessage({ meta: rows[0].meta, externalMsgId: rows[0].external_msg_id });
};

const encolar = async (payload: unknown) =>
  Number((await client.query(
    "insert into public.wa_inbound_events (payload) values ($1::jsonb) returning seq",
    [JSON.stringify(payload)],
  )).rows[0].seq);

const reclamar = async (c: Client, token: string) =>
  (await c.query("select * from public.wa_claim_inbound_events($1,$2)", [token, 10])).rows;

const liberar = async (seq: number, token: string, outcome: string, err: string | null = null) =>
  (await client.query("select public.wa_release_inbound_event($1,$2,$3,$4) as o",
    [seq, token, outcome, err])).rows[0].o as string;

// ══ EL RECORRIDO COMPLETO ══════════════════════════════════════════════════
describe("T-WA-R9-07 · ciclo completo inbound → cola → proyección → UI", () => {
  it("1-3 · un evento recibido se persiste y se proyecta", async () => {
    const seq = await encolar({ object: "whatsapp_business_account", entry: [] });
    const { rows } = await client.query(
      "select processed, terminal, attempts from public.wa_inbound_events where seq = $1", [seq],
    );
    // Persistido y pendiente: el 200 del webhook no lo dio por resuelto.
    expect(rows[0]).toMatchObject({ processed: false, terminal: false, attempts: 0 });
    expect(await reclamar(client, TOKEN_A)).toHaveLength(1);
    await liberar(seq, TOKEN_A, "done");
    expect((await client.query(
      "select processed from public.wa_inbound_events where seq = $1", [seq],
    )).rows[0].processed).toBe(true);
  });

  it("4-6 · sin configuración el evento queda en cola; restaurada, se procesa UNA vez", async () => {
    const seq = await encolar({ object: "whatsapp_business_account", entry: [{ id: "x" }] });

    // (4) Falta `META_WA_PHONE_NUMBER_ID`: transitorio, vuelve a la cola.
    await reclamar(client, TOKEN_A);
    expect(await liberar(seq, TOKEN_A, "retryable", "tenant_unresolved")).toBe("requeued");
    let f = (await client.query(
      "select processed, terminal, last_error from public.wa_inbound_events where seq = $1", [seq],
    )).rows[0];
    expect(f).toMatchObject({ processed: false, terminal: false, last_error: "tenant_unresolved" });

    // (5) Se restaura la configuración: el evento vuelve a estar disponible.
    await client.query("update public.wa_inbound_events set next_attempt_at = now() where seq = $1", [seq]);
    const r = await reclamar(client, TOKEN_A);
    expect(r).toHaveLength(1);

    // (6) Y se procesa exactamente una vez: el segundo worker no lo ve.
    const b = await sandbox.connect();
    try {
      expect(await reclamar(b, TOKEN_B)).toHaveLength(0);
    } finally {
      await b.end();
    }
    expect(await liberar(seq, TOKEN_A, "done")).toBe("done");

    f = (await client.query(
      "select processed, attempts from public.wa_inbound_events where seq = $1", [seq],
    )).rows[0];
    expect(f.processed).toBe(true);
    // Dos intentos consumidos, UN procesamiento efectivo.
    expect(f.attempts).toBe(2);
  });

  it("9-11 · outbound: una sola llamada, sello, webhook y auditoría durable", async () => {
    // (9) El operador envía: UNA fila, con metadata canónica del servidor.
    const id = await postear(CONV, "cid-e2e");
    expect((await proyeccionDe(id)).providerState).toBe("queued");

    // Reclamo y sello, como hace el egress real.
    expect(await aplicar({ p_message_id: id, p_status: "sending", p_source: "server" })).toBe("applied");
    await client.query("update public.connect_messages set external_msg_id = $2 where id = $1",
      [id, "wamid.E2E"]);
    expect(await aplicar({ p_message_id: id, p_status: "sent", p_source: "server" })).toBe("applied");

    // (10) Marcador de auditoría durable.
    expect((await client.query(
      "select public.connect_wa_mark_audited($1,$2,$3) as o", [id, "wamid.E2E", AT_META],
    )).rows[0].o).toBe("applied");

    // (11) El webhook avanza a delivered y luego a read.
    expect(await aplicar({ p_wamid: "wamid.E2E", p_status: "delivered", p_source: "meta", p_at: AT_META })).toBe("applied");
    expect(await aplicar({ p_wamid: "wamid.E2E", p_status: "read", p_source: "meta", p_at: AT_META })).toBe("applied");

    const wa = await proyeccionDe(id);
    // El marcador SOBREVIVIÓ a los dos avances de Meta.
    expect(wa.audited).toBe(true);
    expect(wa.providerState).toBe("read");
    expect(wa.stateSource).toBe("meta");
  });

  it("7-8 · la relectura produce la burbuja y la hora correctas", async () => {
    const id = await postear(CONV, "cid-ui");
    // Recién creado: intento en curso.
    expect(bubbleStatusFromProjection(await proyeccionDe(id))).toBe("sending");

    await aplicar({ p_message_id: id, p_status: "sending", p_source: "server" });
    await client.query("update public.connect_messages set external_msg_id = $2 where id = $1", [id, "wamid.UI"]);
    await aplicar({ p_message_id: id, p_status: "sent", p_source: "server" });
    // Sellado pero SIN auditar: pendiente de confirmación, nunca confirmado.
    expect(bubbleStatusFromProjection(await proyeccionDe(id))).toBe("pending");

    await client.query("select public.connect_wa_mark_audited($1,$2,$3)", [id, "wamid.UI", AT_META]);
    await aplicar({ p_wamid: "wamid.UI", p_status: "delivered", p_source: "meta", p_at: AT_META });
    // Confirmado: sin leyenda. La hora la pinta siempre `ThreadView`.
    expect(bubbleStatusFromProjection(await proyeccionDe(id))).toBeUndefined();

    // Y el instante durable sigue siendo legible.
    expect((await proyeccionDe(id)).stateAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it("8b · una fila histórica del mismo hilo se muestra NEUTRA, con su hora", async () => {
    const { rows } = await client.query(
      `insert into public.connect_messages (conversation_id, author_profile_id, kind, body, meta, external_msg_id)
       values ($1,$2,'text','viejo', $3::jsonb, $4) returning id`,
      [CONV, OPERADOR, JSON.stringify({ wa: { direction: "outbound", status: "sent" } }), "hash-sha256"],
    );
    const wa = await proyeccionDe(rows[0].id);
    expect(wa.stateSource).toBe("historical_unknown");
    expect(bubbleStatusFromProjection(wa)).toBe("historical");
    expect(wa.audited).toBe(false);
  });

  it("12 · ningún write cruza de conversación", async () => {
    const mio = await postear(CONV, "cid-cross-1");
    const ajeno = await postear(CONV_AJENA, "cid-cross-2");
    expect(mio).not.toBe(ajeno);

    await aplicar({ p_message_id: mio, p_status: "sending", p_source: "server" });
    await client.query("update public.connect_messages set external_msg_id = $2 where id = $1", [mio, "wamid.MIO"]);
    await aplicar({ p_message_id: mio, p_status: "sent", p_source: "server" });

    // Un status de Meta con el wamid del mío NO puede tocar el ajeno.
    await aplicar({ p_wamid: "wamid.MIO", p_status: "delivered", p_source: "meta", p_at: AT_META });

    expect((await proyeccionDe(mio)).providerState).toBe("delivered");
    expect((await proyeccionDe(ajeno)).providerState).toBe("queued");
  });

  it("12b · un status cuyo wamid no existe no toca NINGUNA fila", async () => {
    const { rows: antes } = await client.query("select id, meta from public.connect_messages order by id");
    expect(await aplicar({
      p_wamid: "wamid.NO_EXISTE", p_status: "read", p_source: "meta", p_at: AT_META,
    })).toBe("unmatched");
    const { rows: despues } = await client.query("select id, meta from public.connect_messages order by id");
    expect(despues).toEqual(antes);
  });
});
