/**
 * T-A0-01 · Esquema cargado, verificado contra el CATÁLOGO REAL.
 *
 * Endurecido tras H-02: antes se comprobaba la mera EXISTENCIA de policies y
 * triggers por nombre, de modo que una policy `FOR SELECT` convertida en
 * `FOR ALL`, con roles ampliados o sin `with_check`, pasaba inadvertida.
 * Ahora se compara la DEFINICIÓN EXACTA —comando, roles, `qual`, `with_check`—
 * normalizada de forma determinista, más grants efectivos, owner, banderas de
 * RLS, y la función/evento/timing/estado de cada trigger.
 *
 * No se consulta `supabase_migrations.schema_migrations` en ningún punto: ese
 * tracker está verificado como no fiel al catálogo. La única autoridad admitida
 * es `information_schema` / `pg_catalog`.
 */

import { afterAll, beforeAll, describe, expect, it, inject } from "vitest";
import { emitSentinelWhenGreen } from "./harness/sentinel";
import { Client } from "pg";
import { connectGuarded } from "./harness/cluster";
import { REQUIRED_OBJECTS, WMS_MIGRATION_MANIFEST } from "./harness/manifest";

let client: Client;

beforeAll(async () => {
  client = await connectGuarded(inject("dbUrl"));
});

afterAll(async () => {
  await client?.end();
});

/**
 * Normaliza una expresión de PostgreSQL de forma determinista para poder
 * compararla: colapsa espacios, elimina los casts `::text`/`::name` que el
 * planner agrega, y unifica mayúsculas.
 */
export function normalizeExpr(expr: string | null): string | null {
  if (expr === null) return null;
  return expr
    .replace(/::(text|name|character varying|bpchar)\b/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

interface PolicyRow {
  schemaname: string;
  tablename: string;
  policyname: string;
  cmd: string;
  roles: string[];
  qual: string | null;
  with_check: string | null;
  permissive: string;
}

/** Definición EXACTA esperada de cada policy de las tablas de stock. */
const EXPECTED_POLICIES: ReadonlyArray<{
  table: string;
  policy: string;
  cmd: string;
  roles: string[];
  qual: string | null;
  withCheck: string | null;
}> = [
  {
    table: "inventory_items",
    policy: "inventory_items read",
    cmd: "SELECT",
    roles: ["public"],
    qual: "(auth.role() = 'authenticated')",
    withCheck: null,
  },
  {
    table: "inventory_lots",
    policy: "inventory_lots read",
    cmd: "SELECT",
    roles: ["public"],
    qual: "(auth.role() = 'authenticated')",
    withCheck: null,
  },
  {
    table: "inventory_movements",
    policy: "inventory_movements read",
    cmd: "SELECT",
    roles: ["public"],
    qual: "(auth.role() = 'authenticated')",
    withCheck: null,
  },
  {
    table: "stock_allocations",
    policy: "stock_allocations read",
    cmd: "SELECT",
    roles: ["public"],
    qual: "(auth.role() = 'authenticated')",
    withCheck: null,
  },
];

const STOCK_TABLES = EXPECTED_POLICIES.map((p) => p.table);

describe("T-A0-01 · esquema cargado (autoridad: catálogo)", () => {
  emitSentinelWhenGreen("P3_N1A0_SCHEMA_LOAD_PASS");

  it("aplicó exactamente el manifiesto versionado", () => {
    expect(inject("migrationsApplied")).toEqual([...WMS_MIGRATION_MANIFEST]);
  });

  it("el servidor es PostgreSQL 17", () => {
    const v = inject("serverVersionNum");
    expect(v).toBeGreaterThanOrEqual(170_000);
    expect(v).toBeLessThan(180_000);
  });

  it("las tablas del dominio existen", async () => {
    const { rows } = await client.query<{ table_name: string }>(
      `select table_name from information_schema.tables
        where table_schema = 'public' and table_name = any($1)`,
      [[...REQUIRED_OBJECTS.tables]],
    );
    expect(rows.map((r) => r.table_name).sort()).toEqual([...REQUIRED_OBJECTS.tables].sort());
  });

  it("inventory_items tiene la forma productiva verificada", async () => {
    const { rows } = await client.query<{ column_name: string; is_nullable: string }>(
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
    expect(rows.find((r) => r.column_name === "client_name")?.is_nullable).toBe("NO");
    const names = rows.map((r) => r.column_name);
    expect(names).not.toContain("client_id");
    expect(names).not.toContain("business_unit");
  });

  it.each(Object.entries(REQUIRED_OBJECTS.enums))("el enum %s tiene sus etiquetas", async (t, labels) => {
    const { rows } = await client.query<{ enumlabel: string }>(
      `select e.enumlabel from pg_type t join pg_enum e on e.enumtypid = t.oid
        where t.typname = $1 order by e.enumsortorder`,
      [t],
    );
    expect(rows.map((r) => r.enumlabel)).toEqual([...labels]);
  });

  // ── H-02: policies, comparadas por DEFINICIÓN, no por existencia ────────

  it("las tablas de stock tienen EXACTAMENTE una policy, con la definición esperada", async () => {
    const { rows } = await client.query<PolicyRow>(
      `select schemaname, tablename, policyname, cmd,
              array(select unnest(roles)::text) as roles,
              qual, with_check, permissive
         from pg_policies where schemaname = 'public' and tablename = any($1)
        order by tablename, policyname`,
      [STOCK_TABLES],
    );

    // Cantidad exacta: una policy por tabla. Una policy extra rompe acá.
    expect(rows).toHaveLength(EXPECTED_POLICIES.length);

    for (const expected of EXPECTED_POLICIES) {
      const got = rows.find((r) => r.tablename === expected.table);
      expect(got, `falta policy en ${expected.table}`).toBeDefined();
      expect(got!.schemaname).toBe("public");
      expect(got!.policyname).toBe(expected.policy);
      // Comando: SELECT ≠ ALL. Es el mutante que la revisión exigió detectar.
      expect(got!.cmd, `comando de ${expected.table}`).toBe(expected.cmd);
      expect(got!.permissive).toBe("PERMISSIVE");
      expect(got!.roles, `roles de ${expected.table}`).toEqual(expected.roles);
      expect(normalizeExpr(got!.qual), `qual de ${expected.table}`).toBe(
        normalizeExpr(expected.qual),
      );
      expect(normalizeExpr(got!.with_check), `with_check de ${expected.table}`).toBe(
        normalizeExpr(expected.withCheck),
      );
    }
  });

  it("ninguna policy de stock referencia scoping por tenant (estado vigente, honesto)", async () => {
    // Documenta el estado REAL: la RLS restringe por rol autenticado, NO aísla
    // por cliente. No debe afirmarse aislamiento tenant-aware que no existe.
    const { rows } = await client.query<PolicyRow>(
      `select tablename, policyname, qual, with_check from pg_policies
        where schemaname = 'public' and tablename = any($1)`,
      [STOCK_TABLES],
    );
    for (const r of rows) {
      const expr = `${r.qual ?? ""} ${r.with_check ?? ""}`.toLowerCase();
      expect(expr).not.toMatch(/profiles/);
      expect(expr).not.toMatch(/client_id/);
      expect(expr).not.toMatch(/client_name/);
      expect(expr).not.toMatch(/auth\.uid/);
    }
  });

  it("RLS habilitada, y `force` en su estado vigente", async () => {
    const { rows } = await client.query<{
      relname: string;
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
      owner: string;
    }>(
      `select c.relname, c.relrowsecurity, c.relforcerowsecurity,
              pg_get_userbyid(c.relowner) as owner
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relname = any($1)`,
      [STOCK_TABLES],
    );
    expect(rows).toHaveLength(STOCK_TABLES.length);
    for (const r of rows) {
      expect(r.relrowsecurity, `${r.relname}.relrowsecurity`).toBe(true);
      // El esquema productivo NO usa FORCE: el owner bypasea RLS. Se deja
      // asentado como fotografía, no como aprobación.
      expect(r.relforcerowsecurity, `${r.relname}.relforcerowsecurity`).toBe(false);
      expect(r.owner).toBe("postgres");
    }
  });

  it("grants efectivos: anon/authenticated conservan privilegios; RLS es la barrera", async () => {
    // Reproduce el default de Supabase. Si estos grants faltaran, una consulta
    // como `anon` fallaría por privilegio y no por policy: falso PASS de RLS.
    const { rows } = await client.query<{ grantee: string; privilege_type: string }>(
      `select grantee, privilege_type from information_schema.role_table_grants
        where table_schema = 'public' and table_name = 'inventory_items'
          and grantee in ('anon','authenticated')`,
    );
    for (const role of ["anon", "authenticated"]) {
      const privs = rows.filter((r) => r.grantee === role).map((r) => r.privilege_type);
      expect(privs, `grants de ${role}`).toContain("SELECT");
      expect(privs, `grants de ${role}`).toContain("INSERT");
      expect(privs, `grants de ${role}`).toContain("UPDATE");
      expect(privs, `grants de ${role}`).toContain("DELETE");
    }
  });

  // ── funciones, triggers y constraints: definición exacta ────────────────

  it("las funciones existen con el SECURITY DEFINER que corresponde", async () => {
    const { rows } = await client.query<{ proname: string; prosecdef: boolean; cfg: string | null }>(
      `select p.proname, p.prosecdef, array_to_string(p.proconfig, ',') as cfg
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = any($1)`,
      [[...REQUIRED_OBJECTS.functions]],
    );
    expect(rows.map((r) => r.proname).sort()).toEqual([...REQUIRED_OBJECTS.functions].sort());

    for (const w of ["confirm_reception", "confirm_movement", "allocate_order", "confirm_dispatch"]) {
      const fn = rows.find((r) => r.proname === w)!;
      expect(fn.prosecdef, `${w} debe ser SECURITY DEFINER`).toBe(true);
      expect(fn.cfg, `${w} debe fijar search_path`).toMatch(/search_path/);
    }
    // El guard del ledger NO debe ser definer: corre con los privilegios del
    // invocante y aun así bloquea a todos.
    expect(
      (
        await client.query<{ prosecdef: boolean }>(
          `select prosecdef from pg_proc p join pg_namespace n on n.oid=p.pronamespace
            where n.nspname='public' and p.proname='prevent_inventory_movement_mutation'`,
        )
      ).rows[0].prosecdef,
    ).toBe(false);
  });

  it("los triggers tienen función, evento, timing y estado exactos", async () => {
    const { rows } = await client.query<{
      tgname: string;
      table_name: string;
      func: string;
      tgtype: number;
      tgenabled: string;
    }>(
      `select t.tgname, c.relname as table_name, p.proname as func, t.tgtype, t.tgenabled
         from pg_trigger t
         join pg_class c on c.oid = t.tgrelid
         join pg_proc p on p.oid = t.tgfoid
        where not t.tgisinternal and t.tgname = any($1)`,
      [[...REQUIRED_OBJECTS.triggers]],
    );
    expect(rows.map((r) => r.tgname).sort()).toEqual([...REQUIRED_OBJECTS.triggers].sort());

    const byName = Object.fromEntries(rows.map((r) => [r.tgname, r]));

    // Inmutabilidad del ledger: BEFORE (bit 1) UPDATE (bit 16) + DELETE (bit 8), por fila (bit 1).
    const imm = byName["trg_inventory_movements_immutable"];
    expect(imm.table_name).toBe("inventory_movements");
    expect(imm.func).toBe("prevent_inventory_movement_mutation");
    expect(imm.tgenabled).toBe("O"); // habilitado en modo origin
    expect(imm.tgtype & 1).toBe(1); // ROW
    expect(imm.tgtype & 2).toBe(2); // BEFORE
    expect(imm.tgtype & 8).toBe(8); // DELETE
    expect(imm.tgtype & 16).toBe(16); // UPDATE

    const trunc = byName["trg_inventory_movements_no_truncate"];
    expect(trunc.func).toBe("prevent_inventory_movement_mutation");
    expect(trunc.tgtype & 1).toBe(0); // STATEMENT, no ROW
    expect(trunc.tgtype & 32).toBe(32); // TRUNCATE
    expect(trunc.tgenabled).toBe("O");

    expect(byName["trg_reception_item_bu"].func).toBe("sync_reception_item_business_unit");
    expect(byName["trg_reception_cascade_bu"].func).toBe("cascade_reception_business_unit");
  });

  it("el CHECK ANMAT tiene la definición exacta", async () => {
    const { rows } = await client.query<{ def: string; conrelid: string }>(
      `select pg_get_constraintdef(c.oid) as def, r.relname as conrelid
         from pg_constraint c join pg_class r on r.oid = c.conrelid
        where c.conname = 'reception_items_anmat_lot_chk'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].conrelid).toBe("reception_items");
    const def = normalizeExpr(rows[0].def)!;
    expect(def).toContain("business_unit <> 'anmat'");
    expect(def).toContain("lot_number is not null");
    expect(def).toContain("expiration_date is not null");
  });

  it("los índices de identidad existen y NO usan NULLS NOT DISTINCT", async () => {
    const { rows } = await client.query<{ indexname: string; indexdef: string }>(
      `select indexname, indexdef from pg_indexes
        where schemaname = 'public' and indexname = any($1)`,
      [[...REQUIRED_OBJECTS.indexes]],
    );
    expect(rows.map((r) => r.indexname).sort()).toEqual([...REQUIRED_OBJECTS.indexes].sort());
    // Fotografía del defecto M-1 tal como está HOY. P3-N1B deberá invertirla.
    for (const r of rows) expect(r.indexdef).not.toMatch(/NULLS NOT DISTINCT/i);
    expect(rows.find((r) => r.indexname === "inventory_items_identity_uk")!.indexdef).toMatch(
      /\(client_name, sku, position_id\)/,
    );
  });
});
