import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const sql = readFileSync(
  resolve(process.cwd(), "supabase/migrations/0233_wa_make_relay_outbox.sql"),
  "utf8",
).toLowerCase();
const rollback = readFileSync(
  resolve(process.cwd(), "supabase/migrations/ROLLBACK_0233_wa_make_relay_outbox.sql"),
  "utf8",
).toLowerCase();
const netlify = readFileSync(resolve(process.cwd(), "netlify.toml"), "utf8");
const scheduledFunction = readFileSync(
  resolve(process.cwd(), "netlify/functions/whatsapp-make-relay.mts"),
  "utf8",
);
const route = readFileSync(
  resolve(process.cwd(), "src/app/api/whatsapp/relay-queue/route.ts"),
  "utf8",
);

describe("0233 · contrato durable del relay", () => {
  it("la identidad es única y la outbox tiene lease/backoff/dead-letter", () => {
    expect(sql).toMatch(/relay_key\s+text\s+not null unique/);
    expect(sql).toContain("for update skip locked");
    expect(sql).toMatch(/create or replace function public\.wa_claim_make_relay[\s\S]*limit 1/);
    expect(sql).toContain("next_attempt_at");
    expect(sql).toContain("status = 'dead'");
    expect(sql).toContain("lease_exhausted");
    expect(sql).toContain("wa_replay_make_relay");
  });

  it("evento y outbox nacen dentro de la misma función transaccional", () => {
    const fn = sql.slice(
      sql.indexOf("create or replace function public.wa_persist_inbound_with_relay"),
      sql.indexOf("create or replace function public.wa_claim_make_relay"),
    );
    expect(fn).toContain("insert into public.wa_inbound_events");
    expect(fn).toContain("insert into public.wa_make_relay_outbox");
    expect(fn).toContain("on conflict (relay_key) do update");
    expect(fn).toContain("when wa_make_relay_outbox.status = 'dead' then 'pending'");
  });

  it("PII queda deny-all y las RPC sólo se otorgan a service_role", () => {
    expect(sql).toContain("enable row level security");
    expect(sql).toContain("revoke all on table public.wa_make_relay_outbox");
    expect(sql).toContain("grant execute on function public.wa_persist_inbound_with_relay");
    expect(sql).toContain("to service_role");
  });

  it("el cron queda registrado declarativamente y reclama una sola fila", () => {
    expect(netlify).toContain('[functions."whatsapp-make-relay"]');
    expect(netlify).toMatch(/\[functions\."whatsapp-make-relay"\][\s\S]*schedule\s*=\s*"\* \* \* \* \*"/);
    expect(scheduledFunction).toContain("relay-queue?limit=1");
    expect(route).toMatch(/Math\.min\(Math\.max\(rawLimit, 1\), 1\)/);
  });

  it("el cron llama al deploy exacto en previews y sólo cae a URL en producción", () => {
    expect(scheduledFunction).toContain(
      "process.env.DEPLOY_PRIME_URL ?? process.env.URL",
    );
    expect(scheduledFunction.indexOf("process.env.DEPLOY_PRIME_URL")).toBeLessThan(
      scheduledFunction.indexOf("process.env.URL"),
    );
  });

  it("incluye rollback ejecutable y fail-closed ante una outbox no vacía", () => {
    expect(rollback).toContain("rollback_0233_aborted");
    expect(rollback).toContain("exists (select 1 from public.wa_make_relay_outbox limit 1)");
    expect(rollback).toContain(
      "lock table public.wa_make_relay_outbox in access exclusive mode",
    );
    expect(rollback.indexOf("lock table public.wa_make_relay_outbox")).toBeLessThan(
      rollback.indexOf("exists (select 1 from public.wa_make_relay_outbox"),
    );
    expect(rollback).toContain("drop function if exists public.wa_persist_inbound_with_relay");
    expect(rollback).toContain("drop table if exists public.wa_make_relay_outbox");
  });
});
