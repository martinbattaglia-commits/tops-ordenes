import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const ports = vi.hoisted(() => ({
  createUserClient: vi.fn(),
  createAdminClient: vi.fn(),
  getUser: vi.fn(),
  rpc: vi.fn(),
  from: vi.fn(),
  demoMode: false,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: ports.createUserClient,
  createAdminClient: ports.createAdminClient,
}));

vi.mock("@/lib/env", () => ({
  env: { app: { get demoMode() { return ports.demoMode; } } },
}));

import { ClientsAccessDeniedError, listClients } from "@/lib/data/clients";

function authorizedClient() {
  return {
    auth: { getUser: ports.getUser },
    rpc: ports.rpc,
    from: ports.from,
  };
}

beforeEach(() => {
  for (const port of [
    ports.createUserClient,
    ports.createAdminClient,
    ports.getUser,
    ports.rpc,
    ports.from,
  ]) port.mockReset();
  ports.demoMode = false;
  ports.createUserClient.mockReturnValue(authorizedClient());
  ports.getUser.mockResolvedValue({ data: { user: { id: "user" } }, error: null });
  ports.rpc.mockResolvedValue({ data: true, error: null });
  const range = vi.fn().mockResolvedValue({ data: [], error: null, count: 0 });
  const order = vi.fn().mockReturnValue({ range });
  const select = vi.fn().mockReturnValue({ order });
  ports.from.mockReturnValue({ select });
});

describe("/clients · autorización antes de leer", () => {
  it("sin backend y fuera de demo falla cerrado sin exponer mocks", async () => {
    ports.createUserClient.mockReturnValueOnce(null);
    ports.demoMode = false;
    await expect(listClients()).rejects.toBeInstanceOf(ClientsAccessDeniedError);
    expect(ports.getUser).not.toHaveBeenCalled();
    expect(ports.from).not.toHaveBeenCalled();
  });

  it("sólo el demo explícito puede leer el dataset mock", async () => {
    ports.createUserClient.mockReturnValueOnce(null);
    ports.demoMode = true;
    await expect(listClients()).resolves.toMatchObject({ source: "mock" });
    expect(ports.from).not.toHaveBeenCalled();
    ports.demoMode = false;
  });

  for (const [label, authResult, permissionResult] of [
    ["sin sesión", { data: { user: null }, error: null }, { data: true, error: null }],
    ["error de sesión", { data: { user: null }, error: { message: "db secret" } }, { data: true, error: null }],
    ["permiso denegado", { data: { user: { id: "u" } }, error: null }, { data: false, error: null }],
    ["error de permiso", { data: { user: { id: "u" } }, error: null }, { data: null, error: { message: "db secret" } }],
  ] as const) {
    it(`${label}: no construye ninguna lectura de clients`, async () => {
      ports.getUser.mockResolvedValueOnce(authResult);
      ports.rpc.mockResolvedValueOnce(permissionResult);
      await expect(listClients()).rejects.toBeInstanceOf(ClientsAccessDeniedError);
      expect(ports.from).not.toHaveBeenCalled();
    });
  }

  it("ordena sesión → permiso exacto → lectura user-scoped", async () => {
    const order: string[] = [];
    ports.getUser.mockImplementation(async () => {
      order.push("auth");
      return { data: { user: { id: "u" } }, error: null };
    });
    ports.rpc.mockImplementation(async (name: string, args: unknown) => {
      order.push(`rpc:${name}:${JSON.stringify(args)}`);
      return { data: true, error: null };
    });
    ports.from.mockImplementation((table: string) => {
      order.push(`from:${table}`);
      return {
        select: () => ({
          order: () => ({ range: async () => ({ data: [], error: null, count: 0 }) }),
        }),
      };
    });
    await expect(listClients()).resolves.toMatchObject({ source: "supabase", total: 0 });
    expect(order).toEqual([
      "auth",
      'rpc:has_permission:{"p_slug":"clientes.view"}',
      "from:clients",
    ]);
    expect(ports.createAdminClient).not.toHaveBeenCalled();
  });
});
