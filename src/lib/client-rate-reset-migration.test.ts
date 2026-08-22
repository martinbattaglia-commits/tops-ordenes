import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260822175503_client_service_rate_reset.sql"),
  "utf8",
);
const rollback = readFileSync(
  resolve(process.cwd(), "supabase/migrations/ROLLBACK_20260822175503_client_service_rate_reset.sql"),
  "utf8",
);

describe("client tariff reset migration contract", () => {
  it("is authenticated, permission-bound, serialized and auditable", () => {
    expect(migration).toContain("v_actor uuid := auth.uid()");
    expect(migration).toContain("public.has_permission('servicios.edit')");
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toContain("for update");
    expect(migration).toContain("insert into public.audit_log");
    expect(migration).toContain("'reset_to_list'");
  });

  it("does not grant anonymous or service-role execution", () => {
    expect(migration).toContain(
      "revoke all on function public.client_service_rate_reset(uuid, text, text)",
    );
    expect(migration).toContain("from public, anon, authenticated, service_role");
    expect(migration).toContain("to authenticated");
    expect(migration).not.toContain("to anon");
    expect(migration).not.toContain("to service_role");
  });

  it("returns false on a no-op and cancels future successors before closing the current rate", () => {
    expect(migration).toContain("delete from public.client_service_rates");
    expect(migration).toContain("valid_from > v_now");
    expect(migration).toContain("if not v_changed then");
    expect(migration).toContain("return false");
    expect(migration).toContain("set valid_to = v_now");
  });

  it("allows explicit list-price gaps while still rejecting overlapping custom rates", () => {
    expect(migration).toContain("valid_to is null or valid_to > next_from");
    expect(migration).toContain("CLIENT_SERVICE_RATE_TIMELINE_INVALID: solapamiento temporal");
    expect(migration).not.toContain("valid_to is distinct from next_from");
  });

  it("ships a fail-closed rollback that refuses to recreate an invalid open-tail invariant", () => {
    expect(rollback).toContain("ROLLBACK_BLOCKED");
    expect(rollback).toContain("drop function if exists public.client_service_rate_reset");
    expect(rollback).toContain("valid_to is distinct from next_from");
  });
});
