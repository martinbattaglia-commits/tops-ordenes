import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock mínimo de deps: estado de env mutable por test + findFolderByPath controlable.
const mockEnv = vi.hoisted(() => ({
  google: { driveRootFolderId: "" },
  compliance: { driveFolderId: "", driveSubpath: "AGENCIA GUBERNAMENTAL DE CONTROL" },
}));
vi.mock("@/lib/env", () => ({ env: mockEnv }));
vi.mock("@/lib/drive/client", () => ({
  findFolderByPath: vi.fn(),
}));

import { findFolderByPath } from "@/lib/drive/client";
import { resolveComplianceFolder } from "./resolve-folder";

const findFolderByPathMock = vi.mocked(findFolderByPath);

// Id claramente FALSO (mismo formato que un folder id de Drive): el fixture no
// necesita el id real, y el secrets scanning de Netlify falla el build si el
// valor de GOOGLE_DRIVE_ROOT_FOLDER_ID aparece en el repo (Preview #45).
const ROOT_VIEJO = "1TEST-FAKE-ROOT-FOLDER-ID-0000000";
const CARPETA_NUEVA = "1saWQiEW6oH2dYBOToe3adgkLPpDIHtEW";

beforeEach(() => {
  vi.clearAllMocks();
  mockEnv.google.driveRootFolderId = "";
  mockEnv.compliance.driveFolderId = "";
  mockEnv.compliance.driveSubpath = "AGENCIA GUBERNAMENTAL DE CONTROL";
});

describe("resolveComplianceFolder", () => {
  it("honra COMPLIANCE_DRIVE_FOLDER_ID aunque esté FUERA del root global (E12)", async () => {
    mockEnv.google.driveRootFolderId = ROOT_VIEJO;
    mockEnv.compliance.driveFolderId = CARPETA_NUEVA;

    const r = await resolveComplianceFolder();

    expect(r).toEqual({ id: CARPETA_NUEVA, via: "env-id" });
    // Jamás degrada al root ni intenta resolución por ruta cuando hay id explícito.
    expect(r.id).not.toBe(ROOT_VIEJO);
    expect(findFolderByPathMock).not.toHaveBeenCalled();
  });

  it("honra el id explícito también sin root global configurado", async () => {
    mockEnv.compliance.driveFolderId = CARPETA_NUEVA;

    await expect(resolveComplianceFolder()).resolves.toEqual({
      id: CARPETA_NUEVA,
      via: "env-id",
    });
  });

  it("id explícito == root sigue siendo env-id (regresión)", async () => {
    mockEnv.google.driveRootFolderId = ROOT_VIEJO;
    mockEnv.compliance.driveFolderId = ROOT_VIEJO;

    await expect(resolveComplianceFolder()).resolves.toEqual({
      id: ROOT_VIEJO,
      via: "env-id",
    });
  });

  it("sin id explícito, resuelve por ruta de nombres desde el root (regresión)", async () => {
    mockEnv.google.driveRootFolderId = ROOT_VIEJO;
    findFolderByPathMock.mockResolvedValueOnce("folder-por-ruta");

    await expect(resolveComplianceFolder()).resolves.toEqual({
      id: "folder-por-ruta",
      via: "path",
    });
    expect(findFolderByPathMock).toHaveBeenCalledWith(["AGENCIA GUBERNAMENTAL DE CONTROL"]);
  });

  it("sin id explícito ni ruta resuelta, cae al root global (regresión)", async () => {
    mockEnv.google.driveRootFolderId = ROOT_VIEJO;
    findFolderByPathMock.mockResolvedValueOnce(null);

    await expect(resolveComplianceFolder()).resolves.toEqual({
      id: ROOT_VIEJO,
      via: "root",
    });
  });

  it("sin ninguna configuración devuelve none (el engine reporta skipped)", async () => {
    findFolderByPathMock.mockResolvedValueOnce(null);

    await expect(resolveComplianceFolder()).resolves.toEqual({ id: null, via: "none" });
  });
});
