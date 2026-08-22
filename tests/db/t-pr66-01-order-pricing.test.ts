/**
 * T-PR66-01 · PostgreSQL 17 REAL para FASE A de OC y Ordenes de Servicio.
 *
 * Prueba las migraciones productivas sin reescribirlas: precios pendientes,
 * resumen canonico, conciliacion, tarifario versionado, almacenamiento
 * A COTIZAR, moneda explicita, snapshots y rollback logico de `m2`.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Client } from "pg";
import {
  connectGuarded,
  startEphemeralCluster,
  type EphemeralCluster,
} from "./harness/cluster";

const ROOT = resolve(__dirname, "..", "..");
const MIGRATIONS = resolve(ROOT, "supabase", "migrations");
const BOOTSTRAP = resolve(ROOT, "tests", "db", "bootstrap", "00-platform-stub.sql");
const ADMIN = "11111111-1111-4111-8111-111111111111";
const NO_PROFILE = "77777777-7777-4777-8777-777777777777";
const NO_PROFILE_WITH_GRANTS = "88888888-8888-4888-8888-888888888888";
const NO_ROLES = "99999999-9999-4999-8999-999999999999";
const WRONG_ROLE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PO_SIGNATURE = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

const BASE_FILES = [
  "0001_init.sql",
  "0002_seed.sql",
  "0003_storage.sql",
  "0004_extended_schema.sql",
  "0005_fix_rls_recursion.sql",
  "0006_real_operators.sql",
  "0007_extend_service_units.sql",
  "0008_purchase_orders.sql",
  "0009_rbac.sql",
  "0010_documents.sql",
  "0011_arca_billing.sql",
  "0013_invoices_storage_isolation.sql",
  "0014_supplier_invoices.sql",
  "0015_supplier_invoice_attachments.sql",
  "0021_wms_permission_module.sql",
  "0022_wms_rbac_seed.sql",
  "0097_recon_schema.sql",
  "0240_clientes_permission_module.sql",
  "0241_clients_native_master.sql",
  "0242_clients_atomic_mutations.sql",
] as const;

let cluster: EphemeralCluster;
let db: Client;
let vendorId: string;
let clientId: string;
let purchaseOrderId: string;
let serviceOrderId: string;
let serviceLineId: string;
let operatorId: string;

async function apply(file: string): Promise<void> {
  await db.query(readFileSync(resolve(MIGRATIONS, file), "utf8"));
}

async function applyTo(target: Client, file: string): Promise<void> {
  await target.query(readFileSync(resolve(MIGRATIONS, file), "utf8"));
}

async function asAuthenticated<T>(fn: () => Promise<T>): Promise<T> {
  await db.query("set role authenticated");
  try {
    return await fn();
  } finally {
    await db.query("reset role");
  }
}

async function asServiceRole<T>(fn: () => Promise<T>): Promise<T> {
  await db.query("select set_config('request.jwt.claim.role','service_role',false)");
  await db.query("set role service_role");
  try {
    return await fn();
  } finally {
    await db.query("reset role");
    await db.query("select set_config('request.jwt.claim.role','authenticated',false)");
  }
}

async function asIdentity<T>(
  uid: string | null,
  role: "authenticated" | "anon",
  fn: () => Promise<T>,
): Promise<T> {
  await db.query("begin");
  await db.query("select set_config('request.jwt.claim.sub',$1,true)", [uid ?? ""]);
  await db.query("select set_config('request.jwt.claim.role',$1,true)", [role]);
  await db.query("select set_config('request.jwt.claims',$1,true)", [
    JSON.stringify({ ...(uid ? { sub: uid } : {}), role }),
  ]);
  await db.query(`set local role ${role}`);
  try {
    return await fn();
  } finally {
    await db.query("rollback");
  }
}

async function errorOf(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return "";
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

const EFFECT_TABLES = [
  ["public", "clients"], ["public", "client_events"],
  ["public", "purchase_orders"], ["public", "po_items"],
  ["public", "po_events"], ["public", "po_price_events"],
  ["public", "po_email_sends"], ["public", "po_signature_evidence"],
  ["public", "orders"], ["public", "order_services"],
  ["public", "service_tariff_versions"], ["public", "service_tariff_rates"],
  ["public", "client_service_rates"], ["public", "service_order_events"],
  ["public", "service_order_billing_adjustments"], ["public", "email_sends"],
  ["public", "service_order_signatures"], ["public", "audit_log"],
  ["storage", "objects"],
] as const;

async function effectDigest(): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const [schema, table] of EFFECT_TABLES) {
    const { rows } = await db.query<{ digest: string }>(`
      select count(*)::text || ':' ||
             md5(coalesce(string_agg(to_jsonb(t)::text, '|' order by to_jsonb(t)::text), '')) digest
        from ${schema}.${table} t
    `);
    result[`${schema}.${table}`] = rows[0].digest;
  }
  return result;
}

async function pricingTokens(serviceSlug: string): Promise<{
  versionId: string;
  tariffRateId: string;
  clientRateId: string | null;
}> {
  const result = await db.query<{
    version_id: string;
    tariff_rate_id: string;
    client_rate_id: string | null;
  }>(`
    select v.id version_id, r.id tariff_rate_id,
           (select c.id from public.client_service_rates c
             where c.client_id=$2 and c.service_slug=$1
               and c.valid_from <= clock_timestamp()
               and (c.valid_to is null or c.valid_to > clock_timestamp())
             order by c.valid_from desc limit 1) client_rate_id
      from public.service_tariff_versions v
      join public.service_tariff_rates r on r.version_id=v.id and r.service_slug=$1
     where v.status in ('active','superseded')
       and v.effective_from <= clock_timestamp()
       and (v.effective_to is null or v.effective_to > clock_timestamp())
  `, [serviceSlug, clientId]);
  if (result.rows.length !== 1) throw new Error(`pricing tokens unavailable for ${serviceSlug}`);
  return {
    versionId: result.rows[0].version_id,
    tariffRateId: result.rows[0].tariff_rate_id,
    clientRateId: result.rows[0].client_rate_id,
  };
}

function pricedLine(
  serviceSlug: string,
  tokens: { tariffRateId: string; clientRateId: string | null },
  qtyRequested = 1,
) {
  return {
    pricing_kind: "catalog",
    service_slug: serviceSlug,
    qty_requested: qtyRequested,
    expected_tariff_rate_id: tokens.tariffRateId,
    expected_client_rate_id: tokens.clientRateId,
  };
}

function transportLine(
  serviceSlug: string,
  tokens: { tariffRateId: string; clientRateId: string | null },
  qtyRequested = 1,
) {
  return {
    ...pricedLine(serviceSlug, tokens, qtyRequested),
    pricing_kind: "transport",
    second_trip_discount: false,
    surcharge: "none",
  };
}

interface TariffRatePayload {
  service_slug: string;
  label: string;
  category: string;
  unit: string;
  rate: number | null;
  min_qty: number;
  min_billing: number;
  requires_quote: boolean;
  metadata: Record<string, unknown>;
}

async function completeTariffRates(
  target: Client,
  overrides: TariffRatePayload[],
): Promise<TariffRatePayload[]> {
  const current = await target.query<TariffRatePayload>(`
    select r.service_slug, r.label, r.category, r.unit::text unit,
           r.rate::float8 rate, r.min_qty::float8 min_qty,
           r.min_billing::float8 min_billing, r.requires_quote, r.metadata
      from public.service_tariff_versions v
      join public.service_tariff_rates r on r.version_id=v.id
     where v.status='active'
     order by r.service_slug
  `);
  const replacement = new Map(overrides.map((rate) => [rate.service_slug, rate]));
  const complete = current.rows.map((rate) => replacement.get(rate.service_slug) ?? rate);
  for (const rate of overrides) {
    if (!current.rows.some((candidate) => candidate.service_slug === rate.service_slug)) {
      complete.push(rate);
    }
  }
  return complete;
}

beforeAll(async () => {
  cluster = await startEphemeralCluster();
  db = await connectGuarded(cluster.url);
  await db.query(readFileSync(BOOTSTRAP, "utf8"));
  for (const file of BASE_FILES) await apply(file);
  await db.query(`
    create or replace function public.ai_docs_redact(p text)
    returns text language sql immutable as $$ select p $$;
  `);
  await apply("0243_purchase_order_price_lifecycle.sql");
  await apply("0244_service_order_pricing_lifecycle.sql");
  await apply("20260815002748_service_unit_m2.sql");
  await apply("20260815002807_service_tariff_m2_rates.sql");

  await db.query(
    `insert into auth.users(id,email,raw_user_meta_data)
     values ($1,'joseluis@logisticatops.com','{"full_name":"Perfil mutable PR66"}')`,
    [ADMIN],
  );
  await db.query("update public.profiles set role='admin' where id=$1", [ADMIN]);
  await db.query(
    `insert into public.user_roles(user_id,role_id,position_title)
     select $1,id,'Administrador de prueba' from public.roles where slug='admin'`,
    [ADMIN],
  );
  await db.query(`
    insert into public.role_permissions(role_id,permission_id)
    select r.id,p.id from public.roles r join public.permissions p on p.slug='compras.sign'
    where r.slug='admin' on conflict do nothing
  `);
  await db.query(
    `insert into auth.users(id,email,raw_user_meta_data) values
       ($1,'sin-perfil@example.test','{}'),
       ($2,'sin-perfil-con-grants@example.test','{}'),
       ($3,'sin-roles@example.test','{}'),
       ($4,'rol-vacio@example.test','{}')`,
    [NO_PROFILE, NO_PROFILE_WITH_GRANTS, NO_ROLES, WRONG_ROLE],
  );
  await db.query("delete from public.profiles where id=any($1::uuid[])", [
    [NO_PROFILE, NO_PROFILE_WITH_GRANTS],
  ]);
  await db.query(`
    insert into public.roles(slug,name) values
      ('phase_a_all','FASE A test grants'),('phase_a_empty','FASE A sin permisos');
    insert into public.role_permissions(role_id,permission_id)
    select r.id,p.id from public.roles r join public.permissions p
      on p.slug in (
        'compras.create','compras.sign','compras.edit',
        'servicios.create','servicios.sign','servicios.edit'
      )
     where r.slug='phase_a_all';
  `);
  await db.query(
    "insert into public.user_roles(user_id,role_id) select $1,id from public.roles where slug='phase_a_all'",
    [NO_PROFILE_WITH_GRANTS],
  );
  await db.query(
    "insert into public.user_roles(user_id,role_id) select $1,id from public.roles where slug='phase_a_empty'",
    [WRONG_ROLE],
  );
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [ADMIN]);
  await db.query("select set_config('request.jwt.claim.role','authenticated',false)");
  await db.query("select set_config('request.jwt.claims',$1,false)", [
    JSON.stringify({ sub: ADMIN, role: "authenticated", email: "joseluis@logisticatops.com" }),
  ]);

  vendorId = (
    await db.query<{ id: string }>(
      `insert into public.vendors(razon,cuit)
       values ('Proveedor PR66','30-70000001-5') returning id`,
    )
  ).rows[0].id;
  clientId = (
    await db.query<{ id: string }>(
      `insert into public.clients(razon,cuit,activo)
       values ('Cliente PR66','30-71181219-5',true) returning id`,
    )
  ).rows[0].id;
  operatorId = (
    await db.query<{ id: string }>(
      "select id from public.operators where active order by full_name limit 1",
    )
  ).rows[0].id;
}, 300_000);

afterAll(async () => {
  await db?.end();
  await cluster?.teardown();
});

describe("T-PR66-01 · identidad incompleta y ACL fail-closed", () => {
  const calls: Array<{ name: string; sql: string; params: unknown[] }> = [
    { name: "purchase_order_issue", sql: "select public.purchase_order_issue('{}'::jsonb,'[]'::jsonb)", params: [] },
    {
      name: "po_reconcile_prices",
      sql: "select public.po_reconcile_prices($1,$2,'[]'::jsonb,'frontera de identidad')",
      params: ["bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "cccccccc-cccc-4ccc-8ccc-cccccccccccc"],
    },
    { name: "service_order_issue", sql: "select public.service_order_issue('{}'::jsonb,'[]'::jsonb)", params: [] },
    {
      name: "service_order_record_fulfillment",
      sql: "select public.service_order_record_fulfillment($1,1,'frontera de identidad')",
      params: ["dddddddd-dddd-4ddd-8ddd-dddddddddddd"],
    },
    {
      name: "service_order_adjust_billing",
      sql: "select public.service_order_adjust_billing($1,1,1,'frontera de identidad')",
      params: ["dddddddd-dddd-4ddd-8ddd-dddddddddddd"],
    },
    {
      name: "service_tariff_publish",
      sql: "select public.service_tariff_publish('DENIED','ARS',current_date,'fuente aprobada','frontera de identidad','[]'::jsonb)",
      params: [],
    },
    {
      name: "client_service_rate_set",
      sql: "select public.client_service_rate_set($1,'peon','ARS',1,0,0,current_date,'frontera de identidad')",
      params: ["eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"],
    },
  ];

  it("deniega las siete RPC antes de cualquier efecto y conserva un control verdadero", async () => {
    const before = await effectDigest();
    const helperNull = await asIdentity(NO_PROFILE, "authenticated", async () => (
      await db.query<{ allowed: boolean | null }>(
        "select public.has_permission('fasea.permission.inexistente') allowed",
      )
    ).rows[0].allowed);
    const helperFalse = await asIdentity(NO_ROLES, "authenticated", async () => (
      await db.query<{ allowed: boolean | null }>(
        "select public.has_permission('fasea.permission.inexistente') allowed",
      )
    ).rows[0].allowed);
    const residualGrant = await asIdentity(NO_PROFILE_WITH_GRANTS, "authenticated", async () => (
      await db.query<{ allowed: boolean }>(
        "select public.has_permission('servicios.edit') allowed",
      )
    ).rows[0].allowed);
    const positive = await asIdentity(ADMIN, "authenticated", async () => (
      await db.query<{ compras: boolean; servicios: boolean }>(`
        select public.has_permission('compras.edit') compras,
               public.has_permission('servicios.edit') servicios
      `)
    ).rows[0]);
    expect(helperNull).toBeNull();
    expect(helperFalse).toBe(false);
    expect(residualGrant).toBe(true);
    expect(positive).toEqual({ compras: true, servicios: true });

    for (const rpc of calls) {
      const noUid = await asIdentity(null, "authenticated", () => errorOf(() => db.query(rpc.sql, rpc.params)));
      expect(noUid, `${rpc.name}:auth.uid NULL`).toMatch(/identidad|auth requerida/i);

      for (const uid of [NO_PROFILE, NO_PROFILE_WITH_GRANTS]) {
        const noProfile = await asIdentity(uid, "authenticated", () =>
          errorOf(() => db.query(rpc.sql, rpc.params)));
        expect(noProfile, `${rpc.name}:sin perfil`).toMatch(/perfil/i);
      }

      for (const uid of [NO_ROLES, WRONG_ROLE]) {
        const noPermission = await asIdentity(uid, "authenticated", () =>
          errorOf(() => db.query(rpc.sql, rpc.params)));
        expect(noPermission, `${rpc.name}:permiso falso`).toMatch(/permiso/i);
      }

      const anon = await asIdentity(ADMIN, "anon", () => errorOf(() => db.query(rpc.sql, rpc.params)));
      expect(anon, `${rpc.name}:anon`).toMatch(/permission denied/i);
    }

    expect(await effectDigest()).toEqual(before);
  });

  it("materializa ACL mínimas para cada SECURITY DEFINER declarado por FASE A", async () => {
    const sourceFiles = [
      "0241_clients_native_master.sql",
      "0242_clients_atomic_mutations.sql",
      "0243_purchase_order_price_lifecycle.sql",
      "0244_service_order_pricing_lifecycle.sql",
    ];
    const sources = sourceFiles.map((file) => readFileSync(resolve(MIGRATIONS, file), "utf8"));
    const { rows } = await db.query<{
      proname: string; prosrc: string; result_type: string; config: string[] | null;
    }>(`
      select p.proname,p.prosrc,p.prorettype::regtype::text result_type,p.proconfig config
        from pg_proc p join pg_namespace n on n.oid=p.pronamespace
       where n.nspname='public' and p.prosecdef
       order by p.proname
    `);
    const phaseFunctions = rows.filter((row) => sources.some((source) =>
      new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${row.proname}\\s*\\(`, "i")
        .test(source)));
    expect(phaseFunctions.length).toBeGreaterThan(0);

    for (const fn of phaseFunctions) {
      expect(fn.config?.join(" "), `${fn.proname}:search_path`).toMatch(/search_path=/);
      const grants = await db.query<{ grantee: string }>(
        `select distinct grantee from information_schema.routine_privileges
          where routine_schema='public' and routine_name=$1
            and grantee in ('PUBLIC','anon','authenticated','service_role')
          order by grantee`,
        [fn.proname],
      );
      const expected = fn.result_type === "trigger"
        ? []
        : /public\.has_permission\s*\(/i.test(fn.prosrc)
          ? ["authenticated"]
          : /auth\.role\s*\(\s*\)/i.test(fn.prosrc)
            ? ["service_role"]
            : [];
      expect(grants.rows.map((row) => row.grantee), `${fn.proname}:ACL`).toEqual(expected);
    }
  });
});

describe("T-PR66-01 · OC pendiente y conciliacion real", () => {
  const lines = [
    { label: "Conocido", unit: "un", qty: 2, price: 100, subtotal: 200, pos: 0, price_state: "known" },
    {
      label: "Pendiente", unit: "un", qty: 1, price: null, subtotal: null, pos: 1,
      price_state: "pending", price_reason: "Proveedor cotiza al despachar",
    },
  ];

  function orderPayload(overrides: Record<string, unknown> = {}) {
    return {
      depot: "MAGALDI", destino: "Agustín Magaldi 1765 · CABA",
      entrega: "Inmediata", categoria: "Insumos", cond_pago: "30 dias", vendor_id: vendorId,
      observ: "Prueba lifecycle", signature_data_url: PO_SIGNATURE,
      ...overrides,
    };
  }

  it("reconstruye el header desde lineas y no inventa importe pendiente", async () => {
    const mismatch = await asAuthenticated(() => errorOf(() => db.query(
      "select public.purchase_order_issue($1::jsonb,$2::jsonb)",
      [JSON.stringify(orderPayload({ neto: 999999, total: 999999, price_state: "known", pending_price_lines: 0 })), JSON.stringify(lines)],
    )));
    expect(mismatch).toMatch(/cabecera económica no admite el claim/i);

    const result = await asAuthenticated(() => db.query<{ result: { id: string } }>(
      "select public.purchase_order_issue($1::jsonb,$2::jsonb) result",
      [JSON.stringify(orderPayload()), JSON.stringify(lines)],
    ));
    purchaseOrderId = result.rows[0].result.id;
    const header = await db.query<{
      price_state: string; neto: string | null; total: string | null;
      known_partial_neto: string; pending_price_lines: number;
    }>(
      `select price_state,neto::text,total::text,known_partial_neto::text,pending_price_lines
       from public.purchase_orders where id=$1`, [purchaseOrderId],
    );
    expect(header.rows[0]).toEqual({
      price_state: "pending", neto: null, total: null,
      known_partial_neto: "200.00", pending_price_lines: 1,
    });
    const items = await db.query<{ state: string; price: string | null; subtotal: string | null }>(
      `select price_state state,price::text,subtotal::text
       from public.po_items where order_id=$1 order by pos`, [purchaseOrderId],
    );
    expect(items.rows).toEqual([
      { state: "known", price: "100.00", subtotal: "200.00" },
      { state: "pending", price: null, subtotal: null },
    ]);
    const events = await db.query<{ kind: string }>(
      "select kind::text kind from public.po_events where order_id=$1 order by id",
      [purchaseOrderId],
    );
    expect(events.rows).toEqual([{ kind: "created" }]);
  });

  it("impide bypass directo y excluye pendientes de metricas reales", async () => {
    const bypass = await asAuthenticated(() => errorOf(() => db.query(
      `insert into public.po_items(order_id,label,qty,price,subtotal,pos)
       values ($1,'Bypass',1,1,1,99)`, [purchaseOrderId],
    )));
    expect(bypass).toMatch(/permission denied/i);
    const analytics = await asAuthenticated(() =>
      db.query("select * from public.ai_supplier_spend_overview('compromiso','todo',10)"));
    expect(analytics.rows).toEqual([]);
  });

  it("concilia con factura real y conserva original, real y diferencia", async () => {
    const invoiceId = (await db.query<{ id: string }>(
      `insert into public.supplier_invoices(
         public_id,vendor_id,purchase_order_id,numero,moneda,neto,iva,total
       ) values ('',$1,$2,'PR66-001','ARS',300,63,363) returning id`,
      [vendorId,purchaseOrderId],
    )).rows[0].id;
    await db.query(
      `insert into public.po_reconciliations(
         purchase_order_id,supplier_invoice_id,initiated_by,score
       ) values ($1,$2,$3,100)`,
      [purchaseOrderId,invoiceId,ADMIN],
    );
    const itemRows = await db.query<{ id: string; price_state: string }>(
      "select id,price_state from public.po_items where order_id=$1 order by pos", [purchaseOrderId],
    );
    const real = itemRows.rows.map((line) => ({
      item_id: line.id, actual_unit_price: line.price_state === "known" ? 110 : 80,
    }));
    await asAuthenticated(() => db.query(
      "select public.po_reconcile_prices($1,$2,$3::jsonb,$4)",
      [purchaseOrderId, invoiceId, JSON.stringify(real), "Factura real recibida"],
    ));
    const linesAfter = await db.query<{ issued: string | null; actual: string; delta: string | null }>(
      `select price::text issued,actual_unit_price::text actual,(actual_unit_price-price)::text delta
       from public.po_items where order_id=$1 order by pos`, [purchaseOrderId],
    );
    expect(linesAfter.rows).toEqual([
      { issued: "100.00", actual: "110.00", delta: "10.00" },
      { issued: null, actual: "80.00", delta: null },
    ]);
  });
});

describe("T-PR66-01 · OS versionada, prestada y facturada", () => {
  it("aprueba precio particular y congela minimo y moneda", async () => {
    const approved = await asAuthenticated(() => db.query<{ id: string }>(
      `select public.client_service_rate_set($1,'peon','ARS',25000,2,null,current_date,$2)::text id`,
      [clientId, "Acuerdo particular vigente"],
    ));
    const replay = await asAuthenticated(() => db.query<{ id: string }>(
      `select public.client_service_rate_set($1,'peon','ARS',25000,2,null,current_date,$2)::text id`,
      [clientId, "Acuerdo particular vigente"],
    ));
    expect(replay.rows[0].id).toBe(approved.rows[0].id);
    expect(Number((await db.query<{ n: string }>(
      "select count(*)::text n from public.audit_log where entity='client_service_rates' and entity_id=$1",
      [approved.rows[0].id],
    )).rows[0].n)).toBe(1);
    const tokens = await pricingTokens("peon");
    const result = await asAuthenticated(() => db.query<{ result: { id: string } }>(
      "select public.service_order_issue($1::jsonb,$2::jsonb) result",
      [JSON.stringify({
        depot: "MAGALDI", client_id: clientId, operator_id: operatorId,
        h_start: "08:00", h_end: "12:00", hours: 4, pallets: 0, units: 0, km: 0,
        signed_by: "Cliente PR66",
        signature_data_url: PO_SIGNATURE, client_total: 50000,
        expected_tariff_version_id: tokens.versionId,
      }), JSON.stringify([pricedLine("peon", tokens)])],
    ));
    serviceOrderId = result.rows[0].result.id;
    const line = await db.query<{
      id: string; source: string; requested: string; effective: string;
      rate: string; subtotal: string; currency: string;
    }>(
      `select id,price_source source,qty_requested::text requested,qty_effective::text effective,
              rate_snapshot::text rate,subtotal_requested::text subtotal,currency_snapshot currency
       from public.order_services where order_id=$1`, [serviceOrderId],
    );
    serviceLineId = line.rows[0].id;
    expect(line.rows[0]).toEqual({
      id: serviceLineId, source: "client_rate", requested: "1.00", effective: "2.00",
      rate: "25000.00", subtotal: "50000.00", currency: "ARS",
    });
  });

  it("mantiene almacenamiento m2 A COTIZAR y rechaza cruce ARS/USD", async () => {
    const storage = await db.query<{ slug: string; rate: string | null; quote: boolean }>(
      `select service_slug slug,rate::text,requires_quote quote from public.service_tariff_rates
       where service_slug in ('alm-general','alm-anmat') order by service_slug`,
    );
    expect(storage.rows).toEqual([
      { slug: "alm-anmat", rate: null, quote: true },
      { slug: "alm-general", rate: null, quote: true },
    ]);
    const longDistance = await db.query<{ slug: string; rate: string | null; quote: boolean }>(
      `select service_slug slug,rate::text,requires_quote quote
         from public.service_tariff_rates
        where service_slug like 'transporte:%:MAS_100'
        order by service_slug`,
    );
    expect(longDistance.rows).toHaveLength(4);
    expect(longDistance.rows.every((row) => row.rate === null && row.quote)).toBe(true);
    await db.query("begin");
    try {
      await asAuthenticated(() => db.query(
        `select public.client_service_rate_set(
           $1,'transporte:semi:MAS_100','ARS',700000,0,0,current_date,$2
         )`,
        [clientId, "Cotización de transporte aprobada"],
      ));
      expect((await pricingTokens("transporte:semi:MAS_100")).clientRateId).toMatch(/^[0-9a-f-]{36}$/);
    } finally {
      await db.query("rollback");
    }
    const signatureRead = await asServiceRole(() => db.query(
      "select 1 from public.service_order_signatures where order_id=$1",
      [serviceOrderId],
    ));
    expect(signatureRead.rowCount).toBe(1);
    const mismatch = await asAuthenticated(() => errorOf(() => db.query(
      `select public.client_service_rate_set($1,'alm-general','USD',10,0,0,current_date,$2)`,
      [clientId, "No convertir monedas"],
    )));
    expect(mismatch).toMatch(/no coincide con el tarifario activo ARS/i);
  });

  it("rechaza A COTIZAR y total divergente sin dejar OS parcial", async () => {
    const before = Number((await db.query<{ n: string }>("select count(*) n from public.orders")).rows[0].n);
    const quoteTokens = await pricingTokens("alm-general");
    const peonTokens = await pricingTokens("peon");
    const base = {
      depot: "MAGALDI", client_id: clientId, operator_id: operatorId,
      h_start: "08:00", h_end: "12:00", hours: 4, pallets: 0, units: 0, km: 0,
      signed_by: "Cliente PR66",
      signature_data_url: PO_SIGNATURE, client_total: 1,
      expected_tariff_version_id: quoteTokens.versionId,
    };
    const quoteError = await asAuthenticated(() => errorOf(() => db.query(
      "select public.service_order_issue($1::jsonb,$2::jsonb)",
      [JSON.stringify(base), JSON.stringify([pricedLine("alm-general", quoteTokens)])],
    )));
    expect(quoteError).toMatch(/requiere cotizacion/i);
    const totalError = await asAuthenticated(() => errorOf(() => db.query(
      "select public.service_order_issue($1::jsonb,$2::jsonb)",
      [JSON.stringify({ ...base, expected_tariff_version_id: peonTokens.versionId }), JSON.stringify([pricedLine("peon", peonTokens)])],
    )));
    expect(totalError).toMatch(/total firmado no coincide/i);
    const missingToken = await asAuthenticated(() => errorOf(() => db.query(
      "select public.service_order_issue($1::jsonb,$2::jsonb)",
      [JSON.stringify({ ...base, expected_tariff_version_id: undefined }), JSON.stringify([pricedLine("peon", peonTokens)])],
    )));
    expect(missingToken).toMatch(/Identidad canónica de OS inválida/i);
    const malformedQty = await asAuthenticated(() => errorOf(() => db.query(
      "select public.service_order_issue($1::jsonb,$2::jsonb)",
      [JSON.stringify({ ...base, expected_tariff_version_id: peonTokens.versionId }), JSON.stringify([{ ...pricedLine("peon", peonTokens), qty_requested: "1" }])],
    )));
    expect(malformedQty).toMatch(/Cantidad solicitada inválida/i);
    const missingRateToken = await asAuthenticated(() => errorOf(() => db.query(
      "select public.service_order_issue($1::jsonb,$2::jsonb)",
      [JSON.stringify({ ...base, expected_tariff_version_id: peonTokens.versionId }), JSON.stringify([{ ...pricedLine("peon", peonTokens), expected_tariff_rate_id: undefined }])],
    )));
    expect(missingRateToken).toMatch(/tarifa del servicio cambio/i);
    for (const clientTotal of [49999.99, 50000.01]) {
      const centMismatch = await asAuthenticated(() => errorOf(() => db.query(
        "select public.service_order_issue($1::jsonb,$2::jsonb)",
        [
          JSON.stringify({
            ...base,
            client_total: clientTotal,
            expected_tariff_version_id: peonTokens.versionId,
          }),
          JSON.stringify([pricedLine("peon", peonTokens)]),
        ],
      )));
      expect(centMismatch).toMatch(/total firmado no coincide/i);
    }
    for (const forgedSignature of [
      { signed_by: { browser: "forged" } },
      { signature_hash: "bad" },
      { observ: { browser: "forged" } },
    ]) {
      const signatureError = await asAuthenticated(() => errorOf(() => db.query(
        "select public.service_order_issue($1::jsonb,$2::jsonb)",
        [
          JSON.stringify({
            ...base,
            ...forgedSignature,
            client_total: 50000,
            expected_tariff_version_id: peonTokens.versionId,
          }),
          JSON.stringify([pricedLine("peon", peonTokens)]),
        ],
      )));
      expect(signatureError).toMatch(/Depósito o firma de OS inválidos/i);
    }
    const corruptedPng = Buffer.from(PO_SIGNATURE.slice("data:image/png;base64,".length), "base64");
    corruptedPng[corruptedPng.length - 5] ^= 0x01;
    for (const signature_data_url of [
      "data:image/png;base64,iVBORw0KGgo=",
      `data:image/png;base64,${corruptedPng.toString("base64")}`,
    ]) {
      const invalidPng = await asAuthenticated(() => errorOf(() => db.query(
        "select public.service_order_issue($1::jsonb,$2::jsonb)",
        [
          JSON.stringify({
            ...base,
            signature_data_url,
            client_total: 50000,
            expected_tariff_version_id: peonTokens.versionId,
          }),
          JSON.stringify([pricedLine("peon", peonTokens)]),
        ],
      )));
      expect(invalidPng).toMatch(/Firma PNG inválida/i);
    }

    const transportA = await pricingTokens("transporte:qubo:CABA");
    const transportB = await pricingTokens("transporte:qubo:40KM");
    const forgedTransport = await asAuthenticated(() => errorOf(() => db.query(
      "select public.service_order_issue($1::jsonb,$2::jsonb)",
      [
        JSON.stringify({ ...base, expected_tariff_version_id: peonTokens.versionId }),
        JSON.stringify([{ ...pricedLine("peon", peonTokens), pricing_kind: "transport" }]),
      ],
    )));
    expect(forgedTransport).toMatch(/Tipo de precio no coincide con el servicio canónico/i);
    const forgedCatalog = await asAuthenticated(() => errorOf(() => db.query(
      "select public.service_order_issue($1::jsonb,$2::jsonb)",
      [
        JSON.stringify({ ...base, expected_tariff_version_id: transportA.versionId }),
        JSON.stringify([pricedLine("transporte:qubo:CABA", transportA)]),
      ],
    )));
    expect(forgedCatalog).toMatch(/Tipo de precio no coincide con el servicio canónico/i);
    const urgent = {
      pricing_kind: "urgent",
      service_slug: "recargo-envio-urgente",
      qty_requested: 1,
    };
    const nonFinalUrgent = await asAuthenticated(() => errorOf(() => db.query(
      "select public.service_order_issue($1::jsonb,$2::jsonb)",
      [
        JSON.stringify({ ...base, expected_tariff_version_id: transportA.versionId }),
        JSON.stringify([
          transportLine("transporte:qubo:CABA", transportA),
          urgent,
          transportLine("transporte:qubo:40KM", transportB),
        ]),
      ],
    )));
    expect(nonFinalUrgent).toMatch(/Recargo urgente sin transporte previo/i);
    const duplicateUrgent = await asAuthenticated(() => errorOf(() => db.query(
      "select public.service_order_issue($1::jsonb,$2::jsonb)",
      [
        JSON.stringify({ ...base, expected_tariff_version_id: transportA.versionId }),
        JSON.stringify([transportLine("transporte:qubo:CABA", transportA), urgent, urgent]),
      ],
    )));
    expect(duplicateUrgent).toMatch(/Recargo urgente sin transporte previo/i);

    await db.query("begin");
    try {
      const validTransport = await asAuthenticated(() => db.query<{ result: { id: string } }>(
        "select public.service_order_issue($1::jsonb,$2::jsonb) result",
        [
          JSON.stringify({
            ...base,
            client_total: 852000,
            expected_tariff_version_id: transportA.versionId,
          }),
          JSON.stringify([
            transportLine("transporte:qubo:CABA", transportA),
            transportLine("transporte:qubo:40KM", transportB),
            urgent,
          ]),
        ],
      ));
      const lines = await db.query<{ slug: string; subtotal: string }>(
        `select service_slug slug,subtotal_requested::text subtotal
           from public.order_services where order_id=$1 order by line_sequence`,
        [validTransport.rows[0].result.id],
      );
      expect(lines.rows).toEqual([
        { slug: "transporte:qubo:CABA", subtotal: "203000.00" },
        { slug: "transporte:qubo:40KM", subtotal: "223000.00" },
        { slug: "recargo-envio-urgente", subtotal: "426000.00" },
      ]);
    } finally {
      await db.query("rollback");
    }
    expect(Number((await db.query<{ n: string }>("select count(*) n from public.orders")).rows[0].n)).toBe(before);
  });

  it("conserva solicitado, prestado, facturado y ledger inmutable", async () => {
    await asAuthenticated(() => db.query(
      "select public.service_order_record_fulfillment($1,3,$2)", [serviceLineId, "Se prestaron tres horas"],
    ));
    await asAuthenticated(() => db.query(
      "select public.service_order_adjust_billing($1,3,60000,$2)", [serviceLineId, "Ajuste comercial autorizado"],
    ));
    const line = await db.query<{
      requested: string; provided: string; billed: string; issued: string;
      provided_amount: string; billed_amount: string;
    }>(
      `select qty_requested::text requested,qty_provided::text provided,qty_billed::text billed,
              subtotal_requested::text issued,subtotal_provided::text provided_amount,
              subtotal_billed::text billed_amount from public.order_services where id=$1`, [serviceLineId],
    );
    expect(line.rows[0]).toEqual({
      requested: "1.00", provided: "3.00", billed: "3.00", issued: "50000.00",
      provided_amount: "75000.00", billed_amount: "60000.00",
    });
    expect((await db.query(
      "select 1 from public.service_order_events where order_id=$1", [serviceOrderId],
    )).rowCount).toBe(3);
    const mutation = await errorOf(() => db.query(
      "update public.service_order_events set reason='alterado' where order_id=$1", [serviceOrderId],
    ));
    expect(mutation).toMatch(/append-only/i);

    const stateBeforeInvalid = (await db.query<{
      provided: string; billed: string; events: string; adjustments: string;
    }>(`
      select os.qty_provided::text provided,os.qty_billed::text billed,
             (select count(*)::text from public.service_order_events where order_id=os.order_id) events,
             (select count(*)::text from public.service_order_billing_adjustments where order_id=os.order_id) adjustments
        from public.order_services os where os.id=$1
    `, [serviceLineId])).rows[0];
    for (const sql of [
      "select public.service_order_record_fulfillment($1,null,$2)",
      "select public.service_order_record_fulfillment($1,3.001,$2)",
      "select public.service_order_record_fulfillment($1,'NaN'::numeric,$2)",
      "select public.service_order_adjust_billing($1,null,60000,$2)",
      "select public.service_order_adjust_billing($1,3.001,60000,$2)",
      "select public.service_order_adjust_billing($1,3,60000.001,$2)",
      "select public.service_order_adjust_billing($1,3,'NaN'::numeric,$2)",
    ]) {
      const rejected = await asAuthenticated(() => errorOf(() => db.query(sql, [
        serviceLineId,
        "Valor económico no canónico",
      ])));
      expect(rejected).toMatch(/obligatorios/i);
    }
    expect((await db.query<{
      provided: string; billed: string; events: string; adjustments: string;
    }>(`
      select os.qty_provided::text provided,os.qty_billed::text billed,
             (select count(*)::text from public.service_order_events where order_id=os.order_id) events,
             (select count(*)::text from public.service_order_billing_adjustments where order_id=os.order_id) adjustments
        from public.order_services os where os.id=$1
    `, [serviceLineId])).rows[0]).toEqual(stateBeforeInvalid);
  });

  it("congela la fórmula de transporte y conserva el signo canónico de bonificaciones", async () => {
    await db.query("begin");
    try {
      await db.query(`
        update public.service_tariff_rates r
           set min_qty=3, min_billing=500000
          from public.service_tariff_versions v
         where r.version_id=v.id
           and v.status in ('active','superseded')
           and v.effective_from <= clock_timestamp()
           and (v.effective_to is null or v.effective_to > clock_timestamp())
           and r.service_slug='transporte:qubo:CABA'
      `);
      const transportTokens = await pricingTokens("transporte:qubo:CABA");
      const issuedTransport = await asAuthenticated(() => db.query<{ result: { id: string } }>(
        "select public.service_order_issue($1::jsonb,$2::jsonb) result",
        [JSON.stringify({
          depot: "MAGALDI", client_id: clientId, operator_id: operatorId,
          h_start: "08:00", h_end: "12:00", hours: 4, pallets: 0, units: 0, km: 0,
          signed_by: "Cliente transporte", signature_data_url: PO_SIGNATURE,
          client_total: 625000,
          expected_tariff_version_id: transportTokens.versionId,
        }), JSON.stringify([{
          ...transportLine("transporte:qubo:CABA", transportTokens),
          second_trip_discount: true,
          surcharge: "17_19",
        }])],
      ));
      const transport = (await db.query<{
        id: string; requested: string; effective: string; subtotal: string; formula: {
          kind: string; second_trip_discount: boolean; surcharge_pct: number;
        };
      }>(`
        select id,qty_requested::text requested,qty_effective::text effective,
               subtotal_requested::text subtotal,pricing_formula_snapshot formula
          from public.order_services where order_id=$1
      `, [issuedTransport.rows[0].result.id])).rows[0];
      expect(transport).toEqual({
        id: transport.id,
        requested: "1.00",
        effective: "3.00",
        subtotal: "625000.00",
        formula: { kind: "transport_v1", second_trip_discount: true, surcharge_pct: 0.25 },
      });
      await asAuthenticated(() => db.query(
        "select public.service_order_record_fulfillment($1,1,$2)",
        [transport.id, "Prestación con fórmula congelada"],
      ));
      expect((await db.query<{ line_total: string; order_total: string }>(`
        select os.subtotal_provided::text line_total,o.provided_total::text order_total
          from public.order_services os join public.orders o on o.id=os.order_id
         where os.id=$1
      `, [transport.id])).rows[0]).toEqual({
        line_total: "625000.00",
        order_total: "625000.00",
      });
      await db.query("savepoint immutable_formula");
      const immutableFormula = await errorOf(() => db.query(
        `update public.order_services
            set pricing_formula_snapshot='{"kind":"catalog_v1"}'::jsonb
          where id=$1`,
        [transport.id],
      ));
      await db.query("rollback to savepoint immutable_formula");
      expect(immutableFormula).toMatch(/snapshot emitido.*inmutable/i);

      const peonTokens = await pricingTokens("peon");
      const issuedBonus = await asAuthenticated(() => db.query<{ result: { id: string } }>(
        "select public.service_order_issue($1::jsonb,$2::jsonb) result",
        [JSON.stringify({
          depot: "MAGALDI", client_id: clientId, operator_id: operatorId,
          h_start: "08:00", h_end: "12:00", hours: 4, pallets: 0, units: 0, km: 0,
          signed_by: "Cliente bonificación", signature_data_url: PO_SIGNATURE,
          client_total: 40000,
          expected_tariff_version_id: peonTokens.versionId,
        }), JSON.stringify([
          pricedLine("peon", peonTokens),
          {
            pricing_kind: "bonification",
            service_slug: "bonificacion-pr66",
            label: "Bonificación aprobada",
            unit: "un",
            qty_requested: 1,
            manual_rate: -10000,
            manual_subtotal: -10000,
            pricing_reason: "Bonificación autorizada de prueba",
          },
        ])],
      ));
      const bonusLines = await db.query<{
        id: string; source: string; requested: string; formula: { kind: string };
      }>(`
        select id,price_source source,subtotal_requested::text requested,
               pricing_formula_snapshot formula
          from public.order_services where order_id=$1 order by line_sequence
      `, [issuedBonus.rows[0].result.id]);
      expect(bonusLines.rows.map(({ source, requested, formula }) => ({ source, requested, formula }))).toEqual([
        { source: "client_rate", requested: "50000.00", formula: { kind: "catalog_v1" } },
        { source: "bonification", requested: "-10000.00", formula: { kind: "bonification_v1" } },
      ]);
      await asAuthenticated(() => db.query(
        "select public.service_order_adjust_billing($1,1,50000,$2)",
        [bonusLines.rows[0].id, "Facturación de servicio aprobado"],
      ));
      await asAuthenticated(() => db.query(
        "select public.service_order_adjust_billing($1,1,10000,$2)",
        [bonusLines.rows[1].id, "Aplicación de bonificación aprobada"],
      ));
      expect((await db.query<{ billed: string; total: string; magnitude: string; delta: string }>(`
        select os.subtotal_billed::text billed,o.billed_total::text total,
               a.billed_amount::text magnitude,a.delta_amount::text delta
          from public.order_services os
          join public.orders o on o.id=os.order_id
          join public.service_order_billing_adjustments a on a.order_service_id=os.id
         where os.id=$1
      `, [bonusLines.rows[1].id])).rows[0]).toEqual({
        billed: "-10000.00",
        total: "40000.00",
        magnitude: "10000.00",
        delta: "-10000.00",
      });
      await db.query("savepoint excessive_bonus");
      await db.query("set local role authenticated");
      const excessiveBonus = await errorOf(() => db.query(
        "select public.service_order_adjust_billing($1,1,10000.01,$2)",
        [bonusLines.rows[1].id, "Bonificación excedida"],
      ));
      await db.query("rollback to savepoint excessive_bonus");
      expect(excessiveBonus).toMatch(/excede el snapshot emitido/i);
    } finally {
      await db.query("rollback");
    }
  });

  it("serializa agregados de prestación y facturación entre líneas concurrentes", async () => {
    const peonTokens = await pricingTokens("peon");
    const adminTokens = await pricingTokens("admin-in");
    const issued = await asAuthenticated(() => db.query<{ result: { id: string } }>(
      "select public.service_order_issue($1::jsonb,$2::jsonb) result",
      [JSON.stringify({
        depot: "MAGALDI", client_id: clientId, operator_id: operatorId,
        h_start: "08:00", h_end: "12:00", hours: 4, pallets: 0, units: 0, km: 0,
        signed_by: "Cliente concurrente", signature_data_url: PO_SIGNATURE,
        client_total: 95000,
        expected_tariff_version_id: peonTokens.versionId,
      }), JSON.stringify([
        pricedLine("peon", peonTokens),
        pricedLine("admin-in", adminTokens),
      ])],
    ));
    const lines = await db.query<{ id: string; slug: string }>(
      `select id,service_slug slug from public.order_services
        where order_id=$1 order by line_sequence`,
      [issued.rows[0].result.id],
    );
    const a = await connectGuarded(cluster.url);
    const b = await connectGuarded(cluster.url);
    const authenticate = async (client: Client) => {
      await client.query("select set_config('request.jwt.claim.sub',$1,false)", [ADMIN]);
      await client.query("select set_config('request.jwt.claim.role','authenticated',false)");
      await client.query("select set_config('request.jwt.claims',$1,false)", [
        JSON.stringify({ sub: ADMIN, role: "authenticated", email: "joseluis@logisticatops.com" }),
      ]);
    };
    await authenticate(a);
    await authenticate(b);
    try {
      await a.query("begin");
      await a.query("set local role authenticated");
      await a.query(
        "select public.service_order_record_fulfillment($1,3,$2)",
        [lines.rows[0].id, "Prestación concurrente A"],
      );
      await b.query("begin");
      await b.query("set local role authenticated");
      let fulfillmentSettled = false;
      const fulfillmentB = b.query(
        "select public.service_order_record_fulfillment($1,2,$2)",
        [lines.rows[1].id, "Prestación concurrente B"],
      ).then((value) => {
        fulfillmentSettled = true;
        return value;
      });
      await new Promise((resolveWait) => setTimeout(resolveWait, 100));
      expect(fulfillmentSettled).toBe(false);
      await a.query("commit");
      await fulfillmentB;
      await b.query("commit");
      expect((await db.query<{ total: string }>(
        "select provided_total::text total from public.orders where id=$1",
        [issued.rows[0].result.id],
      )).rows[0].total).toBe("165000.00");

      await a.query("begin");
      await a.query("set local role authenticated");
      await a.query(
        "select public.service_order_adjust_billing($1,3,75000,$2)",
        [lines.rows[0].id, "Facturación concurrente A"],
      );
      await b.query("begin");
      await b.query("set local role authenticated");
      let billingSettled = false;
      const billingB = b.query(
        "select public.service_order_adjust_billing($1,2,90000,$2)",
        [lines.rows[1].id, "Facturación concurrente B"],
      ).then((value) => {
        billingSettled = true;
        return value;
      });
      await new Promise((resolveWait) => setTimeout(resolveWait, 100));
      expect(billingSettled).toBe(false);
      await a.query("commit");
      await billingB;
      await b.query("commit");
      expect((await db.query<{ total: string }>(
        "select billed_total::text total from public.orders where id=$1",
        [issued.rows[0].result.id],
      )).rows[0].total).toBe("165000.00");
    } finally {
      await a.query("rollback").catch(() => undefined);
      await b.query("rollback").catch(() => undefined);
      await a.end();
      await b.end();
    }
  });

  it("rechaza publicar un tarifario ambiguo sin sustituir el activo", async () => {
    const before = (await db.query<{ id: string }>(
      "select id from public.service_tariff_versions where status='active'",
    )).rows[0].id;
    const duplicated = [
      { service_slug: "peon", label: "Peon", category: "personal", unit: "hs", rate: 1 },
      { service_slug: "peon", label: "Peon 2", category: "personal", unit: "hs", rate: 2 },
    ];
    const error = await asAuthenticated(() => errorOf(() => db.query(
      `select public.service_tariff_publish(
        'DUPLICADO','ARS',current_date+1,'Fuente aprobada','Prueba adversarial',$1::jsonb
      )`, [JSON.stringify(duplicated)],
    )));
    expect(error).toMatch(/servicios duplicados/i);
    expect((await db.query<{ id: string }>(
      "select id from public.service_tariff_versions where status='active'",
    )).rows[0].id).toBe(before);

    const partial = [{
      service_slug: "peon", label: "Peón parcial", category: "personal",
      unit: "hs", rate: 30000, min_qty: 2, min_billing: 0,
      requires_quote: false, metadata: {},
    }];
    const partialError = await asAuthenticated(() => errorOf(() => db.query(
      `select public.service_tariff_publish(
        'PARCIAL','ARS',current_date+1,'Fuente aprobada','Omisión deliberada',$1::jsonb
      )`, [JSON.stringify(partial)],
    )));
    expect(partialError).toMatch(/tarifario completo.*todos los conceptos/i);
    expect((await db.query<{ id: string }>(
      "select id from public.service_tariff_versions where status='active'",
    )).rows[0].id).toBe(before);
  });

  it("publica hoy de forma atómica, preserva el snapshot anterior y admite replay exacto", async () => {
    const priorSnapshot = (await db.query<{ tariff_version_id: string; pricing_snapshot_at: string }>(
      "select tariff_version_id,pricing_snapshot_at::text from public.orders where id=$1",
      [serviceOrderId],
    )).rows[0];
    const rates = await completeTariffRates(db, [{
      service_slug: "peon", label: "Peón temporal B", category: "personal",
      unit: "hs", rate: 31000, min_qty: 2, min_billing: 0,
      requires_quote: false, metadata: {},
    }]);
    const issued = await asAuthenticated(() => db.query<{ id: string }>(
      `select public.service_tariff_publish(
         'TEMPORAL-B','ARS',
         (clock_timestamp() at time zone 'America/Argentina/Buenos_Aires')::date,
         'Fuente temporal aprobada','Publicación inmediata controlada',$1::jsonb
       )::text id`,
      [JSON.stringify(rates)],
    ));
    const versionB = issued.rows[0].id;
    const replay = await asAuthenticated(() => db.query<{ id: string }>(
      `select public.service_tariff_publish(
         'TEMPORAL-B','ARS',
         (clock_timestamp() at time zone 'America/Argentina/Buenos_Aires')::date,
         'Fuente temporal aprobada','Publicación inmediata controlada',$1::jsonb
       )::text id`,
      [JSON.stringify(rates)],
    ));
    expect(replay.rows[0].id).toBe(versionB);
    expect(Number((await db.query<{ n: string }>(
      `select count(*)::text n from public.audit_log
        where entity='service_tariff_versions' and entity_id=$1 and action='publish'`,
      [versionB],
    )).rows[0].n)).toBe(1);

    const afterSnapshot = (await db.query<{ tariff_version_id: string; pricing_snapshot_at: string }>(
      "select tariff_version_id,pricing_snapshot_at::text from public.orders where id=$1",
      [serviceOrderId],
    )).rows[0];
    expect(afterSnapshot).toEqual(priorSnapshot);

    const tokens = await pricingTokens("peon");
    expect(tokens.versionId).toBe(versionB);
    const newOrder = await asAuthenticated(() => db.query<{ result: { id: string; tariff_version_id: string } }>(
      "select public.service_order_issue($1::jsonb,$2::jsonb) result",
      [JSON.stringify({
        depot: "MAGALDI", client_id: clientId, operator_id: operatorId,
        h_start: "08:00", h_end: "12:00", hours: 4, pallets: 0, units: 0, km: 0,
        signed_by: "Cliente PR66 B",
        signature_data_url: PO_SIGNATURE, client_total: 50000,
        expected_tariff_version_id: tokens.versionId,
      }), JSON.stringify([pricedLine("peon", tokens)])],
    ));
    expect(newOrder.rows[0].result.tariff_version_id).toBe(versionB);
  });

  it("mantiene la versión actual hasta el límite futuro y conmuta exactamente en [inicio, fin)", async () => {
    const rates = await completeTariffRates(db, [{
      service_slug: "peon", label: "Peón temporal C", category: "personal",
      unit: "hs", rate: 32000, min_qty: 2, min_billing: 0,
      requires_quote: false, metadata: {},
    }]);
    const before = await pricingTokens("peon");
    const issued = await asAuthenticated(() => db.query<{ id: string }>(
      `select public.service_tariff_publish(
         'TEMPORAL-C','ARS',
         (clock_timestamp() at time zone 'America/Argentina/Buenos_Aires')::date + 1,
         'Fuente futura aprobada','Programación futura controlada',$1::jsonb
       )::text id`,
      [JSON.stringify(rates)],
    ));
    const versionC = issued.rows[0].id;
    const stillCurrent = await pricingTokens("peon");
    expect(stillCurrent.versionId).toBe(before.versionId);

    const window = await db.query<{ old_id: string; new_id: string; boundary: string }>(`
      with b as (
        select id,effective_from from public.service_tariff_versions where id=$1
      )
      select
        (select v.id from public.service_tariff_versions v,b
          where v.status in ('active','superseded')
            and v.effective_from <= b.effective_from - interval '1 microsecond'
            and (v.effective_to is null or v.effective_to > b.effective_from - interval '1 microsecond')) old_id,
        (select v.id from public.service_tariff_versions v,b
          where v.status in ('active','superseded')
            and v.effective_from <= b.effective_from
            and (v.effective_to is null or v.effective_to > b.effective_from)) new_id,
        b.effective_from::text boundary
      from b
    `, [versionC]);
    expect(window.rows[0].old_id).toBe(before.versionId);
    expect(window.rows[0].new_id).toBe(versionC);
    expect(Number((await db.query<{ n: string }>(`
      select count(*)::text n from public.service_tariff_versions v
       where v.status in ('active','superseded') and v.effective_from <= $1::timestamptz
         and (v.effective_to is null or v.effective_to > $1::timestamptz)
    `, [window.rows[0].boundary])).rows[0].n)).toBe(1);

    const currentIssue = await asAuthenticated(() => db.query<{ result: { tariff_version_id: string } }>(
      "select public.service_order_issue($1::jsonb,$2::jsonb) result",
      [JSON.stringify({
        depot: "MAGALDI", client_id: clientId, operator_id: operatorId,
        h_start: "08:00", h_end: "12:00", hours: 4, pallets: 0, units: 0, km: 0,
        signed_by: "Cliente vigente",
        signature_data_url: PO_SIGNATURE, client_total: 50000,
        expected_tariff_version_id: stillCurrent.versionId,
      }), JSON.stringify([pricedLine("peon", stillCurrent)])],
    ));
    expect(currentIssue.rows[0].result.tariff_version_id).toBe(before.versionId);

    const incompatible = await asAuthenticated(() => errorOf(() => db.query(
      `select public.service_tariff_publish(
         'TEMPORAL-C-CONFLICT','ARS',
         (clock_timestamp() at time zone 'America/Argentina/Buenos_Aires')::date + 1,
         'Fuente futura aprobada','Conflicto deliberado',$1::jsonb
       )`, [JSON.stringify(rates)],
    )));
    expect(incompatible).toMatch(/posterior a la cola publicada/i);
  });

  it("programa precios particulares sin desactivar el actual y rechaza cero/backdating", async () => {
    const before = await pricingTokens("peon");
    const future = await asAuthenticated(() => db.query<{ id: string }>(
      `select public.client_service_rate_set(
         $1,'peon','ARS',26000,2,null,
         (clock_timestamp() at time zone 'America/Argentina/Buenos_Aires')::date+1,
         'Precio particular futuro aprobado'
       )::text id`, [clientId],
    ));
    const nowTokens = await pricingTokens("peon");
    expect(nowTokens.clientRateId).toBe(before.clientRateId);
    const boundary = (await db.query<{ valid_from: string }>(
      "select valid_from::text from public.client_service_rates where id=$1",
      [future.rows[0].id],
    )).rows[0].valid_from;
    const sides = await db.query<{ before_id: string; at_id: string }>(`
      select
        (select id from public.client_service_rates where client_id=$1 and service_slug='peon'
          and valid_from <= $2::timestamptz - interval '1 microsecond'
          and (valid_to is null or valid_to > $2::timestamptz - interval '1 microsecond')) before_id,
        (select id from public.client_service_rates where client_id=$1 and service_slug='peon'
          and valid_from <= $2::timestamptz
          and (valid_to is null or valid_to > $2::timestamptz)) at_id
    `, [clientId, boundary]);
    expect(sides.rows[0]).toEqual({ before_id: before.clientRateId, at_id: future.rows[0].id });
    const auditBeforeReplay = Number((await db.query<{ n: string }>(
      "select count(*)::text n from public.audit_log where entity='client_service_rates'",
    )).rows[0].n);
    const historicalReplay = await asAuthenticated(() => db.query<{ id: string }>(
      `select public.client_service_rate_set(
         $1,'peon','ARS',25000,2,null,current_date,'Acuerdo particular vigente'
       )::text id`, [clientId],
    ));
    expect(historicalReplay.rows[0].id).toBe(before.clientRateId);
    expect(Number((await db.query<{ n: string }>(
      "select count(*)::text n from public.audit_log where entity='client_service_rates'",
    )).rows[0].n)).toBe(auditBeforeReplay);

    const zero = await asAuthenticated(() => errorOf(() => db.query(
      `select public.client_service_rate_set($1,'peon','ARS',0,0,0,current_date+2,'Cero inválido')`,
      [clientId],
    )));
    expect(zero).toMatch(/invalidos/i);
    const invalidBefore = (await db.query<{ rates: string; audits: string }>(`
      select count(*)::text rates,
             (select count(*)::text from public.audit_log where entity='client_service_rates') audits
        from public.client_service_rates
    `)).rows[0];
    for (const value of ["25000.001", "'NaN'::numeric", "'Infinity'::numeric"]) {
      const invalidNumeric = await asAuthenticated(() => errorOf(() => db.query(
        `select public.client_service_rate_set(
           $1,'peon','ARS',${value},2,null,current_date+2,'Valor no canónico'
         )`, [clientId],
      )));
      expect(invalidNumeric).toMatch(/invalidos/i);
    }
    expect((await db.query<{ rates: string; audits: string }>(`
      select count(*)::text rates,
             (select count(*)::text from public.audit_log where entity='client_service_rates') audits
        from public.client_service_rates
    `)).rows[0]).toEqual(invalidBefore);
    const past = await asAuthenticated(() => errorOf(() => db.query(
      `select public.client_service_rate_set($1,'peon','ARS',27000,0,0,current_date-1,'Pasado inválido')`,
      [clientId],
    )));
    expect(past).toMatch(/retrotraer/i);

    const incompatibleUnit = await completeTariffRates(db, [{
      service_slug: "peon", label: "Peón incompatible", category: "personal",
      unit: "un", rate: 35000, min_qty: 2, min_billing: 0,
      requires_quote: false, metadata: {},
    }]);
    const unitError = await asAuthenticated(() => errorOf(() => db.query(
      `select public.service_tariff_publish(
         'CLIENT-RATE-UNIT-CONFLICT','ARS',current_date+2,
         'Fuente incompatible','Cambio de unidad no reautorizado',$1::jsonb
       )`, [JSON.stringify(incompatibleUnit)],
    )));
    expect(unitError).toMatch(/incompatible con precios particulares/i);

    const reverseCluster = await startEphemeralCluster();
    const reverseDb = await connectGuarded(reverseCluster.url);
    try {
      await reverseDb.query(readFileSync(BOOTSTRAP, "utf8"));
      for (const file of BASE_FILES) await applyTo(reverseDb, file);
      await reverseDb.query(`
        create or replace function public.ai_docs_redact(p text)
        returns text language sql immutable as $$ select p $$;
      `);
      await applyTo(reverseDb, "0243_purchase_order_price_lifecycle.sql");
      await applyTo(reverseDb, "0244_service_order_pricing_lifecycle.sql");
      await reverseDb.query(
        `insert into auth.users(id,email,raw_user_meta_data)
         values ($1,'reverse-pr66@logisticatops.com','{"full_name":"Reverse PR66"}')`,
        [ADMIN],
      );
      await reverseDb.query("update public.profiles set role='admin' where id=$1", [ADMIN]);
      await reverseDb.query(
        `insert into public.user_roles(user_id,role_id,position_title)
         select $1,id,'Administrador reverso' from public.roles where slug='admin'`,
        [ADMIN],
      );
      const reverseClient = (await reverseDb.query<{ id: string }>(
        `insert into public.clients(razon,cuit,activo)
         values ('Cliente Reverse','30-71181219-5',true) returning id`,
      )).rows[0].id;
      await reverseDb.query("select set_config('request.jwt.claim.sub',$1,false)", [ADMIN]);
      await reverseDb.query("select set_config('request.jwt.claim.role','authenticated',false)");
      await reverseDb.query("select set_config('request.jwt.claims',$1,false)", [
        JSON.stringify({ sub: ADMIN, role: "authenticated", email: "reverse-pr66@logisticatops.com" }),
      ]);
      await reverseDb.query("set role authenticated");
      try {
        const reverseRates = await completeTariffRates(reverseDb, [{
          service_slug: "peon", label: "Peón futuro incompatible", category: "personal",
          unit: "un", rate: 35000, min_qty: 2, min_billing: 0,
          requires_quote: false, metadata: {},
        }]);
        await reverseDb.query(
          `select public.service_tariff_publish(
             'REVERSE-FUTURE','ARS',current_date+1,
             'Fuente futura aprobada','Cambio futuro de unidad',$1::jsonb
           )`, [JSON.stringify(reverseRates)],
        );
        const reverseError = await errorOf(() => reverseDb.query(
          `select public.client_service_rate_set(
             $1,'peon','ARS',25000,2,null,current_date,'Precio vigente aprobado'
           )`, [reverseClient],
        ));
        expect(reverseError).toMatch(/incompatible con tarifarios futuros/i);
      } finally {
        await reverseDb.query("reset role");
      }
      expect((await reverseDb.query<{ n: string }>(
        "select count(*)::text n from public.client_service_rates",
      )).rows[0].n).toBe("0");
    } finally {
      await reverseDb.end();
      await reverseCluster.teardown();
    }
  });

  it("rechaza huecos directos, es independiente de la zona de sesión y revierte si falla auditoría", async () => {
    await db.query("begin");
    const gap = await errorOf(async () => {
      await db.query(`
        update public.service_tariff_versions
           set effective_to=effective_to-interval '1 second'
         where status='superseded' and effective_to is not null
           and code='TEMPORAL-B'
      `);
      await db.query("set constraints all immediate");
    });
    await db.query("rollback");
    expect(gap).toMatch(/TIMELINE_INVALID/i);

    const fixedNow = "2026-08-15T23:30:00Z";
    const boundaries: string[] = [];
    for (const zone of ["UTC", "America/Los_Angeles", "Pacific/Kiritimati"]) {
      await db.query(`set time zone '${zone}'`);
      boundaries.push((await db.query<{ value: string }>(
        `select extract(epoch from public._service_pricing_boundary(
           date '2026-08-17',$1::timestamptz
         ))::text value`,
        [fixedNow],
      )).rows[0].value);
    }
    await db.query("set time zone 'America/Argentina/Buenos_Aires'");
    expect(new Set(boundaries).size).toBe(1);

    await db.query(`
      create or replace function public._pr66_fail_tariff_audit()
      returns trigger language plpgsql as $$ begin
        if new.action='publish' and new.payload->>'code'='AUDIT-FAIL' then
          raise exception 'PR66_AUDIT_FAILURE';
        end if;
        return new;
      end $$;
      create trigger trg_pr66_fail_tariff_audit before insert on public.audit_log
      for each row execute function public._pr66_fail_tariff_audit();
    `);
    const before = await db.query<{ versions: string; tail: string }>(`
      select count(*)::text versions,
             (select id::text from public.service_tariff_versions where status='active') tail
      from public.service_tariff_versions
    `);
    const rates = await completeTariffRates(db, [{
      service_slug: "peon", label: "Peón audit", category: "personal",
      unit: "hs", rate: 33000, min_qty: 2, min_billing: 0,
      requires_quote: false, metadata: {},
    }]);
    const failed = await asAuthenticated(() => errorOf(() => db.query(
      `select public.service_tariff_publish(
         'AUDIT-FAIL','ARS',current_date+2,'Fuente auditada','Falla de auditoría',$1::jsonb
       )`, [JSON.stringify(rates)],
    )));
    await db.query("drop trigger trg_pr66_fail_tariff_audit on public.audit_log");
    await db.query("drop function public._pr66_fail_tariff_audit()");
    expect(failed).toMatch(/PR66_AUDIT_FAILURE/);
    expect((await db.query<{ versions: string; tail: string }>(`
      select count(*)::text versions,
             (select id::text from public.service_tariff_versions where status='active') tail
      from public.service_tariff_versions
    `)).rows[0]).toEqual(before.rows[0]);
  });

  it("serializa publicaciones concurrentes y deja una sola cola sin solapamiento", async () => {
    const rates = await completeTariffRates(db, [{
      service_slug: "peon", label: "Peón concurrente", category: "personal",
      unit: "hs", rate: 34000, min_qty: 2, min_billing: 0,
      requires_quote: false, metadata: {},
    }]);
    const beforeCount = Number((await db.query<{ n: string }>(
      "select count(*)::text n from public.service_tariff_versions",
    )).rows[0].n);
    const other = await connectGuarded(cluster.url);
    try {
      await other.query("select set_config('request.jwt.claim.sub',$1,false)", [ADMIN]);
      await other.query("select set_config('request.jwt.claim.role','authenticated',false)");
      await other.query("select set_config('request.jwt.claims',$1,false)", [
        JSON.stringify({ sub: ADMIN, role: "authenticated", email: "admin-pr66@logisticatops.com" }),
      ]);

      await db.query("begin");
      await db.query("set local role authenticated");
      await db.query(
        `select public.service_tariff_publish(
           'CONCURRENT-A','ARS',current_date+2,'Fuente concurrente','Publicación A',$1::jsonb
         )`, [JSON.stringify(rates)],
      );

      await other.query("begin");
      await other.query("set local role authenticated");
      let settled = false;
      const competing = errorOf(() => other.query(
        `select public.service_tariff_publish(
           'CONCURRENT-B','ARS',current_date+2,'Fuente concurrente','Publicación B',$1::jsonb
         )`, [JSON.stringify(rates)],
      )).then((value) => {
        settled = true;
        return value;
      });
      await new Promise((resolveWait) => setTimeout(resolveWait, 100));
      expect(settled).toBe(false);
      await db.query("commit");
      const competingError = await competing;
      expect(competingError).toMatch(/posterior a la cola publicada/i);
      await other.query("rollback");
    } finally {
      await db.query("rollback").catch(() => undefined);
      await other.query("rollback").catch(() => undefined);
      await other.end();
    }

    expect(Number((await db.query<{ n: string }>(
      "select count(*)::text n from public.service_tariff_versions",
    )).rows[0].n)).toBe(beforeCount + 1);
    const continuity = await db.query<{ invalid: string; active: string }>(`
      with timeline as (
        select status,effective_to,
               lead(effective_from) over (order by effective_from,id) next_from
          from public.service_tariff_versions
         where status in ('active','superseded')
      )
      select count(*) filter (where effective_to is distinct from next_from)::text invalid,
             count(*) filter (where status='active')::text active
        from timeline
    `);
    expect(continuity.rows[0]).toEqual({ invalid: "0", active: "1" });
  });

  it("rechaza cero, retroactividad y huecos particulares sin mutar la genealogía", async () => {
    const zeroRates = [{
      service_slug: "peon", label: "Peón cero", category: "personal",
      unit: "hs", rate: 0, min_qty: 0, min_billing: 0,
      requires_quote: false, metadata: {},
    }];
    const zero = await asAuthenticated(() => errorOf(() => db.query(
      `select public.service_tariff_publish(
         'ZERO-RATE','ARS',current_date+3,'Fuente inválida','Precio cero',$1::jsonb
       )`, [JSON.stringify(zeroRates)],
    )));
    expect(zero).toMatch(/A COTIZAR/i);

    const validRates = [{ ...zeroRates[0], rate: 35000, label: "Peón válido" }];
    const backdate = await asAuthenticated(() => errorOf(() => db.query(
      `select public.service_tariff_publish(
         'BACKDATE','ARS',current_date-1,'Fuente inválida','Retroactividad',$1::jsonb
       )`, [JSON.stringify(validRates)],
    )));
    expect(backdate).toMatch(/retrotraer/i);

    await db.query("begin");
    const clientGap = await errorOf(async () => {
      await db.query(`
        update public.client_service_rates
           set valid_to=valid_to-interval '1 second'
         where client_id=$1 and service_slug='peon' and valid_to is not null
      `, [clientId]);
      await db.query("set constraints all immediate");
    });
    await db.query("rollback");
    expect(clientGap).toMatch(/CLIENT_SERVICE_RATE_TIMELINE_INVALID/i);
  });
});

describe("T-PR66-01 · reset y reapertura de tarifas particulares", () => {
  it("permite volver a personalizar después de un período regido por lista", async () => {
    const resetCluster = await startEphemeralCluster();
    const resetDb = await connectGuarded(resetCluster.url);
    try {
      await resetDb.query(readFileSync(BOOTSTRAP, "utf8"));
      for (const file of BASE_FILES) await applyTo(resetDb, file);
      await resetDb.query(`
        create or replace function public.ai_docs_redact(p text)
        returns text language sql immutable as $$ select p $$;
      `);
      await applyTo(resetDb, "0243_purchase_order_price_lifecycle.sql");
      await applyTo(resetDb, "0244_service_order_pricing_lifecycle.sql");
      await applyTo(resetDb, "20260822175503_client_service_rate_reset.sql");

      await resetDb.query(
        `insert into auth.users(id,email,raw_user_meta_data)
         values ($1,'tariff-reset@logisticatops.com','{"full_name":"Tariff Reset"}')`,
        [ADMIN],
      );
      await resetDb.query("update public.profiles set role='admin' where id=$1", [ADMIN]);
      await resetDb.query(
        `insert into public.user_roles(user_id,role_id,position_title)
         select $1,id,'Administrador reset' from public.roles where slug='admin'`,
        [ADMIN],
      );
      const resetClient = (await resetDb.query<{ id: string }>(
        `insert into public.clients(razon,cuit,activo)
         values ('Cliente Reset','30-71181219-5',true) returning id`,
      )).rows[0].id;
      await resetDb.query("select set_config('request.jwt.claim.sub',$1,false)", [ADMIN]);
      await resetDb.query("select set_config('request.jwt.claim.role','authenticated',false)");
      await resetDb.query("select set_config('request.jwt.claims',$1,false)", [
        JSON.stringify({ sub: ADMIN, role: "authenticated", email: "tariff-reset@logisticatops.com" }),
      ]);
      await resetDb.query("set role authenticated");
      try {
        const first = await resetDb.query<{ id: string }>(
          `select public.client_service_rate_set($1,'peon','ARS',25000,null,null,current_date,'Primera tarifa') id`,
          [resetClient],
        );
        expect(first.rows[0].id).toMatch(/^[0-9a-f-]{36}$/);
        expect((await resetDb.query<{ changed: boolean }>(
          `select public.client_service_rate_reset($1,'peon','Vuelta temporal a lista') changed`,
          [resetClient],
        )).rows[0].changed).toBe(true);
        const second = await resetDb.query<{ id: string }>(
          `select public.client_service_rate_set($1,'peon','ARS',27000,null,null,current_date + 1,'Nueva tarifa') id`,
          [resetClient],
        );
        expect(second.rows[0].id).not.toBe(first.rows[0].id);
      } finally {
        await resetDb.query("reset role");
      }
      const timeline = await resetDb.query<{ valid_to: string | null; next_from: string | null }>(`
        select valid_to::text,
               lead(valid_from) over (order by valid_from, id)::text next_from
          from public.client_service_rates
         where client_id=$1 and service_slug='peon'
         order by valid_from, id
      `, [resetClient]);
      expect(timeline.rows).toHaveLength(2);
      expect(timeline.rows[0].valid_to).not.toBe(timeline.rows[0].next_from);
      expect(timeline.rows[1].valid_to).toBeNull();
    } finally {
      await resetDb.end();
      await resetCluster.teardown();
    }
  });
});

describe("T-PR66-01 · rollback verificable", () => {
  it("revierte en orden, ejecuta rollback propio de m2 y no deja residuos", async () => {
    const rollbackCluster = await startEphemeralCluster();
    const rollbackDb = await connectGuarded(rollbackCluster.url);
    try {
      await rollbackDb.query(readFileSync(BOOTSTRAP, "utf8"));
      for (const file of BASE_FILES) await applyTo(rollbackDb, file);
      await rollbackDb.query(`
        create or replace function public.ai_docs_redact(p text)
        returns text language sql immutable as $$ select p $$;
      `);
      for (const file of [
        "0243_purchase_order_price_lifecycle.sql",
        "0244_service_order_pricing_lifecycle.sql",
        "20260815002748_service_unit_m2.sql",
        "20260815002807_service_tariff_m2_rates.sql",
      ]) await applyTo(rollbackDb, file);
      const preservedBefore = (await rollbackDb.query<{ m2: string; versions: string }>(`
        select count(*) filter (where r.service_slug in ('alm-general','alm-anmat'))::text m2,
               (select count(*)::text from public.service_tariff_versions) versions
          from public.service_tariff_rates r
      `)).rows[0];
      await rollbackDb.query(`
        insert into public.service_tariff_versions(
          code,currency,status,effective_from,source_label,notes
        ) values (
          'ROLLBACK-BLOCKER','ARS','draft',clock_timestamp()+interval '30 days',
          'Bloqueo de prueba','Debe preservar toda la cadena'
        )
      `);
      await rollbackDb.query("begin");
      const blocked = await errorOf(async () => {
        await applyTo(rollbackDb, "ROLLBACK_20260815002807_service_tariff_m2_rates.sql");
        await applyTo(rollbackDb, "ROLLBACK_20260815002748_service_unit_m2.sql");
        await applyTo(rollbackDb, "ROLLBACK_0244_service_order_pricing_lifecycle.sql");
      });
      await rollbackDb.query("rollback");
      expect(blocked).toMatch(/ROLLBACK_0244_BLOCKED/i);
      expect((await rollbackDb.query<{ m2: string; versions: string }>(`
        select count(*) filter (where r.service_slug in ('alm-general','alm-anmat'))::text m2,
               (select count(*)::text from public.service_tariff_versions) versions
          from public.service_tariff_rates r
      `)).rows[0]).toEqual({
        m2: preservedBefore.m2,
        versions: String(Number(preservedBefore.versions) + 1),
      });
      await rollbackDb.query("delete from public.service_tariff_versions where code='ROLLBACK-BLOCKER'");

      await rollbackDb.query("begin");
      try {
        for (const file of [
          "ROLLBACK_20260815002807_service_tariff_m2_rates.sql",
          "ROLLBACK_20260815002748_service_unit_m2.sql",
          "ROLLBACK_0244_service_order_pricing_lifecycle.sql",
          "ROLLBACK_0243_purchase_order_price_lifecycle.sql",
        ]) await applyTo(rollbackDb, file);
        await rollbackDb.query("commit");
      } catch (error) {
        await rollbackDb.query("rollback");
        throw error;
      }
      const residue = await rollbackDb.query<{ n: string }>(`
      select count(*)::text n from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname in (
        'po_price_events','service_tariff_versions','service_tariff_rates',
        'client_service_rates','service_order_events','service_order_billing_adjustments'
      )
    `);
      expect(residue.rows[0].n).toBe("0");
      expect((await rollbackDb.query<{ n: string }>(
        `select count(*)::text n from public.services_catalog
         where unit='m2'::public.service_unit_t`,
      )).rows[0].n).toBe("0");
      const rollbackAcl = await rollbackDb.query<{
        role_name: string; ins: boolean; upd: boolean; del: boolean; trunc: boolean;
      }>(`
        select role_name,
               has_table_privilege(role_name,'public.orders','insert') ins,
               has_table_privilege(role_name,'public.orders','update') upd,
               has_table_privilege(role_name,'public.orders','delete') del,
               has_table_privilege(role_name,'public.orders','truncate') trunc
          from (values ('anon'),('authenticated'),('service_role')) r(role_name)
         order by role_name
      `);
      expect(rollbackAcl.rows).toEqual([
        { role_name: "anon", ins: false, upd: false, del: false, trunc: false },
        { role_name: "authenticated", ins: true, upd: true, del: true, trunc: false },
        { role_name: "service_role", ins: false, upd: false, del: true, trunc: false },
      ]);
      const columnAcl = await rollbackDb.query<{ n: string }>(`
        select count(*) filter (where attacl is not null)::text n
          from pg_attribute
         where attrelid='public.orders'::regclass
           and attname in ('status','signature_url','pdf_url','invoice_id')
      `);
      expect(columnAcl.rows[0].n).toBe("2");
      const serviceRoleColumns = await rollbackDb.query<{ column_name: string; allowed: boolean }>(`
        select column_name,
               has_column_privilege('service_role','public.orders',column_name,'update') allowed
          from (values ('status'),('signature_url'),('pdf_url'),('invoice_id')) c(column_name)
         order by column_name
      `);
      expect(serviceRoleColumns.rows).toEqual([
        { column_name: "invoice_id", allowed: false },
        { column_name: "pdf_url", allowed: true },
        { column_name: "signature_url", allowed: true },
        { column_name: "status", allowed: false },
      ]);
    } finally {
      await rollbackDb.end();
      await rollbackCluster.teardown();
    }
  });
});
