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
  const isPublic =
    pathname === "/login" ||
    pathname === "/auth/forgot-password" ||
    pathname === "/auth/reset-password" ||
    pathname === "/drive" ||
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/api/clientify") ||
    pathname.startsWith("/api/cctv") ||
    pathname.startsWith("/api/whatsapp") ||
    pathname.startsWith("/api/drive") ||
    pathname.startsWith("/compras/validar") ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/icons") ||
    pathname.startsWith("/fonts") ||
    pathname === "/manifest.webmanifest" ||
    pathname === "/sw.js" ||
    pathname === "/favicon.ico";

  if (!user && !isPublic) {
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
