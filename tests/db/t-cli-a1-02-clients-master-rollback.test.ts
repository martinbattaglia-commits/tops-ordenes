/**
 * T-CLI-A1-02 · NEXUS-CLIENTES-ORDENES-PRECIOS-USUARIOS-001 · Carril A.
 *
 * Ensayo de REVERSIBILIDAD de 0241 y 0240 contra PostgreSQL REAL.
 *
 * ─── QUÉ DEMUESTRA ─────────────────────────────────────────────────────────
 *
 * Un rollback que nadie ejecutó nunca no es un rollback: es un archivo. Acá se
 * ejecuta de verdad y se mide el resultado con una fotografía del catálogo
 * tomada ANTES de aplicar la migración y otra DESPUÉS de revertirla.
 *
 * ─── LÍMITE CONOCIDO DEL INSTRUMENTO ───────────────────────────────────────
 *
 * `snapshotCatalog` (harness/wa-sandbox) captura seis conjuntos: tablas,
 * funciones, policies, triggers, grants de tabla y columnas. NO captura
 * índices, constraints, tipos, comentarios, defaults, secuencias ni
 * privilegios de rutina. La revisión adversarial C4 1/2 señaló, con razón, que
 * el docstring anterior afirmaba que un índice olvidado «lo delata el diff»,
 * y eso era falso: los índices quedaban atrapados sólo por transitividad
 * accidental (su `drop function` habría fallado).
 *
 * En vez de sobreentender el instrumento, esta suite mide los índices y las
 * constraints POR SEPARADO y de forma explícita.
 */

import { afterAll, beforeAll, describe, expect, it, inject } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Client } from "pg";
import {
  createWaSandbox,
  snapshotCatalog,
  diffCatalog,
  type WaSandbox,
  type CatalogSnapshot,
} from "./harness/wa-sandbox";
import { CIERRE_ACOTADO } from "./harness/clientes-closure";

const DIR = resolve(__dirname, "..", "..", "supabase", "migrations");
const M0240 = resolve(DIR, "0240_clientes_permission_module.sql");
const M0241 = resolve(DIR, "0241_clients_native_master.sql");
const M0242 = resolve(DIR, "0242_clients_atomic_mutations.sql");
const R0240 = resolve(DIR, "ROLLBACK_0240_clientes_permission_module.sql");
const R0241 = resolve(DIR, "ROLLBACK_0241_clients_native_master.sql");
const R0242 = resolve(DIR, "ROLLBACK_0242_clients_atomic_mutations.sql");

/** Cartera FICTICIA preexistente: debe sobrevivir intacta al rollback. */
const CARTERA = [
  { razon: "Preexistente Uno SA", cuit: "30-70000001-6" },
  { razon: "Preexistente Dos SRL", cuit: "30-70000002-4" },
];

let sb: WaSandbox;
let db: Client;
let antes: CatalogSnapshot;

/** Índices y constraints de `clients` y `client_events`: fuera del snapshot. */
async function indicesYConstraints(): Promise<string[]> {
  const { rows } = await db.query<{ x: string }>(`
    select indexname as x from pg_indexes
      where schemaname='public' and tablename in ('clients','client_events')
    union all
    select conname from pg_constraint
      where conrelid in ('public.clients'::regclass)
    order by 1
  `);
  return rows.map((r) => r.x);
}

/** Privilegios de ejecución de las RPC: tampoco están en el snapshot. */
async function grantsDeRutina(): Promise<string[]> {
  const { rows } = await db.query<{ x: string }>(`
    select routine_name || ':' || grantee as x
      from information_schema.routine_privileges
     where routine_schema='public' and privilege_type='EXECUTE'
     order by 1
  `);
  return rows.map((r) => r.x);
}

beforeAll(async () => {
  sb = await createWaSandbox(inject("dbUrl"));
  db = sb.client;
  await db.query(CIERRE_ACOTADO);
  for (const c of CARTERA) {
    await db.query("insert into public.clients (razon, cuit) values ($1,$2)", [c.razon, c.cuit]);
  }
  // El valor de enum de 0240 es irreversible por diseño de PostgreSQL, así que
  // la línea de base lo incluye y el diff mide exclusivamente lo de 0241.
  await db.query(readFileSync(M0240, "utf8"));
  antes = await snapshotCatalog(db);
}, 120_000);

afterAll(async () => {
  await sb?.destroy();
});

describe("T-CLI-A1-02 · 0241 es reversible sin residuos", () => {
  let indicesAntes: string[];
  let grantsAntes: string[];

  it("aplicar 0241 agrega objetos y revertirla los quita todos", async () => {
    indicesAntes = await indicesYConstraints();
    grantsAntes = await grantsDeRutina();

    await db.query(readFileSync(M0241, "utf8"));

    // Comprobación positiva (C7): la migración cambió algo. Sin esto, un
    // rollback que «no deja residuos» podría estar midiendo la nada.
    const conMigracion = await snapshotCatalog(db);
    expect(diffCatalog(antes, conMigracion).length).toBeGreaterThan(0);
    expect((await indicesYConstraints()).length).toBeGreaterThan(indicesAntes.length);

    await db.query(readFileSync(R0241, "utf8"));

    expect(diffCatalog(antes, await snapshotCatalog(db))).toEqual([]);
  });

  it("no deja índices ni constraints huérfanos (fuera del snapshot)", async () => {
    expect(await indicesYConstraints()).toEqual(indicesAntes);
  });

  it("no deja privilegios de ejecución huérfanos (fuera del snapshot)", async () => {
    expect(await grantsDeRutina()).toEqual(grantsAntes);
  });

  it("las filas de clients sobreviven al ciclo completo", async () => {
    const { rows } = await db.query<{ razon: string; cuit: string }>(
      "select razon, cuit from public.clients order by razon",
    );
    // Se compara contra la cartera ORDENADA por razón social: el literal de
    // arriba está en orden de inserción, no alfabético. Se mide el conjunto.
    const esperada = [...CARTERA].sort((a, b) => a.razon.localeCompare(b.razon));
    expect(rows.map((r) => r.razon)).toEqual(esperada.map((c) => c.razon));
    expect(rows.map((r) => r.cuit)).toEqual(esperada.map((c) => c.cuit));
  });

  it("el trigger de 0004 sobrevive: el rollback no se lo lleva puesto", async () => {
    const { rows } = await db.query<{ n: string }>(
      `select count(*)::text as n from information_schema.triggers
        where event_object_table='clients' and trigger_name='clients_touch_updated_at'`,
    );
    expect(rows[0].n).toBe("1");
  });

  it("el rollback borra sólo los slugs sembrados, no los ajenos", async () => {
    const { rows } = await db.query<{ slug: string }>("select slug from public.permissions");
    const slugs = rows.map((r) => r.slug);
    expect(slugs).not.toContain("clientes.view");
    expect(slugs).not.toContain("wms.clients.create");
  });

  it("la cadena 0241/0242 no deja policies transitorias ni reabre service_role", async () => {
    await db.query(readFileSync(M0241, "utf8"));
    await db.query(readFileSync(M0242, "utf8"));
    await db.query("begin");
    try {
      await db.query(readFileSync(R0242, "utf8"));
      await db.query(readFileSync(R0241, "utf8"));
      await db.query("commit");
    } catch (error) {
      await db.query("rollback");
      throw error;
    }
    const policies = await db.query<{ policyname: string }>(
      `select policyname from pg_policies
        where schemaname='public' and tablename='clients'
          and policyname in ('clients insert internal','clients update internal')`,
    );
    expect(policies.rows).toEqual([]);
    expect((await db.query<{ writable: boolean }>(
      `select has_table_privilege('service_role','public.clients','insert')
           or has_table_privilege('service_role','public.clients','update') writable`,
    )).rows[0].writable).toBe(false);
  });

  it("reaplicar 0241 después del rollback vuelve a funcionar", async () => {
    await db.query(readFileSync(M0241, "utf8"));
    const { rows } = await db.query<{ n: string }>(
      "select count(*)::text as n from public.permissions where module = 'clientes'",
    );
    expect(rows[0].n).toBe("4");
  });
});

describe("T-CLI-A1-02 · guarda de orden de ROLLBACK_0240", () => {
  it("aborta si 0241 todavía no fue revertida", async () => {
    let mensaje: string | null = null;
    try {
      await db.query(readFileSync(R0240, "utf8"));
    } catch (e) {
      mensaje = e instanceof Error ? e.message : String(e);
    }
    expect(mensaje).toMatch(/ROLLBACK_0240 abortado/);
    expect(mensaje).toMatch(/Revert[íi] 0241 primero/);
  });

  it("pasa una vez que 0241 fue revertida", async () => {
    await db.query(readFileSync(R0241, "utf8"));
    await expect(db.query(readFileSync(R0240, "utf8"))).resolves.toBeDefined();
  });
});
