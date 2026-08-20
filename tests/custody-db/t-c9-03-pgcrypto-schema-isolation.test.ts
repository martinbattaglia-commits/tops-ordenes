import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { Client } from "pg";
import {
  actAsServer,
  actAsWithSession,
  baseScenario,
  createActor,
  createClient,
  createShipment,
  grantPermission,
  uid,
  type Actor,
  type Scenario,
} from "./harness/fixtures";
import { REPO_ROOT } from "./harness/manifest";

const FORWARD = readFileSync(
  join(REPO_ROOT, "supabase/migrations/0263_custody_pod_signature_and_reception_idempotency.sql"),
  "utf8",
);
const ROLLBACK = readFileSync(
  join(REPO_ROOT, "supabase/migrations/ROLLBACK_0263_custody_pod_signature_and_reception_idempotency.sql"),
  "utf8",
);

let db: Client;
let s: Scenario;
let actor: Actor;
let clientId: string;
let positionId: string;

beforeAll(async () => {
  const connectionString = inject("custodyDbUrl");
  db = new Client({ connectionString });
  await db.connect();
  await actAsServer(db);

  s = await baseScenario(db);
  clientId = await createClient(db, uid("CLI-PGCRYPTO"), 1);
  actor = await createActor(db, "operaciones");
  await grantPermission(db, actor, "wms.edit");
  await grantPermission(db, actor, "wms.create");

  const { rows } = await db.query<{ id: string }>(
    `select id from public.warehouse_positions order by id limit 1`,
  );
  positionId = rows[0].id;
});

afterAll(async () => {
  await db.end();
});

describe("T-C9-03 · Resolución explícita de pgcrypto (extensions.digest) y search_path restringido", () => {
  it("custody_pod_receiver_hash resuelve extensions.digest bajo search_path restringido", async () => {
    await actAsServer(db);
    await db.query(`set search_path = public, pg_catalog;`);

    const name = " Juan  Pérez ";
    const doc = " 12.345.678-K ";

    const { rows } = await db.query<{ hash: string; expected: string }>(
      `select
         public.custody_pod_receiver_hash($1, $2) as hash,
         encode(extensions.digest(convert_to(jsonb_build_object('name', btrim($1), 'document', nullif(btrim($2), ''))::text, 'UTF8'), 'sha256'::text), 'hex') as expected`,
      [name, doc],
    );

    expect(rows[0].hash).toMatch(/^[0-9a-f]{64}$/);
    expect(rows[0].hash).toBe(rows[0].expected);
  });

  it("custody_pod_receiver_hash maneja documento nulo o vacío de manera determinista", async () => {
    await actAsServer(db);

    const { rows: r1 } = await db.query<{ hash: string }>(
      `select public.custody_pod_receiver_hash('Maria Lopez', null) as hash`,
    );
    const { rows: r2 } = await db.query<{ hash: string }>(
      `select public.custody_pod_receiver_hash('Maria Lopez', '   ') as hash`,
    );

    expect(r1[0].hash).toMatch(/^[0-9a-f]{64}$/);
    expect(r1[0].hash).toBe(r2[0].hash);
  });

  it("custody_shipment_release_snapshot computa hash SHA-256 válido vía extensions.digest", async () => {
    await actAsServer(db);
    const shipmentId = await createShipment(db, s.orderId);

    const { rows } = await db.query<{ snapshot_hash: string }>(
      `select public.custody_shipment_release_snapshot($1) as snapshot_hash`,
      [shipmentId],
    );

    expect(rows[0].snapshot_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("wms_create_confirm_reception_v1 e idempotencia operan correctamente con extensions.digest", async () => {
    await actAsWithSession(db, actor, actor.sessionId);

    const key = randomUUID();
    const payload = {
      client_id: clientId,
      business_unit: "GENERAL",
      numero_remito: `REM-${uid("PGCRYPTO")}`,
      custody_reforzada: false,
      items: [{
        sku: `SKU-${uid("P")}`,
        description: "Mercaderia test pgcrypto",
        lot_number: "L1",
        expiration_date: "2028-06-30",
        quantity: 5,
        position_id: positionId,
      }],
    };

    const { rows: res1 } = await db.query<{ result: any }>(
      `select public.wms_create_confirm_reception_v1($1, $2::jsonb) as result`,
      [key, JSON.stringify(payload)],
    );

    expect(res1[0].result).toBeDefined();
    expect(res1[0].result.reception_id).toBeDefined();

    // Idempotencia: segunda invocación devuelve el mismo resultado
    const { rows: res2 } = await db.query<{ result: any }>(
      `select public.wms_create_confirm_reception_v1($1, $2::jsonb) as result`,
      [key, JSON.stringify(payload)],
    );

    expect(res2[0].result).toEqual(res1[0].result);

    await actAsServer(db);
    const { rows: opRows } = await db.query<{ payload_sha256: string }>(
      `select payload_sha256 from public.wms_reception_operations where idempotency_key = $1`,
      [key],
    );
    expect(opRows[0].payload_sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("ciclo de rollback y reaplicación preserva aislamiento y consistencia de pgcrypto", async () => {
    await actAsServer(db);

    const { rows: priorGrants } = await db.query<{ role_id: string }>(
      `select rp.role_id from public.role_permissions rp
        join public.permissions p on p.id=rp.permission_id where p.slug='wms.custody.pod'`,
    );
    await db.query(`delete from public.role_permissions rp using public.permissions p
      where p.id=rp.permission_id and p.slug='wms.custody.pod'`);

    // Rollback
    await db.query(ROLLBACK);

    // Verificar que funciones de 0263 ya no existen
    const { rows: fCheck } = await db.query<{ exists: boolean }>(
      `select to_regprocedure('public.custody_pod_receiver_hash(text,text)') is not null as exists`,
    );
    expect(fCheck[0].exists).toBe(false);

    // Reaplicar FORWARD
    await db.query(FORWARD);
    for (const grant of priorGrants) {
      await db.query(
        `insert into public.role_permissions(role_id,permission_id)
         select $1,p.id from public.permissions p where p.slug='wms.custody.pod' on conflict do nothing`,
        [grant.role_id],
      );
    }

    const { rows: fReapply } = await db.query<{ hash: string }>(
      `select public.custody_pod_receiver_hash('Test Reapply', '11223344') as hash`,
    );
    expect(fReapply[0].hash).toMatch(/^[0-9a-f]{64}$/);
  });
});
