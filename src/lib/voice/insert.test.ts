import { describe, expect, it } from "vitest";
import { planInsertion } from "./insert";

describe("planInsertion", () => {
  it("inserta en el caret agregando un espacio separador", () => {
    expect(planInsertion("Hola Juan,", 10, 10, "¿Cómo estás?")).toEqual({
      value: "Hola Juan, ¿Cómo estás?",
      caret: 23,
    });
  });

  it("reemplaza la selección cuando selStart !== selEnd", () => {
    expect(planInsertion("uno dos tres", 4, 7, "cuatro")).toEqual({
      value: "uno cuatro tres",
      caret: 10,
    });
  });

  it("no antepone espacio si el texto empieza con puntuación", () => {
    expect(planInsertion("hola", 4, 4, ", mundo")).toEqual({
      value: "hola, mundo",
      caret: 11,
    });
  });

  it("no antepone espacio después de un carácter de apertura", () => {
    expect(planInsertion("(", 1, 1, "nota")).toEqual({
      value: "(nota",
      caret: 5,
    });
    expect(planInsertion("dice: ", 6, 6, "sí")).toEqual({
      value: "dice: sí",
      caret: 8,
    });
  });

  it("no antepone espacio en un campo vacío", () => {
    expect(planInsertion("", 0, 0, "primero")).toEqual({
      value: "primero",
      caret: 7,
    });
  });

  it("agrega un espacio posterior si lo que sigue es una palabra", () => {
    expect(planInsertion("ab cd", 3, 3, "X")).toEqual({
      value: "ab X cd",
      caret: 5,
    });
  });

  it("no agrega espacio posterior antes de puntuación", () => {
    expect(planInsertion("hola .", 5, 5, "Juan")).toEqual({
      value: "hola Juan.",
      caret: 9,
    });
  });

  it("ignora un texto vacío o de solo espacios", () => {
    expect(planInsertion("hola", 2, 2, "   ")).toEqual({
      value: "hola",
      caret: 2,
    });
  });
});
