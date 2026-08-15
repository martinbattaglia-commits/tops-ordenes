/**
 * T-PR66-A1 · FASE A — integridad económica de órdenes de compra.
 *
 * PostgreSQL 17 real: prueba que 0243 deriva la cabecera desde las líneas,
 * rechaza claims divergentes, excluye importes no reales y sólo concilia un
 * par OC/factura canónico en ARS cuyo detalle cierra contra el neto fiscal.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
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
const ADMIN = "a1111111-1111-4111-8111-111111111111";
const NO_PURCHASE_ACCESS = "b2222222-2222-4222-8222-222222222222";
const SIGNATURE_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const SIGNATURE_DATA_URL = `data:image/png;base64,${SIGNATURE_B64}`;
const SIGNATURE_SHA256 = createHash("sha256").update(Buffer.from(SIGNATURE_B64, "base64")).digest("hex");
const PDF_SHA256 = "a".repeat(64);
const PDF_SIZE = 1024;

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
  "0097_recon_schema.sql",
] as const;

let cluster: EphemeralCluster;
let db: Client;
let vendorId: string;
let orderId: string;
let invoiceId: string;

async function apply(file: string): Promise<void> {
  await db.query(readFileSync(resolve(MIGRATIONS, file), "utf8"));
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

async function asUser<T>(userId: string, email: string, fn: () => Promise<T>): Promise<T> {
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [userId]);
  await db.query(
    "select set_config('request.jwt.claims',$1,false)",
    [JSON.stringify({ sub: userId, role: "authenticated", email })],
  );
  await db.query("set role authenticated");
  try {
    return await fn();
  } finally {
    await db.query("reset role");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [ADMIN]);
    await db.query(
      "select set_config('request.jwt.claims',$1,false)",
      [JSON.stringify({ sub: ADMIN, role: "authenticated", email: "joseluis@logisticatops.com" })],
    );
  }
}

async function finalizeDocument(id: string): Promise<void> {
  const path = `${id}/${PDF_SHA256}.pdf`;
  await db.query(
    `insert into storage.objects(bucket_id,name,metadata)
     values ('po-pdfs-private',$1,$2::jsonb)`,
    [path, JSON.stringify({ size: PDF_SIZE, mimetype: "application/pdf" })],
  );
  await asServiceRole(() => db.query(
    "select public.purchase_order_finalize_document($1,$2,$3,$4)",
    [id, path, PDF_SHA256, PDF_SIZE],
  ));
}

async function errorOf(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return "";
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

function header(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    depot: "MAGALDI",
    destino: "Agustín Magaldi 1765 · CABA",
    entrega: "Inmediata",
    categoria: "Insumos",
    cond_pago: "30 días",
    vendor_id: vendorId,
    signature_data_url: SIGNATURE_DATA_URL,
    ...extra,
  };
}

const lines = [
  {
    label: "Conocido",
    unit: "un",
    qty: 2,
    price: 100,
    subtotal: 200,
    pos: 0,
    price_state: "known",
  },
  {
    label: "Pendiente",
    unit: "un",
    qty: 1,
    price: null,
    subtotal: null,
    pos: 1,
    price_state: "pending",
    price_reason: "Proveedor cotiza al despachar",
  },
];

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

  await db.query(
    `insert into auth.users(id,email,raw_user_meta_data)
     values ($1,'joseluis@logisticatops.com','{"full_name":"Perfil mutable de prueba"}'),
            ($2,'sin-compras@example.test','{"full_name":"Sin permiso de Compras"}')`,
    [ADMIN, NO_PURCHASE_ACCESS],
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
  const vendor = await db.query<{ id: string }>(
    `insert into public.vendors(razon,cuit,email)
     values ('Proveedor PR66 A1','30-70000011-2','proveedor-pr66-a1@example.test') returning id`,
  );
  vendorId = vendor.rows[0].id;
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [ADMIN]);
  await db.query("select set_config('request.jwt.claim.role','authenticated',false)");
  await db.query(
    "select set_config('request.jwt.claims',$1,false)",
    [JSON.stringify({ sub: ADMIN, role: "authenticated", email: "joseluis@logisticatops.com" })],
  );
}, 300_000);

afterAll(async () => {
  await db?.end();
  await cluster?.teardown();
});

describe("T-PR66-A1 · emisión canónica", () => {
  it("rechaza cabecera monetaria divergente sin dejar un header", async () => {
    const before = Number((await db.query<{ n: string }>("select count(*)::text n from public.purchase_orders")).rows[0].n);
    const error = await asAuthenticated(() => errorOf(() => db.query(
      "select public.purchase_order_issue($1::jsonb,$2::jsonb)",
      [JSON.stringify(header({ price_state: "known", total: 242 })), JSON.stringify(lines)],
    )));
    expect(error).toMatch(/cabecera económica no admite el claim/i);
    const after = Number((await db.query<{ n: string }>("select count(*)::text n from public.purchase_orders")).rows[0].n);
    expect(after).toBe(before);
  });

  it("reconstruye estado e importes desde las líneas y excluye el pendiente de métricas", async () => {
    const issued = await asAuthenticated(() => db.query<{ result: {
      id: string;
      signed_by: string;
      signature_hash: string;
      integrity_hash: string;
      emisor_name: string;
      emisor_email: string;
      emisor_role: string;
    } }>(
      "select public.purchase_order_issue($1::jsonb,$2::jsonb) result",
      [JSON.stringify(header()), JSON.stringify(lines)],
    ));
    orderId = issued.rows[0].result.id;
    expect(issued.rows[0].result).toMatchObject({
      signed_by: "José Luis Rodríguez Silva",
      signature_hash: SIGNATURE_SHA256,
      emisor_name: "José Luis Rodríguez Silva",
      emisor_email: "joseluis@logisticatops.com",
      emisor_role: "Director de Operaciones y Apoderado",
    });
    expect(issued.rows[0].result.integrity_hash).toMatch(/^[a-f0-9]{64}$/);

    const stored = await db.query<{
      currency: string;
      price_state: string;
      neto: string | null;
      total: string | null;
      planning_total: string | null;
      known_partial_neto: string;
      pending_price_lines: number;
      signed_by: string;
      signature_hash: string;
    }>(
      `select currency,price_state,neto,total,planning_total,
              known_partial_neto,pending_price_lines,signed_by,signature_hash
         from public.purchase_orders where id=$1`,
      [orderId],
    );
    expect(stored.rows[0]).toEqual({
      currency: "ARS",
      price_state: "pending",
      neto: null,
      total: null,
      planning_total: null,
      known_partial_neto: "200.00",
      pending_price_lines: 1,
      signed_by: "José Luis Rodríguez Silva",
      signature_hash: SIGNATURE_SHA256,
    });

    expect((await db.query<{ sha256: string }>(
      "select sha256 from public.po_signature_evidence where order_id=$1",
      [orderId],
    )).rows).toEqual([{ sha256: SIGNATURE_SHA256 }]);
    await finalizeDocument(orderId);

    const lifecycle = await db.query<{ kind: string }>(
      "select kind from public.po_events where order_id=$1 order by ts,kind",
      [orderId],
    );
    expect(lifecycle.rows.map((row) => row.kind).sort()).toEqual(["created", "signed"]);

    const metrics = await asAuthenticated(() => db.query(
      "select * from public.ai_supplier_spend_overview('compromiso','todo',10)",
    ));
    expect(metrics.rows).toEqual([]);

    const bypass = await asAuthenticated(() => errorOf(() => db.query(
      "update public.purchase_orders set total=0 where id=$1",
      [orderId],
    )));
    expect(bypass).toMatch(/permission denied/i);

    const forgedDelivery = await asAuthenticated(() => errorOf(() => db.query(
      `insert into public.po_events(order_id,kind,actor,meta)
       values ($1,'sent_email','attacker','{"provider_id":"fake"}')`,
      [orderId],
    )));
    expect(forgedDelivery).toMatch(/permission denied/i);
    const forgedRpc = await asAuthenticated(() => errorOf(() => db.query(
      "select public.purchase_order_record_delivery_event($1,'sent_email',$2::jsonb)",
      [orderId, JSON.stringify({ provider_id: "fake", recipient_kind: "vendor" })],
    )));
    expect(forgedRpc).toMatch(/permission denied/i);

    const forgedEmailLedger = await asAuthenticated(() => errorOf(() => db.query(
      `insert into public.po_email_sends(order_id,to_email,status,attempt_key)
       values ($1,'attacker@example.test','sent','attacker-key')`,
      [orderId],
    )));
    expect(forgedEmailLedger).toMatch(/permission denied/i);
    const forgedPrepare = await asAuthenticated(() => errorOf(() => db.query(
      "select public.purchase_order_prepare_email_delivery($1)",
      [orderId],
    )));
    expect(forgedPrepare).toMatch(/permission denied/i);
    const forgedBegin = await asAuthenticated(() => errorOf(() => db.query(
      "select public.purchase_order_begin_email_delivery($1,$2)",
      [orderId, `purchase-order/vendor/${orderId}`],
    )));
    expect(forgedBegin).toMatch(/permission denied/i);
    const forgedDrive = await asAuthenticated(() => errorOf(() => db.query(
      "update public.purchase_orders set drive_file_id='fake-drive' where id=$1",
      [orderId],
    )));
    expect(forgedDrive).toMatch(/permission denied/i);

    await db.query(
      "update public.vendors set email='proveedor-actualizado@example.test' where id=$1",
      [vendorId],
    );

    await asServiceRole(async () => {
      const invalidKind = await errorOf(() => db.query(
        "select public.purchase_order_record_delivery_event($1,'sent_email',$2::jsonb)",
        [orderId, JSON.stringify({ provider_id: "fake" })],
      ));
      expect(invalidKind).toMatch(/Evento de entrega de OC inválido/i);

      const prepared = await db.query<{ result: {
        attempt_key: string;
        status: string;
        provider_id: string | null;
        to_email: string;
      } }>(
        "select public.purchase_order_prepare_email_delivery($1) result",
        [orderId],
      );
      expect(prepared.rows[0].result).toEqual({
        attempt_key: `purchase-order/vendor/${orderId}`,
        status: "queued",
        provider_id: null,
        to_email: "proveedor-pr66-a1@example.test",
      });
      const begun = await db.query<{ result: { status: string; to_email: string } }>(
        "select public.purchase_order_begin_email_delivery($1,$2) result",
        [orderId, prepared.rows[0].result.attempt_key],
      );
      expect(begun.rows[0].result).toMatchObject({
        status: "unknown",
        to_email: "proveedor-pr66-a1@example.test",
      });
      await db.query(
        "select public.purchase_order_finalize_email_delivery($1,$2,'unknown',null,'PO_EMAIL_SEND_FAILED')",
        [orderId, prepared.rows[0].result.attempt_key],
      );
      const params = [orderId, prepared.rows[0].result.attempt_key, "sent", "provider-real"];
      const first = await db.query<{ event_id: string }>(
        "select public.purchase_order_finalize_email_delivery($1,$2,$3,$4,null) event_id",
        params,
      );
      const replay = await db.query<{ event_id: string }>(
        "select public.purchase_order_finalize_email_delivery($1,$2,$3,$4,null) event_id",
        params,
      );
      expect(replay.rows[0].event_id).toBe(first.rows[0].event_id);
      await db.query(
        "select public.purchase_order_record_delivery_event($1,'drive_synced',$2::jsonb)",
        [orderId, JSON.stringify({ file_id: "drive-real", folder: "OC/2026/Proveedor", link: "https://drive.example.test/file" })],
      );
    });
    expect((await db.query(
      "select 1 from public.po_events where order_id=$1 and kind='sent_email' and meta->>'provider_id'='provider-real' and meta->>'delivery_kind'='notification_only'",
      [orderId],
    )).rowCount).toBe(1);
    const emailEvidence = await db.query<{
      status: string;
      to_email: string;
      provider_id: string;
    }>(
      "select status,to_email,provider_id from public.po_email_sends where order_id=$1",
      [orderId],
    );
    expect(emailEvidence.rows).toEqual([{
      status: "sent",
      to_email: "proveedor-pr66-a1@example.test",
      provider_id: "provider-real",
    }]);
    expect((await db.query<{ file: string; folder: string }>(
      "select drive_file_id file,drive_folder folder from public.purchase_orders where id=$1",
      [orderId],
    )).rows[0]).toEqual({ file: "drive-real", folder: "OC/2026/Proveedor" });

    const denied = await asUser(NO_PURCHASE_ACCESS, "sin-compras@example.test", async () => {
      const counts = await db.query<{
        headers: string; items: string; events: string; emails: string; prices: string;
      }>(`
        select
          (select count(*)::text from public.purchase_orders) headers,
          (select count(*)::text from public.po_items) items,
          (select count(*)::text from public.po_events) events,
          (select count(*)::text from public.po_email_sends) emails,
          (select count(*)::text from public.po_price_events) prices
      `);
      const metrics = await db.query<{ result: {
        total: number; real_total: number; non_real_count: number;
      } }>("select public.purchase_order_list_metrics() result");
      return { counts: counts.rows[0], metrics: metrics.rows[0].result };
    });
    expect(denied.counts).toEqual({
      headers: "0", items: "0", events: "0", emails: "0", prices: "0",
    });
    expect(denied.metrics).toMatchObject({ total: 0, real_total: 0, non_real_count: 0 });

    const unsafeRollback = await errorOf(() => apply("ROLLBACK_0243_purchase_order_price_lifecycle.sql"));
    expect(unsafeRollback).toMatch(/ROLLBACK_0243_BLOCKED/i);
    expect((await db.query(
      "select 1 from pg_proc where proname='purchase_order_issue'",
    )).rowCount).toBe(1);
  });

  it("deriva de forma distinta precio conocido y estimado", async () => {
    await asAuthenticated(async () => {
      await db.query("begin");
      try {
        const known = await db.query<{ result: { id: string } }>(
          "select public.purchase_order_issue($1::jsonb,$2::jsonb) result",
          [JSON.stringify(header()), JSON.stringify([{
            label: "Precio conocido", unit: "un", qty: 1, price: 100,
            subtotal: 100, pos: 0, price_state: "known",
          }])],
        );
        const estimated = await db.query<{ result: { id: string } }>(
          "select public.purchase_order_issue($1::jsonb,$2::jsonb) result",
          [JSON.stringify(header()), JSON.stringify([{
            label: "Precio estimado", unit: "un", qty: 1, price: 100,
            subtotal: 100, pos: 0, price_state: "estimated",
            price_reason: "Cotización provisoria vigente",
          }])],
        );
        const summaries = await db.query<{
          price_state: string;
          neto: string | null;
          total: string | null;
          planning_total: string | null;
        }>(
          `select price_state,neto,total,planning_total
             from public.purchase_orders
            where id = any($1::uuid[])
            order by price_state`,
          [[known.rows[0].result.id, estimated.rows[0].result.id]],
        );
        expect(summaries.rows).toEqual([
          { price_state: "known", neto: "100.00", total: "121.00", planning_total: "121.00" },
          { price_state: "estimated", neto: null, total: null, planning_total: "121.00" },
        ]);
      } finally {
        await db.query("rollback");
      }
    });
  });

  it("rechaza destino falsificado, proveedor inactivo y cantidades JSON malformadas sin residuos", async () => {
    const before = await db.query<{ orders: string; items: string; events: string }>(`
      select
        (select count(*)::text from public.purchase_orders) orders,
        (select count(*)::text from public.po_items) items,
        (select count(*)::text from public.po_events) events
    `);

    const forgedDestination = await asAuthenticated(() => errorOf(() => db.query(
      "select public.purchase_order_issue($1::jsonb,$2::jsonb)",
      [JSON.stringify(header({ destino: "Dirección inyectada por el navegador" })), JSON.stringify(lines)],
    )));
    expect(forgedDestination).toMatch(/Destino inconsistente/i);

    const malformedQty = await asAuthenticated(() => errorOf(() => db.query(
      "select public.purchase_order_issue($1::jsonb,$2::jsonb)",
      [JSON.stringify(header()), JSON.stringify([{ ...lines[0], qty: "2" }])],
    )));
    expect(malformedQty).toMatch(/Cantidad de línea inválida/i);

    for (const claim of [
      { signed_by: "Atacante" },
      { signature_hash: "f".repeat(64) },
      { emisor_name: "Emisor inyectado" },
      { date: "2000-01-01T00:00:00.000Z" },
      { ip: "203.0.113.10" },
    ]) {
      const forgedCanonical = await asAuthenticated(() => errorOf(() => db.query(
        "select public.purchase_order_issue($1::jsonb,$2::jsonb)",
        [JSON.stringify(header(claim)), JSON.stringify(lines)],
      )));
      expect(forgedCanonical).toMatch(/datos canónicos del servidor/i);
    }

    const malformedSignature = await asAuthenticated(() => errorOf(() => db.query(
      "select public.purchase_order_issue($1::jsonb,$2::jsonb)",
      [JSON.stringify(header({ signature_data_url: "data:image/png;base64,QUJDRA==" })), JSON.stringify(lines)],
    )));
    expect(malformedSignature).toMatch(/Firma PNG inválida/i);
    const headerOnlySignature = await asAuthenticated(() => errorOf(() => db.query(
      "select public.purchase_order_issue($1::jsonb,$2::jsonb)",
      [JSON.stringify(header({ signature_data_url: "data:image/png;base64,iVBORw0KGgo=" })), JSON.stringify(lines)],
    )));
    expect(headerOnlySignature).toMatch(/Firma PNG inválida/i);
    const hugePos = await asAuthenticated(() => errorOf(() => db.query(
      "select public.purchase_order_issue($1::jsonb,$2::jsonb)",
      [JSON.stringify(header()), JSON.stringify([{ ...lines[0], pos: 999999999999999999999 }])],
    )));
    expect(hugePos).toMatch(/Posición de línea inconsistente/i);
    const tooMany = Array.from({ length: 501 }, (_, pos) => ({ ...lines[0], pos }));
    const batchError = await asAuthenticated(() => errorOf(() => db.query(
      "select public.purchase_order_issue($1::jsonb,$2::jsonb)",
      [JSON.stringify(header()), JSON.stringify(tooMany)],
    )));
    expect(batchError).toMatch(/cantidad de líneas/i);

    await db.query("update public.vendors set active=false where id=$1", [vendorId]);
    try {
      const inactiveVendor = await asAuthenticated(() => errorOf(() => db.query(
        "select public.purchase_order_issue($1::jsonb,$2::jsonb)",
        [JSON.stringify(header()), JSON.stringify(lines)],
      )));
      expect(inactiveVendor).toMatch(/Proveedor inexistente o inactivo/i);
    } finally {
      await db.query("update public.vendors set active=true where id=$1", [vendorId]);
    }

    const after = await db.query<{ orders: string; items: string; events: string }>(`
      select
        (select count(*)::text from public.purchase_orders) orders,
        (select count(*)::text from public.po_items) items,
        (select count(*)::text from public.po_events) events
    `);
    expect(after.rows[0]).toEqual(before.rows[0]);
  });

  it("un fallo del ledger created revierte header, líneas, firma y auditoría de precio", async () => {
    const before = await db.query<{
      orders: string; items: string; price_events: string; events: string; signatures: string;
    }>(`
      select
        (select count(*)::text from public.purchase_orders) orders,
        (select count(*)::text from public.po_items) items,
        (select count(*)::text from public.po_price_events) price_events,
        (select count(*)::text from public.po_events) events,
        (select count(*)::text from public.po_signature_evidence) signatures
    `);
    await db.query(`
      create or replace function public._test_pr66_fail_po_created()
      returns trigger language plpgsql as $$
      begin
        if new.kind='created' then raise exception 'TEST_PO_CREATED_AUDIT_FAILURE'; end if;
        return new;
      end;
      $$;
      create trigger trg_test_pr66_fail_po_created
      before insert on public.po_events
      for each row execute function public._test_pr66_fail_po_created();
    `);
    try {
      const error = await asAuthenticated(() => errorOf(() => db.query(
        "select public.purchase_order_issue($1::jsonb,$2::jsonb)",
        [JSON.stringify(header()), JSON.stringify(lines)],
      )));
      expect(error).toContain("TEST_PO_CREATED_AUDIT_FAILURE");
    } finally {
      await db.query("drop trigger if exists trg_test_pr66_fail_po_created on public.po_events");
      await db.query("drop function if exists public._test_pr66_fail_po_created()");
    }
    const after = await db.query<{
      orders: string; items: string; price_events: string; events: string; signatures: string;
    }>(`
      select
        (select count(*)::text from public.purchase_orders) orders,
        (select count(*)::text from public.po_items) items,
        (select count(*)::text from public.po_price_events) price_events,
        (select count(*)::text from public.po_events) events,
        (select count(*)::text from public.po_signature_evidence) signatures
    `);
    expect(after.rows[0]).toEqual(before.rows[0]);
  });
});

describe("T-PR66-A1 · conciliación congruente y trazable", () => {
  it("rechaza moneda y neto incongruentes; luego conserva real, emitido y diferencia", async () => {
    const invoice = await db.query<{ id: string }>(
      `insert into public.supplier_invoices(
         public_id,vendor_id,purchase_order_id,numero,moneda,neto,iva,total
       ) values ('',$1,$2,'PR66-A1-001','USD',300,63,363) returning id`,
      [vendorId, orderId],
    );
    invoiceId = invoice.rows[0].id;
    await db.query(
      `insert into public.po_reconciliations(
         purchase_order_id,supplier_invoice_id,initiated_by,score
       ) values ($1,$2,$3,100)`,
      [orderId, invoiceId, ADMIN],
    );
    const itemRows = await db.query<{ id: string; price_state: string }>(
      "select id,price_state from public.po_items where order_id=$1 order by pos",
      [orderId],
    );

    const valid = itemRows.rows.map((item) => ({
      item_id: item.id,
      actual_unit_price: item.price_state === "known" ? 110 : 80,
    }));
    const currencyError = await asAuthenticated(() => errorOf(() => db.query(
      "select public.po_reconcile_prices($1,$2,$3::jsonb,$4)",
      [orderId, invoiceId, JSON.stringify(valid), "Factura real recibida"],
    )));
    expect(currencyError).toMatch(/no está en ARS/i);

    await db.query("update public.supplier_invoices set moneda='ARS' where id=$1", [invoiceId]);
    for (const malformed of [
      [{ item_id: { forged: true }, actual_unit_price: 10 }],
      [{ item_id: itemRows.rows[0].id, actual_unit_price: "10" }],
    ]) {
      const malformedError = await asAuthenticated(() => errorOf(() => db.query(
        "select public.po_reconcile_prices($1,$2,$3::jsonb,$4)",
        [orderId, invoiceId, JSON.stringify(malformed), "Factura real recibida"],
      )));
      expect(malformedError).toMatch(/malformado/i);
    }
    const wrongNet = valid.map((line, index) => ({
      ...line,
      actual_unit_price: index === 1 ? 70 : line.actual_unit_price,
    }));
    const netError = await asAuthenticated(() => errorOf(() => db.query(
      "select public.po_reconcile_prices($1,$2,$3::jsonb,$4)",
      [orderId, invoiceId, JSON.stringify(wrongNet), "Factura real recibida"],
    )));
    expect(netError).toMatch(/no cierran contra el neto de factura/i);
    expect((await db.query(
      "select 1 from public.po_items where order_id=$1 and price_reconciled_at is not null",
      [orderId],
    )).rowCount).toBe(0);

    await asAuthenticated(() => db.query(
      "select public.po_reconcile_prices($1,$2,$3::jsonb,$4)",
      [orderId, invoiceId, JSON.stringify(valid), "Factura real recibida"],
    ));

    const stored = await db.query<{
      total: string;
      issued_total: string | null;
      invoice_id: string;
      reconciled: boolean;
    }>(
      `select total,issued_total,price_reconciled_invoice_id invoice_id,
              price_reconciled_at is not null reconciled
         from public.purchase_orders where id=$1`,
      [orderId],
    );
    expect(stored.rows[0]).toEqual({
      total: "363.00",
      issued_total: null,
      invoice_id: invoiceId,
      reconciled: true,
    });

    const itemAudit = await db.query<{
      state: string;
      issued: string | null;
      actual: string;
      delta: string | null;
      invoice: string;
    }>(
      `select issued_state::text state,issued_unit_price issued,
              actual_unit_price actual,delta_unit_price delta,
              meta->>'invoice_public_id' invoice
         from public.po_price_events
        where order_id=$1 and action='reconciled'
        order by item_id`,
      [orderId],
    );
    expect(itemAudit.rows).toHaveLength(2);
    expect(itemAudit.rows.map((row) => row.invoice).every(Boolean)).toBe(true);
    expect(itemAudit.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ state: "known", issued: "100.00", actual: "110.00", delta: "10.00" }),
      expect.objectContaining({ state: "pending", issued: null, actual: "80.00", delta: null }),
    ]));

    const metrics = await asAuthenticated(() => db.query<{ total: string }>(
      "select total from public.ai_supplier_spend_overview('compromiso','todo',10)",
    ));
    expect(metrics.rows).toEqual([{ total: "363.00" }]);
  });

  it("el rollback estructural sólo avanza en un universo limpio y elimina sus objetos", async () => {
    const clean = await startEphemeralCluster();
    const cleanDb = await connectGuarded(clean.url);
    try {
      await cleanDb.query(readFileSync(BOOTSTRAP, "utf8"));
      for (const file of BASE_FILES) {
        await cleanDb.query(readFileSync(resolve(MIGRATIONS, file), "utf8"));
      }
      const legacyVendor = (await cleanDb.query<{ id: string }>(
        `insert into public.vendors(razon,cuit,email)
         values ('Proveedor legado rollback','30-70000022-8','legado@example.test')
         returning id`,
      )).rows[0].id;
      const legacyOrder = (await cleanDb.query<{ id: string }>(
        `insert into public.purchase_orders(public_id,vendor_id,status,neto,iva,total)
         values ('OC-LEGACY-PR66',$1,'borrador',100,21,121)
         returning id`,
        [legacyVendor],
      )).rows[0].id;
      const legacyItems = (await cleanDb.query<{
        id: string;
        label: string;
        qty: string;
        price: string;
        subtotal: string;
        pos: number;
      }>(
        `insert into public.po_items(order_id,label,unit,qty,price,subtotal,pos)
         values ($1,'Legacy delta 0.20','un',1,100,100.20,0),
                ($1,'Legacy delta 0.40','un',1,100,100.40,1),
                ($1,'Legacy válida','un',1,100,100,2)
         returning id,label,qty::text,price::text,subtotal::text,pos`,
        [legacyOrder],
      )).rows;
      const legacyBusinessBefore = legacyItems.map((row) => ({
        ...row,
        qty: Number(row.qty).toFixed(2),
        price: Number(row.price).toFixed(2),
        subtotal: Number(row.subtotal).toFixed(2),
      }));
      await cleanDb.query(`
        create or replace function public.ai_docs_redact(p text)
        returns text language sql immutable as $$ select p $$;
      `);
      await cleanDb.query("begin");
      await cleanDb.query(
        `insert into public.po_items(order_id,label,unit,qty,price,subtotal,pos)
         values ($1,'Tercera anomalía','un',1,100,100.60,3)`,
        [legacyOrder],
      );
      const thirdAnomaly = await errorOf(() => cleanDb.query(
        readFileSync(resolve(MIGRATIONS, "0243_purchase_order_price_lifecycle.sql"), "utf8"),
      ));
      expect(thirdAnomaly).toMatch(/PR66_0243_HISTORICAL_ANOMALY_DRIFT/i);
      await cleanDb.query("rollback");
      expect((await cleanDb.query<{ n: string }>(
        `select count(*)::text n from public.po_items
          where price is not null
            and not (abs(subtotal-round(qty*price,2)) <= 0.01)`,
      )).rows[0].n).toBe("2");
      await cleanDb.query(readFileSync(resolve(MIGRATIONS, "0243_purchase_order_price_lifecycle.sql"), "utf8"));
      const constraint = (await cleanDb.query<{ validated: boolean; comment: string }>(
        `select c.convalidated validated, obj_description(c.oid,'pg_constraint') comment
           from pg_constraint c
          where c.conrelid='public.po_items'::regclass
            and c.conname='po_items_price_subtotal_ck'`,
      )).rows[0];
      expect(constraint).toEqual({
        validated: false,
        comment: "PR66 FASE A · NOT VALID preserva sin modificar exactamente 2 excepciones legacy verificadas (deltas ARS 0.20 y 0.40, sin PII); INSERT/UPDATE nuevos siguen sujetos a tolerancia máxima ARS 0.01.",
      });
      expect((await cleanDb.query<{ delta: string }>(
        `select abs(subtotal-round(qty*price,2))::text delta
           from public.po_items
          where price is not null
            and not (abs(subtotal-round(qty*price,2)) <= 0.01)
          order by abs(subtotal-round(qty*price,2))`,
      )).rows).toEqual([{ delta: "0.20" }, { delta: "0.40" }]);
      expect((await cleanDb.query<{
        id: string;
        label: string;
        qty: string;
        price: string;
        subtotal: string;
        pos: number;
      }>(
        `select id,label,qty::text,price::text,subtotal::text,pos
           from public.po_items where id=any($1::uuid[]) order by pos`,
        [legacyItems.map((row) => row.id)],
      )).rows.map((row) => ({
        ...row,
        qty: Number(row.qty).toFixed(2),
        price: Number(row.price).toFixed(2),
        subtotal: Number(row.subtotal).toFixed(2),
      }))).toEqual(legacyBusinessBefore);

      const invalidInsert = await errorOf(() => cleanDb.query(
        `insert into public.po_items(order_id,label,unit,qty,price,subtotal,pos)
         values ($1,'Nueva inconsistente','un',1,100,100.20,3)`,
        [legacyOrder],
      ));
      expect(invalidInsert).toMatch(/po_items_price_subtotal_ck/i);
      const validItem = (await cleanDb.query<{ id: string }>(
        `insert into public.po_items(order_id,label,unit,qty,price,subtotal,pos)
         values ($1,'Nueva válida','un',2,100,200,3) returning id`,
        [legacyOrder],
      )).rows[0].id;
      const futureInvalidUpdate = await errorOf(() => cleanDb.query(
        "update public.po_items set subtotal=200.20 where id=$1",
        [validItem],
      ));
      expect(futureInvalidUpdate).toMatch(/inmutable|po_items_price_subtotal_ck/i);
      const invalidUpdate = await errorOf(() => cleanDb.query(
        "update public.po_items set label='Legacy alterada' where id=$1",
        [legacyItems[0].id],
      ));
      expect(invalidUpdate).toMatch(/po_items_price_subtotal_ck/i);
      await cleanDb.query(
        "update public.po_items set label='Nueva válida operable' where id=$1",
        [validItem],
      );
      expect((await cleanDb.query<{ label: string; price: string; subtotal: string }>(
        "select label,price::text,subtotal::text from public.po_items where id=$1",
        [validItem],
      )).rows[0]).toEqual({ label: "Nueva válida operable", price: "100.00", subtotal: "200.00" });
      expect((await cleanDb.query<{ snap: boolean }>(
        "select vendor_snapshot is not null snap from public.purchase_orders where id=$1",
        [legacyOrder],
      )).rows[0].snap).toBe(true);
      expect((await cleanDb.query<{ id: string; public: boolean }>(
        "select id,public from storage.buckets where id in ('po-pdfs','po-pdfs-private') order by id",
      )).rows).toEqual([
        { id: "po-pdfs", public: true },
        { id: "po-pdfs-private", public: false },
      ]);
      expect((await cleanDb.query(
        `select 1 from pg_policies where schemaname='storage' and tablename='objects'
          and policyname in ('po-pdfs public read','po-pdfs internal write')`,
      )).rowCount).toBe(2);
      await cleanDb.query(readFileSync(resolve(MIGRATIONS, "ROLLBACK_0243_purchase_order_price_lifecycle.sql"), "utf8"));
      expect((await cleanDb.query(
        "select 1 from pg_type where typname='po_price_state_t'",
      )).rowCount).toBe(0);
      expect((await cleanDb.query(
        `select 1 from pg_constraint
          where conrelid='public.po_items'::regclass
            and conname='po_items_price_subtotal_ck'`,
      )).rowCount).toBe(0);
      expect((await cleanDb.query(
        "select 1 from pg_proc where proname in ('purchase_order_prepare_email_delivery','purchase_order_begin_email_delivery','purchase_order_finalize_email_delivery','purchase_order_finalize_document')",
      )).rowCount).toBe(0);
      expect((await cleanDb.query(
        "select 1 from information_schema.tables where table_schema='public' and table_name='po_signature_evidence'",
      )).rowCount).toBe(0);
      expect((await cleanDb.query(
        "select 1 from public.purchase_orders where id=$1",
        [legacyOrder],
      )).rowCount).toBe(1);
      expect((await cleanDb.query<{
        id: string;
        label: string;
        qty: string;
        price: string;
        subtotal: string;
        pos: number;
      }>(
        `select id,label,qty::text,price::text,subtotal::text,pos
           from public.po_items where id=any($1::uuid[]) order by pos`,
        [legacyItems.map((row) => row.id)],
      )).rows.map((row) => ({
        ...row,
        qty: Number(row.qty).toFixed(2),
        price: Number(row.price).toFixed(2),
        subtotal: Number(row.subtotal).toFixed(2),
      }))).toEqual(legacyBusinessBefore);
      expect((await cleanDb.query<{ id: string; public: boolean }>(
        "select id,public from storage.buckets where id in ('po-pdfs','po-pdfs-private') order by id",
      )).rows).toEqual([{ id: "po-pdfs", public: true }]);
      expect((await cleanDb.query(
        `select 1 from pg_policies where schemaname='storage' and tablename='objects'
          and policyname in ('po-pdfs public read','po-pdfs internal write')`,
      )).rowCount).toBe(2);

      await cleanDb.query(
        `insert into auth.users(id,email,raw_user_meta_data)
         values ($1,'rollback-pr66@example.test','{"full_name":"Rollback PR66"}')
         on conflict (id) do nothing`,
        [ADMIN],
      );
      await cleanDb.query("update public.profiles set role='admin' where id=$1", [ADMIN]);
      await cleanDb.query(
        `insert into public.user_roles(user_id,role_id,position_title)
         select $1,id,'Administrador rollback' from public.roles where slug='admin'
         on conflict do nothing`,
        [ADMIN],
      );
      await cleanDb.query(`
        insert into public.role_permissions(role_id,permission_id)
        select r.id,p.id from public.roles r join public.permissions p on p.slug='compras.sign'
        where r.slug='admin' on conflict do nothing
      `);
      await cleanDb.query("select set_config('request.jwt.claim.sub',$1,false)", [ADMIN]);
      await cleanDb.query("select set_config('request.jwt.claim.role','authenticated',false)");
      await cleanDb.query("select set_config('request.jwt.claims',$1,false)", [
        JSON.stringify({ sub: ADMIN, role: "authenticated", email: "rollback-pr66@example.test" }),
      ]);
      await cleanDb.query("set role authenticated");
      const legacyItem = (await cleanDb.query<{ id: string }>(
        `insert into public.po_items(order_id,label,unit,qty,price,subtotal,pos)
         values ($1,'Línea rollback','un',1,100,100,0) returning id`,
        [legacyOrder],
      )).rows[0].id;
      await cleanDb.query("update public.po_items set label='Línea rollback operable' where id=$1", [legacyItem]);
      const legacyEmail = (await cleanDb.query<{ id: string }>(
        `insert into public.po_email_sends(order_id,to_email,tag,status)
         values ($1,'proveedor-rollback@example.test','vendor','queued') returning id`,
        [legacyOrder],
      )).rows[0].id;
      await cleanDb.query("update public.po_email_sends set status='sent' where id=$1", [legacyEmail]);
      await cleanDb.query("reset role");
      expect((await cleanDb.query<{ label: string }>(
        "select label from public.po_items where id=$1", [legacyItem],
      )).rows[0].label).toBe("Línea rollback operable");
      expect((await cleanDb.query<{ status: string }>(
        "select status from public.po_email_sends where id=$1", [legacyEmail],
      )).rows[0].status).toBe("sent");
      expect((await cleanDb.query<{ allowed: boolean }>(
        `select has_table_privilege('service_role','public.po_items','INSERT')
             or has_table_privilege('service_role','public.po_email_sends','INSERT') allowed`,
      )).rows[0].allowed).toBe(false);
    } finally {
      await cleanDb.end();
      await clean.teardown();
    }
  });
});
