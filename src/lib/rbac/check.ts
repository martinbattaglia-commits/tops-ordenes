/**
 * RBAC check server-side — verificación de permiso para route handlers.
 *
 * Política (remediation R4 + R22, 2026-05-29):
 *   1. Si NO hay sesión → 401 (en realidad nunca llega acá; el middleware
 *      ya lo bloquea con 401 antes. Defensa en profundidad).
 *   2. Si hay sesión y user_roles tiene rows con ese permiso → 200, continúa.
 *   3. Si hay sesión y user_roles tiene rows pero NO ese permiso → 403.
 *   4. Si hay sesión y user_roles está VACÍA en TODA la DB (RBAC dormido,
 *      FASE 1) → fail-open con log WARN. Detección hecha con SERVICE ROLE
 *      para bypassar la RLS de user_roles (R22 fix).
 *   5. Si Supabase no está configurado y NEXT_PUBLIC_DEMO_MODE=1 → fail-open.
 *
 * R22 — Por qué hace falta SERVICE ROLE para el seed-check:
 *   La RLS de user_roles ("read self or admin", migration 0009) filtra el
 *   SELECT al subset propio del caller. Un usuario regular sin asignación ve
 *   count=0 aunque la tabla tenga 100 rows de otros usuarios → fail-open
 *   incorrecto → bypass de RBAC. Con service_role la query ve el estado real.
 *
 * Principio de menor privilegio honrado:
 *   · createAdminClient() se usa SOLO para `select count(1) from user_roles`
 *     con head=true (no devuelve filas, solo el total).
 *   · TODO el resto (auth, lookup de mis permisos, etc.) sigue bajo el cliente
 *     normal con RLS aplicada.
 *   · Nunca se usa service role para autorizar: el permiso real se verifica
 *     contra los roles DEL USUARIO (no del admin).
 *
 * Por qué fail-open en (4): si fail-closed antes de seedear roles, NADIE
 * (ni Director, ni Compliance) puede usar Drive. Bloqueo total no buscado.
 * El warn en logs hace visible que falta seedear.
 */

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";

export interface PermissionCheckOk {
  ok: true;
  userId: string;
  userEmail: string | null;
  /** Si la verificación fue real (RBAC vivo) o fallback (RBAC dormido). */
  enforced: boolean;
  /** Slug del permiso requerido. */
  permission: string;
}

export interface PermissionCheckDenied {
  ok: false;
  status: 401 | 403;
  error: string;
}

export type PermissionCheck = PermissionCheckOk | PermissionCheckDenied;

/**
 * Verifica si el usuario autenticado tiene un permiso específico.
 *
 * Uso en route handlers:
 *
 *   const check = await checkPermission(req, "compliance.view");
 *   if (!check.ok) return NextResponse.json({...}, { status: check.status });
 *   // ...continúa
 *
 * @param permission Slug del permiso ej. "compliance.view"
 */
export async function checkPermission(
  _req: NextRequest,
  permission: string
): Promise<PermissionCheck> {
  // Demo mode o Supabase no configurado → fail-open (estamos en preview)
  if (env.app.demoMode || env.app.needsSupabase) {
    return {
      ok: true,
      userId: "demo",
      userEmail: null,
      enforced: false,
      permission,
    };
  }

  const supabase = createClient();
  if (!supabase) {
    // R21: log explícito en vez de fail-open silencioso.
    console.warn(
      JSON.stringify({
        ts: new Date().toISOString(),
        level: "warn",
        mod: "rbac",
        op: "check-permission.no-client",
        permission,
        reason: "createClient() returned null with Supabase configured",
      })
    );
    return {
      ok: true,
      userId: "no-client",
      userEmail: null,
      enforced: false,
      permission,
    };
  }

  // 1. Sesión (RLS-bound — chequea cookie del usuario)
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, status: 401, error: "Auth required" };
  }

  // 2. Estrategia B — enforcement DIRIGIDO por-usuario (decisión 2026-06-08).
  //
  // Contamos las asignaciones DEL USUARIO (la RLS de user_roles permite leer
  // las filas propias del caller, sin service role):
  //   · selfCount === 0 → el usuario NO tiene rol asignado → bootstrap per-user
  //     (fail-open salvo RBAC_ENFORCE=1). Así, asignar solo a gerencia_comercial /
  //     administracion_finanzas NO afecta al resto de los usuarios.
  //   · selfCount  > 0 → enforcement REAL contra los permisos del usuario (abajo).
  //
  // Trade-off (vs fix R22): R22 usaba el conteo GLOBAL con service role para que
  // un usuario sin asignación no bypasee cuando la tabla tiene filas de otros.
  // La Estrategia B elige, a propósito, que los usuarios sin asignación queden en
  // bootstrap (fail-open) para permitir un rollout dirigido en FASE 1. Ver
  // RBAC-PERMISSION-CHANGESET.md §nota de seguridad.
  const { count: selfCount, error: selfErr } = await supabase
    .from("user_roles")
    .select("*", { count: "exact", head: true })
    .eq("user_id", user.id);
  if (selfErr) {
    console.error(
      JSON.stringify({
        ts: new Date().toISOString(),
        level: "error",
        mod: "rbac",
        op: "check-permission.self-count-failed",
        permission,
        userId: user.id,
        err: selfErr.message,
      })
    );
    return { ok: false, status: 403, error: "No se pudo verificar permisos" };
  }
  const totalAssignments = selfCount ?? 0;

  // Caso fallback (per-user): el usuario no tiene rol asignado → bootstrap.
  if (totalAssignments === 0) {
    // H1 — con RBAC_ENFORCE=1 (post-seed en prod) → fail-CLOSED en vez de open.
    if (env.rbac.enforce) {
      console.warn(
        JSON.stringify({
          ts: new Date().toISOString(),
          level: "warn",
          mod: "rbac",
          op: "check-permission.enforced-empty-deny",
          permission,
          userId: user.id,
          reason: "user_roles vacía y RBAC_ENFORCE=1 → fail-closed",
        })
      );
      return { ok: false, status: 403, error: `Permiso requerido: ${permission}` };
    }
    // Default (sin enforce): fail-open de bootstrap + log WARN (deuda hasta seedear).
    console.warn(
      JSON.stringify({
        ts: new Date().toISOString(),
        level: "warn",
        mod: "rbac",
        op: "check-permission.fallback-allow",
        permission,
        userId: user.id,
        reason: "user_roles table empty globally (RBAC dormido, FASE 1)",
      })
    );
    return {
      ok: true,
      userId: user.id,
      userEmail: user.email ?? null,
      enforced: false,
      permission,
    };
  }

  // 3. RBAC activo: chequear permiso real.
  // SELECT roles del user → role_permissions → permissions.slug
  const { data: rows, error } = await supabase
    .from("user_roles")
    .select("role:roles(role_permissions(permission:permissions(slug)))")
    .eq("user_id", user.id);

  if (error) {
    // Si la query falla por schema mismatch, fail-closed con error explícito.
    console.error(
      JSON.stringify({
        ts: new Date().toISOString(),
        level: "error",
        mod: "rbac",
        op: "check-permission.query-failed",
        permission,
        userId: user.id,
        err: error.message,
      })
    );
    return { ok: false, status: 403, error: "No se pudo verificar permisos" };
  }

  // Aplanar la jerarquía para obtener el set de permission slugs del user.
  type RowShape = {
    role?: {
      role_permissions?: Array<{
        permission?: { slug: string };
      }>;
    };
  };
  const userPermissions = new Set<string>();
  for (const row of (rows ?? []) as RowShape[]) {
    const rps = row.role?.role_permissions ?? [];
    for (const rp of rps) {
      if (rp.permission?.slug) userPermissions.add(rp.permission.slug);
    }
  }

  if (userPermissions.has(permission)) {
    return {
      ok: true,
      userId: user.id,
      userEmail: user.email ?? null,
      enforced: true,
      permission,
    };
  }

  console.warn(
    JSON.stringify({
      ts: new Date().toISOString(),
      level: "warn",
      mod: "rbac",
      op: "check-permission.denied",
      permission,
      userId: user.id,
      grantedCount: userPermissions.size,
    })
  );
  return {
    ok: false,
    status: 403,
    error: `Permiso requerido: ${permission}`,
  };
}

/**
 * Helper para usar dentro de route handlers — corta el flujo si no autorizado.
 * Devuelve NextResponse si denied, o info del user si OK.
 */
export async function requireDrivePermission(
  req: NextRequest,
  permission: string,
  requestId: string
): Promise<NextResponse | PermissionCheckOk> {
  const check = await checkPermission(req, permission);
  if (!check.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: check.error,
        requestId,
      },
      {
        status: check.status,
        headers: { "x-request-id": requestId },
      }
    );
  }
  return check;
}
