import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Autorización estricta de documentos (Resolución R2-b).
 *
 * Contrato bajo prueba: sesión + asignación RBAC explícita + permiso efectivo.
 * `profiles.role` y cualquier fail-open global son irrelevantes para conceder.
 *
 * El backend se simula a nivel de las consultas que hace el helper:
 *   · `user_roles`        → asignaciones explícitas del usuario
 *   · `role_permissions`  → permisos efectivos de esos roles
 */

const state = {
  user: null as { id: string } | null,
  /** Filas de `user_roles` del usuario. Vacío = sin asignación explícita. */
  asignaciones: [] as { role_id: string }[],
  /** Slugs que conceden los roles asignados. */
  permisosEfectivos: [] as string[],
  /** `profiles.role` — NO debe alcanzar para conceder. */
  profileRole: "operaciones" as string | null,
  rbacEnforce: false,
  /** Simula un fallo al leer `profiles`. */
  perfilError: false,
  /** Simula un usuario sin fila en `profiles`. */
  perfilLegible: true,
  /** `profiles.depot` — ámbito de jefatura de depósito. */
  depot: null as string | null,
  /** `profiles.client_id` — ámbito de portal. */
  clientId: null as string | null,
  /** Última consulta a role_permissions, para verificar su FORMA. */
  ultimoSelect: "" as string,
  ultimoFiltroSlug: "" as string,
};

vi.mock("server-only", () => ({}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: state.user } }) },
    from(tabla: string) {
      if (tabla === "user_roles") {
        return {
          select: () => ({
            eq: async () => ({ data: state.asignaciones, error: null }),
          }),
        };
      }
      if (tabla === "profiles") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () =>
                state.perfilError
                  ? { data: null, error: { message: "boom" } }
                  : {
                      data: state.perfilLegible
                        ? {
                            role: state.profileRole,
                            depot: state.depot,
                            client_id: state.clientId,
                          }
                        : null,
                      error: null,
                    },
            }),
          }),
        };
      }
      if (tabla === "role_permissions") {
        return {
          select: (sel: string) => ({
            in: (_col: string, roleIds: string[]) => ({
              eq: (col: string, slug: string) => ({
                limit: async () => {
                  state.ultimoSelect = sel;
                  state.ultimoFiltroSlug = col;
                  const concede =
                    roleIds.length > 0 && state.permisosEfectivos.includes(slug);
                  return { data: concede ? [{ permission_id: "p1" }] : [], error: null };
                },
              }),
            }),
          }),
        };
      }
      throw new Error(`tabla inesperada: ${tabla}`);
    },
  }),
}));

vi.mock("@/lib/auth/roles", () => ({
  getCurrentProfileRole: async () => state.profileRole,
}));

const { requireExplicitPermission, authorizeDocumentAccess, depotInScope, clientInScope } =
  await import("./authz");

function reset(over: Partial<typeof state> = {}) {
  state.user = { id: `u-${Math.random().toString(36).slice(2)}` };
  state.asignaciones = [{ role_id: "rol-operaciones" }];
  state.permisosEfectivos = ["wms.view", "tesoreria.view"];
  state.profileRole = "operaciones";
  state.depot = null;
  state.clientId = null;
  state.perfilError = false;
  state.perfilLegible = true;
  state.rbacEnforce = false;
  Object.assign(state, over);
}

describe("R2-b · autorización estricta de documentos", () => {
  beforeEach(() => reset());

  it("1 · asignación + permiso correcto → permitido", async () => {
    expect((await requireExplicitPermission("wms.view")).ok).toBe(true);
  });

  it("2 · asignación sin el permiso pedido → 403", async () => {
    reset({ permisosEfectivos: ["compras.view"] });
    expect(await requireExplicitPermission("wms.view")).toMatchObject({
      ok: false,
      status: 403,
    });
  });

  it("3 · usuario interno SIN asignación RBAC → 403", async () => {
    reset({ asignaciones: [] });
    expect(await requireExplicitPermission("tesoreria.view")).toMatchObject({
      ok: false,
      status: 403,
    });
  });

  it("4 · profiles.role='operaciones' sin asignación → 403", async () => {
    // El default del enum no concede nada por sí solo.
    reset({ asignaciones: [], profileRole: "operaciones" });
    const r = await authorizeDocumentAccess("wms.view", { scope: "internal" });
    expect(r).toMatchObject({ ok: false, status: 403 });
  });

  it("5 · usuario de portal → 403 aunque tuviera el permiso", async () => {
    reset({ profileRole: "cliente" });
    const r = await authorizeDocumentAccess("wms.view", { scope: "internal" });
    expect(r).toMatchObject({ ok: false, status: 403 });
  });

  it("6 · sin sesión → 401", async () => {
    reset();
    state.user = null;
    expect(await requireExplicitPermission("wms.view")).toMatchObject({
      ok: false,
      status: 401,
    });
  });

  it("7 · fuera de ámbito (rol no determinable) → fail-closed 403", async () => {
    reset({ profileRole: null });
    const r = await authorizeDocumentAccess("wms.view", { scope: "internal" });
    expect(r).toMatchObject({ ok: false, status: 403 });
  });

  it("8 · enumeración consecutiva → 429 sin filtrar existencia", async () => {
    reset();
    const res = [];
    for (let i = 0; i < 70; i++) res.push(await requireExplicitPermission("wms.view"));
    const cortados = res.filter((r) => !r.ok && r.status === 429);
    expect(cortados.length).toBeGreaterThan(0);
    // El 429 no distingue documento existente de inexistente: se decide antes
    // de tocar los datos.
    expect(res[0].ok).toBe(true);
  });

  it("9 · con RBAC_ENFORCE apagado la ruta sigue bloqueando", async () => {
    // El helper no consulta la bandera: sin asignación, deniega igual.
    reset({ asignaciones: [], rbacEnforce: false });
    expect(await requireExplicitPermission("wms.view")).toMatchObject({
      ok: false,
      status: 403,
    });
  });

  it("11 · la consulta usa !inner: sin él, PostgREST haría LEFT JOIN y concedería a cualquiera", async () => {
    reset();
    await requireExplicitPermission("wms.view");
    // Sin `!inner` el embed es LEFT JOIN y devuelve filas aunque el rol NO
    // tenga el permiso: fail-open total. Esta aserción es la única defensa
    // automática contra que alguien lo quite.
    expect(state.ultimoSelect).toContain("permissions!inner");
    // Y el filtro debe aplicarse sobre la tabla embebida, no sobre otra columna.
    expect(state.ultimoFiltroSlug).toBe("permissions.slug");
  });

  it("12 · portal con tesoreria.view → 403 (el recibo expone CUIT y CBU)", async () => {
    // Regresión detectada en revisión: al volver opt-in el ámbito interno, la
    // ruta de recibos se había quedado sin esa capa.
    reset({ profileRole: "cliente", permisosEfectivos: ["tesoreria.view"] });
    const r = await authorizeDocumentAccess("tesoreria.view", { scope: "internal" });
    expect(r).toMatchObject({ ok: false, status: 403 });
  });

  it("13 · jefe de depósito asignado alcanza su propio depósito", async () => {
    reset({ depot: "MAGALDI" });
    const r = await authorizeDocumentAccess("wms.view", { scope: "internal" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(depotInScope(r.scope, "MAGALDI")).toBe(true);
  });

  it("14 · jefe de OTRO depósito no alcanza el documento", async () => {
    reset({ depot: "MAGALDI" });
    const r = await authorizeDocumentAccess("wms.view", { scope: "internal" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(depotInScope(r.scope, "LUJAN")).toBe(false);
  });

  it("15 · alcance global legítimo (sin depósito asignado) llega a ambos", async () => {
    // Así representa el modelo a dirección, gerencia y compliance.
    reset({ depot: null });
    const r = await authorizeDocumentAccess("wms.view", { scope: "internal" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(depotInScope(r.scope, "MAGALDI")).toBe(true);
      expect(depotInScope(r.scope, "LUJAN")).toBe(true);
    }
  });

  it("16 · documento sin depósito determinable → fail-closed para quien está acotado", async () => {
    reset({ depot: "LUJAN" });
    const r = await authorizeDocumentAccess("wms.view", { scope: "internal" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(depotInScope(r.scope, null)).toBe(false);
  });

  it("17 · portal sólo alcanza documentos de su propio cliente", async () => {
    reset({ profileRole: "cliente", clientId: "cli-1", permisosEfectivos: ["servicios.view"] });
    const r = await requireExplicitPermission("servicios.view");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(clientInScope(r.scope, "cli-1")).toBe(true);
      expect(clientInScope(r.scope, "cli-2")).toBe(false);
      // Documento sin cliente declarado → fail-closed.
      expect(clientInScope(r.scope, null)).toBe(false);
    }
  });

  it("18 · error leyendo profiles → 403, nunca alcance global", async () => {
    // Antes se descartaba el error: el scope quedaba en nulls y tanto
    // depotInScope como clientInScope devolvían true ⇒ alcance global.
    reset({ perfilError: true });
    expect(await requireExplicitPermission("wms.view")).toMatchObject({
      ok: false,
      status: 403,
    });
  });

  it("19 · usuario sin fila en profiles → 403", async () => {
    reset({ perfilLegible: false });
    expect(await requireExplicitPermission("analytics.view")).toMatchObject({
      ok: false,
      status: 403,
    });
  });

  it("10 · tabla de asignaciones vacía → fail-closed, nunca acceso general", async () => {
    reset({ asignaciones: [], permisosEfectivos: [] });
    for (const p of ["wms.view", "tesoreria.view"] as const) {
      expect(await requireExplicitPermission(p)).toMatchObject({
        ok: false,
        status: 403,
      });
    }
  });
});
