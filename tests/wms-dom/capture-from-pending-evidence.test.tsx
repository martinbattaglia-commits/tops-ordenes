/**
 * EL CIRCUITO TIENE QUE ESTAR VIVO EN SU PRIMER PASO.
 *
 * ─── EL DEFECTO QUE ESTE ARCHIVO EXISTE PARA VER ──────────────────────────
 *
 * `PhysicalCapturePanel` colgaba su habilitación de `view.inspection.enabled`,
 * bajo la premisa —escrita en un comentario— de que ese campo transportaba el
 * permiso de captura. No lo transporta: funde el permiso CON la exigencia de
 * estado `REVIEW_REQUIRED`/`HOLD`, que es propia de la foto de inspección
 * humana.
 *
 * Todo caso nace en `PENDING_EVIDENCE`. Ese estado no es ninguno de los dos,
 * así que `inspection.enabled` era `false` y los dos slots quedaban apagados
 * JUSTO cuando había que sacar la foto de ingreso — y con un cartel de permiso
 * para un bloqueo que era de estado. El operario no podía empezar nunca.
 *
 * ─── POR QUÉ NINGÚN TEST LO VEÍA ──────────────────────────────────────────
 *
 * Porque los view-models se fabricaban a mano con `state: "REVIEW_REQUIRED"` e
 * `inspection: { enabled: true }` escritos como literales. La batería medía el
 * literal, no el sistema. Acá el view-model se DERIVA con
 * `buildCustodyCaseView`, el mismo que corre en producción, sobre un caso
 * físico recién materializado por el trigger de 0250a.
 *
 * ─── LA REGLA QUE GOBIERNA LA CAPTURA ─────────────────────────────────────
 *
 * Dos condiciones, copiadas del servidor y no inventadas:
 *   · permiso `wms.edit` (`actions.ts`, antes de tocar Storage);
 *   · caso NO terminal (`attach_custody_physical_evidence` en 0251 rechaza por
 *     estado sólo con `state in('RELEASED','QUARANTINED')`).
 * El estado `PENDING_EVIDENCE` no bloquea nada, ni en la base ni acá.
 */
import { describe, expect, it, vi } from "vitest";
import { buttonByName, render } from "./_render";
import { derivedView, nacienteFisico, UNIT } from "./_view";

vi.mock("@/app/(app)/wms/custody/actions", () => ({
  registerPhysicalIngressAction: vi.fn(async () => ({ ok: true, data: { evidence_id: "e", event_public_id: "p" } })),
  registerPhysicalEgressAction: vi.fn(async () => ({ ok: true, data: { evidence_id: "e", event_public_id: "p" } })),
}));

import { PhysicalCapturePanel } from "@/app/(app)/wms/custody/_components/PhysicalCapturePanel";

/** Caso recién nacido: PENDING_EVIDENCE, sin fotos, operario CON `wms.edit`. */
function vistaNaciente(permisos: string[] = ["wms.edit"]) {
  return derivedView({
    base: nacienteFisico,
    actor: { role: "operaciones", permissions: permisos },
  });
}

describe("el caso recién nacido está en PENDING_EVIDENCE y el operario PUEDE capturar", () => {
  it("la vista derivada confirma el estado que todo caso tiene al nacer", () => {
    const v = vistaNaciente();
    expect(v.state).toBe("PENDING_EVIDENCE");
    expect(v.scope).toBe("physical_unit");
    // La inspección humana SÍ está bloqueada acá, y está bien que lo esté.
    expect(v.inspection.enabled).toBe(false);
    // La captura del par NO. Ésta es la separación que faltaba.
    expect(v.capture.enabled).toBe(true);
    expect(v.capture.blockers).toEqual([]);
  });

  it("el input de la foto de ingreso está HABILITADO", async () => {
    const { container, unmount } = await render(
      <PhysicalCapturePanel view={vistaNaciente()} tieneIngreso={false} tieneEgreso={false} />,
    );
    const input = container.querySelector<HTMLInputElement>("#captura-foto-ingreso");
    expect(input).not.toBeNull();
    expect(input!.hasAttribute("disabled")).toBe(false);
    await unmount();
  });

  it("el botón «Registrar ingreso» no está muerto por permiso", async () => {
    const { container, unmount } = await render(
      <PhysicalCapturePanel view={vistaNaciente()} tieneIngreso={false} tieneEgreso={false} />,
    );
    // Sin archivo elegido el botón está deshabilitado —correcto—, pero NO por
    // permiso: lo que se afirma es que la pantalla no acusa al permiso.
    expect(container.textContent).not.toMatch(/No tenés permiso para registrar evidencia/);
    expect(container.querySelector('[data-bloqueo="ingreso"]')).toBeNull();
    expect(container.querySelector('[data-bloqueo="egreso"]')).toBeNull();
    await unmount();
  });

  it("con la foto elegida, el botón de ingreso queda VIVO", async () => {
    const { container, unmount } = await render(
      <PhysicalCapturePanel view={vistaNaciente()} tieneIngreso={false} tieneEgreso={false} />,
    );
    const input = container.querySelector<HTMLInputElement>("#captura-foto-ingreso")!;
    const file = new File([new Uint8Array([1, 2, 3])], "ingreso.png", { type: "image/png" });
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    const { act } = await import("react");
    await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); });

    const btn = buttonByName(container, /Registrar ingreso/) as HTMLButtonElement;
    expect(btn.hasAttribute("disabled")).toBe(false);
    await unmount();
  });
});

describe("la captura sí se apaga cuando el servidor la apagaría", () => {
  it("sin `wms.edit` no se puede capturar, y el motivo es el permiso", () => {
    const v = derivedView({
      base: nacienteFisico,
      actor: { role: "operaciones", permissions: ["wms.custody.decide"] },
    });
    expect(v.capture.enabled).toBe(false);
    expect(v.capture.blockers).toContain("No tenés permiso para registrar evidencia");
  });

  it("sin sesión verificada tampoco", () => {
    const v = derivedView({ base: nacienteFisico, actor: null });
    expect(v.capture.enabled).toBe(false);
    expect(v.capture.blockers).toContain("Sesión no verificada");
  });

  it("con el caso LIBERADO se apaga, y el motivo es el estado — no el permiso", () => {
    const v = derivedView({
      base: nacienteFisico,
      case: {
        state: "RELEASED",
        decision: {
          decision: "release",
          actorUserId: "u", actorSessionId: "s", actorRole: "admin",
          clientId: "22222222-2222-4222-8222-222222222222",
          permission: "wms.custody.decide", decidedAt: "2026-08-10T12:00:00.000Z",
          reason: "conforme", observations: null, inspectionEvidenceIds: [],
          previousState: "REVIEW_REQUIRED", newState: "RELEASED", chainHeadAtDecision: "head-1",
        },
      },
      actor: { role: "operaciones", permissions: ["wms.edit"] },
    });
    expect(v.capture.enabled).toBe(false);
    expect(v.capture.blockers).toContain("El caso ya está liberado: no admite más fotografías");
    // Nunca un mensaje de permiso para un problema de estado.
    expect(v.capture.blockers).not.toContain("No tenés permiso para registrar evidencia");
  });

  it("con el caso EN CUARENTENA, el motivo lo dice tal cual", () => {
    const v = derivedView({
      base: nacienteFisico,
      case: {
        state: "QUARANTINED",
        decision: {
          decision: "quarantine",
          actorUserId: "u", actorSessionId: "s", actorRole: "operaciones",
          clientId: "22222222-2222-4222-8222-222222222222",
          permission: "wms.custody.decide", decidedAt: "2026-08-10T12:00:00.000Z",
          reason: "diferencias en el embalaje", observations: null, inspectionEvidenceIds: [],
          previousState: "HOLD", newState: "QUARANTINED", chainHeadAtDecision: "head-1",
        },
      },
      actor: { role: "operaciones", permissions: ["wms.edit"] },
    });
    expect(v.capture.enabled).toBe(false);
    expect(v.capture.blockers).toContain("La unidad está en cuarentena: no admite más fotografías");
  });

  it("en REVIEW_REQUIRED y en HOLD la captura sigue viva: no se cambió una jaula por otra", () => {
    for (const state of ["REVIEW_REQUIRED", "HOLD"] as const) {
      const v = derivedView({
        base: nacienteFisico,
        case: { state },
        actor: { role: "operaciones", permissions: ["wms.edit"] },
      });
      expect(v.capture.enabled, state).toBe(true);
    }
  });

  it("la unidad del caso derivado es la física, no un shipment", () => {
    expect(vistaNaciente().entityId).toBe(UNIT);
  });
});
