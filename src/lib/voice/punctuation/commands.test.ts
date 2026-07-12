import { describe, expect, it } from "vitest";
import { applyCommands } from "./commands";

describe("applyCommands", () => {
  it("interpreta comandos multi-palabra inequívocos", () => {
    expect(applyCommands("hola nueva línea mundo")).toBe("hola \n mundo");
    expect(applyCommands("uno nuevo párrafo dos")).toBe("uno \n\n dos");
    expect(applyCommands("fin punto y aparte inicio")).toBe("fin .\n inicio");
    expect(applyCommands("qué pasa signo de interrogación")).toBe("qué pasa ?");
    expect(applyCommands("cuidado signo de exclamación")).toBe("cuidado !");
  });

  it("acepta las variantes sin tilde", () => {
    expect(applyCommands("hola nueva linea mundo")).toBe("hola \n mundo");
    expect(applyCommands("uno nuevo parrafo dos")).toBe("uno \n\n dos");
  });

  it("es insensible a mayúsculas", () => {
    expect(applyCommands("hola NUEVA LÍNEA mundo")).toBe("hola \n mundo");
  });

  it("NUNCA reemplaza las palabras aisladas 'punto' y 'coma'", () => {
    expect(applyCommands("el punto de encuentro")).toBe("el punto de encuentro");
    expect(applyCommands("que coma tranquilo")).toBe("que coma tranquilo");
    expect(applyCommands("punto de venta")).toBe("punto de venta");
  });

  it("prefiere 'punto y aparte' sobre cualquier coincidencia parcial", () => {
    expect(applyCommands("listo punto y aparte")).toBe("listo .\n");
  });

  it("deja intacto un texto sin comandos", () => {
    expect(applyCommands("descargar en el depósito de Magaldi")).toBe(
      "descargar en el depósito de Magaldi",
    );
  });
});
