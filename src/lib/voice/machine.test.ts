import { describe, expect, it } from "vitest";
import { transition } from "./machine";

describe("transition", () => {
  it("arranca la escucha desde idle", () => {
    expect(transition("idle", { type: "START" })).toBe("listening");
  });

  it("arranca la escucha desde error (reintento)", () => {
    expect(transition("error", { type: "START" })).toBe("listening");
  });

  it("STOP lleva de listening a processing", () => {
    expect(transition("listening", { type: "STOP" })).toBe("processing");
  });

  it("CANCEL lleva a idle desde listening y desde processing", () => {
    expect(transition("listening", { type: "CANCEL" })).toBe("idle");
    expect(transition("processing", { type: "CANCEL" })).toBe("idle");
  });

  it("SETTLED cierra processing en idle", () => {
    expect(transition("processing", { type: "SETTLED" })).toBe("idle");
  });

  it("FAIL lleva a error desde listening y desde processing", () => {
    expect(transition("listening", { type: "FAIL" })).toBe("error");
    expect(transition("processing", { type: "FAIL" })).toBe("error");
  });

  it("DISMISS limpia el error", () => {
    expect(transition("error", { type: "DISMISS" })).toBe("idle");
  });

  it("es total: una acción inválida no cambia el estado", () => {
    expect(transition("idle", { type: "STOP" })).toBe("idle");
    expect(transition("idle", { type: "SETTLED" })).toBe("idle");
    expect(transition("processing", { type: "START" })).toBe("processing");
    expect(transition("listening", { type: "START" })).toBe("listening");
  });
});
