import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import {
  depotManagerIdentity,
  depotManagerRouteAllowed,
  depotManagerRpcRowValid,
  type DepotManagerRpcRow,
} from "@/lib/rbac/depot-manager";

/**
 * Mantiene la sesión refrescada en cada request y bloquea las rutas
 * privadas si el usuario no está autenticado.
 *
 * Rutas:
 *  - /login        → pública
 *  - /api/auth/*   → pública
 *  - todo el resto → requiere sesión (excepto en demo mode)
 */
export async function updateSession(request: NextRequest) {
  const response = NextResponse.next({ request });

  // Demo mode (sin Supabase o forzado) → dejamos pasar libremente.
  if (!env.supabase.configured || env.app.demoMode) {
    return response;
  }

  const supabase = createServerClient(env.supabase.url!, env.supabase.anonKey!, {
    cookies: {
      get(name: string) {
        return request.cookies.get(name)?.value;
      },
      set(name: string, value: string, options: CookieOptions) {
        response.cookies.set({ name, value, ...options });
      },
      remove(name: string, options: CookieOptions) {
        response.cookies.set({ name, value: "", ...options });
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  // Rutas estrictamente públicas. Cuidado al agregar nuevas: cualquier ruta acá
  // queda accesible sin sesión y puede leakear datos sensibles del Drive
  // corporativo, CRM, CCTV, etc.
  //
  // Política:
  //   · /login                       → form público de inicio de sesión
  //   · /api/auth/*                  → callbacks de Supabase (login/logout)
  //   · /api/whatsapp/webhook        → Meta firma y postea acá (sin cookies)
  //   · /api/clientify/webhook/<token> → Clientify postea acá. Clientify NO firma
  //                                    (ver CLIENTIFY_WEBHOOK_AUTH_RESEARCH.md); la
  //                                    auth es token-en-URL, validado timing-safe
  //                                    dentro del handler. ping/sync-* siguen privados.
  //   · /compras/validar/<publicId>  → QR público que valida OC firmadas
  //   · assets estáticos             → _next, icons, fonts, manifest, sw, favicon
  //
  // TODO el resto (incluido /drive, /api/drive/*, /api/cctv/*, /api/clientify/{ping,sync-deals},
  // /api/whatsapp/{ping,send}, /api/compras/*, /api/orders/*, /api/invoices/*) requiere
  // sesión válida — fueron movidos a privado el 2026-05-29 tras el DRIVE-PREFLIGHT-AUDIT
  // que detectó exposición pública del browser de Drive.
  const isPublic =
    pathname === "/login" ||
    pathname === "/auth/forgot-password" ||
    pathname === "/auth/reset-password" ||
    pathname.startsWith("/api/auth") ||
    pathname === "/api/whatsapp/webhook" ||
    // Webhook de Clientify: ruta tokenizada /api/clientify/webhook/<token>. El token-en-URL
    // se valida dentro del handler (verifyWebhookToken). /api/clientify/ping sigue privado;
    // /api/clientify/sync-deals es cron (Bearer CRON_SECRET) → ver allowlist más abajo.
    pathname === "/api/clientify/webhook" ||
    pathname.startsWith("/api/clientify/webhook/") ||
    pathname === "/api/tracking/ingest" || // Traccar Client postea sin sesión; protegido por token propio
    // Sync diario del Compliance Cockpit: el cron (GitHub Actions) postea con
    // `Authorization: Bearer CRON_SECRET` sin cookie de sesión. La auth se valida
    // DENTRO del handler (CRON_SECRET). Sólo la ruta exacta — no /api/compliance/*.
    pathname === "/api/compliance/sync" ||
    // Sync diario de Contratos (Comercial → Cynthia → Clientes): mismo patrón que
    // compliance — el cron postea con `Authorization: Bearer CRON_SECRET` sin cookie;
    // la auth se valida DENTRO del handler. Sólo la ruta exacta.
    pathname === "/api/comercial/contratos/sync" ||
    // Sync diario de Caja Chica (Tesorería): mismo patrón — el cron postea con
    // `Authorization: Bearer CRON_SECRET` sin cookie; la auth se valida DENTRO
    // del handler. Sólo la ruta exacta.
    pathname === "/api/tesoreria/caja-chica/sync" ||
    // Sync diario del Tablero Comercial (Clientify → Supabase): el cron (GitHub Actions)
    // postea con `Authorization: Bearer CRON_SECRET` sin cookie; la auth se valida DENTRO
    // del handler. Sólo la ruta exacta — no /api/clientify/* (ping sigue privado).
    pathname === "/api/clientify/sync-deals" ||
    // Worker de connect_outbox (F4.1A, D-F41-9): la Netlify Scheduled Function postea con
    // `Authorization: Bearer CRON_SECRET` sin cookie; la auth se valida DENTRO del handler
    // (timing-safe, 503 sin secret / 401 mismatch). Sólo la ruta exacta.
    // Hallazgo del smoke DRAFT de la ventana F4.1: sin esta línea el middleware devolvía 401
    // incluso con Bearer válido (mismo patrón que los 5 crons de arriba).
    pathname === "/api/connect/cron/dispatch-outbox" ||
    // Worker de drenado de knowledge_events (F0.5.2/E2.1): el cron de GH Actions
    // (knowledge-drain.yml, */5) postea con `Authorization: Bearer CRON_SECRET` sin
    // cookie; la auth se valida DENTRO del handler vía requireCronAuth (503 sin secret /
    // 401 mismatch, timing-safe). Sólo la ruta exacta. Expediente KDW-001: sin esta línea
    // el middleware devolvía 401 "Auth required" antes de llegar al handler — mismo
    // patrón que dispatch-outbox y que los 5 crons de arriba.
    pathname === "/api/knowledge/drain" ||
    // LINK-WA: el drenaje durable inbound lo invoca GitHub Actions sin cookie,
    // con Authorization: Bearer CRON_SECRET. La frontera fail-closed vive en el
    // handler; se abre sólo esta ruta exacta, no subrutas ni el resto de WhatsApp.
    pathname === "/api/whatsapp/inbound-queue" ||
    // Relay durable Nexus → Make. Netlify Scheduled Function lo invoca con
    // CRON_SECRET; la auth fail-closed vive en el handler.
    pathname === "/api/whatsapp/relay-queue" ||
    pathname.startsWith("/compras/validar") ||
    // Trazabilidad de despliegue: sólo metadata de build (commit/branch/fecha/buildId/entorno),
    // sin datos sensibles. Pública para verificar deploys y monitoreo externo. La misma info
    // también se ve en Administración (RBAC). Ver docs/runbooks/RELEASE.md.
    pathname === "/api/version" ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/icons") ||
    pathname.startsWith("/fonts") ||
    pathname === "/manifest.webmanifest" ||
    pathname === "/sw.js" ||
    pathname === "/favicon.ico";

  if (!user && !isPublic) {
    // APIs: 401 JSON (no redirect — el fetch del cliente espera JSON parseable).
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { ok: false, error: "Auth required" },
        { status: 401 }
      );
    }
    // Páginas: redirect a /login con query `from` para volver luego.
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("from", pathname);
    return NextResponse.redirect(url);
  }

  // FASE B · Encargados de depósito. Esta frontera no usa profiles.role ni
  // permisos legacy connect.*. La identidad viene de Auth y la autorización
  // completa de una RPC fail-closed: perfil activo + rol canónico + sede +
  // capacidades exactas. Error, fila ausente o payload incompleto => 404.
  if (user) {
    const identity = depotManagerIdentity(user.id, user.email);
    if (identity.principal) {
      if (!identity.exact || !identity.site) {
        return new NextResponse("Not Found", {
          status: 404,
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        });
      }
      const { data, error } = await supabase
        .rpc("nexus_depot_manager_scope")
        .single();
      const scope = data as DepotManagerRpcRow | null;
      if (error || !depotManagerRpcRowValid(scope, identity.site) || !depotManagerRouteAllowed(pathname)) {
        return new NextResponse("Not Found", {
          status: 404,
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        });
      }
    }
  }

  if (user && pathname === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  return response;
}
