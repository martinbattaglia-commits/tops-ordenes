import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * KDW-001 — Cobertura permanente del allowlist del middleware.
 *
 * `updateSession` es la frontera de autenticación de toda la app: lo que figura en
 * su lista `isPublic` queda accesible SIN sesión. El expediente KDW-001 agregó una
 * única entrada (`/api/knowledge/drain`, para que el cron pueda llegar al handler,
 * que tiene su propio guard fail-closed — ver `src/lib/knowledge/drain-route.test.ts`).
 *
 * Estos tests fijan las dos mitades del contrato:
 *   · que la ruta del cron efectivamente atraviesa el middleware, y
 *   · que NINGUNA otra ruta se volvió pública por efecto del cambio.
 * La igualdad del allowlist es EXACTA (`===`), no por prefijo: variantes con barra
 * final, subrutas o mayúsculas deben seguir protegidas.
 */

// El kill-switch de demo mode (`!configured || demoMode` → deja pasar TODO) haría
// que cualquier ruta pareciera pública: se fija en "configurado y sin demo" para
// que el test evalúe el allowlist real y no un bypass.
const envMock = vi.hoisted(() => ({
  supabase: { configured: true, url: "https://proyecto.supabase.co", anonKey: "anon-key" },
  app: { demoMode: false },
}));
vi.mock("@/lib/env", () => ({ env: envMock }));

// Sesión simulada: `usuario` null = request sin cookie válida, que es exactamente
// el caso del cron de GitHub Actions.
const sesion = vi.hoisted(() => ({ usuario: null as unknown }));
vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: { getUser: async () => ({ data: { user: sesion.usuario }, error: null }) },
  }),
}));

import { readdirSync } from "node:fs";
import { NextRequest } from "next/server";
import { updateSession } from "./middleware";

type Resultado = "pasa" | "401" | "redirect-login" | "redirect-dashboard" | `otro-${number}`;

/**
 * Ejecuta el middleware sobre un pathname y clasifica su desenlace.
 *
 * "pasa" se reserva EXCLUSIVAMENTE al passthrough real de `NextResponse.next()`
 * (status 200 + cabecera `x-middleware-next`). Cualquier otro desenlace se
 * devuelve como `otro-<status>`: si se clasificara por descarte, un bloqueo con
 * un status inesperado (429, 503, …) se leería como "público" y volvería verde
 * un test que en realidad describe una ruta bloqueada.
 */
async function evaluar(pathname: string): Promise<Resultado> {
  const res = await updateSession(
    new NextRequest(new URL(`https://tops-ordenes.netlify.app${pathname}`)),
  );
  if (res.status === 401) return "401";
  if (res.headers.get("location")?.includes("/login")) return "redirect-login";
  if (res.headers.get("location")?.includes("/dashboard")) return "redirect-dashboard";
  if (res.status === 200 && res.headers.get("x-middleware-next") === "1") return "pasa";
  return `otro-${res.status}`;
}

/** Archivos que Next.js convierte en una ruta servida, en cualquiera de sus extensiones. */
const ARCHIVO_DE_RUTA = /^(route|page|default)\.(ts|tsx|js|jsx|mdx)$/;

/**
 * Enumera la SUPERFICIE REAL que la app sirve, en sus DOS orígenes:
 *   · `src/app/**` — cada carpeta con `route|page|default.(ts|tsx|js|jsx|mdx)`;
 *   · `public/**`  — los estáticos, que Netlify sirve desde la raíz y que también
 *     atraviesan el middleware (ahí viven los 13 manuales internos, el organigrama
 *     y las herramientas comerciales: contenido real, no un 404).
 *
 * El cierre se hace contra esta superficie —no contra el texto de la allowlist—
 * porque el fuente admite infinitas formas de dar de alta una ruta (comillas
 * simples, backticks, `.includes()`, un array auxiliar, la cláusula partida en dos
 * líneas…) y un parser de texto sólo reconocería la que conoce. Ejecutando el
 * middleware sobre cada pathname servido, el alta queda expuesta cualquiera sea su
 * sintaxis.
 *
 * ALCANCE EXACTO — el barrido cierra:
 *   · toda alta por PREFIJO (`startsWith`), porque alcanza a paths reales; y
 *   · toda alta EXACTA sobre un path literal del árbol o de `public/`;
 *   · incluso una ruta nueva que nadie dio de alta pero que hereda de un prefijo ya
 *     presente (p. ej. crear `src/app/api/auth/loquesea/route.ts`).
 * NO cierra las altas exactas sobre pathnames DERIVADOS, que el barrido no puede
 * enumerar: el valor concreto de un segmento dinámico (`/api/cctv/snapshot/1`, que
 * acá se sondea como `.../muestra`) y el directory-index de `public/` (`/manual-nexus`
 * frente a `/manual-nexus/index.html`). Esa clase se cubre por sondas nominadas en
 * `PRIVADAS_DE_CONTROL`, no por el barrido. Declararlo importa: un límite mal
 * enunciado se da por auditado.
 */
function superficieDeRutas(): string[] {
  const rutas: string[] = [];

  const recorrerApp = (dir: URL, segmentos: string[]) => {
    for (const entrada of readdirSync(dir, { withFileTypes: true })) {
      if (entrada.isDirectory()) {
        const n = entrada.name;
        if (n.startsWith("_") || n.startsWith("@")) continue; // privados / paralelos: no son rutas
        const siguiente = n.startsWith("(") && n.endsWith(")") // grupos: no aportan segmento
          ? segmentos
          : [...segmentos, n.replace(/^\[\[?\.{0,3}(.+?)\]?\]$/, "muestra")];
        recorrerApp(new URL(`${n}/`, dir), siguiente);
      } else if (ARCHIVO_DE_RUTA.test(entrada.name)) {
        rutas.push(`/${segmentos.join("/")}`);
      }
    }
  };

  const recorrerPublic = (dir: URL, segmentos: string[]) => {
    for (const entrada of readdirSync(dir, { withFileTypes: true })) {
      if (entrada.isDirectory()) recorrerPublic(new URL(`${entrada.name}/`, dir), [...segmentos, entrada.name]);
      else rutas.push(`/${[...segmentos, entrada.name].join("/")}`);
    }
  };

  recorrerApp(new URL("../../app/", import.meta.url), []);
  recorrerPublic(new URL("../../../public/", import.meta.url), []);
  return [...new Set(rutas)].sort();
}

// Inventario de sondas sintéticas: variantes que NO corresponden a un archivo del
// árbol (barra final, mayúsculas, subrutas inexistentes) y por eso no aparecen en
// `superficieDeRutas()`. Complementan el barrido, no lo reemplazan.
const PUBLICAS_ESPERADAS = [
  "/login",
  "/auth/forgot-password",
  "/auth/reset-password",
  "/api/auth/callback",
  "/api/whatsapp/webhook",
  "/api/whatsapp/inbound-queue",
  "/api/whatsapp/relay-queue",
  "/api/clientify/webhook",
  "/api/clientify/webhook/token-abc",
  "/api/tracking/ingest",
  "/api/tracking/traccar-forward",
  "/api/tracking/cron/silence-alert",
  "/api/compliance/sync",
  "/api/comercial/contratos/sync",
  "/api/tesoreria/caja-chica/sync",
  "/api/clientify/sync-deals",
  "/api/connect/cron/dispatch-outbox",
  "/api/knowledge/drain",
  "/compras/validar/abc123",
  "/api/version",
  "/_next/static/chunk.js",
  "/icons/icon.png",
  "/fonts/gotham.woff2",
  "/manifest.webmanifest",
  "/sw.js",
  "/favicon.ico",
];

// Rutas privadas de control, con su desenlace EXACTO esperado. Afirmar el
// desenlace (y no un `not.toBe("pasa")`) evita que un bloqueo aparente —por
// ejemplo un `NextResponse.rewrite`, que devuelve 200 y NO deniega nada— se lea
// como "protegida" por simple descarte.
const PRIVADAS_DE_CONTROL: Array<[string, Resultado]> = [
  ["/api/knowledge/drain/", "401"],
  ["/api/knowledge/drain/otra-ruta", "401"],
  ["/api/whatsapp/inbound-queue/", "401"],
  ["/api/whatsapp/inbound-queue/otra-ruta", "401"],
  ["/api/whatsapp/relay-queue/", "401"],
  ["/api/whatsapp/relay-queue/otra-ruta", "401"],
  ["/api/Knowledge/Drain", "401"],
  ["/api/knowledge", "401"],
  ["/api/drive/list", "401"],
  ["/api/cctv/cameras", "401"],
  ["/api/clientify/ping", "401"],
  ["/api/whatsapp/send", "401"],
  ["/api/compras/ordenes", "401"],
  ["/api/compliance/casos", "401"],
  ["/api/connect/cron/otro", "401"],
  // `/API/...` no matchea `startsWith("/api/")`, así que cae por la rama de
  // páginas → redirect. Igualmente denegada. Matiz preexistente, ajeno a KDW-001.
  ["/API/knowledge/drain", "redirect-login"],
  ["/dashboard", "redirect-login"],
  ["/tesoreria", "redirect-login"],
  ["/drive", "redirect-login"],
  ["/settings/users", "redirect-login"],
  // Pathnames DERIVADOS: la clase que el barrido no puede enumerar (ver el
  // alcance declarado en `superficieDeRutas`). Valores concretos de segmentos
  // dinámicos y directory-index de `public/` — donde viven los 13 manuales
  // internos, el organigrama y las herramientas comerciales.
  ["/api/cctv/snapshot/1", "401"],
  ["/api/orders/PO-2026-0001/pdf", "401"],
  ["/c/token-de-cliente", "redirect-login"],
  ["/manual-nexus", "redirect-login"],
  ["/manual-nexus/", "redirect-login"],
  ["/manual-nexus/index.html", "redirect-login"],
  ["/tools/cotizador", "redirect-login"],
  ["/tools/cotizador/", "redirect-login"],
  ["/docs", "redirect-login"],
  ["/copilot", "redirect-login"],
];

beforeEach(() => {
  sesion.usuario = null;
  envMock.supabase.configured = true;
  envMock.app.demoMode = false;
});

describe("middleware · allowlist — /api/knowledge/drain (KDW-001)", () => {
  it("1. /api/knowledge/drain atraviesa el middleware sin cookie", async () => {
    expect(await evaluar("/api/knowledge/drain")).toBe("pasa");
  });

  it("1b. lo atraviesa también con query string (el allowlist mira sólo el pathname)", async () => {
    const res = await updateSession(
      new NextRequest(new URL("https://tops-ordenes.netlify.app/api/knowledge/drain?dry=1")),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });

  it("2. la igualdad es exacta: /api/knowledge/drainX queda protegida", async () => {
    expect(await evaluar("/api/knowledge/drainX")).toBe("401");
    expect(await evaluar("/api/knowledge/drain-extra")).toBe("401");
  });

  it("3. /api/knowledge/drain/ (barra final) permanece protegida", async () => {
    expect(await evaluar("/api/knowledge/drain/")).toBe("401");
  });

  it("4. /api/knowledge/drain/otra-ruta permanece protegida", async () => {
    expect(await evaluar("/api/knowledge/drain/otra-ruta")).toBe("401");
  });

  it("5. las variantes de mayúsculas permanecen protegidas", async () => {
    // Se afirma el desenlace EXACTO, no la negación de "pasa": clasificar por
    // descarte dejaría pasar un bypass por rewrite (status 200 sin passthrough).
    // Matiz documentado (preexistente, ajeno a KDW-001): la rama que responde 401 JSON
    // exige `pathname.startsWith("/api/")` en minúscula. `/API/...` queda igualmente
    // protegido, pero por la rama de páginas → redirect a /login. Ambos niegan acceso.
    expect(await evaluar("/api/Knowledge/Drain")).toBe("401");
    expect(await evaluar("/api/knowledge/DRAIN")).toBe("401");
    expect(await evaluar("/API/knowledge/drain")).toBe("redirect-login");
  });

  it("5b. el padre /api/knowledge permanece protegido", async () => {
    expect(await evaluar("/api/knowledge")).toBe("401");
  });
});

describe("middleware · comportamiento no relacionado preservado (KDW-001)", () => {
  it("6. las rutas privadas de API siguen devolviendo 401 JSON", async () => {
    for (const ruta of ["/api/drive/list", "/api/cctv/cameras", "/api/clientify/ping", "/api/whatsapp/send"]) {
      expect(await evaluar(ruta), ruta).toBe("401");
    }
  });

  it("6b. las páginas privadas siguen redirigiendo a /login con ?from", async () => {
    const res = await updateSession(
      new NextRequest(new URL("https://tops-ordenes.netlify.app/tesoreria")),
    );
    expect(res.headers.get("location")).toContain("/login");
    expect(res.headers.get("location")).toContain("from=%2Ftesoreria");
  });

  it("6c. los demás crons ya habilitados siguen atravesando el middleware", async () => {
    for (const ruta of [
      "/api/connect/cron/dispatch-outbox",
      "/api/compliance/sync",
      "/api/comercial/contratos/sync",
      "/api/tesoreria/caja-chica/sync",
      "/api/clientify/sync-deals",
      "/api/whatsapp/inbound-queue",
      "/api/whatsapp/relay-queue",
    ]) {
      expect(await evaluar(ruta), ruta).toBe("pasa");
    }
  });

  it("6d. con sesión válida, una ruta privada pasa (el allowlist no la afecta)", async () => {
    sesion.usuario = { id: "u1" };
    expect(await evaluar("/tesoreria")).toBe("pasa");
    expect(await evaluar("/api/drive/list")).toBe("pasa");
  });
});

describe("middleware · inventario cerrado del allowlist (KDW-001)", () => {
  // CIERRE REAL: barre TODAS las rutas que la app sirve (derivadas del árbol de
  // src/app) y ejecuta el middleware sobre cada una. Que una ruta se vuelva
  // pública rompe este test cualquiera sea la sintaxis con que se la dé de alta
  // en la allowlist —comillas simples, backticks, `.includes()`, un array
  // auxiliar—, porque acá se evalúa el predicado, no se lee su texto.
  it("7-superficie. de todas las rutas de la app, sólo son públicas las esperadas", async () => {
    const superficie = superficieDeRutas();
    // Guard de existencia (Marco Regla 7): un barrido roto que devolviera poco o
    // nada daría un PASS vacío. La superficie real ronda las 200 entradas.
    expect(superficie.length).toBeGreaterThan(180);
    expect(superficie).toContain("/api/knowledge/drain"); // el sujeto del expediente
    expect(superficie).toContain("/manual-nexus/index.html"); // rama public/ viva

    const publicas: string[] = [];
    for (const ruta of superficie) {
      if ((await evaluar(ruta)) === "pasa") publicas.push(ruta);
    }

    expect(publicas).toEqual([
      // — endpoints con guard propio dentro del handler —
      "/api/auth/callback",
      "/api/auth/signout",
      "/api/clientify/sync-deals",
      "/api/clientify/webhook",
      "/api/clientify/webhook/muestra",
      "/api/comercial/contratos/sync",
      "/api/compliance/sync",
      "/api/connect/cron/dispatch-outbox",
      "/api/knowledge/drain",
      "/api/tesoreria/caja-chica/sync",
      "/api/tracking/cron/silence-alert",
      "/api/tracking/ingest",
      "/api/tracking/traccar-forward",
      "/api/version",
      "/api/whatsapp/inbound-queue",
      "/api/whatsapp/relay-queue",
      "/api/whatsapp/webhook",
      // — páginas públicas —
      "/auth/forgot-password",
      "/auth/reset-password",
      "/compras/validar/muestra",
      "/login",
      // — estáticos de public/ (sin datos) —
      "/favicon.ico",
      "/fonts/Gotham-Black.otf",
      "/fonts/Gotham-Bold.otf",
      "/fonts/Gotham-Book.otf",
      "/fonts/Gotham-Medium.otf",
      "/icons/apple-touch-icon.png",
      "/icons/icon-192.png",
      "/icons/icon-512.png",
      "/icons/login-bg.jpg",
      "/icons/login/operator.png",
      "/icons/login/ops-photo.png",
      "/icons/logo-color-blue-bg.png",
      "/icons/logo-color-transparent.png",
      "/icons/logo-color.png",
      "/icons/logo-horizontal-transparent.png",
      "/icons/logo-isologo-primary.png",
      "/icons/logo-white-transparent.png",
      "/icons/logo-white.png",
      "/manifest.webmanifest",
      "/sw.js",
      // `.sort()` porque la lista de arriba está agrupada por naturaleza para que
      // se lea, mientras que el barrido devuelve orden lexicográfico.
    ].sort());
  });

  it("7. las sondas sintéticas públicas pasan y sólo ellas", async () => {
    const publicasReales: string[] = [];
    for (const ruta of [...PUBLICAS_ESPERADAS, ...PRIVADAS_DE_CONTROL.map(([r]) => r)]) {
      if ((await evaluar(ruta)) === "pasa") publicasReales.push(ruta);
    }
    expect(publicasReales.sort()).toEqual([...PUBLICAS_ESPERADAS].sort());
  });

  it("7b. cada ruta privada de control conserva su desenlace exacto", async () => {
    // Aislamiento del cambio: las públicas previas a KDW-001 siguen públicas y
    // ninguna privada cambió de desenlace (ni a passthrough ni a otro status).
    for (const ruta of PUBLICAS_ESPERADAS.filter((r) => r !== "/api/knowledge/drain")) {
      expect(await evaluar(ruta), ruta).toBe("pasa");
    }
    for (const [ruta, esperado] of PRIVADAS_DE_CONTROL) {
      expect(await evaluar(ruta), ruta).toBe(esperado);
    }
  });
});
