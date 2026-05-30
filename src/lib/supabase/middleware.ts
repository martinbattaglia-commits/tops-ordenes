import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";

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
  //   · /api/clientify/webhook       → Clientify firma con HMAC y postea acá
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
    pathname === "/api/clientify/webhook" ||
    pathname.startsWith("/compras/validar") ||
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

  if (user && pathname === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  return response;
}
