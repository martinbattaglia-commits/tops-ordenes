/**
 * REMEDIACIÓN CONSOLIDADA · LA EVIDENCIA DE INSPECCIÓN LA DERIVA EL SERVIDOR.
 *
 * ─── QUÉ MUTANTE MATA CADA GRUPO ──────────────────────────────────────────
 *
 * El defecto que originó estas pruebas fue silencioso: la página cargaba el
 * caso sin lista de inspección, el modelo de presentación recibía `[]` y la
 * liberación quedaba bloqueada PARA SIEMPRE con el cartel «falta la foto de
 * inspección humana» —incluso con la foto sacada—. Ningún test lo notó porque
 * todos inyectaban la lista a mano.
 *
 * Acá se prueba lo contrario: que NADIE la inyecte y que igual aparezca,
 * porque la deriva el servidor. Si alguien borra la derivación, o vuelve a
 * aceptar la lista desde afuera, estos casos se ponen en rojo.
 */
import { beforeEach, describe, expect, it } from "vitest";
// @ts-expect-error stub inyectado por alias en vitest.wms-ui.config.ts
import { __setSessionClient, __setAdminClient } from "@/lib/supabase/server";
import {
  decideCustodyCaseAction,
  loadCustodyCaseAction,
} from "@/app/(app)/wms/custody/actions";

const CASE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CLIENT = "22222222-2222-4222-8222-222222222222";
const SHIPMENT = "11111111-1111-4111-8111-111111111111";
const USER = "77777777-7777-4777-8777-777777777777";
const SESSION = "88888888-8888-4888-8888-888888888888";
const ING = "33333333-3333-4333-8333-333333333333";
const EGR = "55555555-5555-4555-8555-555555555555";
const INSPECCION = "66666666-6666-4666-8666-666666666666";
const SHA = "a".repeat(64);

interface Opts {
  /** Lo que devuelve `custody_inspection_candidates`. */
  candidates?: string[];
  candidatesError?: string;
  permissions?: string[];
  role?: string;
  pendingAttempt?: { id: string; status: string; expires_at: string } | null;
  decisionId?: string | null;
  state?: string;
}

/**
 * Cliente de sesión con la forma exacta que consumen las acciones. El caso
 * está en el mejor estado posible para liberar: si la liberación no se
 * habilita, es por la evidencia de inspección y por nada más.
 */
function sessionDouble(opts: Opts = {}) {
  const rpcs: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const caseRow = {
    id: CASE, version: 3, client_id: CLIENT, packing_unit_id: null, shipment_id: SHIPMENT,
    state: opts.state ?? "REVIEW_REQUIRED", hold_reasons: ["NO_CALIBRATED_THRESHOLD"],
    ingress_evidence_id: ING, egress_evidence_id: EGR,
    provider: "p", model: "m", prompt_version: "v", execution_mode: "real",
    outcome: "ok", verdict: "coincide", model_confidence: "0.870", provider_error: null,
    chain_status: "verified", chain_events_checked: 4, chain_head: "head-1",
    chain_attested_at: "2026-08-10T11:30:00.000Z",
    decision_id: opts.decisionId ?? null,
    created_at: "2026-08-08T10:15:00.000Z", updated_at: "2026-08-10T09:42:00.000Z",
  };

  const evidenceRow = (id: string, stage: string, eventType: string) => ({
    id, event_id: `ev-${id}`, kind: "foto", sha256: SHA, redacted: false,
    captured_at: "2026-08-09T10:00:00.000Z",
    custody_events: {
      packing_unit_id: null, shipment_id: SHIPMENT, stage, event_type: eventType,
      occurred_at: "2026-08-09T10:00:00.000Z",
    },
  });

  const table = (name: string) => ({
    select: () => ({
      eq: (_c: string, _v: unknown) => ({
        async maybeSingle() {
          if (name === "custody_integrity_cases") return { data: caseRow, error: null };
          if (name === "profiles") {
            return { data: { role: opts.role ?? "admin", client_id: null }, error: null };
          }
          return { data: null, error: null };
        },
        order: () => ({
          async limit() {
            if (name === "custody_integrity_evaluation_attempts") {
              return { data: opts.pendingAttempt ? [opts.pendingAttempt] : [], error: null };
            }
            return { data: [{ row_hash: "head-1" }], error: null };
          },
        }),
      }),
      async in(_c: string, values: readonly unknown[]) {
        if (name === "my_permissions") {
          return {
            data: (opts.permissions ?? ["wms.custody.decide", "wms.edit"]).map((slug) => ({ slug })),
            error: null,
          };
        }
        if (name === "custody_evidence") {
          // `.in()` FILTRA, igual que el cliente real: devolver de más haría
          // que el dominio rechazara por ids no solicitados y la prueba
          // mediría el doble en vez del código.
          const todas = [
            evidenceRow(ING, "packing", "foto_packing"),
            evidenceRow(EGR, "entrega", "foto_entrega"),
            evidenceRow(INSPECCION, "despacho", "inspeccion_humana"),
          ];
          return { data: todas.filter((r) => values.includes(r.id)), error: null };
        }
        return { data: [], error: null };
      },
    }),
  });

  return {
    rpcs,
    from: table,
    async rpc(fn: string, args: Record<string, unknown>) {
      rpcs.push({ fn, args });
      if (fn === "custody_inspection_candidates") {
        if (opts.candidatesError) return { data: null, error: { message: opts.candidatesError } };
        return {
          data: (opts.candidates ?? [INSPECCION]).map((evidence_id) => ({
            evidence_id, event_id: `ev-${evidence_id}`,
            occurred_at: "2026-08-09T10:00:00.000Z", chain_seq: 4,
          })),
          error: null,
        };
      }
      if (fn === "decide_custody_integrity") return { data: "decision-1", error: null };
      return { data: null, error: null };
    },
    auth: {
      async getUser() { return { data: { user: { id: USER } }, error: null }; },
      async getClaims() {
        return { data: { claims: { sub: USER, session_id: SESSION } }, error: null };
      },
    },
  };
}

beforeEach(() => {
  __setAdminClient(null);
});

describe("la página NO aporta la lista: el servidor la deriva", () => {
  it("liberar se habilita SIN que nadie inyecte evidencias de inspección", async () => {
    __setSessionClient(sessionDouble());
    // Como la página, pero con el motivo ya tipeado: sin motivo la liberación
    // está bloqueada por el motivo, y lo que se mide acá es la inspección.
    const res = await loadCustodyCaseAction(CASE, {
      draftReason: "inspección física conforme y sin diferencias",
    });
    expect(res.ok).toBe(true);
    if (!res.ok || !res.data) return;

    expect(res.data.release.enabled).toBe(true);
    expect(res.data.release.blockers).not.toContain("Falta la foto de inspección humana");
    expect(res.data.inspection.eligible).toBe(1);
  });

  it("la derivación se pide al SERVIDOR, con el id del caso y nada más", async () => {
    const db = sessionDouble();
    __setSessionClient(db);
    await loadCustodyCaseAction(CASE);

    const call = db.rpcs.find((r) => r.fn === "custody_inspection_candidates");
    expect(call).toBeDefined();
    expect(call!.args).toEqual({ p_case_id: CASE });
  });

  it("sin candidatos elegibles, liberar sigue bloqueado y se dice por qué", async () => {
    __setSessionClient(sessionDouble({ candidates: [] }));
    const res = await loadCustodyCaseAction(CASE, {
      draftReason: "inspección física conforme y sin diferencias",
    });
    expect(res.ok).toBe(true);
    if (!res.ok || !res.data) return;
    expect(res.data.release.enabled).toBe(false);
    expect(res.data.release.blockers).toContain("Falta la foto de inspección humana");
    expect(res.data.inspection.eligible).toBe(0);
    // Cuarentena NO se debilita por esto.
    expect(res.data.quarantine.enabled).toBe(true);
  });

  it("si la derivación falla, falla CERRADO: no libera y el caso sigue visible", async () => {
    __setSessionClient(sessionDouble({ candidatesError: "boom" }));
    const res = await loadCustodyCaseAction(CASE);
    expect(res.ok).toBe(true);
    if (!res.ok || !res.data) return;
    expect(res.data.release.enabled).toBe(false);
    expect(res.data.inspection.eligible).toBe(0);
  });

  it("sin permiso de decisión no se deriva nada y no se filtra el motivo", async () => {
    const db = sessionDouble({ permissions: ["wms.view"] });
    __setSessionClient(db);
    const res = await loadCustodyCaseAction(CASE);
    expect(res.ok).toBe(true);
    if (!res.ok || !res.data) return;
    expect(db.rpcs.find((r) => r.fn === "custody_inspection_candidates")).toBeUndefined();
    expect(res.data.release.enabled).toBe(false);
  });

  it("un caso ya decidido no consulta candidatos", async () => {
    const db = sessionDouble({ decisionId: "d-1", state: "RELEASED" });
    __setSessionClient(db);
    await loadCustodyCaseAction(CASE);
    expect(db.rpcs.find((r) => r.fn === "custody_inspection_candidates")).toBeUndefined();
  });
});

describe("la decisión REDERIVA y no confía en lo que llegue de afuera", () => {
  it("liberar manda al RPC las evidencias derivadas por el servidor", async () => {
    const db = sessionDouble();
    __setSessionClient(db);
    await decideCustodyCaseAction({
      caseId: CASE,
      expectedVersion: 3,
      decision: "release",
      reason: "inspección física conforme y sin diferencias",
    });

    const decide = db.rpcs.find((r) => r.fn === "decide_custody_integrity");
    expect(decide).toBeDefined();
    expect(decide!.args.p_inspection_evidence_ids).toEqual([INSPECCION]);
    // Y se rederivó en ESTA llamada, no se reusó la del render.
    expect(db.rpcs.filter((r) => r.fn === "custody_inspection_candidates")).toHaveLength(1);
  });

  it("un `inspectionEvidenceIds` inyectado en el input NO llega a la base", async () => {
    const db = sessionDouble({ candidates: [INSPECCION] });
    __setSessionClient(db);
    const intruso = "99999999-9999-4999-8999-999999999999";
    await decideCustodyCaseAction({
      caseId: CASE,
      expectedVersion: 3,
      decision: "release",
      reason: "inspección física conforme y sin diferencias",
      // El campo no existe en el tipo: se fuerza como lo haría un cliente hostil.
      ...({ inspectionEvidenceIds: [intruso] } as Record<string, unknown>),
    });

    const decide = db.rpcs.find((r) => r.fn === "decide_custody_integrity");
    expect(decide!.args.p_inspection_evidence_ids).toEqual([INSPECCION]);
    expect(JSON.stringify(decide!.args)).not.toContain(intruso);
  });

  it("cuarentena NO consume evidencia de inspección", async () => {
    const db = sessionDouble();
    __setSessionClient(db);
    await decideCustodyCaseAction({
      caseId: CASE,
      expectedVersion: 3,
      decision: "quarantine",
      reason: "diferencias visibles en la esquina del bulto",
    });

    const decide = db.rpcs.find((r) => r.fn === "decide_custody_integrity");
    expect(decide!.args.p_inspection_evidence_ids).toEqual([]);
    expect(db.rpcs.find((r) => r.fn === "custody_inspection_candidates")).toBeUndefined();
  });
});

describe("reserva de evaluación en vuelo", () => {
  it("un intento pendiente y vigente deshabilita volver a evaluar", async () => {
    __setSessionClient(
      sessionDouble({
        pendingAttempt: {
          id: "attempt-1",
          status: "pending",
          expires_at: new Date(Date.now() + 600_000).toISOString(),
        },
      }),
    );
    const res = await loadCustodyCaseAction(CASE);
    expect(res.ok).toBe(true);
    if (!res.ok || !res.data) return;
    expect(res.data.reevaluation.inFlight).toBe(true);
    expect(res.data.reevaluation.enabled).toBe(false);
    expect(res.data.reevaluation.blockers).toContain(
      "Ya hay una evaluación en curso para este caso",
    );
  });

  it("un intento VENCIDO no bloquea: la reserva ya no existe", async () => {
    __setSessionClient(
      sessionDouble({
        pendingAttempt: {
          id: "attempt-1",
          status: "pending",
          expires_at: new Date(Date.now() - 600_000).toISOString(),
        },
      }),
    );
    const res = await loadCustodyCaseAction(CASE);
    expect(res.ok).toBe(true);
    if (!res.ok || !res.data) return;
    expect(res.data.reevaluation.inFlight).toBe(false);
    expect(res.data.reevaluation.enabled).toBe(true);
  });
});
