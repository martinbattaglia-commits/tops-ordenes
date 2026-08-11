/**
 * T-WA-R9-03 · H-3 — backfill de procedencia contra PostgreSQL REAL.
 *
 * Lo que se prueba no es "que escriba", sino que **NO invente evidencia**:
 * cuáles filas toca, cuáles deja explícitamente ambiguas, que repetirlo no
 * cambie nada y que la reversión deshaga exactamente lo suyo.
 *
 * Cierre propio y acotado, igual que T-WA-R9-02: el manifiesto A0 es el cierre
 * WMS y no carga la cadena Connect. Las funciones bajo prueba son las REALES,
 * leídas de 0228 en disco.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, inject } from "vitest";
import type { Client } from "pg";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createWaSandbox, type WaSandbox } from "./harness/wa-sandbox";

const MIG_0227 = resolve(__dirname, "..", "..", "supabase", "migrations", "0227_wa_atomic_status.sql");
const MIG_0228 = resolve(__dirname, "..", "..", "supabase", "migrations", "0228_wa_provenance_backfill.sql");
const CORTE = "-- (6) NACIMIENTO CANÓNICO DEL INTENTO";

let sandbox: WaSandbox;
let client: Client;

const CONV = "cccccccc-9999-4999-8999-cccccccccccc";
const CONV_DM = "dddddddd-9999-4999-8999-dddddddddddd";
const PERFIL = "aaaaaaaa-9999-4999-8999-aaaaaaaaaaaa";
const PARTICIPANTE = "eeeeeeee-9999-4999-8999-eeeeeeeeeeee";

beforeAll(async () => {
  // HIGH-2 · base efímera DEDICADA (ver harness/wa-sandbox.ts).
  sandbox = await createWaSandbox(inject("dbUrl"));
  client = sandbox.client;
  await client.query(`
    create table if not exists public.connect_conversations (
      id uuid primary key, kind text not null, archived_at timestamptz
    );
    create table if not exists public.connect_messages (
      id uuid primary key default gen_random_uuid(),
      conversation_id uuid,
      author_participant_id uuid,
      author_profile_id uuid,
      external_msg_id text,
      created_at timestamptz not null default now(),
      meta jsonb not null default '{}'::jsonb
    );
  `);
  // Helpers de 0227 (aportan `_wa_server_now_iso`) y las funciones de 0228.
  const s227 = readFileSync(MIG_0227, "utf8");
  await client.query(s227.slice(0, s227.indexOf(CORTE)));
  await client.query(readFileSync(MIG_0228, "utf8"));

  await client.query(
    `insert into public.connect_conversations (id, kind)
     values ($1,'whatsapp'), ($2,'dm') on conflict (id) do nothing`,
    [CONV, CONV_DM],
  );
});

afterAll(async () => {
  // Se destruye la base entera: cero `drop ... cascade` sobre objetos ajenos.
  await sandbox?.destroy();
});

beforeEach(async () => {
  await client.query("delete from public.connect_messages");
});

/** Inserta una fila con la forma exacta de una población histórica. */
async function sembrar(opts: {
  id: string;
  wa?: Record<string, unknown> | null;
  perfil?: boolean;
  wamid?: string | null;
  conv?: string;
}) {
  await client.query(
    `insert into public.connect_messages
       (id, conversation_id, author_profile_id, author_participant_id, external_msg_id, meta)
     values ($1,$2,$3,$4,$5,$6::jsonb)`,
    [
      opts.id,
      opts.conv ?? CONV,
      opts.perfil === false ? null : PERFIL,
      opts.perfil === false ? PARTICIPANTE : null,
      opts.wamid ?? null,
      JSON.stringify(opts.wa === null ? {} : { wa: opts.wa }),
    ],
  );
}

const wa = async (id: string) => {
  const { rows } = await client.query("select meta->'wa' as wa from public.connect_messages where id=$1", [id]);
  return rows[0]?.wa ?? {};
};
const inventario = async () => {
  const { rows } = await client.query("select * from public.wa_backfill_provenance_inventory()");
  return Object.fromEntries(rows.map((r) => [r.clase, Number(r.filas)]));
};
const correr = async (dryRun: boolean) => {
  const { rows } = await client.query("select * from public.wa_backfill_provenance($1)", [dryRun]);
  return Object.fromEntries(rows.map((r) => [r.accion, Number(r.filas)]));
};
const revertir = async (dryRun = false) => {
  const { rows } = await client.query(
    'select * from public.wa_backfill_provenance_rollback($1)', [dryRun]);
  return Object.fromEntries(rows.map((r) => [r.accion, Number(r.filas)])).revertidas;
};

const ID = (n: number) => `11111111-0000-4000-8000-${String(n).padStart(12, "0")}`;

// ══ 1 · CLASIFICACIÓN — quién es derivable y quién no ══════════════════════
describe("T-WA-R9-03 · el inventario separa poblaciones sin tocar nada", () => {
  beforeEach(async () => {
    await sembrar({ id: ID(1), wa: { direction: "outbound", status: "sending" } });          // derivable
    await sembrar({ id: ID(2), wa: { direction: "outbound", status: "queued" } });           // derivable
    await sembrar({ id: ID(3), wa: { status: "reconciliation_required" } });                 // derivable
    await sembrar({ id: ID(4), wa: { direction: "outbound", status: "sent" }, wamid: "w1" }); // ambigua por estado
    await sembrar({ id: ID(5), wa: { direction: "outbound", status: "delivered" } });        // ambigua por estado
    await sembrar({ id: ID(6), wa: { direction: "inbound" }, perfil: false });               // intocable
    await sembrar({ id: ID(7), wa: null });                                                  // sin estado
    await sembrar({ id: ID(8), wa: { direction: "outbound", status: "sent", status_source: "meta" } }); // ya acreditada
    await sembrar({ id: ID(9), wa: { status: "sending" }, perfil: false });                  // sin autor
  });

  it("cuenta cada clase y no muta ninguna fila", async () => {
    const antes = await client.query("select id, meta from public.connect_messages order by id");
    const inv = await inventario();

    expect(inv).toEqual({
      derivable_server: 3,
      ambigua_por_estado: 2,
      inbound_intocable: 1,
      sin_estado: 1,
      ya_acreditada: 1,
      ambigua_sin_autor: 1,
    });

    const despues = await client.query("select id, meta from public.connect_messages order by id");
    expect(despues.rows).toEqual(antes.rows);
  });

  it("el dry-run informa el MISMO universo que después escribe", async () => {
    const seco = await correr(true);
    expect(seco).toEqual({ dry_run_candidatas: 3, escritas: 0 });

    // Y no escribió nada.
    expect((await wa(ID(1))).status_source).toBeUndefined();

    const real = await correr(false);
    expect(real.dry_run_candidatas).toBe(3);
    expect(real.escritas).toBe(3);
  });

  it("una conversación no-WhatsApp queda fuera del universo", async () => {
    await sembrar({ id: ID(20), wa: { direction: "outbound", status: "sending" }, conv: CONV_DM });
    expect((await correr(true)).dry_run_candidatas).toBe(3); // sigue siendo 3
    await correr(false);
    expect((await wa(ID(20))).status_source).toBeUndefined();
  });
});

// ══ 2 · LA REGLA DE DERIVACIÓN NO INVENTA EVIDENCIA ════════════════════════
describe("T-WA-R9-03 · sólo se acredita lo determinista", () => {
  it.each(["queued", "sending", "reconciliation_required"])(
    "`%s` sólo lo escribe el servidor ⇒ se acredita `server`",
    async (status) => {
      await sembrar({ id: ID(1), wa: { direction: "outbound", status } });
      await correr(false);
      const w = await wa(ID(1));
      expect(w.status_source).toBe("server");
      expect(w.direction).toBe("outbound");
      expect(w.status).toBe(status);
    },
  );

  it.each(["sent", "delivered", "read", "failed"])(
    "`%s` es ambiguo entre dominios ⇒ NO se deriva procedencia",
    async (status) => {
      await sembrar({ id: ID(1), wa: { direction: "outbound", status }, wamid: "wamid.X" });
      await correr(false);
      const w = await wa(ID(1));
      // Sigue sin procedencia: la UI la mostrará neutra, que es lo honesto.
      expect(w.status_source).toBeUndefined();
      expect(w).not.toHaveProperty("provenance_backfill");
    },
  );

  it("H-3 · un sello NO acredita dirección: el importador usa otro espacio de ids", async () => {
    // Fila del import histórico: sin `meta`, con sha256 en `external_msg_id`.
    await sembrar({
      id: ID(2), wa: null,
      wamid: "3f2a9c1b4e5d6f708192a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f8",
    });
    await correr(false);
    const w = await wa(ID(2));
    expect(w.direction).toBeUndefined();
    expect(w.status_source).toBeUndefined();
  });

  it("H-3 · una fila INBOUND jamás se convierte en outbound", async () => {
    await sembrar({ id: ID(3), wa: { direction: "inbound", status: "sending" }, perfil: false });
    await correr(false);
    const w = await wa(ID(3));
    expect(w.direction).toBe("inbound");
    expect(w.status_source).toBeUndefined();
  });

  it("una fila con procedencia YA acreditada no se pisa", async () => {
    await sembrar({ id: ID(4), wa: { direction: "outbound", status: "sending", status_source: "meta" } });
    await correr(false);
    expect((await wa(ID(4))).status_source).toBe("meta");
  });

  it("sin autor de perfil no se puede acreditar dirección ⇒ se deja ambigua", async () => {
    await sembrar({ id: ID(5), wa: { status: "sending" }, perfil: false });
    await correr(false);
    const w = await wa(ID(5));
    expect(w.status_source).toBeUndefined();
    expect(w.direction).toBeUndefined();
  });
});

// ══ 3 · IDEMPOTENCIA ═══════════════════════════════════════════════════════
describe("T-WA-R9-03 · repetir el backfill no cambia nada", () => {
  it("la segunda corrida escribe CERO filas", async () => {
    await sembrar({ id: ID(1), wa: { direction: "outbound", status: "sending" } });
    expect((await correr(false)).escritas).toBe(1);

    const despuesDeLaPrimera = await wa(ID(1));
    const segunda = await correr(false);
    expect(segunda.escritas).toBe(0);
    expect(segunda.dry_run_candidatas).toBe(0);
    // Y el contenido es idéntico: ni siquiera se re-sella la hora.
    expect(await wa(ID(1))).toEqual(despuesDeLaPrimera);
  });

  it("tres corridas seguidas convergen al mismo estado", async () => {
    await sembrar({ id: ID(1), wa: { direction: "outbound", status: "queued" } });
    await sembrar({ id: ID(2), wa: { direction: "outbound", status: "sent" } });
    await correr(false);
    const tras1 = await client.query("select id, meta from public.connect_messages order by id");
    await correr(false);
    await correr(false);
    const tras3 = await client.query("select id, meta from public.connect_messages order by id");
    expect(tras3.rows).toEqual(tras1.rows);
  });
});

// ══ 4 · REVERSIÓN EXACTA ═══════════════════════════════════════════════════
describe("T-WA-R9-03 · la reversión deshace SÓLO lo del backfill", () => {
  it("devuelve la fila a su forma previa, marca incluida", async () => {
    const original = { direction: "outbound", status: "sending" };
    await sembrar({ id: ID(1), wa: original });
    await correr(false);
    expect((await wa(ID(1))).status_source).toBe("server");

    expect(await revertir()).toBe(1);
    const w = await wa(ID(1));
    expect(w).toEqual(original);
    expect(w).not.toHaveProperty("provenance_backfill");
    expect(w).not.toHaveProperty("status_source");
  });

  it("si el backfill AGREGÓ la dirección, la reversión también la quita", async () => {
    await sembrar({ id: ID(2), wa: { status: "reconciliation_required" } });
    await correr(false);
    expect((await wa(ID(2))).direction).toBe("outbound");

    await revertir();
    const w = await wa(ID(2));
    expect(w).toEqual({ status: "reconciliation_required" });
    expect(w.direction).toBeUndefined();
  });

  it("si la dirección YA estaba, la reversión NO la quita", async () => {
    await sembrar({ id: ID(3), wa: { direction: "outbound", status: "sending" } });
    await correr(false);
    await revertir();
    // La dirección era un hecho previo: revertir el backfill no puede borrarlo.
    expect((await wa(ID(3))).direction).toBe("outbound");
  });

  it("NO toca una procedencia escrita por el código productivo", async () => {
    await sembrar({ id: ID(4), wa: { direction: "outbound", status: "sent", status_source: "meta" } });
    await sembrar({ id: ID(5), wa: { direction: "outbound", status: "sending" } });
    await correr(false);

    expect(await revertir()).toBe(1); // sólo la que escribió el backfill
    expect((await wa(ID(4))).status_source).toBe("meta");
    expect((await wa(ID(5))).status_source).toBeUndefined();
  });

  it("revertir dos veces es no-op", async () => {
    await sembrar({ id: ID(6), wa: { direction: "outbound", status: "sending" } });
    await correr(false);
    expect(await revertir()).toBe(1);
    expect(await revertir()).toBe(0);
  });

  it("ciclo completo backfill→revertir→backfill es determinista", async () => {
    await sembrar({ id: ID(7), wa: { direction: "outbound", status: "sending" } });
    await correr(false);
    const tras1 = (await wa(ID(7))).status_source;
    await revertir();
    await correr(false);
    expect((await wa(ID(7))).status_source).toBe(tras1);
  });
});

// ══ 5 · CERO EGRESS ════════════════════════════════════════════════════════
describe("T-WA-R9-03 · el backfill no puede provocar un reenvío", () => {
  it("no toca `external_msg_id` ni el estado", async () => {
    await sembrar({ id: ID(1), wa: { direction: "outbound", status: "sending" }, wamid: "wamid.SELLO" });
    await correr(false);
    const { rows } = await client.query(
      "select external_msg_id, meta->'wa'->>'status' as s from public.connect_messages where id=$1",
      [ID(1)],
    );
    expect(rows[0]).toEqual({ external_msg_id: "wamid.SELLO", s: "sending" });
  });

  it("ninguna fila queda en un estado que habilite un egress nuevo", async () => {
    // `claimSending` sólo reclama desde null/queued. El backfill no puede
    // devolver una fila enviada a esos estados.
    await sembrar({ id: ID(2), wa: { direction: "outbound", status: "sent" } });
    await correr(false);
    expect((await wa(ID(2))).status).toBe("sent");
  });
});

// ══ CLOSEOUT · §4.C · la reversión es exacta aunque 0227 escriba después ═══
/**
 * Riesgo: el backfill deriva `status_source` y deja su marca; más tarde el
 * código productivo avanza el estado por RPC y escribe procedencia REAL. Si la
 * marca sobreviviera, revertir el backfill borraría un hecho que el backfill
 * nunca escribió.
 *
 * La marca CADUCA en el momento en que un writer real toca la fila: a partir de
 * ahí la procedencia ya no es derivada y la reversión no la alcanza.
 */
describe("T-WA-R9-03 · §4.C · reversión frente a escrituras posteriores", () => {
  beforeAll(async () => {
    // Se agrega la RPC de estado a esta base para simular el escenario real.
    const s227full = readFileSync(MIG_0227, "utf8");
    await client.query(s227full.slice(0, s227full.indexOf(CORTE)));
  });

  const avanzar = async (id: string, status: string, source: string) => {
    const { rows } = await client.query(
      "select public.connect_wa_apply_status(p_message_id => $1, p_status => $2," +
        " p_source => $3) as o", [id, status, source],
    );
    return rows[0].o as string;
  };

  it("si la RPC escribe después, la marca CADUCA y la reversión no toca la fila", async () => {
    await sembrar({ id: ID(1), wa: { direction: "outbound", status: "queued" } });
    await correr(false);
    expect((await wa(ID(1))).provenance_backfill).toBeDefined();

    // El código productivo avanza el estado: procedencia REAL, no derivada.
    expect(await avanzar(ID(1), "sending", "server")).toBe("applied");
    const tras = await wa(ID(1));
    expect(tras.provenance_backfill).toBeUndefined();
    expect(tras.status_source).toBe("server");

    // La reversión ya no la considera suya.
    expect(await revertir()).toBe(0);
    expect((await wa(ID(1))).status_source).toBe("server");
    expect((await wa(ID(1))).status).toBe("sending");
  });

  it("una fila NO tocada por la RPC sí se revierte, en el mismo lote", async () => {
    await sembrar({ id: ID(1), wa: { direction: "outbound", status: "queued" } });
    await sembrar({ id: ID(2), wa: { direction: "outbound", status: "sending" } });
    await correr(false);
    await avanzar(ID(1), "sending", "server"); // sólo la 1 avanza

    expect(await revertir()).toBe(1);
    expect((await wa(ID(1))).status_source).toBe("server");   // preservada
    expect((await wa(ID(2))).status_source).toBeUndefined();  // revertida
  });

  it("un hecho de META posterior tampoco se pierde al revertir", async () => {
    await sembrar({ id: ID(3), wa: { direction: "outbound", status: "sending" } }, );
    await correr(false);
    await avanzar(ID(3), "sent", "meta");
    expect(await revertir()).toBe(0);
    const w = await wa(ID(3));
    expect(w.status_source).toBe("meta");
    expect(w.status).toBe("sent");
  });

  it("el dry-run de la reversión informa sin tocar nada", async () => {
    await sembrar({ id: ID(4), wa: { direction: "outbound", status: "sending" } });
    await correr(false);

    const { rows } = await client.query(
      "select * from public.wa_backfill_provenance_rollback($1)", [true],
    );
    const seco = Object.fromEntries(rows.map((r) => [r.accion, Number(r.filas)]));
    expect(seco).toEqual({ dry_run_candidatas: 1, revertidas: 0 });
    // Y no revirtió: la procedencia derivada sigue puesta.
    expect((await wa(ID(4))).status_source).toBe("server");

    // La ejecución real coincide con lo informado.
    expect(await revertir()).toBe(1);
  });

  it("el dry-run por DEFECTO es seco: llamar sin argumento no revierte", async () => {
    await sembrar({ id: ID(5), wa: { direction: "outbound", status: "sending" } });
    await correr(false);
    await client.query("select * from public.wa_backfill_provenance_rollback()");
    expect((await wa(ID(5))).status_source).toBe("server");
  });
});
