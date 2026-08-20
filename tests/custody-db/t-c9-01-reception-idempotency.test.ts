import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { Client } from "pg";
import {
  actAsServer,
  actAsWithSession,
  createActor,
  createClient,
  expectFailure,
  grantPermission,
  uid,
  type Actor,
} from "./harness/fixtures";

let db: Client;
let db2: Client;
let actor: Actor;
let clientId: string;
let positionId: string;

beforeAll(async () => {
  const connectionString = inject("custodyDbUrl");
  db = new Client({ connectionString });
  db2 = new Client({ connectionString });
  await Promise.all([db.connect(), db2.connect()]);
  await actAsServer(db);
  clientId = await createClient(db, uid("CLI-IDEMP"), 2);
  actor = await createActor(db, "operaciones");
  await grantPermission(db, actor, "wms.edit");
  const { rows } = await db.query<{ id: string }>(
    `select id from public.warehouse_positions order by id limit 1`,
  );
  positionId = rows[0].id;
});

afterAll(async () => {
  await Promise.all([db.end(), db2.end()]);
});

function payload(suffix: string, overrides: Record<string, unknown> = {}) {
  return {
    client_id: clientId,
    business_unit: "GENERAL",
    numero_remito: `REM-${suffix}`,
    custody_reforzada: false,
    items: [{
      sku: `SKU-${suffix}`,
      description: `Bien ${suffix}`,
      lot_number: `LOT-${suffix}`,
      expiration_date: "2028-12-31",
      quantity: 2,
      position_id: positionId,
      ingress_sha256: "a".repeat(64),
    }],
    ...overrides,
  };
}

async function invoke(c: Client, key: string, body: Record<string, unknown>) {
  const { rows } = await c.query<{ r: Record<string, unknown> }>(
    `select public.wms_create_confirm_reception_v1($1::uuid,$2::jsonb) as r`,
    [key, JSON.stringify(body)],
  );
  return rows[0].r;
}

describe("T-C9-01 · recepción idempotente durable", () => {
  it("expone sólo la RPC autenticada y mantiene privado el ledger", async () => {
    await actAsServer(db);
    const { rows } = await db.query<{
      anon: boolean; authenticated: boolean; service: boolean; table_auth: boolean;
    }>(`select
      has_function_privilege('anon','public.wms_create_confirm_reception_v1(uuid,jsonb)','EXECUTE') anon,
      has_function_privilege('authenticated','public.wms_create_confirm_reception_v1(uuid,jsonb)','EXECUTE') authenticated,
      has_function_privilege('service_role','public.wms_create_confirm_reception_v1(uuid,jsonb)','EXECUTE') service,
      has_table_privilege('authenticated','public.wms_reception_operations','SELECT') table_auth`);
    expect(rows[0]).toEqual({ anon: false, authenticated: true, service: false, table_auth: false });
  });

  it("mismo key+payload devuelve exactamente el mismo resultado y materializa una sola genealogía", async () => {
    const key = randomUUID();
    const body = payload(uid("SAME"));
    await actAsWithSession(db, actor, actor.sessionId);
    const first = await invoke(db, key, body);
    const second = await invoke(db, key, body);
    expect(second).toEqual(first);

    await actAsServer(db);
    const receptionId = String(first.reception_id);
    const { rows } = await db.query<{
      operations: string; receptions: string; items: string; movements: string; units: string; cases: string;
    }>(`select
      (select count(*) from public.wms_reception_operations where idempotency_key=$1)::text operations,
      (select count(*) from public.receptions where id=$2)::text receptions,
      (select count(*) from public.reception_items where reception_id=$2)::text items,
      (select count(*) from public.inventory_movements where reference_type='recepcion' and reference_id=$2)::text movements,
      (select count(*) from public.custody_physical_units u join public.reception_items i on i.id=u.reception_item_id where i.reception_id=$2)::text units,
      (select count(*) from public.custody_integrity_cases c join public.custody_physical_units u on u.id=c.physical_unit_id join public.reception_items i on i.id=u.reception_item_id where i.reception_id=$2)::text cases`,
      [key, receptionId],
    );
    expect(rows[0]).toEqual({ operations: "1", receptions: "1", items: "1", movements: "1", units: "1", cases: "1" });

    const itemId = String((first.item_ids as unknown[])[0]);
    const { rows: unitRows } = await db.query<{ id: string }>(
      `select id from public.custody_physical_units where reception_item_id=$1`, [itemId],
    );
    const unitId = unitRows[0].id;
    const path = `physical_unit/${unitId}/recepcion/${randomUUID()}.png`;
    const { rows: attestRows } = await db.query<{ id: string }>(`select public.attest_custody_physical_content(
      'custody-evidence',$1,$2,16,'image/png',$3::uuid,$4::uuid,$5::uuid,
      'recepcion'::public.custody_stage_t,'foto_ingreso'::public.custody_event_type_t,900) id`,
      [path, "a".repeat(64), actor.userId, actor.sessionId, unitId],
    );
    await actAsWithSession(db, actor, actor.sessionId);
    const attach = async () => (await db.query<{ r: Record<string, unknown> }>(
      `select public.attach_wms_reception_ingress_v1($1,$2,$3,$4,$5,'ingreso.png',null) r`,
      [String(first.operation_id), itemId, unitId, path, attestRows[0].id],
    )).rows[0].r;
    const attached = await attach();
    expect(await attach()).toEqual(attached);
    await actAsServer(db);
    const { rows: attachmentCounts } = await db.query<{ ledgers: string; events: string }>(`select
      (select count(*) from public.wms_reception_ingress_attachments where operation_id=$1)::text ledgers,
      (select count(*) from public.custody_events where physical_unit_id=$2 and event_type='foto_ingreso')::text events`,
      [String(first.operation_id), unitId],
    );
    expect(attachmentCounts[0]).toEqual({ ledgers: "1", events: "1" });
  });

  it("mismo key con payload distinto falla sin una segunda recepción", async () => {
    const key = randomUUID();
    const body = payload(uid("CONFLICT"));
    await actAsWithSession(db, actor, actor.sessionId);
    const first = await invoke(db, key, body);
    const msg = await expectFailure(() => invoke(db, key, { ...body, notes: "mutado" }));
    expect(msg).toMatch(/WMS_RECEPTION_IDEMPOTENCY_CONFLICT/);
    await actAsServer(db);
    const { rows } = await db.query<{ n: string }>(
      `select count(*)::text n from public.receptions where id=$1`, [String(first.reception_id)],
    );
    expect(rows[0].n).toBe("1");
  });

  it("el replay exacto no depende de que luego cambien nivel o activo del cliente", async () => {
    await actAsServer(db);
    const mutableClient = await createClient(db, uid("CLI-MUTABLE"), 1);
    const key = randomUUID();
    const body = { ...payload(uid("MUTABLE")), client_id: mutableClient, custody_reforzada: false };
    await actAsWithSession(db, actor, actor.sessionId);
    const first = await invoke(db, key, body);
    await actAsServer(db);
    await db.query(`update public.clients set custody_level=2, activo=false where id=$1`, [mutableClient]);
    await actAsWithSession(db, actor, actor.sessionId);
    expect(await invoke(db, key, body)).toEqual(first);
  });

  it("dos conexiones concurrentes convergen al mismo resultado y una sola operación", async () => {
    const key = randomUUID();
    const body = payload(uid("RACE"));
    await Promise.all([
      actAsWithSession(db, actor, actor.sessionId),
      actAsWithSession(db2, actor, actor.sessionId),
    ]);
    const [a, b] = await Promise.all([invoke(db, key, body), invoke(db2, key, body)]);
    expect(b).toEqual(a);
    await actAsServer(db);
    const { rows } = await db.query<{ n: string }>(
      `select count(*)::text n from public.wms_reception_operations where idempotency_key=$1`, [key],
    );
    expect(rows[0].n).toBe("1");
  });

  it("un actor sin grant directo wms.edit no crea claim ni recepción", async () => {
    await actAsServer(db);
    const denied = await createActor(db, "operaciones");
    const key = randomUUID();
    await actAsWithSession(db, denied, denied.sessionId);
    const msg = await expectFailure(() => invoke(db, key, payload(uid("DENY"))));
    expect(msg).toMatch(/no autorizado/i);
    await actAsServer(db);
    const { rows } = await db.query<{ n: string }>(
      `select count(*)::text n from public.wms_reception_operations where idempotency_key=$1`, [key],
    );
    expect(rows[0].n).toBe("0");
  });

  it("un fallo después del primer insert revierte claim, recepción, ítems y genealogía", async () => {
    const marker = uid("FAIL-SECOND");
    const key = randomUUID();
    await actAsServer(db);
    await db.query(`create or replace function public.test_0263_fail_item() returns trigger
      language plpgsql as $$begin if new.description=$q$${marker}$q$ then raise exception 'TEST_0263_FAIL'; end if; return new; end$$`);
    await db.query(`drop trigger if exists test_0263_fail_item on public.reception_items`);
    await db.query(`create trigger test_0263_fail_item before insert on public.reception_items
      for each row execute function public.test_0263_fail_item()`);
    try {
      await actAsWithSession(db, actor, actor.sessionId);
      const body = payload(uid("ROLLBACK"), {
        items: [
          { sku: uid("SKU"), description: "primero", quantity: 1, position_id: positionId, ingress_sha256: "b".repeat(64) },
          { sku: uid("SKU"), description: marker, quantity: 1, position_id: positionId, ingress_sha256: "c".repeat(64) },
        ],
      });
      const msg = await expectFailure(() => invoke(db, key, body));
      expect(msg).toMatch(/TEST_0263_FAIL/);
    } finally {
      await actAsServer(db);
      await db.query(`drop trigger if exists test_0263_fail_item on public.reception_items`);
      await db.query(`drop function if exists public.test_0263_fail_item()`);
    }
    const { rows } = await db.query<{ operations: string; receptions: string }>(`select
      (select count(*) from public.wms_reception_operations where idempotency_key=$1)::text operations,
      (select count(*) from public.receptions r join public.wms_reception_operations o on o.reception_id=r.id where o.idempotency_key=$1)::text receptions`, [key]);
    expect(rows[0]).toEqual({ operations: "0", receptions: "0" });
  });
});
