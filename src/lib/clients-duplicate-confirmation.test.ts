/**
 * Confirmación de duplicados · los seis escenarios del alta.
 *
 * El defecto que cierra este módulo era funcional y silencioso: el servidor
 * devolvía candidatos y exigía confirmación, pero el modal del maestro sólo
 * pintaba el error y nunca ofrecía confirmar. Una razón social parecida dejaba
 * el alta SIN SALIDA desde `/clients`.
 *
 * Se prueba la decisión, no la pantalla: es lo que decide si se crea o no, y
 * es donde estaba el agujero del contrato anterior.
 */
import { describe, expect, it } from "vitest";
import {
  decidirAlta,
  tokenDuplicados,
  type CandidatoDuplicado,
} from "./clients-duplicate-confirmation";

const A: CandidatoDuplicado = {
  id: "11111111-1111-4111-8111-111111111111",
  razon: "Laboratorios Bagó S.A.",
  cuit: "30500001234",
};
const B: CandidatoDuplicado = {
  id: "22222222-2222-4222-8222-222222222222",
  razon: "Laboratorios Bago SA",
  cuit: "30500005678",
};

const ALTA = { razon: "Laboratorios Bagó del Sur S.A.", cuit: "30-70000099-4" };

describe("decisión de alta ante duplicados", () => {
  it("1 · sin duplicados: se crea derecho y no se registra advertencia", () => {
    const d = decidirAlta({ ...ALTA, candidatos: [] });
    expect(d.estado).toBe("crear");
    expect(d).toMatchObject({ duplicadosAdvertidos: null });
  });

  it("2 · duplicado detectado: se advierte, NO se crea, y viene el acuse", () => {
    const d = decidirAlta({ ...ALTA, candidatos: [A, B] });
    expect(d.estado).toBe("advertir");
    if (d.estado !== "advertir") throw new Error("inalcanzable");
    expect(d.candidatos).toHaveLength(2);
    expect(d.acuse).toHaveLength(32);
    expect(d.revisada).toBe(false);
  });

  it("2b · cancelar es simplemente no volver a llamar: la decisión no muta nada", () => {
    // No hay estado servidor que limpiar. Dos advertencias seguidas dan lo
    // mismo, así que abandonar el modal no deja nada a medio hacer.
    const uno = decidirAlta({ ...ALTA, candidatos: [A, B] });
    const dos = decidirAlta({ ...ALTA, candidatos: [A, B] });
    expect(uno).toEqual(dos);
  });

  it("3 · duplicado confirmado con el acuse correcto: se crea y se registra qué se ignoró", () => {
    const advertencia = decidirAlta({ ...ALTA, candidatos: [A, B] });
    if (advertencia.estado !== "advertir") throw new Error("inalcanzable");

    const d = decidirAlta({ ...ALTA, candidatos: [A, B], acuse: advertencia.acuse });
    expect(d.estado).toBe("crear");
    if (d.estado !== "crear") throw new Error("inalcanzable");
    // Ordenados: la auditoría no depende del orden en que la base devolvió.
    expect(d.duplicadosAdvertidos).toEqual([A.id, B.id].sort());
  });

  it("4 · reintento con el mismo acuse: la decisión es idempotente", () => {
    // El doble clic se frena en la UI y, si igual llegaran dos altas, el
    // respaldo real es la unicidad de CUIT en la tabla. Acá se comprueba lo
    // que le toca a la decisión: no cambia de parecer entre una y otra.
    const adv = decidirAlta({ ...ALTA, candidatos: [A, B] });
    if (adv.estado !== "advertir") throw new Error("inalcanzable");
    const primera = decidirAlta({ ...ALTA, candidatos: [A, B], acuse: adv.acuse });
    const segunda = decidirAlta({ ...ALTA, candidatos: [A, B], acuse: adv.acuse });
    expect(primera).toEqual(segunda);
    expect(segunda.estado).toBe("crear");
  });

  it("5 · la lista cambió entre una llamada y la otra: se vuelve a advertir", () => {
    // Alguien creó o desactivó un cliente mientras el modal estaba abierto.
    const adv = decidirAlta({ ...ALTA, candidatos: [A, B] });
    if (adv.estado !== "advertir") throw new Error("inalcanzable");

    const d = decidirAlta({ ...ALTA, candidatos: [A], acuse: adv.acuse });
    expect(d.estado).toBe("advertir");
    if (d.estado !== "advertir") throw new Error("inalcanzable");
    // `revisada` permite decir «lo que viste ya no es lo que hay» en vez de
    // repetir la advertencia inicial como si fuera la primera vez.
    expect(d.revisada).toBe(true);
    expect(d.acuse).not.toBe(adv.acuse);
  });

  it("6 · confirmación forjada al voleo: NO alcanza", () => {
    for (const falso of ["true", "1", "si", "", "0".repeat(32), "x".repeat(64)]) {
      const d = decidirAlta({ ...ALTA, candidatos: [A, B], acuse: falso });
      expect(d.estado).toBe("advertir");
    }
  });

  it("6b · el acuse de OTRO payload no sirve para éste", () => {
    const otro = decidirAlta({ razon: "Otra Cosa SRL", cuit: "30-70000100-1", candidatos: [A, B] });
    if (otro.estado !== "advertir") throw new Error("inalcanzable");
    const d = decidirAlta({ ...ALTA, candidatos: [A, B], acuse: otro.acuse });
    expect(d.estado).toBe("advertir");
  });

  it("6c · el booleano del contrato anterior ya no abre nada", () => {
    // Antes bastaba `confirmar_pese_a_duplicados: true` en la PRIMERA llamada
    // para saltear la advertencia sin haber visto un solo candidato.
    const d = decidirAlta({ ...ALTA, candidatos: [A, B], acuse: String(true) });
    expect(d.estado).toBe("advertir");
  });
});

describe("token de acuse", () => {
  it("no depende del orden en que la base devolvió los candidatos", () => {
    expect(tokenDuplicados(ALTA.razon, ALTA.cuit, [A.id, B.id])).toBe(
      tokenDuplicados(ALTA.razon, ALTA.cuit, [B.id, A.id]),
    );
  });

  it("tolera cambios cosméticos de la razón social", () => {
    const base = tokenDuplicados("Laboratorios Bagó S.A.", "30700000994", [A.id]);
    expect(tokenDuplicados("  laboratorios   bago  s.a.  ", "30700000994", [A.id])).toBe(base);
  });

  it("distingue el CUIT aunque venga con guiones", () => {
    expect(tokenDuplicados("X SA", "30-70000099-4", [A.id])).toBe(
      tokenDuplicados("X SA", "30700000994", [A.id]),
    );
    expect(tokenDuplicados("X SA", "30700000994", [A.id])).not.toBe(
      tokenDuplicados("X SA", "30700000995", [A.id]),
    );
  });

  it("cambia si cambia el conjunto de candidatos", () => {
    expect(tokenDuplicados(ALTA.razon, ALTA.cuit, [A.id])).not.toBe(
      tokenDuplicados(ALTA.razon, ALTA.cuit, [A.id, B.id]),
    );
  });
});
