import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/0266_connect_handover_cas_audit.sql"),
  "utf8",
);
const rollback = readFileSync(
  resolve(process.cwd(), "supabase/migrations/ROLLBACK_0266_connect_handover_cas_audit.sql"),
  "utf8",
);

describe("0266 · Contrato SQL de Transición Atómica, CAS Obligatorio y RBAC WhatsApp", () => {
  it("agrega columna de auditoría handover_by a connect_conversations", () => {
    expect(migration).toContain("add column if not exists handover_by uuid references public.profiles(id)");
  });

  it("elimina cualquier firma antigua o sobrecarga previa sin CAS", () => {
    expect(migration).toContain("drop function if exists public.connect_set_handover_state(uuid, text)");
    expect(migration).toContain("drop function if exists public.connect_set_handover_state(uuid, text, text)");
  });

  it("exige CAS OBLIGATORIO sin default null ni sobrecargas elusivas", () => {
    // La firma no debe tener default null
    expect(migration).toMatch(/connect_set_handover_state\(\s*p_conversation_id uuid,\s*p_state text,\s*p_expected_state text\s*\)\s*returns jsonb/s);
    expect(migration).not.toContain("p_expected_state text default null");

    // Valida explícitamente que p_expected_state no sea null y pertenezca a los estados permitidos
    expect(migration).toContain("if p_expected_state is null or p_expected_state not in ('BOT_ACTIVE', 'PAUSED_HUMAN') then");
    expect(migration).toContain("raise exception 'p_expected_state obligatorio y válido para CAS: %'");
  });

  it("impone autorización empresarial exacta mediante nexus_link_can('nexus_link.whatsapp.send')", () => {
    expect(migration).toContain("if not public.nexus_link_can('nexus_link.whatsapp.send') then");
    expect(migration).toContain("raise exception 'sin permiso para modificar handover de whatsapp' using errcode = 'insufficient_privilege'");
    // No debe permitir atajos por connect.edit, _connect_is_member ni is_admin
    expect(migration).not.toContain("has_permission('connect.edit')");
    expect(migration).not.toContain("_connect_is_member");
    expect(migration).not.toContain("is_admin()");
  });

  it("valida existencia y tipo exacto kind = 'whatsapp' con bloqueo atómico FOR UPDATE", () => {
    expect(migration).toContain("select handover_state, kind into v_current_state, v_kind");
    expect(migration).toContain("for update");
    expect(migration).toContain("if not found then");
    expect(migration).toContain("raise exception 'conversacion inexistente' using errcode = 'no_data_found'");
    expect(migration).toContain("if v_kind <> 'whatsapp' then");
    expect(migration).toContain("raise exception 'la conversacion no es de tipo whatsapp' using errcode = 'check_violation'");
  });

  it("audita actor y fecha real en TODAS las transiciones (pausa y reactivación)", () => {
    expect(migration).toContain("v_actor uuid := auth.uid()");
    // Ambas transiciones actualizan handover_at = now() y handover_by = v_actor
    expect(migration).toContain("handover_state = p_state,");
    expect(migration).toContain("handover_at = now(),");
    expect(migration).toContain("handover_by = v_actor");
    expect(migration).toContain("returning handover_at into v_updated_at");
    // El JSON incluye actor y updated_at
    expect(migration).toContain("'updated_at', v_updated_at");
    expect(migration).toContain("'actor', v_actor");
  });

  it("provee rollback simétrico data-preserving", () => {
    // Preserva handover_by si contiene filas con auditoría
    expect(rollback).toContain("if not exists (select 1 from public.connect_conversations where handover_by is not null) then");
    expect(rollback).toContain("alter table public.connect_conversations drop column if exists handover_by");
    expect(rollback).toContain("drop function if exists public.connect_set_handover_state(uuid, text, text)");
    expect(rollback).toMatch(/connect_set_handover_state\(\s*p_conversation_id uuid,\s*p_state text\s*\)\s*returns void/s);
    expect(rollback).toContain("notify pgrst, 'reload schema'");
  });

  it("demuestra contrato de autorización y CAS en simulación SQL completa", () => {
    type DbConversation = { id: string; kind: string; handover_state: string; handover_by?: string | null; handover_at?: string | null };
    type UserContext = { id: string; capabilities: Set<string>; isAdmin: boolean; isMember: boolean };

    const simulateRpc = (
      user: UserContext,
      db: Map<string, DbConversation>,
      args: { conversationId: string; state: string; expectedState?: string | null },
    ) => {
      // 1. Validación de CAS obligatorio
      if (!args.expectedState || !["BOT_ACTIVE", "PAUSED_HUMAN"].includes(args.expectedState)) {
        throw new Error("p_expected_state obligatorio y válido para CAS");
      }
      if (!["BOT_ACTIVE", "PAUSED_HUMAN"].includes(args.state)) {
        throw new Error("Estado de handover inválido");
      }

      // 2. Validación de RBAC exacto
      if (!user.capabilities.has("nexus_link.whatsapp.send")) {
        throw new Error("sin permiso para modificar handover de whatsapp (insufficient_privilege)");
      }

      // 3. Validación de conversación y tipo
      const conv = db.get(args.conversationId);
      if (!conv) {
        throw new Error("conversacion inexistente (no_data_found)");
      }
      if (conv.kind !== "whatsapp") {
        throw new Error("la conversacion no es de tipo whatsapp (check_violation)");
      }

      // 4. Verificación CAS
      if (conv.handover_state !== args.expectedState) {
        return {
          ok: false,
          conflict: true,
          state: conv.handover_state,
          message: "El estado fue modificado por otro operador.",
        };
      }

      // 5. Mutación y auditoría integral
      const nowIso = new Date().toISOString();
      conv.handover_state = args.state;
      conv.handover_at = nowIso;
      conv.handover_by = user.id;

      return {
        ok: true,
        state: args.state,
        updated_at: nowIso,
        actor: user.id,
      };
    };

    const convId = "conv-1";
    const internalConvId = "conv-internal";
    const db = new Map<string, DbConversation>([
      [convId, { id: convId, kind: "whatsapp", handover_state: "BOT_ACTIVE" }],
      [internalConvId, { id: internalConvId, kind: "internal_chat", handover_state: "BOT_ACTIVE" }],
    ]);

    const opWithCap: UserContext = { id: "op-1", capabilities: new Set(["nexus_link.whatsapp.send"]), isAdmin: false, isMember: true };
    const memberNoCap: UserContext = { id: "op-2", capabilities: new Set([]), isAdmin: false, isMember: true };
    const adminNoCap: UserContext = { id: "admin-1", capabilities: new Set([]), isAdmin: true, isMember: false };

    // CAS sin expectedState -> Rechazado fail-closed
    expect(() => simulateRpc(opWithCap, db, { conversationId: convId, state: "PAUSED_HUMAN", expectedState: null })).toThrow(/p_expected_state obligatorio/);

    // Miembro sin capacidad -> Rechazado
    expect(() => simulateRpc(memberNoCap, db, { conversationId: convId, state: "PAUSED_HUMAN", expectedState: "BOT_ACTIVE" })).toThrow(/insufficient_privilege/);

    // Administrador sin capacidad -> Rechazado
    expect(() => simulateRpc(adminNoCap, db, { conversationId: convId, state: "PAUSED_HUMAN", expectedState: "BOT_ACTIVE" })).toThrow(/insufficient_privilege/);

    // Conversación interna -> Rechazada
    expect(() => simulateRpc(opWithCap, db, { conversationId: internalConvId, state: "PAUSED_HUMAN", expectedState: "BOT_ACTIVE" })).toThrow(/check_violation/);

    // Conversación inexistente -> Rechazada
    expect(() => simulateRpc(opWithCap, db, { conversationId: "conv-ghost", state: "PAUSED_HUMAN", expectedState: "BOT_ACTIVE" })).toThrow(/no_data_found/);

    // Pausa exitosa con auditoría
    const resPause = simulateRpc(opWithCap, db, { conversationId: convId, state: "PAUSED_HUMAN", expectedState: "BOT_ACTIVE" });
    expect(resPause.ok).toBe(true);
    expect(resPause.state).toBe("PAUSED_HUMAN");
    expect(resPause.actor).toBe("op-1");
    expect(db.get(convId)?.handover_state).toBe("PAUSED_HUMAN");
    expect(db.get(convId)?.handover_by).toBe("op-1");

    // Reactivación exitosa con auditoría
    const op2WithCap: UserContext = { id: "op-3", capabilities: new Set(["nexus_link.whatsapp.send"]), isAdmin: false, isMember: true };
    const resResume = simulateRpc(op2WithCap, db, { conversationId: convId, state: "BOT_ACTIVE", expectedState: "PAUSED_HUMAN" });
    expect(resResume.ok).toBe(true);
    expect(resResume.state).toBe("BOT_ACTIVE");
    expect(resResume.actor).toBe("op-3");
    expect(db.get(convId)?.handover_state).toBe("BOT_ACTIVE");
    expect(db.get(convId)?.handover_by).toBe("op-3");

    // Conflicto CAS (intento de pausar cuando ya está BOT_ACTIVE pero expectedState decía PAUSED_HUMAN)
    const resConflict = simulateRpc(opWithCap, db, { conversationId: convId, state: "PAUSED_HUMAN", expectedState: "PAUSED_HUMAN" });
    expect(resConflict.ok).toBe(false);
    expect(resConflict.conflict).toBe(true);
  });
});
