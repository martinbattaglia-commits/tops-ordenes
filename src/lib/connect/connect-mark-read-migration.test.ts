import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/0264_connect_mark_read_named_arguments.sql"),
  "utf8",
);
const rollback = readFileSync(
  resolve(process.cwd(), "supabase/migrations/ROLLBACK_0264_connect_mark_read_named_arguments.sql"),
  "utf8",
);

describe("0264 · contrato nominal connect_mark_read", () => {
  it("declara exactamente los argumentos que envía supabase-js", () => {
    expect(migration).toMatch(/connect_mark_read\(\s*p_conversation_id uuid,\s*p_up_to_seq bigint\s*\)/s);
    expect(migration).toContain("connect_mark_read_pre_0246(p_conversation_id, p_up_to_seq)");
  });

  it("preserva security definer, search_path y mínimo privilegio", () => {
    expect(migration).toContain("security definer");
    expect(migration).toContain("set search_path = public, pg_temp");
    expect(migration).toContain("grant execute on function public.connect_mark_read(uuid, bigint) to authenticated");
  });

  it("incluye rollback simétrico al wrapper sin nombres de 0246", () => {
    expect(rollback).toMatch(/connect_mark_read\(uuid, bigint\)/);
    expect(rollback).toContain("connect_mark_read_pre_0246($1, $2)");
    expect(rollback).toContain("notify pgrst, 'reload schema'");
  });
});
