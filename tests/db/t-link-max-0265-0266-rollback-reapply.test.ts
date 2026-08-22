/**
 * NEXUS-LINK-MAX-RECOVERY · ensayo ejecutable PostgreSQL 17.
 *
 * Demuestra la cadena exacta base → 0265 → 0266 → R0266 → R0265 →
 * reaplicación, leyendo todos los artefactos desde disco. La huella final debe
 * coincidir con la primera aplicación y las filas base deben sobrevivir.
 */
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Client } from "pg";
import { createWaSandbox, type WaSandbox } from "./harness/wa-sandbox";

const MIG = (name: string) =>
  readFileSync(resolve(process.cwd(), "supabase", "migrations", name), "utf8");

const M0265 = MIG("0265_connect_reaction_emoji_whitelist.sql");
const R0265 = MIG("ROLLBACK_0265_connect_reaction_emoji_whitelist.sql");
const M0266 = MIG("0266_connect_handover_cas_audit.sql");
const R0266 = MIG("ROLLBACK_0266_connect_handover_cas_audit.sql");

const ACTOR = "11111111-1111-4111-8111-111111111111";
const CONVERSATION = "22222222-2222-4222-8222-222222222222";
const MESSAGE = "33333333-3333-4333-8333-333333333333";
const PARTICIPANT = "44444444-4444-4444-8444-444444444444";
const REACTION = "55555555-5555-4555-8555-555555555555";

const BASE = `
  create extension if not exists pgcrypto;
  create schema auth;

  create table public.profiles (id uuid primary key);
  create table public.connect_conversations (
    id uuid primary key,
    kind text not null,
    handover_state text not null default 'BOT_ACTIVE',
    handover_at timestamptz
  );
  create table public.connect_messages (
    id uuid primary key,
    conversation_id uuid not null references public.connect_conversations(id)
  );
  create table public.connect_message_reactions (
    id uuid primary key,
    message_id uuid not null references public.connect_messages(id),
    participant_id uuid not null,
    emoji text not null,
    unique (message_id, participant_id, emoji)
  );

  create function auth.uid() returns uuid language sql stable
    as $$ select '${ACTOR}'::uuid $$;
  create function public._connect_is_member(uuid) returns boolean language sql stable
    as $$ select true $$;
  create function public._connect_assert_not_archived(uuid) returns void language sql stable
    as $$ select $$;
  create function public._connect_my_participant(uuid) returns uuid language sql stable
    as $$ select '${PARTICIPANT}'::uuid $$;
  create function public.nexus_depot_manager_reject_legacy_connect() returns void language sql stable
    as $$ select $$;
  create function public.nexus_link_can(text) returns boolean language sql stable
    as $$ select true $$;
  create function public.has_permission(text) returns boolean language sql stable
    as $$ select true $$;
  create function public.is_admin() returns boolean language sql stable
    as $$ select false $$;

  -- Estado exacto relevante de 0246/0260: base interna con parámetros nominales,
  -- wrapper público 0246 sin nombres y handover 0260 con nombres.
  create function public.connect_react_pre_0246(p_message_id uuid, p_emoji text)
    returns void language sql as $$ select $$;
  create function public.connect_react(uuid, text)
    returns void language sql as $$ select $$;
  create function public.connect_set_handover_state(p_conversation_id uuid, p_state text)
    returns void language sql as $$ select $$;

  insert into public.profiles(id) values ('${ACTOR}');
  insert into public.connect_conversations(id, kind) values ('${CONVERSATION}', 'whatsapp');
  insert into public.connect_messages(id, conversation_id) values ('${MESSAGE}', '${CONVERSATION}');
  insert into public.connect_message_reactions(id, message_id, participant_id, emoji)
    values ('${REACTION}', '${MESSAGE}', '${PARTICIPANT}', '👍');
`;

let sandbox: WaSandbox;
let db: Client;

const execute = (sql: string) => db.query(sql);

async function fingerprint(): Promise<string> {
  const { rows } = await db.query<{ fp: string }>(`
    select jsonb_build_object(
      'emoji_constraint', exists(
        select 1 from pg_constraint
         where conname = 'connect_message_reactions_emoji_check'
      ),
      'handover_by', exists(
        select 1 from information_schema.columns
         where table_schema = 'public'
           and table_name = 'connect_conversations'
           and column_name = 'handover_by'
      ),
      'functions', (
        select jsonb_agg(signature order by signature) from (
          select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' ||
                 ':' || coalesce(array_to_string(p.proargnames, ','), '<unnamed>') ||
                 '->' || pg_get_function_result(p.oid) as signature
            from pg_proc p
            join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public'
             and p.proname in (
               'connect_react',
               'connect_react_pre_0246',
               'connect_set_handover_state'
             )
        ) signatures
      )
    )::text as fp
  `);
  return rows[0].fp;
}

beforeAll(async () => {
  sandbox = await createWaSandbox(inject("dbUrl"));
  db = sandbox.client;
  await execute(BASE);
}, 120_000);

afterAll(async () => {
  await sandbox?.destroy();
});

describe("0265/0266 · rollback y reaplicación real", () => {
  it("completa el ciclo sin 42P13, conserva datos base y reproduce la huella final", async () => {
    const baseFingerprint = await fingerprint();
    expect(baseFingerprint).toContain("connect_react(uuid, text):<unnamed>->void");

    await execute(M0265);
    await execute(M0266);
    const firstAppliedFingerprint = await fingerprint();
    expect(firstAppliedFingerprint).toContain("emoji_constraint");
    expect(firstAppliedFingerprint).toContain("p_expected_state");

    const success = await db.query<{ result: { ok: boolean; state: string } }>(
      "select public.connect_set_handover_state($1,$2,$3) as result",
      [CONVERSATION, "PAUSED_HUMAN", "BOT_ACTIVE"],
    );
    expect(success.rows[0].result).toMatchObject({ ok: true, state: "PAUSED_HUMAN" });

    const conflict = await db.query<{ result: { ok: boolean; conflict: boolean; state: string } }>(
      "select public.connect_set_handover_state($1,$2,$3) as result",
      [CONVERSATION, "BOT_ACTIVE", "BOT_ACTIVE"],
    );
    expect(conflict.rows[0].result).toMatchObject({
      ok: false,
      conflict: true,
      state: "PAUSED_HUMAN",
    });

    await expect(db.query("select public.connect_react($1,$2)", [MESSAGE, "🔥"]))
      .rejects.toMatchObject({ code: "23514" });

    // Activa la rama reversible de R0266 sin borrar datos productivos simulados.
    await db.query("update public.connect_conversations set handover_by = null where id = $1", [
      CONVERSATION,
    ]);
    await execute(R0266);
    await execute(R0265);

    const rolledBackFingerprint = await fingerprint();
    expect(rolledBackFingerprint).toBe(baseFingerprint);
    expect(rolledBackFingerprint).toContain("connect_react(uuid, text):<unnamed>->void");
    expect(rolledBackFingerprint).not.toContain("p_expected_state");

    const preserved = await db.query<{ reactions: number; messages: number; conversations: number }>(`
      select
        (select count(*)::int from public.connect_message_reactions where id = '${REACTION}') as reactions,
        (select count(*)::int from public.connect_messages where id = '${MESSAGE}') as messages,
        (select count(*)::int from public.connect_conversations where id = '${CONVERSATION}') as conversations
    `);
    expect(preserved.rows[0]).toEqual({ reactions: 1, messages: 1, conversations: 1 });

    await execute(M0265);
    await execute(M0266);
    expect(await fingerprint()).toBe(firstAppliedFingerprint);
  }, 180_000);
});
