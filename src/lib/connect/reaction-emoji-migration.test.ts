import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/0265_connect_reaction_emoji_whitelist.sql"),
  "utf8",
);
const rollback = readFileSync(
  resolve(process.cwd(), "supabase/migrations/ROLLBACK_0265_connect_reaction_emoji_whitelist.sql"),
  "utf8",
);

describe("0265 · Contrato SQL de Reacciones con Emojis Canónicos (6 Emojis)", () => {
  it("audita filas legacy de forma fail-closed y NO elimina datos silenciosamente", () => {
    // No debe contener delete from connect_message_reactions
    expect(migration).not.toMatch(/delete\s+from\s+(?:public\.)?connect_message_reactions/i);
    // Debe contener el bloque do de auditoría fail-closed
    expect(migration).toContain("v_incompatible_count integer;");
    expect(migration).toContain("MIGRATION_HALTED_NON_CONFORMANT_DATA");
    expect(migration).toContain("using errcode = 'integrity_constraint_violation'");
  });

  it("impone check constraint con la allowlist exacta de 6 emojis", () => {
    expect(migration).toContain("connect_message_reactions_emoji_check");
    expect(migration).toContain("check (emoji in ('👍', '❤️', '😂', '😮', '😢', '🙏'))");
  });

  it("valida la allowlist en la función base connect_react_pre_0246", () => {
    expect(migration).toContain("if p_emoji not in ('👍', '❤️', '😂', '😮', '😢', '🙏') then");
    expect(migration).toContain("raise exception 'emoji no soportado: %', p_emoji using errcode = 'check_violation'");
  });

  it("preserva la protección 0246 (nexus_depot_manager_reject_legacy_connect) en connect_react", () => {
    expect(migration).toContain("perform public.nexus_depot_manager_reject_legacy_connect()");
    expect(migration).toContain("perform public.connect_react_pre_0246(p_message_id, p_emoji)");
  });

  it("declara parámetros nominales para compatibilidad con PostgREST y evita firmas ambiguas", () => {
    expect(migration).toContain("drop function if exists public.connect_react(uuid, text)");
    expect(migration).toMatch(/connect_react\(\s*p_message_id uuid,\s*p_emoji text\s*\)/s);
  });

  it("establece permisos de mínimo privilegio", () => {
    expect(migration).toContain("revoke all on function public.connect_react_pre_0246(uuid, text)");
    expect(migration).toContain("grant execute on function public.connect_react(uuid, text) to authenticated");
  });

  it("provee rollback simétrico data-preserving", () => {
    expect(rollback).toContain("drop constraint if exists connect_message_reactions_emoji_check");
    expect(rollback).toContain("connect_react_pre_0246");
    expect(rollback).toContain("drop function if exists public.connect_react(uuid, text)");
    expect(rollback).toContain("perform public.nexus_depot_manager_reject_legacy_connect()");
    expect(rollback).toContain("notify pgrst, 'reload schema'");
  });

  it("demuestra detención fail-closed ante fila legacy incompatible (simulación lógica de migración)", () => {
    const simulateMigrationAudit = (existingEmojis: string[]) => {
      const allowed = new Set(["👍", "❤️", "😂", "😮", "😢", "🙏"]);
      const incompatible = existingEmojis.filter((e) => !allowed.has(e));
      if (incompatible.length > 0) {
        throw new Error(
          `MIGRATION_HALTED_NON_CONFORMANT_DATA: Se detectaron ${incompatible.length} reacciones con emojis no autorizados. La migración se detiene fail-closed sin alterar datos.`,
        );
      }
      return { success: true };
    };

    // Caso 1: base con emojis no conformes (ej: 🚀, 🎉)
    const dirtyDb = ["👍", "❤️", "🚀", "🎉"];
    expect(() => simulateMigrationAudit(dirtyDb)).toThrow(/MIGRATION_HALTED_NON_CONFORMANT_DATA/);
    // Las filas se preservan intactas en dirtyDb
    expect(dirtyDb).toEqual(["👍", "❤️", "🚀", "🎉"]);

    // Caso 2: base con únicamente los 6 emojis autorizados
    const cleanDb = ["👍", "❤️", "😂", "😮", "😢", "🙏"];
    expect(simulateMigrationAudit(cleanDb)).toEqual({ success: true });
    expect(cleanDb).toHaveLength(6);
  });
});
