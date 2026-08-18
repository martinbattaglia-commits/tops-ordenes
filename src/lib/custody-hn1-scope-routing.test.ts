/**
 * HN-1 · EL EXTREMO DE ADELANTE · la pantalla deja de enrutar a la v1.
 *
 * ─── QUÉ SE MIDE ─────────────────────────────────────────────────────────
 *
 * `integrity-supabase.ts` tenía un ternario que mandaba todo scope no físico
 * a `decide_custody_integrity` (v1). Esa RPC está revocada para
 * `authenticated` desde `0250a:2199-2200`, así que el ternario no elegía
 * entre dos caminos: elegía entre un camino y un `42501` crudo de PostgreSQL
 * subiendo a la cara del inspector.
 *
 * Estas pruebas ejercitan las tres cosas que el cierre exige:
 *
 *   1. el scope físico llama a la v2, y a NINGUNA otra RPC;
 *   2. un scope no físico —y un scope ausente— produce un rechazo TIPADO del
 *      dominio ANTES de tocar la plataforma: la RPC no se llama ni una vez;
 *   3. ese rechazo llega al repositorio como `SCOPE_NOT_DECIDABLE` y NO como
 *      `RECORD_INCOHERENT`, que es lo que el clasificador de mensajes habría
 *      adivinado.
 *
 * Sin red, sin Supabase, sin DOM: el cliente es un doble que sólo anota qué
 * se le pidió.
 */
import { describe, expect, it } from "vitest";
import {
  CustodyContractError,
  createIntegrityCaseRepository,
  type CustodyQueryPort,
} from "./custody/integrity-adapters";
import {
  createSupabaseCustodyQueryPort,
  type CustodyDataClient,
} from "./custody/integrity-supabase";
import type { ApplyDecisionCasInput, CustodyEntityScope } from "./custody/integrity";

/** Doble del cliente: anota cada RPC y devuelve un id cualquiera. */
function fakeClient() {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const db = {
    from() {
      throw new Error("este doble no consulta tablas");
    },
    async rpc(fn: string, args: Record<string, unknown>) {
      calls.push({ fn, args });
      return { data: "decision-id", error: null };
    },
  };
  return { calls, db: db as unknown as CustodyDataClient };
}

const INPUT = {
  caseId: "11111111-1111-1111-1111-111111111111",
  expectedVersion: 3,
  decision: "release" as const,
  reason: "Inspección física completa sin novedades",
  observations: null,
  inspectionEvidenceIds: ["22222222-2222-2222-2222-222222222222"],
};

describe("HN-1 · el puerto de sesión sólo conoce el camino físico", () => {
  it("`physical_unit` llama a `decide_custody_integrity_v2`", async () => {
    const { calls, db } = fakeClient();
    const port = createSupabaseCustodyQueryPort(db);

    const id = await port.decide({ ...INPUT, scope: "physical_unit" });

    expect(id).toBe("decision-id");
    expect(calls).toHaveLength(1);
    expect(calls[0].fn).toBe("decide_custody_integrity_v2");
    expect(calls[0].args.p_case_id).toBe(INPUT.caseId);
    expect(calls[0].args.p_expected_version).toBe(3);
  });

  it("la v1 NO se llama nunca, con ningún scope", async () => {
    const { calls, db } = fakeClient();
    const port = createSupabaseCustodyQueryPort(db);

    await port.decide({ ...INPUT, scope: "physical_unit" });
    for (const scope of ["packing_unit", "shipment"] as CustodyEntityScope[]) {
      await port.decide({ ...INPUT, scope }).catch(() => undefined);
    }
    await port.decide({ ...INPUT }).catch(() => undefined);

    expect(calls.map((c) => c.fn)).not.toContain("decide_custody_integrity");
  });

  it.each(["packing_unit", "shipment"] as CustodyEntityScope[])(
    "`%s` se rechaza TIPADO y sin tocar la plataforma",
    async (scope) => {
      const { calls, db } = fakeClient();
      const port = createSupabaseCustodyQueryPort(db);

      await expect(port.decide({ ...INPUT, scope })).rejects.toBeInstanceOf(
        CustodyContractError,
      );
      // Lo decisivo: NO se llamó a la base. Un 42501 nunca llega a existir.
      expect(calls).toHaveLength(0);
    },
  );

  it("el scope AUSENTE cae del mismo lado: fail-closed", async () => {
    const { calls, db } = fakeClient();
    const port = createSupabaseCustodyQueryPort(db);

    await expect(port.decide({ ...INPUT })).rejects.toBeInstanceOf(CustodyContractError);
    expect(calls).toHaveLength(0);
  });
});

describe("HN-1 · el repositorio traduce el rechazo sin adivinar", () => {
  function repoConScope(scope?: CustodyEntityScope) {
    const { calls, db } = fakeClient();
    const port = createSupabaseCustodyQueryPort(db);
    const query = {
      decide: port.decide,
      async selectCase() {
        throw new Error("no debería llegar acá: la decisión se rechazó antes");
      },
    } as unknown as CustodyQueryPort;
    const input = {
      caseId: INPUT.caseId,
      clientId: "33333333-3333-3333-3333-333333333333",
      scope,
      expectedVersion: INPUT.expectedVersion,
      record: {
        decision: INPUT.decision,
        reason: INPUT.reason,
        observations: INPUT.observations,
        inspectionEvidenceIds: INPUT.inspectionEvidenceIds,
      },
    } as unknown as ApplyDecisionCasInput;
    return { repo: createIntegrityCaseRepository(query), input, calls };
  }

  it.each(["packing_unit", "shipment", undefined] as Array<CustodyEntityScope | undefined>)(
    "scope %s → `SCOPE_NOT_DECIDABLE`, no `RECORD_INCOHERENT`",
    async (scope) => {
      const { repo, input, calls } = repoConScope(scope);

      const r = await repo.applyDecision(input);

      expect(r).toEqual({ ok: false, failure: "SCOPE_NOT_DECIDABLE" });
      expect(calls).toHaveLength(0);
    },
  );
});
