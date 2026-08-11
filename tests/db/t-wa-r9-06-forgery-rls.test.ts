/**
 * T-WA-R9-06 · CLOSEOUT §4.A/§4.B — forja directa y grants, con RLS EFECTIVA.
 *
 * La policy de 0143 protegía quién escribe y dónde, pero no QUÉ: `meta` y
 * `external_msg_id` quedaban libres, así que un operador legítimo podía
 * insertar a mano un mensaje que la UI muestra como entregado y auditado por
 * Meta. Toda la cadena de procedencia se evadía escribiendo el hecho.
 *
 * Estas pruebas corren con `set local role authenticated`, porque el OWNER
 * bypasea RLS y medirla con él haría pasar cualquier policy.
 *
 * Base efímera DEDICADA (HIGH-2): no se toca el cluster compartido.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, inject } from "vitest";
import type { Client } from "pg";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createWaSandbox, type WaSandbox } from "./harness/wa-sandbox";

const MIG = (n: string) => resolve(__dirname, "..", "..", "supabase", "migrations", n);
const CORTE = "-- (6) NACIMIENTO CANÓNICO DEL INTENTO";

let sandbox: WaSandbox;
let client: Client;

const CONV = "cccccccc-6666-4666-8666-cccccccccccc";
const CONV_AJENA = "dddddddd-6666-4666-8666-dddddddddddd";
const YO = "aaaaaaaa-6666-4666-8666-aaaaaaaaaaaa";
const OTRO = "bbbbbbbb-6666-4666-8666-bbbbbbbbbbbb";
const PART = "eeeeeeee-6666-4666-8666-eeeeeeeeeeee";

beforeAll(async () => {
  sandbox = await createWaSandbox(inject("dbUrl"));
  client = sandbox.client;

  await client.query(`
    create table public.connect_conversations (
      id uuid primary key, kind text not null, archived_at timestamptz
    );
    create table public.connect_messages (
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
    create table public.connect_attachments (id uuid primary key, conversation_id uuid, message_id uuid);
    create table public.connect_message_mentions (
      message_id uuid, mentioned_participant_id uuid,
      primary key (message_id, mentioned_participant_id)
    );

    create schema if not exists auth;
    create function auth.uid() returns uuid language sql stable as $fn$
      select nullif(current_setting('test.actor', true), '')::uuid $fn$;
    create function public.has_permission(p text) returns boolean language sql stable as $fn$
      select coalesce(nullif(current_setting('test.permiso', true), '')::boolean, true) $fn$;
    -- Membresía REAL por conversación: habilita el ataque cross-client.
    create function public._connect_is_member(c uuid) returns boolean language sql stable as $fn$
      select c = nullif(current_setting('test.conv_propia', true), '')::uuid $fn$;
    create function public._connect_assert_not_archived(c uuid) returns void language plpgsql as $fn$
      begin null; end $fn$;
    create function public._connect_my_participant(c uuid) returns uuid language sql stable as $fn$
      select '${PART}'::uuid $fn$;

    alter table public.connect_messages enable row level security;
    grant select, insert, update, delete on public.connect_messages to authenticated;
    grant usage on all sequences in schema public to authenticated;

    create policy "connect_messages select" on public.connect_messages
      for select to authenticated
      using (public.has_permission('connect.view') and public._connect_is_member(conversation_id));
  `);

  // Las migraciones REALES: helpers + RPC + nacimiento canónico + lockdown.
  const s227 = readFileSync(MIG("0227_wa_atomic_status.sql"), "utf8");
  await client.query(s227.slice(0, s227.indexOf(CORTE)));
  await client.query(s227.slice(s227.indexOf(CORTE)));
  // La cola con su tabla base (forma de 0171) y la migración 0229 SIN mutilar:
  // recortarla con expresiones regulares partía comentarios al medio.
  await client.query(`
    create table public.wa_inbound_events (
      seq bigserial primary key, payload jsonb not null,
      signature_valid boolean not null default true,
      received_at timestamptz not null default now(),
      processed boolean not null default false, notes text
    );
  `);
  await client.query(readFileSync(MIG("0229_wa_inbound_queue.sql"), "utf8"));
  await client.query(readFileSync(MIG("0230_wa_forgery_lockdown.sql"), "utf8"));

  await client.query(
    `insert into public.connect_conversations (id, kind) values ($1,'whatsapp'), ($2,'whatsapp')`,
    [CONV, CONV_AJENA],
  );
});

afterAll(async () => {
  await sandbox?.destroy();
});

beforeEach(async () => {
  await client.query("delete from public.connect_messages");
});

/** Ejecuta el cuerpo como `authenticated`, con RLS activa, y revierte. */
async function comoAuthenticated<T>(fn: () => Promise<T>): Promise<T> {
  await client.query("begin");
  try {
    await client.query("select set_config('test.actor', $1, true)", [YO]);
    await client.query("select set_config('test.permiso', 'true', true)");
    await client.query("select set_config('test.conv_propia', $1, true)", [CONV]);
    await client.query("set local row_security = on");
    await client.query("set local role authenticated");
    return await fn();
  } finally {
    await client.query("rollback");
  }
}

const insertarDirecto = (extra: Record<string, unknown>) => {
  const cols = ["conversation_id", "author_profile_id", "kind", "body", ...Object.keys(extra)];
  const vals = [CONV, YO, "text", "hola", ...Object.values(extra)];
  const ph = vals.map((_, i) => `$${i + 1}`).join(",");
  return client.query(
    `insert into public.connect_messages (${cols.join(",")}) values (${ph})`,
    vals as never[],
  );
};

// ══ 1 · FORJA DE EVIDENCIA ═════════════════════════════════════════════════
describe("T-WA-R9-06 · §4.A · un authenticated no puede fabricar evidencia", () => {
  it("el OWNER bypasea RLS — por eso no sirve como evidencia", async () => {
    await insertarDirecto({ meta: JSON.stringify({ wa: { status: "read" } }) });
    const { rows } = await client.query("select count(*)::int as n from public.connect_messages");
    expect(rows[0].n).toBe(1);
    await client.query("delete from public.connect_messages");
  });

  it.each([
    ["status entregado", { wa: { direction: "outbound", status: "delivered", status_source: "meta" } }],
    ["status leído", { wa: { direction: "outbound", status: "read", status_source: "meta" } }],
    ["procedencia meta", { wa: { status_source: "meta" } }],
    ["marcador de auditoría", { wa: { audit_sent: { wamid: "wamid.X", at: "2026-01-01T00:00:00.000Z" } } }],
    ["rama wa vacía", { wa: {} }],
  ])("INSERT directo con %s ⇒ RECHAZADO por la policy", async (_l, meta) => {
    await comoAuthenticated(async () => {
      await expect(insertarDirecto({ meta: JSON.stringify(meta) })).rejects.toThrow(
        /row-level security|violates/i,
      );
    });
  });

  it("INSERT directo con `external_msg_id` inventado ⇒ RECHAZADO", async () => {
    await comoAuthenticated(async () => {
      await expect(insertarDirecto({ external_msg_id: "wamid.INVENTADO" })).rejects.toThrow(
        /row-level security|violates/i,
      );
    });
  });

  it("un mensaje SIN evidencia sí se puede insertar: no se rompió el camino legítimo", async () => {
    await comoAuthenticated(async () => {
      await expect(insertarDirecto({})).resolves.toBeTruthy();
    });
  });

  it("`meta` con claves de OTROS módulos sigue permitida", async () => {
    await comoAuthenticated(async () => {
      await expect(
        insertarDirecto({ meta: JSON.stringify({ media: { id: 1 }, tags: ["x"] }) }),
      ).resolves.toBeTruthy();
    });
  });

  it("UPDATE directo sigue prohibido: no se puede promover una fila propia", async () => {
    const { rows } = await client.query(
      `insert into public.connect_messages (conversation_id, author_profile_id, kind, body)
       values ($1,$2,'text','hola') returning id`, [CONV, YO],
    );
    await comoAuthenticated(async () => {
      const r = await client.query(
        `update public.connect_messages set meta = $2::jsonb where id = $1`,
        [rows[0].id, JSON.stringify({ wa: { status: "read", status_source: "meta" } })],
      );
      // La policy `using (false)` deja el UPDATE sin filas: no lanza, no escribe.
      expect(r.rowCount).toBe(0);
    });
    const { rows: after } = await client.query(
      "select meta from public.connect_messages where id = $1", [rows[0].id],
    );
    expect(after[0].meta).toEqual({});
  });
});

// ══ 2 · CROSS-CLIENT ═══════════════════════════════════════════════════════
describe("T-WA-R9-06 · §4.A · aislamiento entre conversaciones", () => {
  it("no se puede insertar en una conversación ajena, ni siquiera sin evidencia", async () => {
    await comoAuthenticated(async () => {
      await expect(
        client.query(
          `insert into public.connect_messages (conversation_id, author_profile_id, kind, body)
           values ($1,$2,'text','hola')`, [CONV_AJENA, YO],
        ),
      ).rejects.toThrow(/row-level security|violates/i);
    });
  });

  it("no se puede insertar declarando OTRO autor", async () => {
    await comoAuthenticated(async () => {
      await expect(
        client.query(
          `insert into public.connect_messages (conversation_id, author_profile_id, kind, body)
           values ($1,$2,'text','hola')`, [CONV, OTRO],
        ),
      ).rejects.toThrow(/row-level security|violates/i);
    });
  });

  it("no se leen mensajes de una conversación ajena", async () => {
    await client.query(
      `insert into public.connect_messages (conversation_id, author_profile_id, kind, body)
       values ($1,$2,'text','ajeno')`, [CONV_AJENA, OTRO],
    );
    await comoAuthenticated(async () => {
      const { rows } = await client.query("select count(*)::int as n from public.connect_messages");
      expect(rows[0].n).toBe(0);
    });
  });
});

// ══ 3 · EL CAMINO LEGÍTIMO SIGUE ABIERTO ═══════════════════════════════════
describe("T-WA-R9-06 · la RPC SÍ escribe evidencia: el lockdown no la alcanza", () => {
  it("`connect_post_message` crea la fila CON metadata canónica", async () => {
    await client.query("select set_config('test.actor', $1, false)", [YO]);
    await client.query("select set_config('test.conv_propia', $1, false)", [CONV]);
    const { rows } = await client.query(
      "select * from public.connect_post_message($1,'hola',null,'cid-1',null,null)", [CONV],
    );
    const { rows: f } = await client.query(
      "select meta from public.connect_messages where id = $1", [rows[0].id],
    );
    // Justo lo que el INSERT directo tiene prohibido declarar.
    expect(f[0].meta.wa).toMatchObject({
      direction: "outbound", status: "queued", status_source: "server",
    });
  });

  it("`connect_wa_apply_status` avanza el estado pese al lockdown", async () => {
    await client.query("select set_config('test.actor', $1, false)", [YO]);
    await client.query("select set_config('test.conv_propia', $1, false)", [CONV]);
    const { rows } = await client.query(
      "select * from public.connect_post_message($1,'hola',null,'cid-2',null,null)", [CONV],
    );
    const { rows: o } = await client.query(
      "select public.connect_wa_apply_status(p_message_id => $1, p_status => 'sending'," +
        " p_source => 'server') as o", [rows[0].id],
    );
    expect(o[0].o).toBe("applied");
  });
});

// ══ 4 · GRANTS EXPLÍCITOS  (§4.B) ══════════════════════════════════════════
describe("T-WA-R9-06 · §4.B · cada RPC declara a quién sirve", () => {
  const privilegio = async (fn: string, role: string) => {
    const { rows } = await client.query(
      "select has_function_privilege($1, $2, 'EXECUTE') as ok", [role, fn],
    );
    return rows[0].ok as boolean;
  };

  const INTERNAS = [
    "public.connect_wa_apply_status(uuid, text, text, text, text, text, text, text, text, text, text, boolean)",
    "public.connect_wa_mark_audited(uuid, text, text)",
    "public.wa_claim_inbound_events(uuid, integer, integer, interval)",
    "public.wa_release_inbound_event(bigint, uuid, text, text)",
    "public.wa_replay_inbound_event(bigint)",
    "public.wa_inbound_queue_health()",
  ];

  it.each(INTERNAS)("%s: sólo service_role", async (fn) => {
    expect(await privilegio(fn, "service_role")).toBe(true);
    expect(await privilegio(fn, "authenticated")).toBe(false);
    expect(await privilegio(fn, "anon")).toBe(false);
  });

  it("`connect_post_message` es el camino del operador: authenticated SÍ", async () => {
    const fn = "public.connect_post_message(uuid, text, uuid, text, uuid[], uuid[])";
    expect(await privilegio(fn, "authenticated")).toBe(true);
    expect(await privilegio(fn, "service_role")).toBe(true);
    expect(await privilegio(fn, "anon")).toBe(false);
  });

  it("ninguna RPC interna queda accesible por PUBLIC", async () => {
    for (const fn of INTERNAS) {
      const { rows } = await client.query(
        "select coalesce(bool_or(a.privilege_type = 'EXECUTE'), false) as ok" +
          " from pg_proc p, aclexplode(p.proacl) a" +
          " where p.oid = to_regprocedure($1) and a.grantee = 0", [fn],
      );
      expect(rows[0].ok, fn).toBe(false);
    }
  });
});
