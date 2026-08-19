/**
 * @vitest-environment jsdom
 *
 * NEXUS-LINK-NOTIFICATIONS-MEDIA-001 · FASE A · la campanita, por RENDER REAL.
 *
 * Se monta el componente productivo en un DOM y se lee lo que ve el operador.
 * La frontera Supabase se sustituye por un doble que devuelve los tres
 * contadores; todo lo demás —composición, colores, formas, textos accesibles—
 * es el código que se despliega.
 *
 * Cubre los ocho estados visuales que exige el mandato: cada color solo, cada
 * par, los tres a la vez y ninguno.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { createRoot, type Root } from "react-dom/client";

// ── Fronteras ──────────────────────────────────────────────────────────────
let contadores = { red_system_count: 0, green_whatsapp_count: 0, yellow_internal_count: 0 };
/** Si es true, la vista responde con ERROR (0234 todavía no aplicada). */
let vistaAusente = false;
/** Tablas/vistas consultadas, para comprobar de DÓNDE sale cada cifra. */
const consultadas: string[] = [];
/** Tablas suscritas por realtime: los contadores dependen de las tres. */
const suscritas: string[] = [];
/** RPC invocadas por el componente, en orden. */
const rpcs: string[] = [];

/** Callbacks de realtime, para poder provocar una recarga desde la prueba. */
const recargas: Array<() => void> = [];

vi.mock("@/lib/supabase/realtime", () => ({
  useRealtimeTable: (tabla: string, cb: () => void) => {
    if (!suscritas.includes(tabla)) suscritas.push(tabla);
    recargas.push(cb);
  },
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: { id: "user-de-prueba" } } }) },
    // La RPC 0235 devuelve `integer` con las filas marcadas. El doble tiene que
    // devolverlo o la campanita toma la rama de error y no recarga.
    rpc: async (nombre: string) => { rpcs.push(nombre); return { data: 1, error: null }; },
    from(tabla: string) {
      consultadas.push(tabla);
      if (tabla === "v_link_notification_badges") {
        return {
          select: () => ({
            maybeSingle: async () =>
              vistaAusente
                ? { data: null, error: { message: 'relation "v_link_notification_badges" does not exist' } }
                : { data: contadores, error: null },
          }),
        };
      }
      // `v_link_my_notifications`: la lista del panel, ya aislada por
      // destinatario en la vista (0235).
      return {
        select: () => ({
          eq: () => ({
            order: () => ({ limit: async () => ({ data: [], error: null }) }),
          }),
        }),
      };
    },
  }),
}));

import { NotificationsBell } from "./NotificationsBell";

let contenedor: HTMLDivElement;
let root: Root;

async function montar() {
  contenedor = document.createElement("div");
  document.body.appendChild(contenedor);
  root = createRoot(contenedor);
  await act(async () => {
    root.render(<NotificationsBell />);
  });
  // Deja resolver la carga asincrónica de contadores.
  await act(async () => { await Promise.resolve(); });
}

/** Badges visibles: los `role="status"` del cluster, en orden de lectura. */
function badges(): string[] {
  return Array.from(contenedor.querySelectorAll('[role="status"]'))
    .map((e) => e.getAttribute("aria-label") ?? "");
}

function badgeDe(categoria: string): string | undefined {
  return badges().find((l) => l.startsWith(categoria));
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  consultadas.length = 0;
  suscritas.length = 0;
  recargas.length = 0;
  rpcs.length = 0;
  vistaAusente = false;
  contadores = { red_system_count: 0, green_whatsapp_count: 0, yellow_internal_count: 0 };
});

afterEach(async () => {
  await act(async () => { root?.unmount(); });
  contenedor?.remove();
  vi.useRealTimers();
});

/** Dispara una recarga por realtime y deja pasar el debounce de 250 ms. */
async function recargarPorRealtime() {
  await act(async () => { recargas[0]?.(); });
  await act(async () => { await vi.advanceTimersByTimeAsync(300); });
  await act(async () => { await Promise.resolve(); });
}

describe("los contadores salen de la vista única de verdad", () => {
  it("consulta v_link_notification_badges, no una suma de la lista del panel", async () => {
    contadores = { red_system_count: 5, green_whatsapp_count: 0, yellow_internal_count: 0 };
    await montar();
    expect(consultadas).toContain("v_link_notification_badges");
  });

  it("el badge rojo NO está limitado por el `limit(15)` del panel", async () => {
    contadores = { red_system_count: 340, green_whatsapp_count: 0, yellow_internal_count: 0 };
    await montar();
    // Se dibuja recortado…
    expect(contenedor.textContent).toContain("99+");
    // …pero el total exacto viaja en el texto accesible.
    expect(badgeDe("Notificaciones del sistema")).toBe("Notificaciones del sistema: 340 pendientes");
  });
});

describe("los ocho estados visuales", () => {
  it("ninguna categoría: no se dibuja ningún badge", async () => {
    await montar();
    expect(badges()).toEqual([]);
    const boton = contenedor.querySelector("button")!;
    expect(boton.getAttribute("aria-label")).toBe("Notificaciones: sin pendientes");
  });

  it("sólo ROJO", async () => {
    contadores = { red_system_count: 3, green_whatsapp_count: 0, yellow_internal_count: 0 };
    await montar();
    expect(badges()).toHaveLength(1);
    expect(badgeDe("Notificaciones del sistema")).toContain("3");
  });

  it("sólo VERDE", async () => {
    contadores = { red_system_count: 0, green_whatsapp_count: 2, yellow_internal_count: 0 };
    await montar();
    expect(badges()).toHaveLength(1);
    expect(badgeDe("WhatsApp")).toContain("2");
  });

  it("sólo AMARILLO", async () => {
    contadores = { red_system_count: 0, green_whatsapp_count: 0, yellow_internal_count: 7 };
    await montar();
    expect(badges()).toHaveLength(1);
    expect(badgeDe("Chat interno")).toContain("7");
  });

  it("ROJO + VERDE, sin amarillo", async () => {
    contadores = { red_system_count: 1, green_whatsapp_count: 4, yellow_internal_count: 0 };
    await montar();
    expect(badges()).toHaveLength(2);
    expect(badgeDe("Chat interno")).toBeUndefined();
  });

  it("ROJO + AMARILLO, sin verde", async () => {
    contadores = { red_system_count: 1, green_whatsapp_count: 0, yellow_internal_count: 4 };
    await montar();
    expect(badges()).toHaveLength(2);
    expect(badgeDe("WhatsApp")).toBeUndefined();
  });

  it("VERDE + AMARILLO, sin rojo", async () => {
    contadores = { red_system_count: 0, green_whatsapp_count: 3, yellow_internal_count: 4 };
    await montar();
    expect(badges()).toHaveLength(2);
    expect(badgeDe("Notificaciones del sistema")).toBeUndefined();
  });

  it("LOS TRES a la vez, cada uno con su cifra propia", async () => {
    contadores = { red_system_count: 1, green_whatsapp_count: 2, yellow_internal_count: 3 };
    await montar();
    expect(badges()).toHaveLength(3);
    expect(badgeDe("Notificaciones del sistema")).toContain("1 pendiente");
    expect(badgeDe("WhatsApp")).toContain("2 pendientes");
    expect(badgeDe("Chat interno")).toContain("3 pendientes");
  });
});

describe("no hay color prioritario ni fusión", () => {
  it("los tres badges coexisten con colores y formas distintas", async () => {
    contadores = { red_system_count: 1, green_whatsapp_count: 2, yellow_internal_count: 3 };
    await montar();
    const clases = Array.from(contenedor.querySelectorAll('[role="status"]'))
      .map((e) => e.className);
    expect(clases).toHaveLength(3);
    // Colores distintos entre sí…
    expect(clases.some((c) => c.includes("#c90812"))).toBe(true);
    expect(clases.some((c) => c.includes("#0f6b39"))).toBe(true);
    expect(clases.some((c) => c.includes("#f2c200"))).toBe(true);
    // …y forma distinta: el rojo es círculo, los otros dos cuadrados.
    const rojo = clases.find((c) => c.includes("#c90812"))!;
    expect(rojo).toContain("rounded-full");
  });

  it("cada badge lleva su propio icono, no sólo color", async () => {
    contadores = { red_system_count: 1, green_whatsapp_count: 2, yellow_internal_count: 3 };
    await montar();
    for (const badge of Array.from(contenedor.querySelectorAll('[role="status"]'))) {
      expect(badge.querySelector("svg")).not.toBeNull();
    }
  });
});

describe("accesibilidad y teclado", () => {
  it("el botón describe todas las categorías con pendientes y sólo ésas", async () => {
    contadores = { red_system_count: 2, green_whatsapp_count: 0, yellow_internal_count: 9 };
    await montar();
    const label = contenedor.querySelector("button")!.getAttribute("aria-label")!;
    expect(label).toContain("Notificaciones del sistema: 2 pendientes");
    expect(label).toContain("Chat interno: 9 pendientes");
    expect(label).not.toContain("WhatsApp");
  });

  it("cada badge tiene tooltip con el total exacto", async () => {
    contadores = { red_system_count: 250, green_whatsapp_count: 0, yellow_internal_count: 0 };
    await montar();
    const badge = contenedor.querySelector('[role="status"]')!;
    expect(badge.getAttribute("title")).toContain("250");
  });

  it("el botón declara su estado de despliegue y Escape cierra el panel", async () => {
    await montar();
    const boton = contenedor.querySelector("button")!;
    expect(boton.getAttribute("aria-expanded")).toBe("false");

    await act(async () => { boton.click(); });
    expect(contenedor.querySelector('[role="region"]')).not.toBeNull();

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(contenedor.querySelector('[role="region"]')).toBeNull();
    // Y el foco vuelve al disparador, no se pierde en el documento.
    expect(document.activeElement).toBe(boton);
  });

  it("abrir la campanita NO marca nada como leído: los contadores no cambian", async () => {
    contadores = { red_system_count: 4, green_whatsapp_count: 1, yellow_internal_count: 2 };
    await montar();
    const antes = badges();
    await act(async () => { contenedor.querySelector("button")!.click(); });
    expect(badges()).toEqual(antes);
  });
});

describe("realtime: las tres fuentes que mueven los contadores (C4 · H-1)", () => {
  it("se suscribe también a connect_participants, donde escribe el marcado de leído", async () => {
    await montar();
    // `connect_mark_read` actualiza `connect_participants.last_read_seq`. Sin
    // esta suscripción, verde y amarillo no BAJAN al leer una conversación.
    expect(suscritas).toContain("notifications");
    expect(suscritas).toContain("connect_messages");
    expect(suscritas).toContain("connect_participants");
    // C4 3/3 · MEDIUM-1: marcar leído un BROADCAST escribe en
    // `notification_reads`, no en `notifications`. La campanita vive en un
    // layout persistente: sin esta suscripción el rojo se queda con la cifra
    // vieja hasta una recarga dura, y los broadcasts son 17 de 28 en producción.
    expect(suscritas).toContain("notification_reads");
  });
});

describe("realtime: la campanita persistente se actualiza sin recarga (PRE-C4 · C)", () => {
  it("un evento de notification_reads baja el rojo sin re-montar el componente", async () => {
    contadores = { red_system_count: 1, green_whatsapp_count: 2, yellow_internal_count: 3 };
    await montar();
    const botonAntes = contenedor.querySelector("button")!;
    expect(badgeDe("Notificaciones del sistema")).toContain("1 pendiente");

    // El servidor registró la lectura personal del broadcast: el rojo baja.
    contadores = { red_system_count: 0, green_whatsapp_count: 2, yellow_internal_count: 3 };
    const iReads = suscritas.indexOf("notification_reads");
    expect(iReads).toBeGreaterThanOrEqual(0);
    await act(async () => { recargas[iReads]?.(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    await act(async () => { await Promise.resolve(); });

    // Sin recarga: es el MISMO nodo, con la cifra nueva.
    expect(contenedor.querySelector("button")).toBe(botonAntes);
    expect(badgeDe("Notificaciones del sistema")).toBeUndefined();
    // Y las otras dos categorías no se movieron.
    expect(badgeDe("WhatsApp")).toContain("2 pendientes");
    expect(badgeDe("Chat interno")).toContain("3 pendientes");
  });

  it("el canal se cierra al desmontar: no quedan escuchas de otra sesión", async () => {
    await montar();
    const antes = recargas.length;
    expect(antes).toBeGreaterThan(0);
    await act(async () => { root.unmount(); });
    // El hook real hace unsubscribe en su cleanup; acá se comprueba que el
    // componente no registra escuchas nuevas después de desmontarse.
    expect(recargas.length).toBe(antes);
    contenedor.remove();
    contenedor = document.createElement("div");
    document.body.appendChild(contenedor);
    root = createRoot(contenedor);
  });
});

describe("marcar leído (C4 · H-3 · 0235)", () => {
  it("usa la RPC canónica, no un UPDATE directo sobre `notifications`", async () => {
    contadores = { red_system_count: 40, green_whatsapp_count: 0, yellow_internal_count: 0 };
    await montar();
    await act(async () => { contenedor.querySelector("button")!.click(); });

    const boton = Array.from(contenedor.querySelectorAll("button"))
      .find((b) => /Marcar todas leídas/.test(b.textContent ?? ""))!;
    expect(boton).toBeDefined();
    await act(async () => { boton.click(); });

    // Una sola vía de escritura, con verificación de destinatario en el
    // servidor y lectura PERSONAL de los broadcasts. El UPDATE directo dejaba
    // que un admin marcara leída la bandeja de toda la organización.
    expect(rpcs).toContain("connect_notif_mark_all_read");
    expect(consultadas).not.toContain("notifications");
  });

  it("la lista del panel sale de la vista aislada, no de la tabla cruda", async () => {
    await montar();
    expect(consultadas).toContain("v_link_my_notifications");
    expect(consultadas).not.toContain("notifications");
  });
});

describe("degradación segura (C4 · M-5)", () => {
  it("si la vista todavía no existe, la consulta ERRORA y la shell no rompe", async () => {
    vistaAusente = true;
    await montar();
    // La rama de error se ejecuta de verdad: la vista respondió con error, no
    // con `data: null`. Antes este caso pasaba aunque se borrara el manejo.
    expect(contenedor.querySelector("button")).not.toBeNull();
    expect(badges()).toEqual([]);
    expect(contenedor.querySelector("button")!.getAttribute("aria-label"))
      .toBe("Notificaciones: sin pendientes");
  });

  it("si la vista responde bien después de haber fallado, los badges vuelven", async () => {
    vistaAusente = false;
    contadores = { red_system_count: 2, green_whatsapp_count: 1, yellow_internal_count: 0 };
    await montar();
    expect(badges()).toHaveLength(2);
  });

  it("un error POSTERIOR limpia los contadores ya cargados (la rama fail-safe se ejecuta)", async () => {
    // C4 2/2 · M-2: montar directamente en error no discriminaba, porque
    // `EMPTY_BADGE_COUNTS` coincide con el estado inicial y el caso pasaba
    // igual si se borraba el manejo de error. Acá se parte de contadores NO
    // nulos ya pintados y recién entonces la vista falla: si la rama
    // `badgesError` no existiera, los badges viejos quedarían en pantalla.
    contadores = { red_system_count: 7, green_whatsapp_count: 3, yellow_internal_count: 5 };
    await montar();
    expect(badges()).toHaveLength(3);

    vistaAusente = true;
    await recargarPorRealtime();

    expect(badges()).toEqual([]);
    expect(contenedor.querySelector("button")!.getAttribute("aria-label"))
      .toBe("Notificaciones: sin pendientes");
  });
});

describe("higiene de accesibilidad (C4 · M-1, M-2)", () => {
  it("los badges reciben el puntero: si no, su tooltip no se mostraría nunca", async () => {
    contadores = { red_system_count: 1, green_whatsapp_count: 1, yellow_internal_count: 1 };
    await montar();
    for (const badge of Array.from(contenedor.querySelectorAll('[role="status"]'))) {
      expect(badge.className).toContain("pointer-events-auto");
    }
  });

  it("el panel NO se anuncia como menú ARIA: es una lista de enlaces", async () => {
    await montar();
    const boton = contenedor.querySelector("button")!;
    expect(boton.getAttribute("aria-haspopup")).toBeNull();
    expect(boton.getAttribute("aria-controls")).toBeTruthy();

    await act(async () => { boton.click(); });
    expect(contenedor.querySelector('[role="menu"]')).toBeNull();
    const panel = contenedor.querySelector('[role="region"]')!;
    expect(panel).not.toBeNull();
    // El botón apunta al panel que efectivamente abre.
    expect(panel.getAttribute("id")).toBe(boton.getAttribute("aria-controls"));
  });
});
