import { describe, expect, it } from "vitest";
import { normalize } from "./normalize";

describe("normalize", () => {
  it("recorta y colapsa espacios", () => {
    expect(normalize("  hola   mundo  ")).toBe("Hola mundo");
  });

  it("normaliza a Unicode NFC", () => {
    const descompuesto = "año"; // NFD: n + tilde combinante
    expect(descompuesto).not.toBe("año"); // distintos antes de normalizar
    expect(normalize(descompuesto)).toBe("Año");
    expect(normalize(descompuesto)).toBe(normalize("año"));
  });

  it("elimina el espacio previo a un signo de puntuación", () => {
    expect(normalize("hola , mundo")).toBe("Hola, mundo");
    expect(normalize("listo ?")).toBe("Listo?");
  });

  it("capitaliza la primera letra y las que siguen a . ! ?", () => {
    expect(normalize("hola. como estás")).toBe("Hola. Como estás");
    expect(normalize("pará! seguí")).toBe("Pará! Seguí");
    expect(normalize("¿sí? claro")).toBe("¿Sí? Claro");
  });

  it("no capitaliza dentro de un número decimal", () => {
    expect(normalize("pesan 3.5 kg")).toBe("Pesan 3.5 kg");
  });

  it("preserva los saltos de línea y colapsa los espacios que los rodean", () => {
    expect(normalize("hola \n mundo")).toBe("Hola\nmundo");
    expect(normalize("uno\n\n\n\ndos")).toBe("Uno\n\ndos");
  });

  it("devuelve cadena vacía para una entrada vacía o de solo espacios", () => {
    expect(normalize("")).toBe("");
    expect(normalize("   \n  ")).toBe("");
  });
});
