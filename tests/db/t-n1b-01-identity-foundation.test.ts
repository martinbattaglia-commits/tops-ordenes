/**
 * T-N1B-01 · Fundación de identidad canónica (0219) — columnas, FK, nulabilidad
 * y traza de declaración de business_unit (GENERAL explícito vs por omisión).
 *
 * Verifica CONTRA EL CATÁLOGO (no contra el tracker) que 0219 dejó exactamente
 * el modelo que P3-D1 manda: client_id ANULABLE en receptions/logistics_orders
 * (la obligatoriedad del contrato aplica sólo a inventory_items y recién en el
 * corte), FK con ON DELETE RESTRICT, y el mecanismo M-03 que distingue las
 * tres poblaciones: 'declared' / 'defaulted' / 'unknown'.
 *
 * Cada caso corre en su propia transacción con ROLLBACK.
 */

import { afterAll, beforeAll, describe, expect, it, inject } from "vitest";
import { Client } from "pg";
import { connectGuarded } from "./harness/cluster";
import { emitSentinelWhenGreen } from "./harness/sentinel";

let client: Client;

beforeAll(async () => {
  client = await connectGuarded(inject("dbUrl"));
});

afterAll(async () => {
  await client?.end();
});

async function withRollback<T>(fn: () => Promise<T>): Promise<T> {
  await client.query("begin");
  try {
    return await fn();
  } finally {
    await client.query("rollback");
  }
}

async function seedClient(tag: string): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `insert into public.clients (razon, cuit) values ($1, $2) returning id`,
    [`__N1B_${tag}__`, `N1B-${tag}`],
  );
  return rows[0].id;
}

describe("T-N1B-01 · fundación de identidad canónica (0219)", () => {
  emitSentinelWhenGreen("P3_N1B_FOUNDATION_VERIFIED");

  it("client_id existe en las tres tablas, con la nulabilidad del contrato", async () => {
    const { rows } = await client.query<{
      table_name: string;
      is_nullable: string;
      data_type: string;
    }>(
      `select table_name, is_nullable, data_type
         from information_schema.columns
        where table_schema = 'public' and column_name = 'client_id'
          and table_name in ('receptions','inventory_items','logistics_orders')
        order by table_name`,
    );
    expect(rows).toEqual([
      // ADR-P3-13: anulable al inicio; inventory_items endurecida por 0220
      // tras demostrar cobertura 100 % (gate G-1).
      { table_name: "inventory_items", is_nullable: "NO", data_type: "uuid" },
      { table_name: "logistics_orders", is_nullable: "YES", data_type: "uuid" },
      { table_name: "receptions", is_nullable: "YES", data_type: "uuid" },
    ]);
  });

  it("las tres FK de client_id apuntan a clients con ON DELETE RESTRICT", async () => {
    const { rows } = await client.query<{ table_name: string; confdeltype: string }>(
      `select cl.relname as table_name, con.confdeltype
         from pg_constraint con
         join pg_class cl on cl.oid = con.conrelid
         join pg_class cf on cf.oid = con.confrelid
        where con.contype = 'f' and cf.relname = 'clients'
          and cl.relname in ('receptions','inventory_items','logistics_orders')
          and exists (
            select 1 from pg_attribute a
             where a.attrelid = con.conrelid and a.attnum = any(con.conkey)
               and a.attname = 'client_id')
        order by cl.relname`,
    );
    expect(rows.map((r) => r.table_name)).toEqual([
      "inventory_items",
      "logistics_orders",
      "receptions",
    ]);
    // 'r' = RESTRICT: un cliente con operación registrada no desaparece.
    expect(new Set(rows.map((r) => r.confdeltype))).toEqual(new Set(["r"]));
  });

  it("FK RESTRICT efectiva: no se puede borrar un cliente con inventario", async () => {
    await withRollback(async () => {
      const clientId = await seedClient("FK");
      await client.query(
        `insert into public.inventory_items (sku, description, client_name, client_id)
         values ('__N1B_FK__','x','__N1B__',$1)`,
        [clientId],
      );
      await expect(
        client.query(`delete from public.clients where id = $1`, [clientId]),
      ).rejects.toThrow(/violates foreign key|viola la llave/i);
    });
  });

  it("business_unit proyectada/declarada/foto: anulables en items, orders y allocations", async () => {
    const { rows } = await client.query<{ table_name: string; is_nullable: string }>(
      `select table_name, is_nullable
         from information_schema.columns
        where table_schema = 'public' and column_name = 'business_unit'
          and table_name in ('inventory_items','logistics_orders','stock_allocations')
        order by table_name`,
    );
    // ADR-P3-06: anulable durante la transición; jamás obligatoria por decreto.
    expect(rows).toEqual([
      { table_name: "inventory_items", is_nullable: "YES" },
      { table_name: "logistics_orders", is_nullable: "YES" },
      { table_name: "stock_allocations", is_nullable: "YES" },
    ]);
  });

  it("receptions.business_unit ya NO tiene DEFAULT (la omisión pasa por el trigger)", async () => {
    const { rows } = await client.query<{ column_default: string | null }>(
      `select column_default from information_schema.columns
        where table_schema='public' and table_name='receptions' and column_name='business_unit'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].column_default).toBeNull();
  });

  it("omitir business_unit ⇒ 'GENERAL' + source='defaulted' (misma semántica, con traza)", async () => {
    await withRollback(async () => {
      const { rows } = await client.query<{ business_unit: string; business_unit_source: string }>(
        `insert into public.receptions (client_name, status)
         values ('__N1B_OMITIDO__','borrador')
         returning business_unit, business_unit_source`,
      );
      expect(rows[0]).toEqual({ business_unit: "GENERAL", business_unit_source: "defaulted" });
    });
  });

  it("business_unit = NULL explícito ⇒ también 'defaulted' (NULL no es una declaración)", async () => {
    await withRollback(async () => {
      const { rows } = await client.query<{ business_unit: string; business_unit_source: string }>(
        `insert into public.receptions (client_name, business_unit, status)
         values ('__N1B_NULO__', null, 'borrador')
         returning business_unit, business_unit_source`,
      );
      expect(rows[0]).toEqual({ business_unit: "GENERAL", business_unit_source: "defaulted" });
    });
  });

  it("declarar 'GENERAL' explícitamente ⇒ source='declared' (la asimetría de M-03 queda medible)", async () => {
    await withRollback(async () => {
      const { rows } = await client.query<{ business_unit: string; business_unit_source: string }>(
        `insert into public.receptions (client_name, business_unit, status)
         values ('__N1B_DECL__','GENERAL','borrador')
         returning business_unit, business_unit_source`,
      );
      expect(rows[0]).toEqual({ business_unit: "GENERAL", business_unit_source: "declared" });
    });
  });

  it("declarar 'ANMAT' ⇒ source='declared'", async () => {
    await withRollback(async () => {
      const { rows } = await client.query<{ business_unit_source: string }>(
        `insert into public.receptions (client_name, business_unit, status)
         values ('__N1B_ANMAT__','ANMAT','borrador')
         returning business_unit_source`,
      );
      expect(rows[0].business_unit_source).toBe("declared");
    });
  });

  it("corregir la BU por UPDATE ⇒ source pasa a 'declared'", async () => {
    await withRollback(async () => {
      const { rows } = await client.query<{ id: string }>(
        `insert into public.receptions (client_name, status)
         values ('__N1B_UPD__','borrador') returning id`,
      );
      const { rows: upd } = await client.query<{ business_unit_source: string }>(
        `update public.receptions set business_unit = 'ANMAT' where id = $1
         returning business_unit_source`,
        [rows[0].id],
      );
      expect(upd[0].business_unit_source).toBe("declared");
    });
  });

  it("des-declarar (UPDATE a NULL) falla cerrado", async () => {
    await withRollback(async () => {
      const { rows } = await client.query<{ id: string }>(
        `insert into public.receptions (client_name, business_unit, status)
         values ('__N1B_DESDECL__','GENERAL','borrador') returning id`,
      );
      await expect(
        client.query(`update public.receptions set business_unit = null where id = $1`, [
          rows[0].id,
        ]),
      ).rejects.toThrow(/no se des-declara|not-null|no admite NULL/i);
    });
  });

  it("el default de la COLUMNA business_unit_source es 'unknown' (población histórica no demostrable)", async () => {
    const { rows } = await client.query<{ column_default: string | null }>(
      `select column_default from information_schema.columns
        where table_schema='public' and table_name='receptions'
          and column_name='business_unit_source'`,
    );
    // Las filas existentes al aplicar 0219 quedaron 'unknown': el default
    // histórico NO es evidencia de decisión (P3-D1 v1.4 · M-03).
    expect(rows[0].column_default).toMatch(/unknown/);
  });

  it("wms_recompute_item_business_unit no es invocable por roles de aplicación", async () => {
    const { rows } = await client.query<{ ok: boolean }>(
      `select has_function_privilege('authenticated',
         'public.wms_recompute_item_business_unit(uuid)', 'execute') as ok`,
    );
    expect(rows[0].ok).toBe(false);
    const { rows: anon } = await client.query<{ ok: boolean }>(
      `select has_function_privilege('anon',
         'public.wms_recompute_item_business_unit(uuid)', 'execute') as ok`,
    );
    expect(anon[0].ok).toBe(false);
  });

  it("las funciones definer de 0219 fijan search_path (public, pg_temp)", async () => {
    const { rows } = await client.query<{ proname: string; proconfig: string[] | null }>(
      `select proname, proconfig from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname='public'
          and proname in ('wms_recompute_item_business_unit','wms_reception_item_bu_projection')
        order by proname`,
    );
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect((r.proconfig ?? []).join(" ")).toMatch(/search_path=public, pg_temp/);
    }
  });
});
