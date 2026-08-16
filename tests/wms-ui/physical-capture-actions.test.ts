/**
 * R-1 · CAPTURA FÍSICA DE INGRESO Y EGRESO — el par canónico lo fija el SERVIDOR.
 *
 * Por qué existe este archivo: la Adenda N.º 2 §4.2 exige foto de ingreso ligada
 * al QR de la unidad y foto de egreso obligatoria, y hasta R-1 NINGUNA superficie
 * del producto podía capturarlas. `attachEvidenceAction` sólo se alcanzaba desde
 * `CustodyShipmentActions` (scope `shipment`) y desde la inspección humana, que
 * fuerza `inspeccion_humana`. Como 0250a materializa un caso obligatorio por cada
 * ítem recibido, esos casos no podían cerrarse nunca y los gates de despacho y POD
 * quedaban disparados de forma permanente.
 *
 * Se ejercitan las acciones REALES con el cliente de sesión inyectado por alias,
 * igual que `server-actions.test.ts`: sin red, sin cookies y sin DOM.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
// @ts-expect-error stub inyectado por alias en vitest.wms-ui.config.ts
import { __setSessionClient, __setAdminClient } from "@/lib/supabase/server";
import {
  registerPhysicalIngressAction,
  registerPhysicalEgressAction,
} from "@/app/(app)/wms/custody/actions";

const UNIT = "33333333-3333-4333-8333-333333333333";
const USER = "77777777-7777-4777-8777-777777777777";
const SESSION = "88888888-8888-4888-8888-888888888888";

/**
 * Sesión mínima: sólo tiene que autenticar. La acción se corta después, al pedir
 * el cliente administrativo, y ese corte es justamente la señal de que el par
 * canónico pasó la validación de contrato en lugar de ser rechazado.
 */
function sessionDouble() {
  return {
    auth: {
      async getUser() {
        return { data: { user: { id: USER } }, error: null };
      },
      async getClaims() {
        return { data: { claims: { sub: USER, session_id: SESSION } }, error: null };
      },
    },
  };
}

/** PNG real de 1×1: los magic bytes tienen que pasar el sniffing del servidor. */
const PNG_1X1 = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
  0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89,
]);

function formConParFalso(): FormData {
  const form = new FormData();
  form.set("file", new File([PNG_1X1], "foto.png", { type: "image/png" }));
  form.set("entity_id", UNIT);
  // El navegador manda un par que el servidor NO debe respetar.
  form.set("scope", "shipment");
  form.set("stage", "entrega");
  form.set("event_type", "firmado");
  form.set("kind", "documento");
  return form;
}

const ACTIONS_SRC = () =>
  readFileSync(resolve(process.cwd(), "src/app/(app)/wms/custody/actions.ts"), "utf8");

describe("R-1 · la captura de ingreso fija recepcion/foto_ingreso en el servidor", () => {
  it("ignora scope, stage, event_type y kind del formulario", async () => {
    __setSessionClient(sessionDouble());
    __setAdminClient(null); // sin admin: corta DESPUÉS de validar el contrato
    const res = await registerPhysicalIngressAction(formConParFalso());
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toBe("Operación administrativa no disponible");
    expect(res.error).not.toBe("Solicitud de captura física inválida");
  });

  it("el forzado vive en la acción, no en el llamador", () => {
    const fn = ACTIONS_SRC().slice(
      ACTIONS_SRC().indexOf("export async function registerPhysicalIngressAction"),
    );
    expect(fn).toMatch(/forced\.set\("scope", "physical_unit"\)/);
    expect(fn).toMatch(/forced\.set\("stage", "recepcion"\)/);
    expect(fn).toMatch(/forced\.set\("event_type", "foto_ingreso"\)/);
  });
});

describe("R-1 · la captura de egreso fija despacho/foto_egreso en el servidor", () => {
  it("ignora scope, stage, event_type y kind del formulario", async () => {
    __setSessionClient(sessionDouble());
    __setAdminClient(null);
    const res = await registerPhysicalEgressAction(formConParFalso());
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toBe("Operación administrativa no disponible");
    expect(res.error).not.toBe("Solicitud de captura física inválida");
  });

  it("el forzado vive en la acción, no en el llamador", () => {
    const fn = ACTIONS_SRC().slice(
      ACTIONS_SRC().indexOf("export async function registerPhysicalEgressAction"),
    );
    expect(fn).toMatch(/forced\.set\("scope", "physical_unit"\)/);
    expect(fn).toMatch(/forced\.set\("stage", "despacho"\)/);
    expect(fn).toMatch(/forced\.set\("event_type", "foto_egreso"\)/);
  });
});

describe("R-1 · la superficie de captura existe y está cableada", () => {
  it("el panel físico usa AMBAS acciones y no arma el par a mano", () => {
    const panel = readFileSync(
      resolve(process.cwd(), "src/app/(app)/wms/custody/_components/PhysicalCapturePanel.tsx"),
      "utf8",
    );
    expect(panel).toMatch(/registerPhysicalIngressAction/);
    expect(panel).toMatch(/registerPhysicalEgressAction/);
    // El cliente no decide etapa ni tipo: no los envía.
    expect(panel).not.toMatch(/set\(\s*["']stage["']/);
    expect(panel).not.toMatch(/set\(\s*["']event_type["']/);
  });

  it("la página de detalle monta el panel para la unidad física", () => {
    const page = readFileSync(
      resolve(process.cwd(), "src/app/(app)/wms/custody/[id]/page.tsx"),
      "utf8",
    );
    expect(page).toMatch(/PhysicalCapturePanel/);
    // Ya no puede mandar al operario a una pantalla de sólo lectura.
    expect(page).not.toMatch(/escaneá el mismo QR y registrala/);
  });
});
