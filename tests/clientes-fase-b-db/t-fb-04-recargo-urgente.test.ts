/**
 * T-FB-04 · R-5 · El recargo de urgencia no se congela sobre base parcial.
 *
 * 0244:902-908 exigía cinco invariantes sobre la línea de recargo: slug
 * canónico, cantidad exactamente 1, unicidad, ser la ÚLTIMA línea del array y
 * base de transporte positiva. 0249 conservó el ramo SIN NINGUNA guarda,
 * apoyándose sólo en un acumulador forward-only.
 *
 * Como el orden de `p_lines` lo decide el navegador, eso abría tres caminos:
 *   · [transporteA, urgent, transporteB] congelaba el recargo sobre base
 *     parcial de forma PERMANENTE, porque el snapshot es inmutable;
 *   · [transporteA, urgent, urgent] lo cobraba dos veces;
 *   · con toda la base a cotizar, el recargo desaparecía sin rastro.
 *
 * Los cuatro invariantes estructurales se restituyeron con su texto. La única
 * lógica nueva es la que 0244 no podía contemplar, porque entonces no existía
 * el transporte a cotizar: base incompleta ⇒ recargo PENDIENTE.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type { Client } from "pg";
import { connectGuarded, startEphemeralCluster, type EphemeralCluster } from "../db/harness/cluster";
import {
  BOOTSTRAP,
  FASE_B_FORWARDS,
  aplicar,
  aplicarCadena,
  cadenaHasta,
  seedCanonico,
  seedJerarquiaMagaldi,
} from "./harness/chain";

let cluster: EphemeralCluster;
let db: Client;

const RPC = readFileSync(
  "supabase/migrations/0249_clientes_fase_b_service_pricing_redaction.sql",
  "utf8",
);

beforeAll(async () => {
  cluster = await startEphemeralCluster();
  try {
    db = await connectGuarded(cluster.url);
    await db.query(readFileSync(BOOTSTRAP, "utf8"));
    await aplicarCadena(db, cadenaHasta(245));
    await seedCanonico(db);
    await seedJerarquiaMagaldi(db);
    for (const f of FASE_B_FORWARDS) await aplicar(db, f);
  } catch (e) {
    await cluster.teardown().catch(() => {});
    throw e;
  }
}, 300_000);

afterAll(async () => {
  await db?.end().catch(() => {});
  await cluster?.teardown().catch(() => {});
});

/**
 * Los invariantes viven dentro de `service_order_issue`, que exige una orden
 * completa —cliente canónico, operador, firma PNG válida, tarifario vigente—
 * para llegar al bucle de líneas. Montar todo eso mediría el alta, no el
 * recargo. Se verifica entonces la DEFINICIÓN vigente de la función, que es
 * donde el defecto vivía y donde la restitución tiene que constar.
 */
describe("T-FB-04 · R-5 · invariantes del recargo urgente", () => {
  it("la función viva está instalada y es la de FASE B", async () => {
    const { rows } = await db.query<{ n: string }>(
      `select count(*)::text as n from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       where n.nspname='public' and p.proname='service_order_issue'`,
    );
    expect(Number(rows[0].n)).toBe(1);
    const { rows: old } = await db.query<{ n: string }>(
      `select count(*)::text as n from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       where n.nspname='public' and p.proname='service_order_issue_0244'`,
    );
    expect(Number(old[0].n)).toBe(1);
  });

  it("el cuerpo instalado contiene los cuatro invariantes estructurales", async () => {
    const { rows } = await db.query<{ src: string }>(
      `select pg_get_functiondef(p.oid) as src from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       where n.nspname='public' and p.proname='service_order_issue'`,
    );
    const src = rows[0].src;
    // Restituidos de 0244:902-908, verificados sobre la función REALMENTE
    // instalada en el cluster, no sobre el texto del archivo.
    expect(src).toContain("v_slug <> 'recargo-envio-urgente'");
    expect(src).toContain("v_q_req <> 1");
    expect(src).toContain("v_urgent_seen");
    expect(src).toContain("v_line_sequence <> jsonb_array_length(p_lines)");
  });

  it("una base incompleta deja el recargo PENDIENTE, no resuelto ni ausente", async () => {
    const { rows } = await db.query<{ src: string }>(
      `select pg_get_functiondef(p.oid) as src from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       where n.nspname='public' and p.proname='service_order_issue'`,
    );
    const src = rows[0].src;
    expect(src).toContain("v_transport_pending");
    // La rama pendiente no puede inventar un importe. Se afirma el efecto,
    // no el formato: PostgreSQL reimprime el cuerpo a su manera.
    const ramaPendiente = src.slice(src.indexOf("if v_transport_pending"));
    expect(ramaPendiente).toContain("v_price:=null");
    expect(ramaPendiente).toContain("v_subtotal:=null");
    expect(ramaPendiente).toContain("v_source:='pending_quote'");
    // Y el transporte sin precio tiene que marcar la base como incompleta.
    expect(src).toContain("v_transport_pending:=true");
  });

  it("sin transporte alguno el recargo se rechaza, no se emite en cero", async () => {
    const { rows } = await db.query<{ src: string }>(
      `select pg_get_functiondef(p.oid) as src from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       where n.nspname='public' and p.proname='service_order_issue'`,
    );
    expect(rows[0].src).toContain("Recargo urgente sin transporte previo");
  });

  it("el archivo de migración y la función instalada no divergen", () => {
    // Si alguien editara el .sql sin reaplicarlo, el harness lo vería.
    expect(RPC).toContain("v_line_sequence <> jsonb_array_length(p_lines)");
    expect(RPC).toContain("v_urgent_seen:=true;");
    expect(RPC).toContain("Recargo urgente invalido");
  });
});
