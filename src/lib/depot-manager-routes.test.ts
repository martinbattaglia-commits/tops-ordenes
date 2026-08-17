/**
 * H-3 · La allowlist de rutas del encargado, bajo prueba.
 *
 * `depotManagerRouteAllowed` es la única barrera por URL: el middleware la
 * consulta y devuelve 404 —no 403— cuando dice que no, de modo que una ruta
 * prohibida ni siquiera revela que existe. Es lógica de string-matching con
 * tres expresiones regulares, un orden de guardas que importa y una doble
 * negación, y hasta ahora no tenía ninguna cobertura: ningún cambio futuro la
 * habría puesto en rojo.
 *
 * Los casos siguen el contrato: Cockpit operativo, Órdenes de Servicio, WMS de
 * su sede y chat interno permitidos; tarifas, exportaciones, custodia,
 * analytics, finanzas y todo lo demás denegado.
 */
import { describe, expect, it } from "vitest";
import {
  depotManagerIdentity,
  depotManagerRouteAllowed,
  depotManagerRpcRowValid,
} from "@/lib/rbac/depot-manager";

const JORGE = { id: "4cf9b607-36bb-4ed9-ab31-82823d625b8d", email: "despachos-lujan@logisticatops.com" };
const JUAN = { id: "3873f156-02de-4424-af48-3e590536cc1d", email: "despachos-magaldi@logisticatops.com" };

describe("H-3 · rutas permitidas al encargado", () => {
  it("el cockpit operativo y las órdenes de servicio", () => {
    expect(depotManagerRouteAllowed("/dashboard")).toBe(true);
    expect(depotManagerRouteAllowed("/orders")).toBe(true);
    expect(depotManagerRouteAllowed("/orders/new")).toBe(true);
    expect(depotManagerRouteAllowed("/orders/OS-000123")).toBe(true);
  });

  it("el WMS de su sede, custodia INCLUIDA", () => {
    expect(depotManagerRouteAllowed("/wms")).toBe(true);
    expect(depotManagerRouteAllowed("/wms/recepciones")).toBe(true);
    expect(depotManagerRouteAllowed("/wms/recepciones/nueva")).toBe(true);
  });

  /**
   * S2-B · EL 404 RETIRADO.
   *
   * La allowlist excluía `/wms/custody` en DOS renglones —el corte explícito y
   * la doble negación del último `return`— y el encargado recibía un 404 en el
   * módulo donde saca las fotos. Eso convertía la custodia digital en una
   * función que la persona que la ejecuta no puede abrir: el mismo usuario que
   * carga la recepción y saca la foto de ingreso no podía ver el caso que esa
   * foto abre, ni sacar la de egreso.
   *
   * Retirar las dos líneas no afloja nada más: `/wms/custody` queda gobernada
   * por lo mismo que gobierna al resto del WMS —RLS de tenant, `wms.view` para
   * mirar, `wms.edit` para capturar y `wms.custody.decide` con rol `admin`
   * para liberar—, que es donde la autoridad estaba escrita desde 0251.
   */
  it("custodia: el encargado ENTRA · las dos líneas del 404 retiradas", () => {
    expect(depotManagerRouteAllowed("/wms/custody")).toBe(true);
    expect(depotManagerRouteAllowed("/wms/custody/evento")).toBe(true);
    // La ruta que sólo comparte prefijo cae bajo la misma regla del WMS: ya no
    // hay un renglón que la trate distinto.
    expect(depotManagerRouteAllowed("/wms/custody-extra")).toBe(true);
  });

  it("el chat interno: sólo las rutas exactas y una conversación", () => {
    expect(depotManagerRouteAllowed("/connect")).toBe(true);
    expect(depotManagerRouteAllowed("/connect/buscar")).toBe(true);
    expect(depotManagerRouteAllowed("/connect/notificaciones")).toBe(true);
    expect(depotManagerRouteAllowed("/connect/favoritos")).toBe(true);
    expect(depotManagerRouteAllowed("/connect/c/abc-123")).toBe(true);
  });

  it("las dos API operativas y los PDF de su flujo", () => {
    expect(depotManagerRouteAllowed("/api/auth/signout")).toBe(true);
    expect(depotManagerRouteAllowed("/api/version")).toBe(true);
    expect(depotManagerRouteAllowed("/api/orders/OS-1/pdf")).toBe(true);
    expect(depotManagerRouteAllowed("/api/wms/recepciones/REC-1/pdf")).toBe(true);
    expect(depotManagerRouteAllowed("/api/wms/despachos/DES-1/pdf")).toBe(true);
  });
});

describe("H-3 · rutas denegadas al encargado", () => {
  it("las tarifas, que son el motor comercial", () => {
    // El guard de tarifas corre ANTES del regex de /orders/[id]: si el orden
    // se invirtiera, "/orders/tarifas" pasaría como si fuera una orden.
    expect(depotManagerRouteAllowed("/orders/tarifas")).toBe(false);
    expect(depotManagerRouteAllowed("/orders/tarifas/editar")).toBe(false);
  });

  it("la exportación y cualquier API fuera de las operativas", () => {
    expect(depotManagerRouteAllowed("/api/orders/export")).toBe(false);
    expect(depotManagerRouteAllowed("/api/analytics/resumen")).toBe(false);
    expect(depotManagerRouteAllowed("/api/orders/OS-1/pdf/extra")).toBe(false);
  });

  it("los módulos prohibidos por contrato", () => {
    for (const ruta of [
      "/analytics",
      "/billing",
      "/compras",
      "/tesoreria",
      "/rrhh",
      "/tracking",
      "/cctv",
      "/anmat",
      "/clients",
      "/settings",
      "/settings/usuarios",
      "/",
    ]) {
      expect(depotManagerRouteAllowed(ruta)).toBe(false);
    }
  });

  it("WhatsApp comercial y cualquier subruta de connect no enumerada", () => {
    expect(depotManagerRouteAllowed("/connect/whatsapp")).toBe(false);
    expect(depotManagerRouteAllowed("/connect/importar")).toBe(false);
    expect(depotManagerRouteAllowed("/connect/c/abc/editar")).toBe(false);
    expect(depotManagerRouteAllowed("/connectar")).toBe(false);
  });
});

describe("H-3 · identidad exacta, UUID y email a la vez", () => {
  it("el par canónico habilita, con su sede", () => {
    const j = depotManagerIdentity(JORGE.id, JORGE.email);
    expect(j.principal).toBe(true);
    expect(j.exact).toBe(true);
    expect(j.site?.depot).toBe("LUJAN");
    const m = depotManagerIdentity(JUAN.id, JUAN.email);
    expect(m.exact).toBe(true);
    expect(m.site?.depot).toBe("MAGALDI");
  });

  it("un par cruzado es principal pero NO exacto: queda dentro de la frontera y denegado", () => {
    const cruzado = depotManagerIdentity(JORGE.id, JUAN.email);
    expect(cruzado.principal).toBe(true);
    expect(cruzado.exact).toBe(false);
  });

  it("un usuario ajeno no es principal", () => {
    const otro = depotManagerIdentity("11111111-1111-4111-8111-111111111111", "otro@logisticatops.com");
    expect(otro.principal).toBe(false);
    expect(otro.exact).toBe(false);
  });

  it("sin identidad no hay principal: fail-closed", () => {
    expect(depotManagerIdentity(undefined, undefined).principal).toBe(false);
    expect(depotManagerIdentity(JORGE.id, undefined).exact).toBe(false);
  });

  it("el email se compara sin distinguir mayúsculas", () => {
    expect(depotManagerIdentity(JORGE.id, JORGE.email.toUpperCase()).exact).toBe(true);
  });
});

describe("H-3 · la fila de la RPC se valida por identidad, no por nave", () => {
  const site = depotManagerIdentity(JORGE.id, JORGE.email).site!;

  it("principal, autorizada y con su sede: vale", () => {
    expect(
      depotManagerRpcRowValid({ is_principal: true, is_authorized: true, depot: "LUJAN" }, site),
    ).toBe(true);
  });

  it("no principal, no autorizada, sede ajena o fila ausente: todas rechazan", () => {
    const base = { is_principal: true, is_authorized: true, depot: "LUJAN" };
    expect(depotManagerRpcRowValid({ ...base, is_principal: false }, site)).toBe(false);
    expect(depotManagerRpcRowValid({ ...base, is_authorized: false }, site)).toBe(false);
    expect(depotManagerRpcRowValid({ ...base, depot: "MAGALDI" }, site)).toBe(false);
    expect(depotManagerRpcRowValid(null, site)).toBe(false);
    expect(depotManagerRpcRowValid(undefined, site)).toBe(false);
  });
});
