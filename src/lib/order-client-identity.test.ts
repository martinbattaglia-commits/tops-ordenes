/**
 * D-6 · los OCHO casos ordenados por Dirección para la congruencia canónica
 * de cliente en órdenes de servicio.
 *
 * El lookup va inyectado, así que se ejercita la lógica REAL sin Supabase. Lo
 * que se mide no es que la función «valide»: es que ante cada forma concreta
 * de incongruencia RECHACE, y que en el único caso congruente devuelva la fila
 * canónica.
 */

import { describe, expect, it, vi } from "vitest";
import {
  OrderClientError,
  invalidaVinculo,
  normalizarRazon,
  resolveOrderClientIdentity,
  soloDigitos,
  type CanonicalOrderClient,
  type OrderClientLookup,
} from "./order-client-identity";

/** Cartera FICTICIA. A y B existen; C está desactivado. */
const A: CanonicalOrderClient = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  razon: "Distribuidora Ávila S.A.",
  cuit: "30-71234567-8",
  activo: true,
};
const B: CanonicalOrderClient = {
  id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  razon: "Farmacéutica del Plata SRL",
  cuit: "30712345679",
  activo: true,
};
const C_INACTIVO: CanonicalOrderClient = {
  id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  razon: "Comercial Retirada SRL",
  cuit: "30-71234567-2",
  activo: false,
};

const CARTERA = [A, B, C_INACTIVO];

/** Lookup canónico: por uuid exacto o por CUIT normalizado. Nunca por nombre. */
const lookup: OrderClientLookup = async (by) => {
  if ("id" in by) return CARTERA.find((c) => c.id === by.id) ?? null;
  return CARTERA.find((c) => soloDigitos(c.cuit) === by.cuitDigits) ?? null;
};

/** Captura el error tipado, o null si no hubo. */
async function capturar(fn: () => Promise<unknown>): Promise<OrderClientError | null> {
  try {
    await fn();
    return null;
  } catch (e) {
    if (e instanceof OrderClientError) return e;
    throw e;
  }
}

describe("D-6 · caso 1 · seleccionar A y reemplazar los datos por los de B", () => {
  it("rechaza: es el escenario exacto de la orden emitida al cliente equivocado", async () => {
    // El wizard tenía a A seleccionado; el operador escribe razón y CUIT de B.
    const err = await capturar(() =>
      resolveOrderClientIdentity({ id: A.id, razon: B.razon, cuit: B.cuit }, lookup),
    );
    expect(err?.code).toBe("CUIT_INCONGRUENTE");
    // Y el mensaje dice a quién apuntaba de verdad, que es lo que el operador
    // necesita para entender qué pasó.
    expect(err?.message).toContain(A.razon);
  });

  it("antes de la corrección, ese payload habría resuelto a A en silencio", async () => {
    // Contraste explícito: si sólo se prefiriera el id, la función devolvería A
    // con los datos de B en pantalla. Se comprueba que NO ocurre.
    const err = await capturar(() =>
      resolveOrderClientIdentity({ id: A.id, razon: B.razon, cuit: B.cuit }, lookup),
    );
    expect(err).not.toBeNull();
  });
});

describe("D-6 · caso 2 · cambiar sólo el CUIT", () => {
  it("rechaza aunque la razón social siga siendo la de A", async () => {
    const err = await capturar(() =>
      resolveOrderClientIdentity({ id: A.id, razon: A.razon, cuit: B.cuit }, lookup),
    );
    expect(err?.code).toBe("CUIT_INCONGRUENTE");
  });

  it("un cambio de FORMATO del mismo CUIT no es un cambio de identidad", async () => {
    // "30-71234567-8", "30712345678" y "30 71234567 8" son el mismo CUIT.
    for (const escrito of ["30712345678", "30 71234567 8", "30-71234567-8"]) {
      const fila = await resolveOrderClientIdentity(
        { id: A.id, razon: A.razon, cuit: escrito },
        lookup,
      );
      expect(fila.id).toBe(A.id);
    }
  });
});

describe("D-6 · caso 3 · cambiar sólo la razón social", () => {
  it("rechaza aunque el CUIT siga siendo el de A", async () => {
    const err = await capturar(() =>
      resolveOrderClientIdentity({ id: A.id, razon: "Otra Cosa SA", cuit: A.cuit }, lookup),
    );
    expect(err?.code).toBe("RAZON_INCONGRUENTE");
  });

  it("tildes, mayúsculas y espacios repetidos NO son una incongruencia", async () => {
    // Rechazar por acentuación sería inutilizable en una operación real.
    for (const escrita of [
      "DISTRIBUIDORA AVILA S.A.",
      "distribuidora  ávila s.a.",
      "  Distribuidora Ávila S.A.  ",
    ]) {
      const fila = await resolveOrderClientIdentity(
        { id: A.id, razon: escrita, cuit: A.cuit },
        lookup,
      );
      expect(fila.id).toBe(A.id);
    }
  });
});

describe("D-6 · caso 4 · payload manipulado", () => {
  it("mandar el uuid de A sin pasar por la UI no alcanza", async () => {
    // La UI limpia el vínculo al editar a mano; un cliente HTTP no lo hace.
    // La decisión se toma en el servidor, así que da igual por dónde entre.
    const err = await capturar(() =>
      resolveOrderClientIdentity({ id: A.id, razon: B.razon, cuit: B.cuit }, lookup),
    );
    expect(err?.code).toBe("CUIT_INCONGRUENTE");
  });

  it("un uuid inexistente no se degrada a búsqueda por CUIT", async () => {
    // Si el uuid viene, manda: no se cae a resolver por otro criterio, porque
    // eso permitiría pasar un uuid basura y colar la identidad por el CUIT.
    const espia = vi.fn(lookup);
    const err = await capturar(() =>
      resolveOrderClientIdentity(
        { id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", razon: A.razon, cuit: A.cuit },
        espia,
      ),
    );
    expect(err?.code).toBe("CLIENT_NO_ENCONTRADO");
    expect(espia).toHaveBeenCalledTimes(1);
    expect(espia).toHaveBeenCalledWith({ id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" });
  });

  it("un uuid vacío o en blanco cae a la resolución por CUIT, no a un uuid falso", async () => {
    const fila = await resolveOrderClientIdentity(
      { id: "   ", razon: A.razon, cuit: A.cuit },
      lookup,
    );
    expect(fila.id).toBe(A.id);
  });
});

describe("D-6 · caso 5 · cliente inexistente", () => {
  it("rechaza y dice qué hacer, sin dar de alta nada", async () => {
    const err = await capturar(() =>
      resolveOrderClientIdentity(
        { id: null, razon: "Nunca Existió SA", cuit: "30-99999999-9" },
        lookup,
      ),
    );
    expect(err?.code).toBe("CLIENT_NO_ENCONTRADO");
    expect(err?.message).toMatch(/no da de alta clientes/);
  });
});

describe("D-6 · caso 6 · cliente inactivo", () => {
  it("rechaza por uuid", async () => {
    const err = await capturar(() =>
      resolveOrderClientIdentity(
        { id: C_INACTIVO.id, razon: C_INACTIVO.razon, cuit: C_INACTIVO.cuit },
        lookup,
      ),
    );
    expect(err?.code).toBe("CLIENT_INACTIVO");
  });

  it("rechaza también resolviendo por CUIT", async () => {
    const err = await capturar(() =>
      resolveOrderClientIdentity(
        { id: null, razon: C_INACTIVO.razon, cuit: C_INACTIVO.cuit },
        lookup,
      ),
    );
    expect(err?.code).toBe("CLIENT_INACTIVO");
  });

  it("el rechazo por inactivo precede al de congruencia", async () => {
    // Un cliente desactivado no admite órdenes ni aunque los datos cuadren.
    const err = await capturar(() =>
      resolveOrderClientIdentity(
        { id: C_INACTIVO.id, razon: "Datos Que No Cuadran SA", cuit: C_INACTIVO.cuit },
        lookup,
      ),
    );
    expect(err?.code).toBe("CLIENT_INACTIVO");
  });
});

describe("D-6 · caso 7 · cliente válido y congruente", () => {
  it("devuelve la fila canónica por uuid", async () => {
    const fila = await resolveOrderClientIdentity(
      { id: A.id, razon: A.razon, cuit: A.cuit },
      lookup,
    );
    expect(fila).toEqual(A);
  });

  it("devuelve la fila canónica resolviendo por CUIT cuando no hay uuid", async () => {
    const fila = await resolveOrderClientIdentity(
      { id: null, razon: B.razon, cuit: B.cuit },
      lookup,
    );
    expect(fila).toEqual(B);
  });
});

describe("D-6 · caso 8 · doble envío", () => {
  it("dos resoluciones idénticas devuelven la MISMA identidad", async () => {
    // La resolución es pura y sin efectos: reenviar no crea ni muta nada. La
    // idempotencia de la orden en sí la garantiza su propia clave.
    const uno = await resolveOrderClientIdentity(
      { id: A.id, razon: A.razon, cuit: A.cuit },
      lookup,
    );
    const dos = await resolveOrderClientIdentity(
      { id: A.id, razon: A.razon, cuit: A.cuit },
      lookup,
    );
    expect(uno).toEqual(dos);
  });

  it("el segundo envío de un payload incongruente vuelve a rechazar igual", async () => {
    // Nunca «se cansa» y acepta: el rechazo es determinista.
    for (let i = 0; i < 3; i++) {
      const err = await capturar(() =>
        resolveOrderClientIdentity({ id: A.id, razon: B.razon, cuit: B.cuit }, lookup),
      );
      expect(err?.code).toBe("CUIT_INCONGRUENTE");
    }
  });

  it("la resolución no escribe: el lookup es la única interacción", async () => {
    const espia = vi.fn(lookup);
    await resolveOrderClientIdentity({ id: A.id, razon: A.razon, cuit: A.cuit }, espia);
    expect(espia).toHaveBeenCalledTimes(1);
  });
});

describe("D-6 · invalidación del vínculo en el wizard", () => {
  const actual = { razon: A.razon, cuit: A.cuit };

  it("editar la razón social invalida", () => {
    expect(invalidaVinculo(actual, { razon: "Otra SA" })).toBe(true);
  });

  it("editar el CUIT invalida", () => {
    expect(invalidaVinculo(actual, { cuit: "30712345679" })).toBe(true);
  });

  it("un parche que NO toca razón ni CUIT no invalida", () => {
    expect(invalidaVinculo(actual, { })).toBe(false);
    expect(invalidaVinculo(actual, { razon: A.razon })).toBe(false);
    expect(invalidaVinculo(actual, { cuit: A.cuit })).toBe(false);
  });

  it("reescribir el MISMO valor no invalida", () => {
    // Si invalidara, un re-render o un blur sin cambios rompería el vínculo.
    expect(invalidaVinculo(actual, { razon: A.razon, cuit: A.cuit })).toBe(false);
  });
});

describe("D-6 · helpers de normalización", () => {
  it("soloDigitos deja el CUIT comparable sin importar el formato", () => {
    expect(soloDigitos("30-71234567-8")).toBe("30712345678");
    expect(soloDigitos("30 71234567 8")).toBe("30712345678");
    expect(soloDigitos("")).toBe("");
  });

  it("normalizarRazon ignora tildes, mayúsculas y espacios repetidos", () => {
    expect(normalizarRazon("DISTRIBUIDORA  ÁVILA S.A.")).toBe("distribuidora avila s.a.");
    expect(normalizarRazon("  distribuidora avila s.a. ")).toBe("distribuidora avila s.a.");
  });
});
