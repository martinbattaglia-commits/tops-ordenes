/**
 * WMS UI-1 · Server Actions del caso.
 *
 * El cliente de sesión se inyecta por alias (`_stubs/supabase-server.mjs`), así
 * que se ejercita la acción REAL —validación de id, sesión, tenant, CAS,
 * motivo y sanitización— sin red, sin cookies y sin DOM.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
// @ts-expect-error stub inyectado por alias en vitest.wms-ui.config.ts
import { __setSessionClient, __setAdminClient } from "@/lib/supabase/server";
import {
  decideCustodyCaseAction,
  loadCustodyCaseAction,
  refreshCustodyCaseAction,
  registerHumanInspectionAction,
} from "@/app/(app)/wms/custody/actions";

const CASE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CLIENT = "22222222-2222-4222-8222-222222222222";
const SHIPMENT = "11111111-1111-4111-8111-111111111111";
const USER = "77777777-7777-4777-8777-777777777777";
const SESSION = "88888888-8888-4888-8888-888888888888";
const SHA = "a".repeat(64);

interface Recorded { table: string; column?: string; value?: unknown }

/** Doble del cliente Supabase de SESIÓN, con la forma que usan las acciones. */
function sessionDouble(opts: {
  caseRow?: Record<string, unknown> | null;
  role?: string;
  clientId?: string | null;
  permissions?: string[];
  rpcError?: string;
  claims?: Record<string, unknown>;
  user?: { id: string } | null;
} = {}) {
  const reads: Recorded[] = [];
  const rpcs: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const caseRow =
    opts.caseRow === undefined
      ? {
          id: CASE, version: 3, client_id: CLIENT, packing_unit_id: null, shipment_id: SHIPMENT,
          state: "REVIEW_REQUIRED", hold_reasons: ["NO_CALIBRATED_THRESHOLD"],
          ingress_evidence_id: null, egress_evidence_id: null,
          provider: "p", model: "m", prompt_version: "v", execution_mode: "real",
          outcome: "ok", verdict: "coincide", model_confidence: "0.870", provider_error: null,
          chain_status: "verified", chain_events_checked: 4, chain_head: "head-1",
          chain_attested_at: "2026-08-10T11:30:00.000Z", decision_id: null,
          created_at: "2026-08-08T10:15:00.000Z", updated_at: "2026-08-10T09:42:00.000Z",
        }
      : opts.caseRow;

  const table = (name: string) => ({
    select: () => ({
      eq: (column: string, value: unknown) => {
        reads.push({ table: name, column, value });
        return {
          async maybeSingle() {
            if (name === "custody_integrity_cases") return { data: caseRow, error: null };
            if (name === "profiles") {
              return {
                data: { role: opts.role ?? "admin", client_id: opts.clientId ?? null },
                error: null,
              };
            }
            return { data: null, error: null };
          },
          order: () => ({
            async limit() { return { data: [{ row_hash: "head-1" }], error: null }; },
          }),
        };
      },
      async in(_c: string, _v: readonly unknown[]) {
        if (name === "my_permissions") {
          return {
            data: (opts.permissions ?? ["wms.custody.decide"]).map((slug) => ({ slug })),
            error: null,
          };
        }
        return { data: [], error: null };
      },
    }),
  });

  return {
    reads,
    rpcs,
    from: table,
    async rpc(fn: string, args: Record<string, unknown>) {
      rpcs.push({ fn, args });
      if (opts.rpcError) return { data: null, error: { message: opts.rpcError } };
      return { data: "decision-1", error: null };
    },
    auth: {
      async getUser() {
        return { data: { user: opts.user === undefined ? { id: USER } : opts.user }, error: null };
      },
      async getClaims() {
        return {
          data: { claims: opts.claims ?? { sub: USER, session_id: SESSION } },
          error: null,
        };
      },
    },
  };
}

beforeEach(() => {
  __setSessionClient(null);
  __setAdminClient(null);
});

describe("loadCustodyCaseAction", () => {
  it("un id no canónico se rechaza SIN tocar la base", async () => {
    const db = sessionDouble();
    __setSessionClient(db);
    const res = await loadCustodyCaseAction("no-es-uuid");
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toBe("Identificador de caso inválido");
    expect(db.reads).toHaveLength(0);
  });

  it("sin cliente de sesión no se devuelve nada", async () => {
    const res = await loadCustodyCaseAction(CASE);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toBe("El caso no existe o no es accesible");
  });

  it("un caso inexistente (o filtrado por RLS) es indistinguible: misma etiqueta", async () => {
    __setSessionClient(sessionDouble({ caseRow: null }));
    const res = await loadCustodyCaseAction(CASE);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toBe("El caso no existe o no es accesible");
  });

  it("devuelve el view-model, sin datos internos", async () => {
    __setSessionClient(sessionDouble());
    const res = await loadCustodyCaseAction(CASE, {
      draftReason: "inspección física conforme",
    });
    expect(res.ok).toBe(true);
    if (!res.ok || !res.data) return;
    expect(res.data.caseId).toBe(CASE);
    expect(res.data.state).toBe("REVIEW_REQUIRED");
    expect(res.data.version).toBe(3);
    const s = JSON.stringify(res.data);
    expect(s).not.toContain(SHA);
    expect(s).not.toContain("custody-evidence");
    expect(s).not.toContain(SESSION);
  });

  it("un usuario de OTRO cliente no ve el caso", async () => {
    __setSessionClient(sessionDouble({ role: "cliente", clientId: "otro-cliente" }));
    const res = await loadCustodyCaseAction(CASE);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toBe("El caso no existe o no es accesible");
  });

  it("sin sesión acreditada (claims sin session_id) no hay actor", async () => {
    __setSessionClient(sessionDouble({ claims: { sub: USER } }));
    const res = await loadCustodyCaseAction(CASE);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toBe("Sesión no verificada");
  });

  it("refresh revalida y vuelve a leer", async () => {
    __setSessionClient(sessionDouble());
    const res = await refreshCustodyCaseAction(CASE);
    expect(res.ok).toBe(true);
  });
});

describe("decideCustodyCaseAction", () => {
  const base = {
    caseId: CASE,
    expectedVersion: 3,
    decision: "quarantine" as const,
    reason: "diferencias visibles en la esquina",
  };

  it("rechaza una decisión desconocida", async () => {
    __setSessionClient(sessionDouble());
    const res = await decideCustodyCaseAction({ ...base, decision: "liberar" as never });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toBe("La decisión enviada no es válida");
  });

  it("rechaza una versión ausente o no entera: el CAS es obligatorio", async () => {
    __setSessionClient(sessionDouble());
    for (const v of [0, -1, 1.5, NaN, undefined as unknown as number]) {
      const res = await decideCustodyCaseAction({ ...base, expectedVersion: v });
      expect(res.ok).toBe(false);
    }
  });

  it("un motivo corto no llega a la base", async () => {
    const db = sessionDouble();
    __setSessionClient(db);
    const res = await decideCustodyCaseAction({ ...base, reason: "corto" });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toBe("El motivo es obligatorio y debe ser específico");
    expect(db.rpcs.filter((r) => r.fn === "decide_custody_integrity")).toHaveLength(0);
  });

  it("la cuarentena llega a la RPC con el CAS de versión y el motivo", async () => {
    const db = sessionDouble();
    __setSessionClient(db);
    const res = await decideCustodyCaseAction(base);
    expect(res.ok).toBe(true);
    const call = db.rpcs.find((r) => r.fn === "decide_custody_integrity");
    expect(call).toBeDefined();
    expect(call!.args.p_expected_version).toBe(3);
    expect(call!.args.p_decision).toBe("quarantine");
    expect(call!.args.p_reason).toBe(base.reason);
    // La identidad NUNCA viaja en el payload: la pone el servidor.
    expect(Object.keys(call!.args)).not.toContain("p_actor_id");
    expect(Object.keys(call!.args)).not.toContain("p_session_id");
    expect(Object.keys(call!.args)).not.toContain("p_client_id");
  });

  it("un rol sin permiso no decide", async () => {
    __setSessionClient(sessionDouble({ permissions: [] }));
    const res = await decideCustodyCaseAction(base);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toBe("No tenés permiso para decidir");
  });

  it("un conflicto de versión se muestra como carrera, no como error crudo", async () => {
    __setSessionClient(sessionDouble({ rpcError: "conflicto de versión del caso" }));
    const res = await decideCustodyCaseAction(base);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toBe("Otra persona decidió primero: recargá el caso");
  });

  it("un error crudo de PostgreSQL NUNCA se muestra tal cual", async () => {
    __setSessionClient(
      sessionDouble({ rpcError: 'null value in column "x" violates not-null constraint at public.custody_integrity_cases' }),
    );
    const res = await decideCustodyCaseAction(base);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).not.toMatch(/null value|constraint|public\./);
    expect(res.error).not.toContain("custody_integrity_cases");
  });

  it("liberar sin evidencia de inspección se rechaza antes de la RPC", async () => {
    const db = sessionDouble();
    __setSessionClient(db);
    const res = await decideCustodyCaseAction({ ...base, decision: "release", reason: "todo conforme acá" });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toBe("La liberación no cumple los requisitos");
    expect(db.rpcs.filter((r) => r.fn === "decide_custody_integrity")).toHaveLength(0);
  });
});

describe("registerHumanInspectionAction fija el par canónico en el SERVIDOR", () => {
  it("ignora stage/event_type/kind del formulario", async () => {
    __setSessionClient(sessionDouble());
    __setAdminClient(null); // sin cliente admin: se corta después de validar
    const form = new FormData();
    form.set("file", new File([new Uint8Array([1, 2, 3])], "foto.png", { type: "image/png" }));
    form.set("scope", "shipment");
    form.set("entity_id", SHIPMENT);
    // Par INVÁLIDO enviado por el navegador: sin forzado, sería rechazado.
    form.set("stage", "entrega");
    form.set("event_type", "inspeccion_humana");
    form.set("kind", "documento");

    const res = await registerHumanInspectionAction(form);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    // Llegó más allá de la validación de contrato ⇒ el par fue forzado.
    expect(res.error).toBe("Operación administrativa no disponible");
    expect(res.error).not.toBe("Solicitud de captura inválida");
  });

  it("el forzado está en el código de la acción, no en el llamador", () => {
    const src = readFileSync(
      resolve(process.cwd(), "src/app/(app)/wms/custody/actions.ts"),
      "utf8",
    );
    const fn = src.slice(src.indexOf("export async function registerHumanInspectionAction"));
    expect(fn).toMatch(/forced\.set\("stage", "despacho"\)/);
    expect(fn).toMatch(/forced\.set\("event_type", "inspeccion_humana"\)/);
    expect(fn).toMatch(/forced\.set\("kind", "foto"\)/);
  });

  it("ninguna acción del caso lee identidad desde el FormData", () => {
    const src = readFileSync(
      resolve(process.cwd(), "src/app/(app)/wms/custody/actions.ts"),
      "utf8",
    );
    expect(src).not.toMatch(/form\.get\(\s*["'](actor_id|user_id|client_id|session_id|role|token|claims)["']\s*\)/);
  });
});
