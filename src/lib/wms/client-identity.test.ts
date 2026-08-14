import { describe, expect, it, vi } from "vitest";
import {
  ClientIdentityError,
  resolveClientSelection,
  type CanonicalClientLookup,
  type CanonicalClientRef,
} from "./client-identity";

/**
 * P3-N1B · pruebas del puente de identidad canónica.
 *
 * El lookup es un puerto inyectado: acá se simula `public.clients` con un mapa
 * por UUID. Ningún camino consulta por nombre — el tipo del puerto lo impide y
 * las pruebas lo verifican operacionalmente.
 */

const CLIENTE_A: CanonicalClientRef = {
  id: "11111111-1111-4111-8111-111111111111",
  razon: "Avante Canónica S.A.",
  activo: true,
};
const CLIENTE_B_MISMO_NOMBRE_1: CanonicalClientRef = {
  id: "22222222-2222-4222-8222-222222222222",
  razon: "Duplicada S.A.",
  activo: true,
};
const CLIENTE_B_MISMO_NOMBRE_2: CanonicalClientRef = {
  id: "33333333-3333-4333-8333-333333333333",
  razon: "Duplicada S.A.",
  activo: true,
};
const CLIENTE_INACTIVO: CanonicalClientRef = {
  id: "44444444-4444-4444-8444-444444444444",
  razon: "Baja Comercial S.R.L.",
  activo: false,
};

function lookupDe(...filas: CanonicalClientRef[]): CanonicalClientLookup {
  const porId = new Map(filas.map((f) => [f.id, f]));
  return async (id) => porId.get(id) ?? null;
}

describe("P3-N1B · resolveClientSelection", () => {
  it("client_id válido: deriva client_name de la fila canónica", async () => {
    const r = await resolveClientSelection({ client_id: CLIENTE_A.id }, lookupDe(CLIENTE_A));
    expect(r).toEqual({ client_id: CLIENTE_A.id, client_name: "Avante Canónica S.A.", unlisted: false });
  });

  it("client_name adulterado desde el navegador se IGNORA: el nombre sale de la fila canónica", async () => {
    const r = await resolveClientSelection(
      { client_id: CLIENTE_A.id, client_name: "OTRO CLIENTE INYECTADO" },
      lookupDe(CLIENTE_A),
    );
    expect(r.client_name).toBe("Avante Canónica S.A.");
    expect(r.client_id).toBe(CLIENTE_A.id);
  });

  it("client_id inexistente: falla cerrado con CLIENT_NOT_FOUND", async () => {
    await expect(
      resolveClientSelection({ client_id: "99999999-9999-4999-8999-999999999999" }, lookupDe(CLIENTE_A)),
    ).rejects.toMatchObject({ code: "CLIENT_NOT_FOUND" });
  });

  it("UUID inválido: falla cerrado sin consultar el puerto", async () => {
    const lookup = vi.fn(lookupDe(CLIENTE_A));
    await expect(resolveClientSelection({ client_id: "no-es-uuid" }, lookup)).rejects.toMatchObject({
      code: "INVALID_CLIENT_ID",
    });
    expect(lookup).not.toHaveBeenCalled();
  });

  it("cliente deshabilitado (clients.activo=false): falla cerrado", async () => {
    await expect(
      resolveClientSelection({ client_id: CLIENTE_INACTIVO.id }, lookupDe(CLIENTE_INACTIVO)),
    ).rejects.toMatchObject({ code: "CLIENT_DISABLED" });
  });

  it("dos clientes con el MISMO nombre: la selección por UUID es inequívoca", async () => {
    const lookup = lookupDe(CLIENTE_B_MISMO_NOMBRE_1, CLIENTE_B_MISMO_NOMBRE_2);
    const r1 = await resolveClientSelection({ client_id: CLIENTE_B_MISMO_NOMBRE_1.id }, lookup);
    const r2 = await resolveClientSelection({ client_id: CLIENTE_B_MISMO_NOMBRE_2.id }, lookup);
    expect(r1.client_id).not.toBe(r2.client_id);
    expect(r1.client_name).toBe(r2.client_name);
  });

  it("ausencia total de selección: falla cerrado con CLIENT_REQUIRED", async () => {
    await expect(resolveClientSelection({}, lookupDe(CLIENTE_A))).rejects.toMatchObject({
      code: "CLIENT_REQUIRED",
    });
  });

  it("client_name solo (payload legado sin client_id): NO se infiere — falla cerrado", async () => {
    const lookup = vi.fn(lookupDe(CLIENTE_A));
    await expect(
      resolveClientSelection({ client_name: "Avante Canónica S.A." }, lookup),
    ).rejects.toMatchObject({ code: "CLIENT_REQUIRED" });
    expect(lookup).not.toHaveBeenCalled();
  });

  it("escape «cliente no listado»: escribe client_name libre con client_id NULL, sin crear cliente", async () => {
    const lookup = vi.fn(lookupDe(CLIENTE_A));
    const r = await resolveClientSelection({ unlisted_client_name: "  Cliente Nuevo En Alta  " }, lookup);
    expect(r).toEqual({ client_id: null, client_name: "Cliente Nuevo En Alta", unlisted: true });
    expect(lookup).not.toHaveBeenCalled();
  });

  it("escape con nombre vacío: falla cerrado", async () => {
    await expect(
      resolveClientSelection({ unlisted_client_name: "   " }, lookupDe(CLIENTE_A)),
    ).rejects.toMatchObject({ code: "UNLISTED_NAME_EMPTY" });
  });

  it("selección contradictoria (client_id + no listado): falla cerrado", async () => {
    await expect(
      resolveClientSelection(
        { client_id: CLIENTE_A.id, unlisted_client_name: "Otro" },
        lookupDe(CLIENTE_A),
      ),
    ).rejects.toMatchObject({ code: "AMBIGUOUS_SELECTION" });
  });

  it("compatibilidad 0219→0220: la vía canónica siempre produce client_id no nulo", async () => {
    // Después de 0220, inventory_items.client_id es NOT NULL y la unicidad es
    // (client_id, sku, position_id). La vía canónica garantiza el dato desde el
    // alta; sólo el escape controlado queda para resolución administrativa.
    const r = await resolveClientSelection({ client_id: CLIENTE_A.id }, lookupDe(CLIENTE_A));
    expect(r.client_id).not.toBeNull();
    expect(r.unlisted).toBe(false);
  });

  it("aislamiento: resolver con el catálogo de un tenant no expone filas de otro", async () => {
    const lookupSoloA = lookupDe(CLIENTE_A);
    await expect(
      resolveClientSelection({ client_id: CLIENTE_B_MISMO_NOMBRE_1.id }, lookupSoloA),
    ).rejects.toMatchObject({ code: "CLIENT_NOT_FOUND" });
  });

  it("errores portan la marca P3-N1B y son ClientIdentityError", async () => {
    try {
      await resolveClientSelection({}, lookupDe());
      expect.unreachable("debió lanzar");
    } catch (e) {
      expect(e).toBeInstanceOf(ClientIdentityError);
      expect((e as Error).message).toContain("[P3-N1B CLIENT_REQUIRED]");
    }
  });
});
