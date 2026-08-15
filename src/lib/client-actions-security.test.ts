import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const ports = vi.hoisted(() => ({
  createUserClient: vi.fn(),
  createAdminClient: vi.fn(),
  getUser: vi.fn(),
  rpc: vi.fn(),
  duplicateCandidates: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: ports.createUserClient,
  createAdminClient: ports.createAdminClient,
}));
vi.mock("@/lib/data/clients", () => ({
  duplicateCandidates: ports.duplicateCandidates,
  listClients: vi.fn(),
}));

import { createClient } from "@/app/(app)/clients/actions";

function input(origen: "clientes" | "wms" = "clientes") {
  return {
    razon: "Cliente Seguro SA",
    cuit: "30-70000014-8",
    origen,
  };
}

beforeEach(() => {
  for (const port of Object.values(ports)) port.mockReset();
  ports.createUserClient.mockReturnValue({
    auth: { getUser: ports.getUser },
    rpc: ports.rpc,
  });
  ports.getUser.mockResolvedValue({ data: { user: { id: "user" } }, error: null });
  ports.rpc.mockResolvedValue({ data: false, error: null });
});

describe("acciones de clientes · autorización estricta antes de admin", () => {
  for (const [label, auth, permission] of [
    ["sin sesión", { data: { user: null }, error: null }, { data: true, error: null }],
    ["error de sesión", { data: { user: null }, error: { message: "detalle interno" } }, { data: true, error: null }],
    ["permiso falso", { data: { user: { id: "u" } }, error: null }, { data: false, error: null }],
    ["error de permiso", { data: { user: { id: "u" } }, error: null }, { data: null, error: { message: "detalle interno" } }],
  ] as const) {
    it(`${label}: no construye cliente admin ni consulta el maestro`, async () => {
      ports.getUser.mockResolvedValueOnce(auth);
      ports.rpc.mockResolvedValueOnce(permission);
      const result = await createClient(input());
      expect(result.ok).toBe(false);
      expect(JSON.stringify(result)).not.toContain("detalle interno");
      expect(ports.createAdminClient).not.toHaveBeenCalled();
      expect(ports.duplicateCandidates).not.toHaveBeenCalled();
    });
  }

  it("selecciona la capacidad exacta según el origen sin modo bootstrap", async () => {
    await createClient(input("wms"));
    expect(ports.rpc).toHaveBeenCalledWith("has_permission", {
      p_slug: "wms.clients.create",
    });
    expect(ports.createAdminClient).not.toHaveBeenCalled();

    ports.rpc.mockClear();
    await createClient(input("clientes"));
    expect(ports.rpc).toHaveBeenCalledWith("has_permission", {
      p_slug: "clientes.create",
    });
  });
});
