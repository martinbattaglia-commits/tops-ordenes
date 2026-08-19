/**
 * BAJA DE LA CUSTODIA DIGITAL REFORZADA · la server action.
 *
 * ─── POR QUÉ EXISTE ────────────────────────────────────────────────────────
 *
 * `contractClientCustody` sólo eleva (1 → 2). Hasta este expediente, corregir
 * un alta hecha sobre el cliente equivocado exigía tocar la base a mano. La
 * RPC `client_set_custody_level` (0256) ya admitía el 2 → 1 con motivo: sólo
 * faltaba la superficie.
 *
 * ─── QUÉ SE MIDE ───────────────────────────────────────────────────────────
 *
 * Que la acción nueva es SIMÉTRICA de la de contratación —mismo permiso, mismo
 * CAS, misma RPC— y que además:
 *
 *   · exige motivo ANTES del round-trip, no después;
 *   · TRADUCE cada error de la base a un mensaje PROPIO. Una frase genérica
 *     que tape la causa real es el defecto que este expediente prohíbe: los
 *     tres defectos corregidos hoy nacieron de ese patrón;
 *   · no toca nada más que la fila del cliente: la mercadería ya materializada
 *     conserva su nivel (0252 la estampa en la unidad, no la re-deriva).
 *
 * ─── FRONTERAS ─────────────────────────────────────────────────────────────
 *
 * Se sustituye el cliente de Supabase y la revalidación de Next. La acción,
 * sus validaciones y su traducción de errores son el código que se despliega.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Fronteras ──────────────────────────────────────────────────────────────

// `actions.ts` arrastra `server-only` vía `@/lib/data/clients`; el resto de la
// suite lo neutraliza igual (ver `client-actions-security.test.ts`).
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

interface Escenario {
  /** Respuesta de `has_permission`. */
  permiso: boolean;
  /** Mensaje de error que devuelve la RPC de nivel, o null si sale bien. */
  errorRpc: string | null;
  /** `updated_at` devuelto cuando la RPC sale bien. */
  updatedAt: string;
}

const escenario: Escenario = { permiso: true, errorRpc: null, updatedAt: "" };

/** Llamadas registradas a `client_set_custody_level`. */
let llamadas: Array<Record<string, unknown>> = [];

function fakeSupabase() {
  return {
    auth: {
      getUser: async () => ({ data: { user: { id: "u-1" } }, error: null }),
    },
    rpc(nombre: string, args: Record<string, unknown>) {
      if (nombre === "has_permission") {
        return Promise.resolve({ data: escenario.permiso, error: null });
      }
      if (nombre === "client_set_custody_level") {
        llamadas.push(args);
        const resultado = escenario.errorRpc
          ? { data: null, error: { message: escenario.errorRpc } }
          : { data: { updated_at: escenario.updatedAt }, error: null };
        return {
          select: () => ({ single: async () => resultado }),
        };
      }
      throw new Error(`RPC inesperada en la prueba: ${nombre}`);
    },
  };
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: () => fakeSupabase(),
  createAdminClient: () => fakeSupabase(),
}));

const CLIENTE = "11111111-1111-4111-8111-111111111111";
const VERSION = "2026-08-15T00:00:00.000Z";

beforeEach(() => {
  escenario.permiso = true;
  escenario.errorRpc = null;
  escenario.updatedAt = "2026-08-19T12:00:00.000Z";
  llamadas = [];
});

async function bajar(id: string, version: string, motivo: string) {
  const mod = await import("@/app/(app)/clients/actions");
  const fn = (mod as Record<string, unknown>).downgradeClientCustody as
    | ((id: string, version: string, motivo: string) => Promise<
        { ok: true; updated_at: string } | { ok: false; error: string }
      >)
    | undefined;
  expect(fn, "la acción `downgradeClientCustody` no existe").toBeTypeOf("function");
  return fn!(id, version, motivo);
}

// ── El camino que corrige el alta ──────────────────────────────────────────

describe("baja de custodia · el camino correcto", () => {
  it("nivel 2 + motivo baja a 1 con el motivo y el CAS de la ficha", async () => {
    const r = await bajar(CLIENTE, VERSION, "  contratada sobre el cliente equivocado  ");
    expect(r).toEqual({ ok: true, updated_at: "2026-08-19T12:00:00.000Z" });

    expect(llamadas).toHaveLength(1);
    const args = llamadas[0]!;
    // El nivel destino es 1 y NO es parámetro de quien llama: esta superficie
    // sólo baja, igual que la hermana sólo sube.
    expect(args.p_level).toBe(1);
    expect(args.p_id).toBe(CLIENTE);
    // El motivo viaja normalizado: la base lo persiste con `btrim` (0256:166)
    // y mandarlo con espacios haría que el evento y la pantalla difieran.
    expect(args.p_motivo).toBe("contratada sobre el cliente equivocado");
    // Mismo CAS que la contratación: sin token, 0256 aborta por 40001.
    expect(args.p_expected_updated_at).toBe(VERSION);
  });

  it("no toca ninguna otra RPC: la mercadería ya materializada conserva su nivel", async () => {
    // 0252 ESTAMPA `custody_level` en `custody_physical_units` al ingresar y no
    // lo re-deriva del cliente al despachar. Por eso bajar al cliente no puede
    // implicar ninguna escritura sobre unidades, casos ni compuertas: si esta
    // acción llamara algo más, el bien ya ingresado quedaría fuera del aparato
    // probatorio con el que entró. La única llamada permitida es la de nivel.
    await bajar(CLIENTE, VERSION, "corrección de alta");
    expect(llamadas).toHaveLength(1);
    const args = llamadas[0]!;
    expect(Object.keys(args).sort()).toEqual(
      ["p_expected_updated_at", "p_id", "p_level", "p_motivo"].sort(),
    );
  });
});

// ── Los rechazos, cada uno con SU mensaje ──────────────────────────────────

describe("baja de custodia · cada rechazo dice su causa", () => {
  it("sin motivo rechaza ANTES del round-trip, y lo dice", async () => {
    const r = await bajar(CLIENTE, VERSION, "   ");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/motivo/i);
    // Lo decisivo: no hubo viaje a la base. La validación es local.
    expect(llamadas, "se llamó a la RPC con un motivo vacío").toHaveLength(0);
  });

  it("sin el permiso no hay round-trip y el mensaje nombra la capacidad", async () => {
    escenario.permiso = false;
    const r = await bajar(CLIENTE, VERSION, "corrección de alta");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain("clientes.custody.contract");
    expect(llamadas).toHaveLength(0);
  });

  it("CLIENT_DENEGADO de la base tiene mensaje propio de permiso", async () => {
    escenario.errorRpc = "CLIENT_DENEGADO: se requiere el permiso clientes.custody.contract";
    const r = await bajar(CLIENTE, VERSION, "corrección de alta");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/permiso/i);
    expect(r.error).not.toMatch(/reintent[áa]/i);
  });

  it("CLIENT_MOTIVO_REQUERIDO de la base tiene mensaje propio de motivo", async () => {
    escenario.errorRpc = "CLIENT_MOTIVO_REQUERIDO: dar de baja la custodia digital exige un motivo";
    const r = await bajar(CLIENTE, VERSION, "corrección de alta");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/motivo/i);
  });

  it("CAS vencido tiene mensaje propio Y accionable", async () => {
    escenario.errorRpc =
      "CLIENT_CONFLICTO_CONCURRENTE: la ficha cambió desde que fue abierta (esperado x, actual y)";
    const r = await bajar(CLIENTE, VERSION, "corrección de alta");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/cambió|cambio/i);
    // Accionable: le dice al operador qué hacer, no sólo que falló.
    expect(r.error).toMatch(/recarg/i);
  });

  it("ningún rechazo conocido cae en la frase genérica de reintento", async () => {
    // Ésta es la guarda contra el patrón que causó los tres defectos de hoy:
    // colapsar causas distintas en una sola frase que las tapa.
    const CODIGOS = [
      "CLIENT_DENEGADO: x",
      "CLIENT_MOTIVO_REQUERIDO: x",
      "CLIENT_CONFLICTO_CONCURRENTE: x",
      "CLIENT_INEXISTENTE: x",
      "CLIENT_NIVEL_INVALIDO: x",
      "CLIENT_SIN_IDENTIDAD: x",
      "CLIENT_SIN_PERFIL_ACTIVO: x",
    ];
    const mensajes: string[] = [];
    for (const codigo of CODIGOS) {
      escenario.errorRpc = codigo;
      llamadas = [];
      const r = await bajar(CLIENTE, VERSION, "corrección de alta");
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.error, `${codigo} cayó en la frase genérica`).not.toMatch(
        /Reintent[áa] en unos minutos/i,
      );
      mensajes.push(r.error);
    }
    // Y además son DISTINTOS entre sí: siete causas, siete mensajes.
    expect(new Set(mensajes).size).toBe(CODIGOS.length);
  });

  it("un motivo desmesurado no entra a la auditoría", async () => {
    // Mismo tope que `setClientActivo` y que el maestro. `client_events.motivo`
    // es `text` sin límite: un pegado accidental entraría entero al evento.
    const r = await bajar(CLIENTE, VERSION, "x".repeat(501));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/500/);
    expect(llamadas).toHaveLength(0);
    // Y el límite exacto sí pasa: 500 es tope, no umbral.
    llamadas = [];
    const ok = await bajar(CLIENTE, VERSION, "x".repeat(500));
    expect(ok.ok).toBe(true);
    expect(llamadas).toHaveLength(1);
  });

  it("la ficha sin versión vigente no viaja a la base", async () => {
    const r = await bajar(CLIENTE, "", "corrección de alta");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/versi[óo]n|recarg/i);
    expect(llamadas).toHaveLength(0);
  });

  it("un identificador que no es UUID no viaja a la base", async () => {
    const r = await bajar("no-es-uuid", VERSION, "corrección de alta");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(llamadas).toHaveLength(0);
  });
});

// ── Invariancia sobre las migraciones (NO es par rojo→verde) ───────────────

describe("invariancia · 0252 y 0256 no se tocaron", () => {
  /**
   * Estas dos NO son pares rojo→verde: hoy ya están en verde, y ése es el
   * punto. Son la guarda de que este expediente NO tocó la RPC ni la regla de
   * recepción, y de que la promesa que la pantalla le hace al usuario —«lo ya
   * ingresado conserva su custodia»— sigue siendo cierta en la base.
   * Se declaran como invariancia, no como cobertura nueva.
   */
  it("`custody_physical_units.custody_level` se estampa al ingresar, no se re-deriva", async () => {
    const { readFileSync, readdirSync } = await import("node:fs");
    const dir = "supabase/migrations";

    // 1 · La columna existe con el DEFAULT que preserva lo ya materializado.
    const sql = readFileSync(`${dir}/0252_custody_two_levels.sql`, "utf8");
    expect(sql).toMatch(
      /custody_physical_units[\s\S]{0,200}custody_level smallint not null default 2/,
    );
    expect(sql).toMatch(/custody_physical_units_level_ck check \(custody_level in \(1, 2\)\)/);

    // 2 · Y NINGUNA migración re-deriva ese nivel desde el cliente. Ésta es la
    //     que importa: medir el COMENTARIO de 0252 fallaría al reescribirlo sin
    //     cambiar una línea de DDL, y quedaría verde si alguien agregara mañana
    //     el `update ... set custody_level = <nivel del cliente>` en el
    //     despacho —que es exactamente el daño que la invariancia custodia—.
    const REDERIVA =
      /update\s+(public\.)?custody_physical_units[\s\S]{0,400}custody_level\s*=[\s\S]{0,300}\bclients?\b/i;
    const culpables = readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .filter((f) => REDERIVA.test(readFileSync(`${dir}/${f}`, "utf8")));
    expect(
      culpables,
      "una migración re-deriva el nivel de la unidad desde el cliente: el bien saldría bajo un régimen distinto del que entró",
    ).toEqual([]);
  });

  it("la BAJA sigue exigiendo motivo en 0256, y el permiso sigue siendo el mismo", async () => {
    const { readFileSync } = await import("node:fs");
    const sql = readFileSync("supabase/migrations/0256_clients_custody_level_rpc.sql", "utf8");
    expect(sql).toMatch(/CLIENT_MOTIVO_REQUERIDO/);
    expect(sql).toMatch(/has_permission\('clientes\.custody\.contract'\)/);
  });
});
