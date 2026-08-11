/**
 * T-WA-R9-01 · LINK-WA WA-8R9 — la RPC de estado, contra PostgreSQL REAL.
 *
 * ─── POR QUÉ ESTE ARCHIVO NO USA EL MANIFIESTO WMS ─────────────────────────
 *
 * El cierre determinista de `tests/db/harness/manifest.ts` es el del dominio
 * WMS: 31 migraciones que NO incluyen la cadena Connect (0142+), así que en ese
 * cluster no existe `connect_messages`. Extender el manifiesto para arrastrar
 * toda la cadena Connect tocaría el harness de WMS, que está congelado durante
 * esta ventana, y además metería decenas de migraciones ajenas al objeto de
 * prueba.
 *
 * En su lugar se monta un CIERRE PROPIO y acotado: un esquema dedicado con la
 * forma exacta que la RPC toca de `connect_messages` (`id`, `external_msg_id`,
 * `meta jsonb`) y las funciones REALES del archivo 0227 tal como están en disco
 * —no una copia—, de modo que lo que se prueba es la migración que se entrega.
 *
 * LÍMITE DECLARADO: esto prueba la SEMÁNTICA de concurrencia de la RPC contra
 * un PostgreSQL real (locks, visibilidad, jsonb, serialización). NO prueba la
 * integración con el resto del esquema Connect (RLS, permisos, triggers), que
 * requiere la cadena completa y queda fuera de esta ventana.
 */

import { afterAll, beforeAll, describe, expect, it, inject } from "vitest";
import type { Client } from "pg";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createWaSandbox, type WaSandbox } from "./harness/wa-sandbox";

const MIGRACION = resolve(
  __dirname, "..", "..", "supabase", "migrations", "0227_wa_atomic_status.sql",
);

/** Marca donde empieza la sección que depende de la cadena Connect completa. */
const CORTE = "-- (6) NACIMIENTO CANÓNICO DEL INTENTO";

let sandbox: WaSandbox;
let client: Client;

/** Ids estables y sintéticos. Sin datos reales, sin teléfonos, sin wamids de Meta. */
const MSG = "11111111-1111-4111-8111-111111111111";
const MSG2 = "22222222-2222-4222-8222-222222222222";
const WAMID = "wamid.TEST_R9";
const AT_META = "2026-08-09T10:00:00.000Z";

beforeAll(async () => {
  // HIGH-2 · base efímera DEDICADA: nada de este archivo toca objetos del
  // cluster compartido, así que no hay nada que restaurar ni orden que respetar.
  sandbox = await createWaSandbox(inject("dbUrl"));
  client = sandbox.client;

  // Forma mínima y FIEL de lo que la RPC toca. Se crea en `public` porque la
  // migración referencia `public.connect_messages` por nombre calificado.
  await client.query(`
    create table if not exists public.connect_messages (
      id              uuid primary key,
      external_msg_id text,
      meta            jsonb not null default '{}'::jsonb
    );
  `);

  // Las funciones REALES del archivo entregado, hasta el corte.
  const sql = readFileSync(MIGRACION, "utf8");
  const idx = sql.indexOf(CORTE);
  if (idx < 0) throw new Error("marca de corte ausente en 0227: el test quedó desalineado");
  await client.query(sql.slice(0, idx));
});

afterAll(async () => {
  // Se destruye la base entera: no hay `drop ... cascade` sobre objetos ajenos.
  await sandbox?.destroy();
});

/** Deja la fila en un estado conocido. */
async function sembrar(id: string, wa: Record<string, unknown>, wamid: string | null = null) {
  await client.query(
    `insert into public.connect_messages (id, external_msg_id, meta)
     values ($1, $2, jsonb_build_object('wa', $3::jsonb, 'otro', 1))
     on conflict (id) do update set external_msg_id = excluded.external_msg_id,
                                     meta = excluded.meta`,
    [id, wamid, JSON.stringify(wa)],
  );
}

async function leerWa(id: string): Promise<Record<string, any>> {
  const { rows } = await client.query("select meta->'wa' as wa from public.connect_messages where id = $1", [id]);
  return rows[0]?.wa ?? {};
}

/** Llama la RPC con parámetros nombrados. */
async function aplicar(
  c: Client,
  args: Record<string, unknown>,
): Promise<string> {
  const keys = Object.keys(args);
  const lista = keys.map((k, i) => `${k} => $${i + 1}`).join(", ");
  const { rows } = await c.query(
    `select public.connect_wa_apply_status(${lista}) as outcome`,
    keys.map((k) => args[k]),
  );
  return rows[0].outcome as string;
}

const OUTBOUND_SENT = {
  direction: "outbound", status: "sent", status_source: "server",
  status_at: "2026-08-09T09:00:00.000Z",
};

// ══ 1 · El espejo SQL del canon no puede divergir del canon ═════════════════
describe("T-WA-R9-01 · _wa_can_transition replica la máquina canónica", () => {
  const ESTADOS = [
    "queued", "sending", "sent", "delivered", "read", "failed", "reconciliation_required",
  ] as const;

  /** Reimplementación del contrato PÚBLICO, no de la implementación SQL. */
  function canonEsperado(cur: string | null, inc: string): boolean {
    if (cur === null) return true;
    if (cur === inc) return false;
    if (inc === "failed") {
      return !["delivered", "read", "reconciliation_required"].includes(cur);
    }
    if (inc === "reconciliation_required") return cur === "queued" || cur === "sending";
    if (cur === "failed") return ["sent", "delivered", "read"].includes(inc);
    if (cur === "reconciliation_required") return ["sent", "delivered", "read"].includes(inc);
    const R: Record<string, number> = { queued: 0, sending: 1, sent: 2, delivered: 3, read: 4 };
    if (!(cur in R) || !(inc in R)) return false;
    return R[inc] > R[cur];
  }

  it("las 7×7 combinaciones más el caso nulo coinciden exactamente", async () => {
    const casos: Array<[string | null, string]> = [];
    for (const inc of ESTADOS) casos.push([null, inc]);
    for (const cur of ESTADOS) for (const inc of ESTADOS) casos.push([cur, inc]);

    const divergencias: string[] = [];
    for (const [cur, inc] of casos) {
      const { rows } = await client.query(
        "select public._wa_can_transition($1, $2) as ok", [cur, inc],
      );
      if (rows[0].ok !== canonEsperado(cur, inc)) {
        divergencias.push(`${cur ?? "∅"}→${inc}: sql=${rows[0].ok} canon=${canonEsperado(cur, inc)}`);
      }
    }
    expect(divergencias).toEqual([]);
    expect(casos).toHaveLength(56);
  });

  it("SCR-LINK-WA-002 · `sent → reconciliation_required` sigue PROHIBIDO", async () => {
    // El contrato prometía esta transición; el canon la niega. La corrección no
    // fue agregarla, fue dejar de prometerla.
    const { rows } = await client.query(
      "select public._wa_can_transition('sent','reconciliation_required') as ok",
    );
    expect(rows[0].ok).toBe(false);
  });
});

// ══ 2 · B-1 · una escritura concurrente NO puede borrar audit_sent ══════════
describe("T-WA-R9-01 · B-1 · claves concurrentes sobreviven", () => {
  it("audit_sent agregado entre la lectura y la escritura NO se pierde", async () => {
    await sembrar(MSG, { ...OUTBOUND_SENT }, WAMID);

    // Segunda conexión: agrega `audit_sent` mientras la primera aún no escribió.
    const otra = await sandbox.connect();
    try {
      await otra.query(
        `update public.connect_messages
            set meta = jsonb_set(meta, '{wa,audit_sent}',
                                 jsonb_build_object('wamid', $2::text, 'at', $3::text), true)
          where id = $1`,
        [MSG, WAMID, AT_META],
      );

      // Ahora el webhook aplica `delivered`. Bajo el viejo read-modify-write el
      // objeto se reconstruía desde un snapshot sin `audit_sent` y lo borraba.
      const out = await aplicar(client, {
        p_wamid: WAMID, p_status: "delivered", p_source: "meta", p_at: AT_META,
      });
      expect(out).toBe("applied");

      const wa = await leerWa(MSG);
      expect(wa.audit_sent).toEqual({ wamid: WAMID, at: AT_META });
      expect(wa.status).toBe("delivered");
      expect(wa.status_source).toBe("meta");
    } finally {
      await otra.end();
    }
  });

  it("las claves ajenas de meta y de wa se preservan", async () => {
    await sembrar(MSG, { ...OUTBOUND_SENT, ajena: "x" }, WAMID);
    await aplicar(client, {
      p_wamid: WAMID, p_status: "delivered", p_source: "meta", p_at: AT_META,
    });
    const { rows } = await client.query("select meta from public.connect_messages where id=$1", [MSG]);
    expect(rows[0].meta.otro).toBe(1);
    expect(rows[0].meta.wa.ajena).toBe("x");
  });
});

// ══ 3 · H-1 · ningún desenlace colapsa en "nada que hacer" ══════════════════
describe("T-WA-R9-01 · H-1 · resultado discriminado", () => {
  it("carrera perdida devuelve retryable, NO noop ni applied", async () => {
    await sembrar(MSG, { ...OUTBOUND_SENT }, WAMID);
    const out = await aplicar(client, {
      p_wamid: WAMID, p_status: "delivered", p_source: "meta", p_at: AT_META,
      p_use_expectations: true,
      p_expect_status: "sending",          // snapshot viejo: la fila ya es `sent`
      p_expect_source: "server",
      p_expect_at: "2026-08-09T08:00:00.000Z",
      p_expect_wamid: WAMID,
    });
    expect(out).toBe("retryable");
    // Y no escribió nada.
    expect((await leerWa(MSG)).status).toBe("sent");
  });

  it("replay idéntico devuelve duplicate (idempotente, no duplica)", async () => {
    await sembrar(MSG, { ...OUTBOUND_SENT }, WAMID);
    const a = await aplicar(client, { p_wamid: WAMID, p_status: "delivered", p_source: "meta", p_at: AT_META });
    const b = await aplicar(client, { p_wamid: WAMID, p_status: "delivered", p_source: "meta", p_at: AT_META });
    expect(a).toBe("applied");
    expect(b).toBe("duplicate");
  });

  it("fila entrante devuelve rejected y no se toca", async () => {
    await sembrar(MSG2, { direction: "inbound" }, "wamid.IN_R9");
    const out = await aplicar(client, {
      p_wamid: "wamid.IN_R9", p_status: "delivered", p_source: "meta", p_at: AT_META,
    });
    expect(out).toBe("rejected");
    const wa = await leerWa(MSG2);
    expect(wa.status).toBeUndefined();
    expect(wa.status_source).toBeUndefined();
  });

  it("wamid inexistente devuelve unmatched", async () => {
    expect(await aplicar(client, {
      p_wamid: "wamid.NO_EXISTE", p_status: "delivered", p_source: "meta", p_at: AT_META,
    })).toBe("unmatched");
  });

  it.each([
    ["procedencia inválida", { p_message_id: MSG, p_status: "sent", p_source: "ui" }],
    ["estado desconocido", { p_message_id: MSG, p_status: "zzz", p_source: "server" }],
    ["sin id ni wamid", { p_status: "sent", p_source: "server" }],
  ])("%s LANZA en vez de degradarse a un resultado", async (_l, args) => {
    await sembrar(MSG, { ...OUTBOUND_SENT }, WAMID);
    await expect(aplicar(client, args)).rejects.toThrow();
  });
});

// ══ 4 · Precedencia de procedencia: el servidor no pisa a Meta ══════════════
describe("T-WA-R9-01 · un hecho server jamás reemplaza un hecho meta", () => {
  it.each(["sent", "delivered", "read", "failed"])(
    "%s/meta no lo degrada un failed del servidor",
    async (status) => {
      await sembrar(MSG, { direction: "outbound", status, status_source: "meta", status_at: AT_META }, WAMID);
      const out = await aplicar(client, { p_message_id: MSG, p_status: "failed", p_source: "server" });
      expect(out).toBe("rejected");
      const wa = await leerWa(MSG);
      expect(wa.status).toBe(status);
      expect(wa.status_source).toBe("meta");
      expect(wa.status_at).toBe(AT_META);
    },
  );

  it("M-1 · la reconciliación deja MARCA durable y conserva el estado de Meta", async () => {
    await sembrar(MSG, {
      direction: "outbound", status: "delivered", status_source: "meta", status_at: AT_META,
      audit_sent: { wamid: WAMID, at: AT_META },
    }, WAMID);

    const out = await aplicar(client, {
      p_message_id: MSG, p_status: "reconciliation_required", p_source: "server",
      p_error: "audit_reconciliation",
    });
    expect(out).toBe("reconciliation_required");

    const wa = await leerWa(MSG);
    // El estado confirmado NO se degradó…
    expect(wa.status).toBe("delivered");
    expect(wa.status_source).toBe("meta");
    // …el marcador de auditoría sigue…
    expect(wa.audit_sent).toEqual({ wamid: WAMID, at: AT_META });
    // …y la reconciliación quedó registrada como hecho aparte.
    expect(wa.reconciliation.reason).toBe("audit_reconciliation");
    expect(wa.reconciliation.at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it("M-1 · marcar reconciliación dos veces no re-sella la hora", async () => {
    await sembrar(MSG, { direction: "outbound", status: "sent", status_source: "server", status_at: AT_META }, WAMID);
    await aplicar(client, { p_message_id: MSG, p_status: "reconciliation_required", p_source: "server" });
    const primera = (await leerWa(MSG)).reconciliation.at;
    await aplicar(client, { p_message_id: MSG, p_status: "reconciliation_required", p_source: "server" });
    expect((await leerWa(MSG)).reconciliation.at).toBe(primera);
  });
});

// ══ 5 · CONCURRENCIA REAL: dos transacciones sobre la misma fila ════════════
describe("T-WA-R9-01 · concurrencia real sobre PostgreSQL", () => {
  /** Abre una transacción, toma el lock por la RPC y la deja pendiente. */
  it("webhook y markAudited se SERIALIZAN: ninguno pierde su hecho", async () => {
    await sembrar(MSG, { ...OUTBOUND_SENT }, WAMID);

    const a = await sandbox.connect();
    const b = await sandbox.connect();
    try {
      // A abre transacción y aplica `delivered` (toma el lock de la fila).
      await a.query("begin");
      expect(await aplicar(a, {
        p_wamid: WAMID, p_status: "delivered", p_source: "meta", p_at: AT_META,
      })).toBe("applied");

      // B intenta escribir `audit_sent` sobre la MISMA fila: queda bloqueado
      // hasta que A confirme. Se lanza sin await y se confirma que no resolvió.
      let bTerminó = false;
      const escrituraB = b
        .query(
          `update public.connect_messages
              set meta = jsonb_set(meta, '{wa,audit_sent}',
                                   jsonb_build_object('wamid', $2::text), true)
            where id = $1`,
          [MSG, WAMID],
        )
        .then(() => { bTerminó = true; });

      await new Promise((r) => setTimeout(r, 150));
      // La prueba de que el lock es real: B no avanzó.
      expect(bTerminó).toBe(false);

      await a.query("commit");
      await escrituraB;
      expect(bTerminó).toBe(true);

      // Ambos hechos conviven: el de Meta y el de auditoría.
      const wa = await leerWa(MSG);
      expect(wa.status).toBe("delivered");
      expect(wa.status_source).toBe("meta");
      expect(wa.audit_sent).toEqual({ wamid: WAMID });
    } finally {
      await a.query("rollback").catch(() => {});
      await b.query("rollback").catch(() => {});
      await a.end(); await b.end();
    }
  });

  it("orden inverso: el marcador primero, el status después", async () => {
    await sembrar(MSG, { ...OUTBOUND_SENT }, WAMID);
    const a = await sandbox.connect();
    try {
      await a.query(
        `update public.connect_messages
            set meta = jsonb_set(meta, '{wa,audit_sent}', jsonb_build_object('wamid', $2::text), true)
          where id = $1`,
        [MSG, WAMID],
      );
      expect(await aplicar(client, {
        p_wamid: WAMID, p_status: "delivered", p_source: "meta", p_at: AT_META,
      })).toBe("applied");
      const wa = await leerWa(MSG);
      expect(wa.audit_sent).toEqual({ wamid: WAMID });
      expect(wa.status).toBe("delivered");
    } finally {
      await a.end();
    }
  });

  it("N escritores simultáneos: exactamente uno aplica, ninguno se pierde en silencio", async () => {
    await sembrar(MSG, { direction: "outbound", status: "sending", status_source: "server", status_at: AT_META }, WAMID);

    const conns = await Promise.all([0, 1, 2, 3, 4].map(() => sandbox.connect()));
    try {
      const outs = await Promise.all(
        conns.map((c) => aplicar(c, {
          p_wamid: WAMID, p_status: "delivered", p_source: "meta", p_at: AT_META,
        })),
      );
      // Uno aplica; el resto ve el hecho ya escrito. Ninguno devuelve algo que
      // el llamador pueda confundir con "no hacía falta".
      expect(outs.filter((o) => o === "applied")).toHaveLength(1);
      expect(outs.filter((o) => o === "duplicate")).toHaveLength(4);
      expect(outs).not.toContain("noop");
      expect((await leerWa(MSG)).status).toBe("delivered");
    } finally {
      await Promise.all(conns.map((c) => c.end()));
    }
  });

  it("mismo instante, estados distintos: gana el canon, no el orden de llegada", async () => {
    await sembrar(MSG, { direction: "outbound", status: "sending", status_source: "server", status_at: AT_META }, WAMID);
    const a = await sandbox.connect();
    try {
      const [x, y] = await Promise.all([
        aplicar(client, { p_wamid: WAMID, p_status: "read", p_source: "meta", p_at: AT_META }),
        aplicar(a, { p_wamid: WAMID, p_status: "sent", p_source: "meta", p_at: AT_META }),
      ]);
      // Ambas llamadas son legítimas; el resultado final NUNCA retrocede.
      expect([x, y]).not.toContain("noop");
      const wa = await leerWa(MSG);
      expect(["sent", "read"]).toContain(wa.status);
      if (x === "applied" && y === "rejected") expect(wa.status).toBe("read");
    } finally {
      await a.end();
    }
  });
});

// ══ 6 · B-1 completo · webhook ↔ markAudited no se borran mutuamente ═══════
/**
 * B-1 nombra una carrera de DOS direcciones. Ya se probó que el webhook no
 * borra `audit_sent`; falta la simétrica: que acreditar la auditoría no
 * REGRESE un status que llegó en el medio. Antes ambos reconstruían `meta.wa`
 * entero desde su propio snapshot, así que el último en escribir ganaba y el
 * hecho del otro desaparecía.
 */
describe("T-WA-R9-01 · B-1 bidireccional · markAudited atómico", () => {
  const acreditar = (c: Client, id: string, wamid: string, at: string) =>
    c.query("select public.connect_wa_mark_audited($1,$2,$3) as o", [id, wamid, at])
      .then((r) => r.rows[0].o as string);

  it("acreditar la auditoría NO regresa un status llegado en el medio", async () => {
    await sembrar(MSG, { ...OUTBOUND_SENT }, WAMID);

    // El webhook avanza a `delivered`…
    expect(await aplicar(client, {
      p_wamid: WAMID, p_status: "delivered", p_source: "meta", p_at: AT_META,
    })).toBe("applied");

    // …y recién después se acredita la auditoría del sello.
    expect(await acreditar(client, MSG, WAMID, AT_META)).toBe("applied");

    const wa = await leerWa(MSG);
    // Ambos hechos conviven. Antes, el marcador pisaba el `delivered`.
    expect(wa.status).toBe("delivered");
    expect(wa.status_source).toBe("meta");
    expect(wa.audit_sent).toEqual({ wamid: WAMID, at: AT_META });
  });

  it("orden inverso: acreditar primero, avanzar después", async () => {
    await sembrar(MSG, { ...OUTBOUND_SENT }, WAMID);
    expect(await acreditar(client, MSG, WAMID, AT_META)).toBe("applied");
    expect(await aplicar(client, {
      p_wamid: WAMID, p_status: "read", p_source: "meta", p_at: AT_META,
    })).toBe("applied");
    const wa = await leerWa(MSG);
    expect(wa.status).toBe("read");
    expect(wa.audit_sent).toEqual({ wamid: WAMID, at: AT_META });
  });

  it("simultáneos sobre la misma fila: ninguno pierde su hecho", async () => {
    await sembrar(MSG, { ...OUTBOUND_SENT }, WAMID);
    const a = await sandbox.connect();
    try {
      const [x, y] = await Promise.all([
        aplicar(client, { p_wamid: WAMID, p_status: "delivered", p_source: "meta", p_at: AT_META }),
        acreditar(a, MSG, WAMID, AT_META),
      ]);
      expect(x).toBe("applied");
      expect(y).toBe("applied");
      const wa = await leerWa(MSG);
      expect(wa.status).toBe("delivered");
      expect(wa.audit_sent).toEqual({ wamid: WAMID, at: AT_META });
    } finally {
      await a.end();
    }
  });

  it("idempotente: re-acreditar el MISMO wamid devuelve duplicate", async () => {
    await sembrar(MSG, { ...OUTBOUND_SENT }, WAMID);
    expect(await acreditar(client, MSG, WAMID, AT_META)).toBe("applied");
    expect(await acreditar(client, MSG, WAMID, AT_META)).toBe("duplicate");
  });

  it("un wamid distinto del sello NO acredita (el marcador se ata al WAMID)", async () => {
    await sembrar(MSG, { ...OUTBOUND_SENT }, WAMID);
    expect(await acreditar(client, MSG, "wamid.OTRO", AT_META)).toBe("rejected");
    expect((await leerWa(MSG)).audit_sent).toBeUndefined();
  });

  it.each([
    ["queued", "estado no auditable"],
    ["sending", "estado no auditable"],
    ["failed", "estado no auditable"],
    ["reconciliation_required", "estado no auditable"],
  ])("estado %s (%s) ⇒ rejected", async (status) => {
    await sembrar(MSG, { ...OUTBOUND_SENT, status }, WAMID);
    expect(await acreditar(client, MSG, WAMID, AT_META)).toBe("rejected");
    expect((await leerWa(MSG)).audit_sent).toBeUndefined();
  });

  it("fila entrante ⇒ rejected, jamás se acredita", async () => {
    await sembrar(MSG2, { direction: "inbound", status: "sent" }, "wamid.IN2");
    expect(await acreditar(client, MSG2, "wamid.IN2", AT_META)).toBe("rejected");
    expect((await leerWa(MSG2)).audit_sent).toBeUndefined();
  });

  it("fila inexistente ⇒ unmatched", async () => {
    expect(await acreditar(client, "99999999-9999-4999-8999-999999999999", WAMID, AT_META))
      .toBe("unmatched");
  });
});

// ══ 7 · el lock de markAudited es REAL, no decorativo ══════════════════════
describe("T-WA-R9-01 · markAudited serializa de verdad", () => {
  it("una transacción abierta bloquea al segundo acreditador hasta el commit", async () => {
    await sembrar(MSG, { ...OUTBOUND_SENT }, WAMID);

    const a = await sandbox.connect();
    const b = await sandbox.connect();
    try {
      // A toma el lock por la RPC y NO confirma todavía.
      await a.query("begin");
      const oA = await a.query(
        "select public.connect_wa_mark_audited($1,$2,$3) as o", [MSG, WAMID, AT_META],
      );
      expect(oA.rows[0].o).toBe("applied");

      // B intenta escribir la MISMA fila: debe quedar esperando.
      let bTerminó = false;
      const escrituraB = b
        .query(
          `update public.connect_messages
              set meta = jsonb_set(meta, '{wa,status}', '"read"'::jsonb, true)
            where id = $1`,
          [MSG],
        )
        .then(() => { bTerminó = true; });

      await new Promise((r) => setTimeout(r, 150));
      // Sin `for update` en la RPC, B habría pasado por encima acá.
      expect(bTerminó).toBe(false);

      await a.query("commit");
      await escrituraB;
      expect(bTerminó).toBe(true);

      const wa = await leerWa(MSG);
      expect(wa.audit_sent).toEqual({ wamid: WAMID, at: AT_META });
      expect(wa.status).toBe("read");
    } finally {
      await a.query("rollback").catch(() => {});
      await b.query("rollback").catch(() => {});
      await a.end(); await b.end();
    }
  });
});

// ══ 8 · contrato ESTRUCTURAL: toda decisión se toma con la fila bloqueada ══
/**
 * Complemento declarado de las pruebas de comportamiento, no sustituto.
 *
 * Quitar `for update` del SELECT de una de estas RPC no lo detecta ninguna
 * prueba de comportamiento posible desde afuera: el `update` final toma su
 * propio lock igual, así que la serialización observable no cambia. Lo que sí
 * cambia —y es el defecto— es que la variable `v_meta` del plpgsql queda
 * RANCIA: entre el SELECT sin lock y el UPDATE, otra transacción puede
 * confirmar un cambio, y `jsonb_set(v_meta, …)` lo pisa. Reproducirlo exigiría
 * pausar la función entre ambas sentencias, cosa que no se puede hacer sin
 * modificar la función bajo prueba.
 *
 * Por eso la precondición se fija sobre el texto de la migración entregada.
 */
describe("T-WA-R9-01 · las RPC deciden con la fila bloqueada", () => {
  const sql = readFileSync(MIGRACION, "utf8");

  /** Cuerpo de una función, desde su `create` hasta el `$$;` que la cierra. */
  const cuerpo = (nombre: string) => {
    const i = sql.indexOf(`create or replace function public.${nombre}`);
    expect(i).toBeGreaterThan(-1);
    const j = sql.indexOf("\n$$;", i);
    expect(j).toBeGreaterThan(i);
    return sql.slice(i, j);
  };

  it.each([["connect_wa_apply_status"], ["connect_wa_mark_audited"]])(
    "%s lee la fila con `for update` antes de decidir",
    (fn) => {
      const c = cuerpo(fn);
      // Hay al menos un SELECT … FOR UPDATE.
      expect(c).toMatch(/from public\.connect_messages[\s\S]*?for update;/);
      // Y NO queda ningún SELECT de la fila sin lock: cada `from
      // public.connect_messages` de esta función debe cerrar con `for update`.
      const lecturas = c.split("from public.connect_messages").slice(1);
      expect(lecturas.length).toBeGreaterThan(0);
      for (const l of lecturas) {
        const hasta = l.slice(0, l.indexOf(";") + 1);
        expect(hasta).toContain("for update");
      }
    },
  );

  it("ninguna de las dos escribe `meta` entero desde una variable rancia", () => {
    for (const fn of ["connect_wa_apply_status", "connect_wa_mark_audited"]) {
      const c = cuerpo(fn);
      // Toda escritura pasa por `jsonb_set` sobre una ruta acotada.
      const sets = c.match(/set meta = [^\n]+/g) ?? [];
      expect(sets.length).toBeGreaterThan(0);
      for (const s of sets) expect(s).toContain("jsonb_set(");
    }
  });
});

// ══ 9 · CLOSEOUT · G · el instante de Meta se valida SERVER-SIDE ═══════════
/**
 * El instante llegaba del evento y se escribía tal cual. Un valor no canónico
 * quedaba persistido y recién la UI lo descartaba al proyectar: el hecho tenía
 * un `status_at` que nadie podía leer. Ahora se rechaza antes de escribir.
 */
describe("T-WA-R9-01 · G · instante canónico o nada", () => {
  it.each([
    ["sin milisegundos", "2026-08-09T10:00:00Z"],
    ["con offset", "2026-08-09T10:00:00.000-03:00"],
    ["con espacio", "2026-08-09 10:00:00.000Z"],
    ["fecha inexistente", "2026-02-30T10:00:00.000Z"],
    ["texto libre", "ayer a la tarde"],
    ["vacío", ""],
  ])("%s ⇒ LANZA y no escribe nada", async (_l, at) => {
    await sembrar(MSG, { ...OUTBOUND_SENT }, WAMID);
    await expect(
      aplicar(client, { p_wamid: WAMID, p_status: "delivered", p_source: "meta", p_at: at }),
    ).rejects.toThrow(/canónico/i);
    // El estado previo quedó intacto.
    expect((await leerWa(MSG)).status).toBe("sent");
  });

  it("un instante canónico sí se acepta y se conserva textual", async () => {
    await sembrar(MSG, { ...OUTBOUND_SENT }, WAMID);
    expect(await aplicar(client, {
      p_wamid: WAMID, p_status: "delivered", p_source: "meta", p_at: AT_META,
    })).toBe("applied");
    expect((await leerWa(MSG)).status_at).toBe(AT_META);
  });

  it("sin instante, lo pone el servidor en forma canónica", async () => {
    await sembrar(MSG, { ...OUTBOUND_SENT }, WAMID);
    await aplicar(client, { p_wamid: WAMID, p_status: "delivered", p_source: "meta" });
    expect((await leerWa(MSG)).status_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it("un hecho del SERVIDOR ignora cualquier instante propuesto", async () => {
    await sembrar(MSG, { direction: "outbound", status: "sending", status_source: "server", status_at: AT_META }, WAMID);
    await aplicar(client, {
      p_message_id: MSG, p_status: "failed", p_source: "server",
      p_at: "2000-01-01T00:00:00.000Z",
    });
    // El reloj del servidor manda: el instante propuesto no se usa.
    expect((await leerWa(MSG)).status_at).not.toBe("2000-01-01T00:00:00.000Z");
  });

  it("el validador SQL replica isCanonicalIsoUtc", async () => {
    const casos: Array<[string, boolean]> = [
      ["2026-08-09T10:00:00.000Z", true],
      ["2026-12-31T23:59:59.999Z", true],
      ["2026-08-09T10:00:00.00Z", false],
      ["2026-13-01T10:00:00.000Z", false],
      ["2026-08-09T25:00:00.000Z", false],
    ];
    for (const [at, esperado] of casos) {
      const { rows } = await client.query("select public._wa_is_canonical_iso($1) as ok", [at]);
      expect(rows[0].ok, at).toBe(esperado);
    }
  });
});
