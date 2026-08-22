import { describe, expect, it } from "vitest";
import { isFinanceDirectorEmail } from "./rbac/boot-permissions";

describe("isFinanceDirectorEmail", () => {
  it.each([
    "martin@logisticatops.com",
    "MARTIN.BATTAGLIA@LOGISTICATOPS.COM",
    " martin@logisticatops.com ",
  ])("acepta solamente una identidad exacta de Direccion: %s", (email) => {
    expect(isFinanceDirectorEmail(email)).toBe(true);
  });

  it.each([
    "martin@tops.com",
    "martinrinas@logisticatops.com",
    "martin@otro-dominio.com",
    "martinbattaglia@logisticatops.com",
    "atacante+martinbattaglia@otro-dominio.com",
    "",
    null,
    undefined,
  ])("rechaza coincidencias parciales o identidades no autorizadas: %s", (email) => {
    expect(isFinanceDirectorEmail(email)).toBe(false);
  });
});
