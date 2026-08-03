/**
 * T-A0-01 · El esquema WMS quedó cargado, verificado contra el CATÁLOGO REAL.
 *
 * No se consulta `supabase_migrations.schema_migrations` en ningún punto: ese
 * tracker está verificado como no fiel al catálogo (P3-N1 §4). La única
 * autoridad admitida es `information_schema` / `pg_catalog`.
 */

import { afterAll, beforeAll, describe, expect, it, inject } from "vitest";
import { emitSentinelWhenGreen } from "./harness/sentinel";
import { Client } from "pg";
import { REQUIRED_OBJECTS, WMS_MIGRATION_MANIFEST } from "./harness/manifest";

let client: Client;

beforeAll(async () => {
  client = new Client({ connectionString: inject("dbUrl") });
  await client.connect();
});

afterAll(async () => {
  await client?.end();
});

describe("T-A0-01 · esquema cargado (autoridad: catálogo)", () => {
  emitSentinelWhenGreen("P3_N1A0_SCHEMA_LOAD_PASS");

  it("aplicó exactamente el manifiesto versionado", () => {
    expect(inject("migrationsApplied")).toEqual([...WMS_MIGRATION_MANIFEST]);
  });

  it("las tablas del dominio existen", async () => {
    const { rows } = await client.query<{ table_name: string }>(
      `select table_name from information_schema.tables
       where table_schema = 'public' and table_name = any($1)`,
      [REQUIRED_OBJECTS.tables],
    );
    const found = rows.map((r) => r.table_name).sort();
    expect(found).toEqual([...REQUIRED_OBJECTS.tables].sort());
  });

  it("inventory_items tiene la forma productiva verificada", async () => {
    const { rows } = await client.query<{
      column_name: string;
      is_nullable: string;
    }>(
      `select column_name, is_nullable from information_schema.columns
       where table_schema = 'public' and table_name = 'inventory_items'
       order by ordinal_position`,
    );
    expect(rows.map((r) => r.column_name)).toEqual([
      "id",
      "sku",
      "description",
      "client_name",
      "position_id",
      "stock_available",
      "stock_reserved",
      "active",
      "created_at",
      "created_by",
    ]);
    // client_name NOT NULL es el hecho que P3-N1B va a cambiar; si esta
    // aserción se rompe, es que el candidato tocó el modelo antes de tiempo.
    expect(rows.find((r) => r.column_name === "client_name")?.is_nullable).toBe("NO");
    // Estado de partida: client_id / business_unit todavía NO existen.
    const names = rows.map((r) => r.column_name);
    expect(names).not.toContain("client_id");
    expect(names).not.toContain("business_unit");
  });

  it.each(Object.entries(REQUIRED_OBJECTS.enums))(
    "el enum %s tiene sus etiquetas",
    async (typname, labels) => {
      const { rows } = await client.query<{ enumlabel: string }>(
        `select e.enumlabel from pg_type t
           join pg_enum e on e.enumtypid = t.oid
          where t.typname = $1 order by e.enumsortorder`,
        [typname],
      );
      expect(rows.map((r) => r.enumlabel)).toEqual([...labels]);
    },
  );

  it("las funciones del dominio existen y son SECURITY DEFINER donde corresponde", async () => {
    const { rows } = await client.query<{ proname: string; prosecdef: boolean }>(
      `select p.proname, p.prosecdef from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = any($1)`,
      [REQUIRED_OBJECTS.functions],
    );
    const found = rows.map((r) => r.proname).sort();
    expect(found).toEqual([...REQUIRED_OBJECTS.functions].sort());

    // Toda escritura de stock pasa por RPC SECURITY DEFINER: es la garantía
    // sobre la que se apoyará el endpoint B2B de P3-N1F.
    const writers = [
      "confirm_reception",
      "confirm_movement",
      "allocate_order",
      "confirm_dispatch",
    ];
    for (const w of writers) {
      expect(rows.find((r) => r.proname === w)?.prosecdef).toBe(true);
    }
  });

  it("los triggers de inmutabilidad y de business_unit existen", async () => {
    const { rows } = await client.query<{ tgname: string }>(
      `select tgname from pg_trigger where not tgisinternal and tgname = any($1)`,
      [REQUIRED_OBJECTS.triggers],
    );
    expect(rows.map((r) => r.tgname).sort()).toEqual(
      [...REQUIRED_OBJECTS.triggers].sort(),
    );
  });

  it("el CHECK ANMAT existe", async () => {
    const { rows } = await client.query(
      `select conname from pg_constraint where conname = any($1)`,
      [REQUIRED_OBJECTS.constraints],
    );
    expect(rows).toHaveLength(REQUIRED_OBJECTS.constraints.length);
  });

  it("los índices de identidad existen y NO usan NULLS NOT DISTINCT", async () => {
    const { rows } = await client.query<{ indexname: string; indexdef: string }>(
      `select indexname, indexdef from pg_indexes
        where schemaname = 'public' and indexname = any($1)`,
      [REQUIRED_OBJECTS.indexes],
    );
    expect(rows.map((r) => r.indexname).sort()).toEqual(
      [...REQUIRED_OBJECTS.indexes].sort(),
    );
    // Deja constancia del defecto M-1 tal como está HOY en producción.
    // P3-N1B lo corregirá; esta aserción deberá invertirse entonces.
    for (const r of rows) {
      expect(r.indexdef).not.toMatch(/NULLS NOT DISTINCT/i);
    }
  });

  it("RLS está habilitada en las tablas de stock, con lockdown de escritura", async () => {
    const { rows } = await client.query<{
      relname: string;
      relrowsecurity: boolean;
      n_policies: number;
    }>(
      `select c.relname, c.relrowsecurity,
              (select count(*) from pg_policies p
                where p.schemaname = 'public' and p.tablename = c.relname)::int as n_policies
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public'
          and c.relname = any(array['inventory_items','inventory_lots','inventory_movements','stock_allocations'])`,
    );
    expect(rows).toHaveLength(4);
    for (const r of rows) {
      expect(r.relrowsecurity).toBe(true);
      // 0027 y 0031 dejaron una única policy (SELECT) en cada una.
      expect(r.n_policies).toBe(1);
    }
  });

});
