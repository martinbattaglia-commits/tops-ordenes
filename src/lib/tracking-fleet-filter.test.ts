import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * FMC130 · punto 2 — `listFleet()` no debe mostrar vehículos dados de baja.
 *
 * El enum `fleet_vehicle_status_t` tiene `active · inactive · maintenance` y
 * hasta este cambio la consulta traía la tabla entera. La prueba falla contra
 * la versión anterior (sin `.neq`) porque el doble de Supabase aplica los
 * filtros de verdad sobre el dataset en vez de ignorarlos: si el código no
 * filtra, el vehículo `inactive` aparece en el resultado.
 *
 * Criterio fijado por Dirección: `maintenance` SÍ se muestra.
 */

const FILAS = [
  {
    id: "v-activo",
    name: "Camión 01",
    plate: "AA000AA",
    type: "camion",
    status: "active",
    driver_name: null,
    device_identifier: "FMC130-01",
    updated_at: "2026-08-17T00:00:00.000Z",
  },
  {
    id: "v-baja",
    name: "Auto viejo",
    plate: "BB111BB",
    type: "auto",
    status: "inactive",
    driver_name: null,
    device_identifier: null,
    updated_at: "2026-08-17T00:00:00.000Z",
  },
  {
    id: "v-taller",
    name: "Camión 02",
    plate: "CC222CC",
    type: "camion",
    status: "maintenance",
    driver_name: null,
    device_identifier: "FMC130-02",
    updated_at: "2026-08-17T00:00:00.000Z",
  },
];

/**
 * Doble mínimo del query builder de PostgREST. Aplica `.neq/.eq/.in` sobre el
 * dataset: sin esa fidelidad la prueba pasaría aunque el código no filtrara.
 */
function builder(dataset: Array<Record<string, unknown>>) {
  let filas = [...dataset];
  const b = {
    select: () => b,
    neq: (col: string, val: unknown) => {
      filas = filas.filter((r) => r[col] !== val);
      return b;
    },
    eq: (col: string, val: unknown) => {
      filas = filas.filter((r) => r[col] === val);
      return b;
    },
    in: (col: string, vals: unknown[]) => {
      filas = filas.filter((r) => vals.includes(r[col]));
      return b;
    },
    order: () => b,
    then: (resolve: (v: { data: unknown; error: null }) => unknown) =>
      resolve({ data: filas, error: null }),
  };
  return b;
}

const createClient = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => createClient(),
}));

beforeEach(() => {
  createClient.mockReset();
  createClient.mockReturnValue({
    from: (tabla: string) =>
      tabla === "fleet_vehicles" ? builder(FILAS) : builder([]),
  });
});

describe("listFleet · visibilidad por estado", () => {
  it("oculta los vehículos inactive", async () => {
    const { listFleet } = await import("./tracking/data");
    const res = await listFleet();

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.vehicles.map((v) => v.id)).not.toContain("v-baja");
  });

  it("sigue mostrando active y maintenance", async () => {
    const { listFleet } = await import("./tracking/data");
    const res = await listFleet();

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.vehicles.map((v) => v.id).sort()).toEqual([
      "v-activo",
      "v-taller",
    ]);
  });
});
