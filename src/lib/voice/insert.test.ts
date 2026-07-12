import { describe, expect, it } from "vitest";
import { planInsertion } from "./insert";

/** Atajo para el caso común: inserción con caret colapsado al final. */
const at = (value: string, caret: number) => ({
  value,
  caretStart: caret,
  caretEnd: caret,
});

describe("planInsertion", () => {
  it("inserta en el caret agregando un espacio separador", () => {
    expect(planInsertion("Hola Juan,", 10, 10, "¿Cómo estás?")).toEqual(
      at("Hola Juan, ¿Cómo estás?", 23),
    );
  });

  it("reemplaza la selección cuando selStart !== selEnd", () => {
    expect(planInsertion("uno dos tres", 4, 7, "cuatro")).toEqual(
      at("uno cuatro tres", 10),
    );
  });

  it("no antepone espacio si el texto empieza con puntuación", () => {
    expect(planInsertion("hola", 4, 4, ", mundo")).toEqual(at("hola, mundo", 11));
  });

  it("no antepone espacio después de un carácter de apertura", () => {
    expect(planInsertion("(", 1, 1, "nota")).toEqual(at("(nota", 5));
    expect(planInsertion("dice: ", 6, 6, "sí")).toEqual(at("dice: sí", 8));
  });

  it("SÍ antepone espacio después de dos puntos secos", () => {
    // ":" es puntuación de cierre, no de apertura: "Notas:" + dictado debe dar
    // "Notas: hola", nunca "Notas:hola".
    expect(planInsertion("Notas:", 6, 6, "hola")).toEqual(at("Notas: hola", 11));
  });

  it("no antepone espacio en un campo vacío", () => {
    expect(planInsertion("", 0, 0, "primero")).toEqual(at("primero", 7));
  });

  it("agrega un espacio posterior si lo que sigue es una palabra", () => {
    expect(planInsertion("ab cd", 3, 3, "X")).toEqual(at("ab X cd", 5));
  });

  it("no agrega espacio posterior antes de puntuación", () => {
    expect(planInsertion("hola .", 5, 5, "Juan")).toEqual(at("hola Juan.", 9));
  });

  it("ignora un texto vacío o de solo espacios, preservando el caret", () => {
    expect(planInsertion("hola", 2, 2, "   ")).toEqual({
      value: "hola",
      caretStart: 2,
      caretEnd: 2,
    });
  });

  it("un no-op con selección activa PRESERVA la selección", () => {
    // Si el dictado vino vacío, el usuario no pierde lo que tenía seleccionado.
    expect(planInsertion("uno dos tres", 4, 7, "  ")).toEqual({
      value: "uno dos tres",
      caretStart: 4,
      caretEnd: 7,
    });
  });
});
