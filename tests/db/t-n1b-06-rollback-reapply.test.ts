/**
 * T-N1B-06 · Ciclo preservador: aplicar → compensar → reaplicar (0219/0220).
 *
 * El runbook se ejecuta contra PostgreSQL 17 real. El caso prueba un estado
 * válido posterior al corte con dos clientes canónicos distintos que comparten
 * client_name, SKU y posición, además de BU declarada/defaulted/unknown,
 * asignaciones y una anomalía durable. La compensación sólo devuelve
 * inventory_items.client_id a nullable: no elimina ni reinterpreta evidencia.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";
import { connectGuarded, startEphemeralCluster, type EphemeralCluster } from "./harness/cluster";
import { loadSchema } from "./harness/schema-loader";
import { WMS_MIGRATION_MANIFEST, MIGRATIONS_DIR } from "./harness/manifest";
import { emitSentinelWhenGreen } from "./harness/sentinel";

const FOUNDATION_FILE = "0219_wms_client_identity_foundation.sql";
const CUTOVER_FILE = "0220_wms_canonical_identity_cutover.sql";
const ROLLBACK_DOC = "ROLLBACK_0219_0220_wms_client_identity.md";

const FOUNDATION_SQL = readFileSync(join(MIGRATIONS_DIR, FOUNDATION_FILE), "utf8");
const CUTOVER_SQL = readFileSync(join(MIGRATIONS_DIR, CUTOVER_FILE), "utf8");

/** Bloques ```sql del documento compensatorio, en orden de aparición. */
function rollbackBlocks(): string[] {
  const doc = readFileSync(join(MIGRATIONS_DIR, ROLLBACK_DOC), "utf8");
  const blocks: string[] = [];
  const re = /```sql\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(doc)) !== null) blocks.push(m[1]);
  return blocks;
}

const WMS_TABLES = [
  "receptions",
  "reception_items",
  "inventory_items",
  "inventory_lots",
  "logistics_orders",
  "stock_allocations",
  "inventory_bu_anomalies",
];

interface Fingerprint {
  cols: Array<Record<string, unknown>>;
  idx: Array<Record<string, unknown>>;
  fns: Array<Record<string, unknown>>;
  tgs: Array<Record<string, unknown>>;
  typ: Array<Record<string, unknown>>;
}

async function fingerprint(c: Client): Promise<Fingerprint> {
  const cols = await c.query(
    `select table_name, column_name, data_type, is_nullable,
            coalesce(column_default, '') as column_default
       from information_schema.columns
      where table_schema = 'public' and table_name = any($1)
      order by table_name, column_name`,
    [WMS_TABLES],
  );
  const idx = await c.query(
    `select indexname, indexdef from pg_indexes
      where schemaname = 'public' and tablename = any($1)
      order by indexname`,
    [WMS_TABLES],
  );
  const fns = await c.query(
    `select proname, md5(prosrc) as src_md5
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and proname in ('allocate_order','confirm_reception',
                        'wms_recompute_item_business_unit',
                        'wms_reception_item_bu_projection',
                        'wms_reception_bu_declaration')
      order by proname`,
  );
  const tgs = await c.query(
    `select c.relname as table_name, t.tgname
       from pg_trigger t join pg_class c on c.oid = t.tgrelid
      where not t.tgisinternal
        and c.relname in ('receptions','reception_items')
      order by c.relname, t.tgname`,
  );
  const typ = await c.query(
    `select t.typname from pg_type t
       join pg_namespace n on n.oid = t.typnamespace
      where n.nspname = 'public' and t.typname = 'bu_declaration_t'`,
  );
  return {
    cols: cols.rows,
    idx: idx.rows,
    fns: fns.rows,
    tgs: tgs.rows,
    typ: typ.rows,
  };
}

/** Normaliza la única diferencia autorizada de la compensación. */
function asCutoverFingerprint(fp: Fingerprint): Fingerprint {
  return {
    ...fp,
    cols: fp.cols.map((row) =>
      row.table_name === "inventory_items" && row.column_name === "client_id"
        ? { ...row, is_nullable: "NO" }
        : row,
    ),
  };
}

let cluster: EphemeralCluster | null = null;
let client: Client;
let baselineClientId = "";
let homonymClientA = "";
let fpCutover: Fingerprint;

async function seedBaseline(): Promise<void> {
  const { rows } = await client.query<{ id: string }>(
    `insert into public.clients (razon, cuit) values ('__N1B6_BASE__','N1B6-BASE') returning id`,
  );
  baselineClientId = rows[0].id;
  await client.query(
    `insert into public.inventory_items (sku, description, client_name) values
       ('__N1B6_BASE_SKU_1__','fila histórica 1','__N1B6_BASE_NOMBRE_1__'),
       ('__N1B6_BASE_SKU_2__','fila histórica 2','__N1B6_BASE_NOMBRE_2__')`,
  );
  await client.query(
    `insert into public.receptions (client_name, business_unit, status)
     values ('__N1B6_BASE_NOMBRE_1__','GENERAL','borrador')`,
  );
  await client.query(
    `insert into public.logistics_orders (client_name, status)
     values ('__N1B6_BASE_NOMBRE_1__','borrador')`,
  );
}

/** Simula la resolución administrativa, sin inferir por nombre. */
async function resolveBaseline(): Promise<void> {
  await client.query(`update public.inventory_items set client_id = $1 where client_id is null`, [
    baselineClientId,
  ]);
  await client.query(`update public.receptions set client_id = $1 where client_id is null`, [
    baselineClientId,
  ]);
  await client.query(`update public.logistics_orders set client_id = $1 where client_id is null`, [
    baselineClientId,
  ]);
}

/**
 * Estado canónico válido que la vieja restauración por nombre no soportaba.
 * Se siembra después del primer corte, cuando la barrera legacy ya no existe.
 */
async function seedCanonicalEvidence(): Promise<void> {
  const { rows: clients } = await client.query<{ id: string; cuit: string }>(
    `insert into public.clients (razon, cuit) values
       ('__N1B6_RAZON_COMPARTIDA__','N1B6-HOM-A'),
       ('__N1B6_RAZON_COMPARTIDA__','N1B6-HOM-B')
     returning id, cuit`,
  );
  homonymClientA = clients.find((row) => row.cuit === "N1B6-HOM-A")!.id;
  const homonymClientB = clients.find((row) => row.cuit === "N1B6-HOM-B")!.id;

  const { rows: positions } = await client.query<{ id: string }>(
    `select id from public.warehouse_positions order by id limit 1`,
  );
  expect(positions).toHaveLength(1);
  const positionId = positions[0].id;

  const { rows: items } = await client.query<{ id: string; client_id: string }>(
    `insert into public.inventory_items
       (sku, description, client_name, client_id, position_id,
        stock_available, stock_reserved, business_unit)
     values
       ('__N1B6_HOM_SKU__','homónimo A','__N1B6_HOMONIMO__',$1,$3,8,0,'GENERAL'),
       ('__N1B6_HOM_SKU__','homónimo B','__N1B6_HOMONIMO__',$2,$3,9,2,'GENERAL')
     returning id, client_id`,
    [homonymClientA, homonymClientB, positionId],
  );
  const itemA = items.find((row) => row.client_id === homonymClientA)!.id;
  const itemB = items.find((row) => row.client_id === homonymClientB)!.id;

  const { rows: recDeclared } = await client.query<{ id: string }>(
    `insert into public.receptions
       (client_name, client_id, business_unit, status, notes)
     values ('__N1B6_HOMONIMO__',$1,'GENERAL','pendiente','declared-A')
     returning id`,
    [homonymClientA],
  );
  const { rows: recDefaulted } = await client.query<{ id: string }>(
    `insert into public.receptions (client_name, client_id, status, notes)
     values ('__N1B6_HOMONIMO__',$1,'pendiente','defaulted-B') returning id`,
    [homonymClientB],
  );
  const { rows: recAnmat } = await client.query<{ id: string }>(
    `insert into public.receptions
       (client_name, client_id, business_unit, status, notes)
     values ('__N1B6_HOMONIMO__',$1,'ANMAT','pendiente','declared-anomaly-A')
     returning id`,
    [homonymClientA],
  );

  await client.query(
    `insert into public.reception_items
       (reception_id, sku, description, quantity, inventory_item_id)
     values ($1,'__N1B6_HOM_SKU__','línea GENERAL A',1,$2)`,
    [recDeclared[0].id, itemA],
  );
  await client.query(
    `insert into public.reception_items
       (reception_id, sku, description, quantity, inventory_item_id)
     values ($1,'__N1B6_HOM_SKU__','línea GENERAL B',1,$2)`,
    [recDefaulted[0].id, itemB],
  );
  await client.query(
    `insert into public.reception_items
       (reception_id, sku, description, quantity, lot_number, expiration_date,
        inventory_item_id)
     values ($1,'__N1B6_HOM_SKU__','línea ANMAT A',1,'N1B6-LOT','2031-01-01',$2)`,
    [recAnmat[0].id, itemA],
  );

  const { rows: orders } = await client.query<{ id: string }>(
    `insert into public.logistics_orders
       (client_name, client_id, business_unit, status, notes)
     values ('__N1B6_HOMONIMO__',$1,'GENERAL','en_preparacion','preservar asignación')
     returning id`,
    [homonymClientB],
  );
  const { rows: lines } = await client.query<{ id: string }>(
    `insert into public.logistics_order_items
       (order_id, sku, description, quantity_requested, status)
     values ($1,'__N1B6_HOM_SKU__','línea asignada',2,'reservado') returning id`,
    [orders[0].id],
  );
  await client.query(
    `insert into public.stock_allocations
       (order_item_id, inventory_item_id, quantity, status, business_unit)
     values ($1,$2,2,'reservada','GENERAL')`,
    [lines[0].id, itemB],
  );
}

/** Snapshot explícito de identidad, BU/procedencia, asignaciones y anomalías. */
async function evidenceSnapshot(): Promise<Record<string, unknown[]>> {
  const items = await client.query(
    `select id, sku, client_name, client_id, position_id, business_unit::text,
            stock_available::text, stock_reserved::text
       from public.inventory_items
      where client_name like '__N1B6%'
        and client_name <> '__N1B6_TRANSICIONAL__'
      order by client_name, sku, client_id, id`,
  );
  const receptions = await client.query(
    `select id, client_name, client_id, business_unit::text,
            business_unit_source::text, status::text, notes
       from public.receptions
      where client_name like '__N1B6%'
      order by client_name, id`,
  );
  const receptionItems = await client.query(
    `select ri.id, ri.reception_id, ri.inventory_item_id, ri.business_unit::text,
            ri.sku, ri.status::text
       from public.reception_items ri
       join public.receptions r on r.id = ri.reception_id
      where r.client_name like '__N1B6%'
      order by ri.id`,
  );
  const orders = await client.query(
    `select id, client_name, client_id, business_unit::text, status::text, notes
       from public.logistics_orders
      where client_name like '__N1B6%'
      order by client_name, id`,
  );
  const orderItems = await client.query(
    `select li.id, li.order_id, li.sku, li.quantity_requested::text, li.status::text
       from public.logistics_order_items li
       join public.logistics_orders o on o.id = li.order_id
      where o.client_name like '__N1B6%'
      order by li.id`,
  );
  const allocations = await client.query(
    `select sa.id, sa.order_item_id, sa.inventory_item_id, sa.quantity::text,
            sa.status::text, sa.business_unit::text
       from public.stock_allocations sa
       join public.logistics_order_items li on li.id = sa.order_item_id
       join public.logistics_orders o on o.id = li.order_id
      where o.client_name like '__N1B6%'
      order by sa.id`,
  );
  const anomalies = await client.query(
    `select a.id, a.inventory_item_id, a.kind, a.business_units::text[],
            a.detected_at::text, a.resolved_at::text, a.notes
       from public.inventory_bu_anomalies a
       join public.inventory_items i on i.id = a.inventory_item_id
      where i.client_name like '__N1B6%'
      order by a.id`,
  );
  return {
    items: items.rows,
    receptions: receptions.rows,
    receptionItems: receptionItems.rows,
    orders: orders.rows,
    orderItems: orderItems.rows,
    allocations: allocations.rows,
    anomalies: anomalies.rows,
  };
}

beforeAll(async () => {
  cluster = await startEphemeralCluster();
  client = await connectGuarded(cluster.url);
  const manifest = WMS_MIGRATION_MANIFEST.filter(
    (m) => m !== FOUNDATION_FILE && m !== CUTOVER_FILE,
  );
  await loadSchema(client, manifest);
});

afterAll(async () => {
  await client?.end();
  if (cluster) await cluster.teardown();
});

describe("T-N1B-06 · compensación y reaplicación", () => {
  emitSentinelWhenGreen("P3_N1B_ROLLBACK_REAPPLY_VERIFIED");

  it("el contrato contiene tres bloques preservadores y ninguna restauración destructiva o por nombre", () => {
    const doc = readFileSync(join(MIGRATIONS_DIR, ROLLBACK_DOC), "utf8");
    const blocks = rollbackBlocks();
    expect(blocks).toHaveLength(3);
    expect(blocks[1]).toMatch(/alter column client_id drop not null/i);
    expect(blocks[1]).toMatch(/inventory_items_canonical_identity_uk/);
    expect(blocks[2]).toMatch(/inventory_bu_anomalies/);
    expect(doc).toMatch(/0219 es forward-only/i);
    expect(doc).not.toMatch(/drop\s+(column|table|type)\b/i);
    expect(doc).not.toMatch(/create\s+unique\s+index\s+(if\s+not\s+exists\s+)?inventory_items_identity_uk/i);
    expect(doc).not.toMatch(/where\s+ii\.client_name\s*=\s*v_order\.client_name/i);
    expect(doc).not.toMatch(/create or replace function public\.(confirm_reception|allocate_order)/i);
  });

  it("preserva homónimos canónicos y toda evidencia; G-1 bloquea hasta resolver y la reaplicación converge", async () => {
    await seedBaseline();

    // Fundación idempotente y corte inicialmente fail-closed.
    await client.query(FOUNDATION_SQL);
    await client.query(FOUNDATION_SQL);
    const early = await client.query(CUTOVER_SQL).then(
      () => null,
      (e: unknown) => e as Error,
    );
    expect(early).not.toBeNull();
    expect(early!.message).toMatch(/GATE G-1/);

    await resolveBaseline();
    await client.query(CUTOVER_SQL);
    await seedCanonicalEvidence();

    const evidenceAtCutover = await evidenceSnapshot();
    const homonymItems = (evidenceAtCutover.items as Array<Record<string, unknown>>).filter(
      (row) => row.client_name === "__N1B6_HOMONIMO__" && row.sku === "__N1B6_HOM_SKU__",
    );
    expect(homonymItems).toHaveLength(2);
    expect(new Set(homonymItems.map((row) => row.client_id)).size).toBe(2);
    expect(new Set(homonymItems.map((row) => row.position_id)).size).toBe(1);
    expect(evidenceAtCutover.anomalies).toHaveLength(1);
    expect((evidenceAtCutover.anomalies[0] as Record<string, unknown>).business_units).toEqual([
      "ANMAT",
      "GENERAL",
    ]);
    expect(
      (evidenceAtCutover.receptions as Array<Record<string, unknown>>)
        .map((row) => row.business_unit_source),
    ).toEqual(expect.arrayContaining(["unknown", "declared", "defaulted"]));

    fpCutover = await fingerprint(client);

    // Ejecuta precheck, compensación y poscondición directamente desde el doc.
    for (const block of rollbackBlocks()) await client.query(block);

    const fpCompensated = await fingerprint(client);
    expect(asCutoverFingerprint(fpCompensated)).toEqual(fpCutover);
    expect(await evidenceSnapshot()).toEqual(evidenceAtCutover);

    const { rows: nullable } = await client.query<{ is_nullable: string }>(
      `select is_nullable from information_schema.columns
        where table_schema='public' and table_name='inventory_items' and column_name='client_id'`,
    );
    expect(nullable[0].is_nullable).toBe("YES");

    // La compensación habilita un estado transicional, pero no permite cortar
    // hasta resolverlo administrativamente.
    await client.query(
      `insert into public.inventory_items
         (sku, description, client_name, stock_available)
       values ('__N1B6_TRANS_SKU__','pendiente de resolución','__N1B6_TRANSICIONAL__',0)`,
    );
    const gated = await client.query(CUTOVER_SQL).then(
      () => null,
      (e: unknown) => e as Error,
    );
    expect(gated).not.toBeNull();
    expect(gated!.message).toMatch(/GATE G-1/);

    await client.query(
      `update public.inventory_items set client_id = $1
        where client_name = '__N1B6_TRANSICIONAL__' and client_id is null`,
      [homonymClientA],
    );
    await client.query(CUTOVER_SQL);

    expect(await fingerprint(client)).toEqual(fpCutover);
    expect(await evidenceSnapshot()).toEqual(evidenceAtCutover);
  }, 240_000);

  it("tras reaplicar, allocate_order sigue fail-closed para un pedido sin client_id", async () => {
    await client.query("begin");
    try {
      const { rows: u } = await client.query<{ id: string }>(
        `insert into auth.users (id) values (gen_random_uuid()) returning id`,
      );
      await client.query(`update public.profiles set role = 'admin' where id = $1`, [u[0].id]);
      await client.query(`select set_config('request.jwt.claim.sub', $1, true)`, [u[0].id]);
      const { rows: o } = await client.query<{ id: string }>(
        `insert into public.logistics_orders (client_name, status)
         values ('__N1B6_SMOKE__','pendiente') returning id`,
      );
      await expect(client.query(`select public.allocate_order($1)`, [o[0].id])).rejects.toThrow(
        /sin identidad canónica/,
      );
    } finally {
      await client.query("rollback");
    }
  });
});

