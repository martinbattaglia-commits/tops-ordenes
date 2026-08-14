// Nexus Link · FASE B — Identidad del contacto de WhatsApp.
//
// Lo que se prueba acá es que el número que se muestra SALE de la fuente
// canónica y no de una reconstrucción: ante cualquier `context_id` que no sea
// exactamente `wa:<E164>`, la respuesta es «no hay número», nunca un número
// arreglado a mano.

import { describe, expect, it } from "vitest";
import {
  esE164,
  etiquetaDeContexto,
  formatearLegible,
  resolverContactoWa,
  telefonoDesdeContextId,
  WA_CONTEXT_PREFIX,
} from "./contact-identity";

const CTX = (tel: string) => `${WA_CONTEXT_PREFIX}${tel}`;

describe("E.164 estricto", () => {
  it("acepta un móvil argentino real", () => {
    expect(esE164("+5491131079124")).toBe(true);
  });

  it("acepta el mínimo y el máximo del estándar", () => {
    expect(esE164("+12345678")).toBe(true);          // 8 dígitos
    expect(esE164("+123456789012345")).toBe(true);   // 15 dígitos
    expect(esE164("+1234567")).toBe(false);          // 7 ⇒ corto
    expect(esE164("+1234567890123456")).toBe(false); // 16 ⇒ largo
  });

  it("rechaza lo que no es E.164", () => {
    for (const malo of [
      "5491131079124",     // sin +
      "+0491131079124",    // arranca en 0
      "+54 9 11 3107 9124", // con espacios: el canónico no los tiene
      "+549113107912a",
      "",
      "+",
    ]) {
      expect(esE164(malo), malo).toBe(false);
    }
  });
});

describe("el teléfono sale del context_id, o no sale", () => {
  it("lo extrae de un context_id de WhatsApp", () => {
    expect(telefonoDesdeContextId(CTX("+5491131079124"))).toBe("+5491131079124");
  });

  it("un context_id interno NO produce teléfono", () => {
    // Los hilos internos usan CTX-AAAA-NNNNNN: otra forma por completo.
    expect(telefonoDesdeContextId("CTX-2026-000123")).toBeNull();
  });

  it("un context_id ausente, vacío o con prefijo pero basura devuelve null", () => {
    expect(telefonoDesdeContextId(null)).toBeNull();
    expect(telefonoDesdeContextId(undefined)).toBeNull();
    expect(telefonoDesdeContextId("")).toBeNull();
    expect(telefonoDesdeContextId(CTX(""))).toBeNull();
    expect(telefonoDesdeContextId(CTX("desconocido"))).toBeNull();
    expect(telefonoDesdeContextId(CTX("5491131079124"))).toBeNull(); // sin +
  });

  it("no reconstruye: un número inválido NO se normaliza para que entre", () => {
    // Si esto devolviera "+5491131079124" estaríamos inventando el dato.
    expect(telefonoDesdeContextId(CTX("54 9 11 3107 9124"))).toBeNull();
  });
});

describe("formato internacional legible", () => {
  it("separa país, marca de móvil y área en un número de Buenos Aires", () => {
    expect(formatearLegible("+5491131079124")).toBe("+54 9 11 3107-9124");
  });

  it("un fijo argentino de Buenos Aires no inventa la marca de móvil", () => {
    expect(formatearLegible("+541143023944")).toBe("+54 11 4302-3944");
  });

  it("un área argentina de tres dígitos se agrupa como tal", () => {
    expect(formatearLegible("+5493414567890")).toBe("+54 9 341 456-7890");
  });

  it("otros países se agrupan de forma genérica pero legible", () => {
    expect(formatearLegible("+14155552671")).toBe("+1 415 555-2671");   // 10 nacionales ⇒ 3-3-4
    expect(formatearLegible("+442071838750")).toBe("+44 207 183-8750");
    // Longitudes distintas de 10 caen en el agrupado de a cuatro desde la
    // derecha: no es el formato nacional de España, y no pretende serlo — es
    // presentación, y el E.164 canónico viaja al lado.
    expect(formatearLegible("+34911234567")).toBe("+34 9 1123 4567");
  });

  it("lo que no es E.164 se devuelve tal cual, sin adornarlo", () => {
    expect(formatearLegible("no-es-un-numero")).toBe("no-es-un-numero");
  });

  it("el legible NUNCA reemplaza al canónico: sólo le quita el ruido", () => {
    const e164 = "+5491131079124";
    expect(formatearLegible(e164).replace(/[^\d+]/g, "")).toBe(e164);
  });
});

describe("etiqueta que reemplaza al context_id crudo en la interfaz", () => {
  it("en WhatsApp NUNCA devuelve el teléfono: devuelve el canal", () => {
    const etiqueta = etiquetaDeContexto("whatsapp", CTX("+5491131079124"));
    expect(etiqueta).toBe("WhatsApp");
    expect(etiqueta).not.toContain("3107");
    expect(etiqueta).not.toContain("+54");
  });

  it("en los hilos internos conserva la referencia técnica, que es útil", () => {
    expect(etiquetaDeContexto("dm", "CTX-2026-000123")).toBe("CTX-2026-000123");
    expect(etiquetaDeContexto("erp", "CTX-2026-000999")).toBe("CTX-2026-000999");
  });

  it("sin context_id no rompe la línea: devuelve vacío", () => {
    expect(etiquetaDeContexto("dm", null)).toBe("");
  });

  it("un context_id de WhatsApp mal etiquetado como interno SÍ mostraría el número", () => {
    // Deja explícito de qué depende: del `kind` de la fila, no del contenido
    // del campo. Es el mismo criterio que `resolverContactoWa`, y la frontera
    // que garantiza el `kind` correcto es la RLS, no esta función.
    expect(etiquetaDeContexto("dm", CTX("+5491131079124"))).toBe(CTX("+5491131079124"));
  });
});

describe("resolución de la ficha", () => {
  it("un hilo de WhatsApp con todo produce nombre, E.164 y legible", () => {
    expect(
      resolverContactoWa({ kind: "whatsapp", title: "Royal Packs", contextId: CTX("+5491131079124") }),
    ).toEqual({ nombre: "Royal Packs", e164: "+5491131079124", legible: "+54 9 11 3107-9124" });
  });

  it("sin título usable cae al teléfono como nombre", () => {
    expect(resolverContactoWa({ kind: "whatsapp", title: "   ", contextId: CTX("+5491131079124") }))
      .toMatchObject({ nombre: "+5491131079124" });
  });

  it("sin número la ficha EXISTE pero declara la ausencia", () => {
    // Ésta es la diferencia clave con `null`: la ficha se abre y dice que no
    // hay número, en vez de romper la pantalla o fingir uno.
    expect(resolverContactoWa({ kind: "whatsapp", title: "Contacto viejo", contextId: null }))
      .toEqual({ nombre: "Contacto viejo", e164: null, legible: null });
  });

  it("sin número NI título todavía hay algo que mostrar", () => {
    expect(resolverContactoWa({ kind: "whatsapp", title: null, contextId: null }))
      .toEqual({ nombre: "Contacto de WhatsApp", e164: null, legible: null });
  });

  it("un hilo INTERNO no tiene ficha, aunque le pongan un context_id de WhatsApp", () => {
    // El canal manda sobre el contenido del campo: si la fila no es 'whatsapp',
    // no hay contacto que mostrar y no se parsea nada.
    for (const kind of ["dm", "group", "channel", "erp", "incident", "ai"]) {
      expect(resolverContactoWa({ kind, title: "X", contextId: CTX("+5491131079124") }), kind)
        .toBeNull();
    }
  });
});
