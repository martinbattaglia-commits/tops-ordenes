import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { Client } from "pg";
import { actAsServer, baseScenario, createShipment, uid, type Scenario } from "./harness/fixtures";
import { REPO_ROOT } from "./harness/manifest";

const FORWARD = readFileSync(join(REPO_ROOT, "supabase/migrations/0263_custody_pod_signature_and_reception_idempotency.sql"), "utf8");
const ROLLBACK = readFileSync(join(REPO_ROOT, "supabase/migrations/ROLLBACK_0263_custody_pod_signature_and_reception_idempotency.sql"), "utf8");

let db: Client;
let s: Scenario;

beforeAll(async () => {
  db = new Client({ connectionString: inject("custodyDbUrl") });
  await db.connect();
  s = await baseScenario(db);
  await actAsServer(db);
});

afterAll(async () => { await db.end(); });

describe("T-C9-02 · rollback lógico 0263", () => {
  it("es ejecutable, preserva ledger+guard con historia y permite reaplicar", async () => {
    const { rows: priorGrants } = await db.query<{ role_id: string }>(
      `select rp.role_id from public.role_permissions rp
        join public.permissions p on p.id=rp.permission_id where p.slug='wms.custody.pod'`,
    );
    await db.query(`delete from public.role_permissions rp using public.permissions p
      where p.id=rp.permission_id and p.slug='wms.custody.pod'`);
    const shipmentId = await createShipment(db, s.orderId);
    const { rows: att } = await db.query<{ id: string }>(`insert into public.custody_content_attestations(
      bucket,storage_path,sha256,size_bytes,actor_id,session_id,client_id,scope,entity_id,
      stage,event_type,observed_mime_type,expires_at
    ) values('custody-pii',$1,$2,16,$3,$4,$5,'shipment',$6,'entrega','firmado','image/png',now()+interval '15 minutes') returning id`,
      [`shipment/${shipmentId}/entrega/${uid("rb")}.png`, "d".repeat(64), s.staff.userId, s.staff.sessionId, s.clientId, shipmentId],
    );
    const { rows: authz } = await db.query<{ id: string }>(`insert into public.custody_pod_signature_authorizations(
      attestation_id,shipment_id,client_id,actor_id,session_id,receiver_payload_sha256,
      delivered_at_snapshot,release_snapshot_sha256,expires_at
    ) values($1,$2,$3,$4,$5,$6,now(),$7,now()+interval '15 minutes') returning id`,
      [att[0].id, shipmentId, s.clientId, s.staff.userId, s.staff.sessionId, "e".repeat(64), "f".repeat(64)],
    );

    await db.query(ROLLBACK);
    const { rows: rolled } = await db.query<{
      modern: boolean; legacy: boolean; history: string; guards: string; operational_guards: string;
    }>(`select
      to_regprocedure('public.generate_delivery_pod_v2(uuid,text,text,text,uuid)') is not null modern,
      to_regprocedure('public.generate_delivery_pod(uuid,text,text,text,uuid,text,timestamptz)') is not null legacy,
      (select count(*) from public.custody_pod_signature_authorizations where id=$1)::text history,
      (select count(*) from pg_trigger where tgrelid='public.custody_pod_signature_authorizations'::regclass
        and tgname in('trg_custody_pod_signature_authorizations_immutable','trg_custody_pod_signature_authorizations_no_truncate'))::text guards,
      (select count(*) from pg_trigger where tgname in(
        'trg_custody_delivery_pods_immutable',
        'trg_custody_delivery_pods_no_truncate',
        'trg_custody_shipment_composition_frozen',
        'trg_custody_shipment_delivery_boundary'
      ))::text operational_guards`,
      [authz[0].id],
    );
    expect(rolled[0]).toEqual({
      modern: false,
      legacy: true,
      history: "1",
      guards: "2",
      operational_guards: "0",
    });

    await db.query(FORWARD);
    for (const grant of priorGrants) {
      await db.query(`insert into public.role_permissions(role_id,permission_id)
        select $1,p.id from public.permissions p where p.slug='wms.custody.pod' on conflict do nothing`,
        [grant.role_id]);
    }
    const { rows: reapplied } = await db.query<{
      modern: boolean; history: string; guards: string; operational_guards: string;
    }>(`select
      to_regprocedure('public.generate_delivery_pod_v2(uuid,text,text,text,uuid)') is not null modern,
      (select count(*) from public.custody_pod_signature_authorizations where id=$1)::text history,
      (select count(*) from pg_trigger where tgrelid='public.custody_pod_signature_authorizations'::regclass
        and tgname in('trg_custody_pod_signature_authorizations_immutable','trg_custody_pod_signature_authorizations_no_truncate'))::text guards,
      (select count(*) from pg_trigger where tgname in(
        'trg_custody_delivery_pods_immutable',
        'trg_custody_delivery_pods_no_truncate',
        'trg_custody_shipment_composition_frozen',
        'trg_custody_shipment_delivery_boundary'
      ))::text operational_guards`,
      [authz[0].id],
    );
    expect(reapplied[0]).toEqual({ modern: true, history: "1", guards: "2", operational_guards: "4" });
  });
});
