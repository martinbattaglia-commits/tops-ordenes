/**
 * T-WA-R9-04 · M-4 — la cola durable contra PostgreSQL REAL.
 *
 * Lo que sólo se puede probar acá: que el claim sea atómico. Con dos workers,
 * "leer pendientes y después marcarlos" es una carrera que ningún test con
 * dobles detecta — ambos leen el mismo lote y ambos procesan. La primitiva que
 * lo resuelve es `for update skip locked`, y su comportamiento es del motor.
 *
 * Cierre propio y acotado: se crea `wa_inbound_events` con la forma de 0171 y
 * se aplican las funciones REALES de 0229 leídas de disco.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, inject } from "vitest";
import type { Client } from "pg";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createWaSandbox, type WaSandbox } from "./harness/wa-sandbox";

const MIG = resolve(__dirname, "..", "..", "supabase", "migrations", "0229_wa_inbound_queue.sql");

let sandbox: WaSandbox;
let client: Client;

const TOK_A = "aaaaaaaa-0000-4000-8000-aaaaaaaaaaaa";
const TOK_B = "bbbbbbbb-0000-4000-8000-bbbbbbbbbbbb";

beforeAll(async () => {
  // HIGH-2 · base efímera DEDICADA (ver harness/wa-sandbox.ts).
  sandbox = await createWaSandbox(inject("dbUrl"));
  client = sandbox.client;
  // Forma de 0171, que es la tabla que 0229 extiende.
  await client.query(`
    create table if not exists public.wa_inbound_events (
      seq             bigserial primary key,
      payload         jsonb   not null,
      signature_valid boolean not null default true,
      received_at     timestamptz not null default now(),
      processed       boolean not null default false,
      notes           text
    );
  `);
  await client.query(readFileSync(MIG, "utf8"));
});

afterAll(async () => {
  // Se destruye la base entera: cero `drop ... cascade` sobre objetos ajenos.
  await sandbox?.destroy();
});

beforeEach(async () => {
  await client.query("delete from public.wa_inbound_events");
  await client.query("alter sequence public.wa_inbound_events_seq_seq restart with 1");
});

async function encolar(n: number) {
  for (let i = 0; i < n; i++) {
    await client.query("insert into public.wa_inbound_events (payload) values ($1::jsonb)", [
      JSON.stringify({ i }),
    ]);
  }
}

const reclamar = async (c: Client, token: string, limit = 10) => {
  const { rows } = await c.query("select * from public.wa_claim_inbound_events($1,$2)", [token, limit]);
  return rows as Array<{ seq: string; attempts: number }>;
};
const liberar = async (seq: number, token: string, outcome: string, err: string | null = null) => {
  const { rows } = await client.query(
    "select public.wa_release_inbound_event($1,$2,$3,$4) as o", [seq, token, outcome, err]);
  return rows[0].o as string;
};
const fila = async (seq: number) => {
  const { rows } = await client.query("select * from public.wa_inbound_events where seq=$1", [seq]);
  return rows[0];
};

// ══ 1 · CLAIM ATÓMICO — dos workers, un ganador ════════════════════════════
describe("T-WA-R9-04 · el claim no puede entregar la misma fila dos veces", () => {
  it("dos workers concurrentes se reparten el lote SIN solaparse", async () => {
    await encolar(10);
    const b = await sandbox.connect();
    try {
      const [ra, rb] = await Promise.all([
        reclamar(client, TOK_A, 10),
        reclamar(b, TOK_B, 10),
      ]);
      const seqsA = ra.map((r) => Number(r.seq));
      const seqsB = rb.map((r) => Number(r.seq));

      // Ninguna fila en ambos…
      expect(seqsA.filter((s) => seqsB.includes(s))).toEqual([]);
      // …y entre los dos se llevaron todo, exactamente una vez cada una.
      expect([...seqsA, ...seqsB].sort((x, y) => x - y)).toEqual([1,2,3,4,5,6,7,8,9,10]);
    } finally {
      await b.end();
    }
  });

  it("el segundo worker NO queda bloqueado esperando al primero", async () => {
    await encolar(4);
    const b = await sandbox.connect();
    try {
      // A abre transacción y reclama 2, sin confirmar.
      await client.query("begin");
      const ra = await reclamar(client, TOK_A, 2);
      expect(ra).toHaveLength(2);

      // B reclama mientras A sigue abierta: `skip locked` le da las otras 2.
      const rb = await reclamar(b, TOK_B, 10);
      expect(rb.map((r) => Number(r.seq))).toEqual([3, 4]);

      await client.query("commit");
    } finally {
      await client.query("rollback").catch(() => {});
      await b.end();
    }
  });

  it("una fila reclamada no vuelve a salir hasta que se libere", async () => {
    await encolar(2);
    expect(await reclamar(client, TOK_A, 10)).toHaveLength(2);
    // Segunda pasada del mismo worker: ya no hay nada vencido.
    expect(await reclamar(client, TOK_A, 10)).toHaveLength(0);
  });

  it("el claim incrementa `attempts` y sella el token", async () => {
    await encolar(1);
    const r = await reclamar(client, TOK_A, 10);
    expect(r[0].attempts).toBe(1);
    const f = await fila(1);
    expect(f.claim_token).toBe(TOK_A);
    expect(f.claimed_at).not.toBeNull();
  });

  it("un token nulo o un límite inválido LANZAN", async () => {
    await encolar(1);
    await expect(reclamar(client, null as never, 10)).rejects.toThrow(/token/i);
    await expect(reclamar(client, TOK_A, 0)).rejects.toThrow(/límite/i);
  });
});

// ══ 2 · DESENLACES Y BACKOFF ═══════════════════════════════════════════════
describe("T-WA-R9-04 · el desenlace decide si el evento vuelve", () => {
  it("`done` lo marca procesado y limpia el error", async () => {
    await encolar(1);
    await reclamar(client, TOK_A);
    expect(await liberar(1, TOK_A, "done")).toBe("done");
    const f = await fila(1);
    expect(f.processed).toBe(true);
    expect(f.claim_token).toBeNull();
    expect(f.last_error).toBeNull();
  });

  it("`retryable` lo devuelve a la cola CON backoff creciente", async () => {
    await encolar(1);
    await reclamar(client, TOK_A);
    expect(await liberar(1, TOK_A, "retryable", "timeout")).toBe("requeued");

    const f1 = await fila(1);
    expect(f1.processed).toBe(false);
    expect(f1.claim_token).toBeNull();
    expect(f1.last_error).toBe("timeout");
    // Vencimiento en el futuro: no vuelve a salir de inmediato.
    expect(new Date(f1.next_attempt_at).getTime()).toBeGreaterThan(Date.now());
    expect(await reclamar(client, TOK_A)).toHaveLength(0);

    // El backoff crece con los intentos.
    await client.query("update public.wa_inbound_events set next_attempt_at = now()");
    await reclamar(client, TOK_A);
    await liberar(1, TOK_A, "retryable", "timeout");
    const f2 = await fila(1);
    expect(new Date(f2.next_attempt_at).getTime())
      .toBeGreaterThan(new Date(f1.next_attempt_at).getTime());
  });

  it("`permanent` lo marca terminal sin más intentos", async () => {
    await encolar(1);
    await reclamar(client, TOK_A);
    expect(await liberar(1, TOK_A, "permanent", "rejected")).toBe("terminal");
    const f = await fila(1);
    expect(f.terminal).toBe(true);
    expect(f.processed).toBe(false); // NO procesado: nunca se fingió éxito
    expect(await reclamar(client, TOK_A)).toHaveLength(0);
  });

  it("agotar los intentos termina en terminal, no en un bucle infinito", async () => {
    await encolar(1);
    for (let i = 0; i < 5; i++) {
      await client.query("update public.wa_inbound_events set next_attempt_at = now()");
      const r = await reclamar(client, TOK_A);
      if (r.length === 0) break;
      await liberar(1, TOK_A, "retryable", "timeout");
    }
    const f = await fila(1);
    expect(f.terminal).toBe(true);
    expect(f.attempts).toBeLessThanOrEqual(5);
  });

  it("un worker con token ajeno NO puede escribir el desenlace", async () => {
    await encolar(1);
    await reclamar(client, TOK_A);
    expect(await liberar(1, TOK_B, "done")).toBe("not_claimed");
    expect((await fila(1)).processed).toBe(false);
  });

  it("un desenlace inválido LANZA en vez de degradarse", async () => {
    await encolar(1);
    await reclamar(client, TOK_A);
    await expect(liberar(1, TOK_A, "lo_que_sea")).rejects.toThrow(/desenlace/i);
  });

  it("el error persistido queda ACOTADO en tamaño", async () => {
    await encolar(1);
    await reclamar(client, TOK_A);
    await liberar(1, TOK_A, "permanent", "x".repeat(1000));
    expect(((await fila(1)).last_error as string).length).toBeLessThanOrEqual(200);
  });
});

// ══ 3 · UN EVENTO NO SE PIERDE PORQUE EL WEBHOOK CONTESTÓ 200 ══════════════
describe("T-WA-R9-04 · el 200 del webhook no borra el trabajo pendiente", () => {
  it("un evento sin procesar sigue disponible y visible", async () => {
    await encolar(3);
    // El webhook ya contestó 200 a los tres; ninguno se proyectó.
    const { rows } = await client.query("select * from public.wa_inbound_queue_health()");
    expect(Number(rows[0].pendientes)).toBe(3);
    expect(Number(rows[0].terminales)).toBe(0);
    // Y el consumidor los encuentra.
    expect(await reclamar(client, TOK_A, 10)).toHaveLength(3);
  });

  it("la salud de la cola no expone payloads", async () => {
    await client.query(
      "insert into public.wa_inbound_events (payload) values ($1::jsonb)",
      [JSON.stringify({ from: "+5491100000001", text: "secreto" })],
    );
    const { rows } = await client.query("select * from public.wa_inbound_queue_health()");
    const dump = JSON.stringify(rows[0]);
    expect(dump).not.toContain("5491100000001");
    expect(dump).not.toContain("secreto");
    expect(Object.keys(rows[0]).sort()).toEqual(["mas_viejo_seg", "pendientes", "terminales"]);
  });

  it("un terminal queda contabilizado, no desaparecido", async () => {
    await encolar(1);
    await reclamar(client, TOK_A);
    await liberar(1, TOK_A, "permanent", "rejected");
    const { rows } = await client.query("select * from public.wa_inbound_queue_health()");
    expect(Number(rows[0].terminales)).toBe(1);
    expect(Number(rows[0].pendientes)).toBe(0);
  });
});

// ══ 4 · REPLAY MANUAL ══════════════════════════════════════════════════════
describe("T-WA-R9-04 · replay manual seguro", () => {
  it("devuelve un terminal a la cola y reinicia sus intentos", async () => {
    await encolar(1);
    await reclamar(client, TOK_A);
    await liberar(1, TOK_A, "permanent", "rejected");

    const { rows } = await client.query("select public.wa_replay_inbound_event(1) as o");
    expect(rows[0].o).toBe("requeued");

    const f = await fila(1);
    expect(f.terminal).toBe(false);
    expect(f.attempts).toBe(0);
    expect(f.last_error).toBeNull();
    expect(await reclamar(client, TOK_A)).toHaveLength(1);
  });

  it("NO reabre un evento ya procesado", async () => {
    await encolar(1);
    await reclamar(client, TOK_A);
    await liberar(1, TOK_A, "done");
    const { rows } = await client.query("select public.wa_replay_inbound_event(1) as o");
    expect(rows[0].o).toBe("noop");
    expect((await fila(1)).processed).toBe(true);
  });

  it("un seq inexistente es noop, no error", async () => {
    const { rows } = await client.query("select public.wa_replay_inbound_event(9999) as o");
    expect(rows[0].o).toBe("noop");
  });

  it("el replay NUNCA toca el payload", async () => {
    await client.query("insert into public.wa_inbound_events (payload) values ($1::jsonb)",
      [JSON.stringify({ marca: "intacta" })]);
    await reclamar(client, TOK_A);
    await liberar(1, TOK_A, "permanent", "rejected");
    await client.query("select public.wa_replay_inbound_event(1)");
    expect((await fila(1)).payload).toEqual({ marca: "intacta" });
  });
});

// ══ 5 · ORDEN Y LÍMITE ═════════════════════════════════════════════════════
describe("T-WA-R9-04 · la cola respeta orden y tamaño de lote", () => {
  it("reclama en orden de llegada", async () => {
    await encolar(5);
    const r = await reclamar(client, TOK_A, 3);
    expect(r.map((x) => Number(x.seq))).toEqual([1, 2, 3]);
  });

  it("el límite acota el lote", async () => {
    await encolar(20);
    expect(await reclamar(client, TOK_A, 7)).toHaveLength(7);
  });

  it("no reclama lo ya procesado ni lo terminal", async () => {
    await encolar(3);
    await reclamar(client, TOK_A, 3);
    await liberar(1, TOK_A, "done");
    await liberar(2, TOK_A, "permanent", "rejected");
    await liberar(3, TOK_A, "retryable", "timeout");
    await client.query("update public.wa_inbound_events set next_attempt_at = now()");

    const r = await reclamar(client, TOK_A, 10);
    expect(r.map((x) => Number(x.seq))).toEqual([3]);
  });
});

// ══ 6 · EL LEASE · un worker muerto no secuestra el evento ═════════════════
/**
 * `skip locked` protege sólo mientras dura la transacción. Al confirmarse el
 * claim la fila queda desbloqueada, así que sin lease cualquier worker la
 * reclamaría de nuevo mientras el primero todavía la procesa — dos
 * proyecciones del mismo evento.
 *
 * Y el lease no puede ser eterno: si el worker muere sin liberar, la fila debe
 * volver sola.
 */
describe("T-WA-R9-04 · el lease protege sin secuestrar", () => {
  const reclamarConLease = async (c: Client, token: string, lease: string) => {
    const { rows } = await c.query(
      "select * from public.wa_claim_inbound_events($1,$2,$3,$4::interval)",
      [token, 10, 5, lease],
    );
    return rows as Array<{ seq: string }>;
  };

  it("mientras el lease vive, otro worker NO se lleva la fila", async () => {
    await encolar(1);
    expect(await reclamarConLease(client, TOK_A, "5 minutes")).toHaveLength(1);
    expect(await reclamarConLease(client, TOK_B, "5 minutes")).toHaveLength(0);
  });

  it("vencido el lease, la fila vuelve sola a la cola", async () => {
    await encolar(1);
    await reclamarConLease(client, TOK_A, "5 minutes");
    // El worker A "muere": nunca libera. Con el lease vencido, B la recupera.
    const r = await reclamarConLease(client, TOK_B, "0 seconds");
    expect(r).toHaveLength(1);
    const f = await fila(1);
    expect(f.claim_token).toBe(TOK_B);
    // Y el intento del worker muerto quedó contabilizado: no se pierde la cuenta.
    expect(f.attempts).toBe(2);
  });

  it("el worker original ya no puede escribir el desenlace tras perder el lease", async () => {
    await encolar(1);
    await reclamarConLease(client, TOK_A, "5 minutes");
    await reclamarConLease(client, TOK_B, "0 seconds");
    // A revive tarde y quiere marcar `done`: la fila ya no es suya.
    expect(await liberar(1, TOK_A, "done")).toBe("not_claimed");
    expect((await fila(1)).processed).toBe(false);
  });
});
