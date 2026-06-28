import { describe, it, expect } from "vitest";
import { requiredVisibilityKeys } from "./visibility";

describe("requiredVisibilityKeys (regla del mínimo común)", () => {
  it("sin fuentes → fail-closed a ['staff']", () => {
    expect(requiredVisibilityKeys([])).toEqual(["staff"]);
  });
  it("todas public_auth → ['public_auth']", () => {
    expect(requiredVisibilityKeys(["public_auth", "public_auth"])).toEqual(["public_auth"]);
  });
  it("descarta public_auth cuando hay una más estricta (AND redundante)", () => {
    expect(requiredVisibilityKeys(["public_auth", "staff"])).toEqual(["staff"]);
  });
  it("conserva y deduplica múltiples claves estrictas, ordenadas", () => {
    expect(requiredVisibilityKeys(["staff", "client:abc", "client:abc"])).toEqual(["client:abc", "staff"]);
  });
  it("ignora espacios y vacíos", () => {
    expect(requiredVisibilityKeys([" perm:comercial.view ", ""])).toEqual(["perm:comercial.view"]);
  });
});
