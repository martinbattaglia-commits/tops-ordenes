/**
 * Guard de página/acción para RBAC (RRHH enforcement · Opción A).
 *
 * Diseño anti-lockout: mientras RBAC **no esté activado** (`RBAC_ENFORCE` != "1")
 * NO bloquea — devuelve acceso permitido para no romper nada antes de seedear los
 * roles/asignaciones. Recién con `RBAC_ENFORCE=1` exige el permiso real vía el RPC
 * `has_permission` (fail-closed en la base, con fallback `current_role()='admin'`).
 *
 * Esto mantiene la promesa "no activar RBAC todavía": los guards se despliegan
 * dormidos y se vuelven efectivos en el mismo switch que el resto del RBAC.
 */
import { env } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

/**
 * ¿El usuario puede acceder al recurso protegido por `slug`?
 *
 * Estrategia B — enforcement DIRIGIDO por-usuario (decisión 2026-06-08):
 *   · Usuario SIN asignación en `user_roles` → bootstrap per-user: NO se bloquea
 *     (salvo RBAC_ENFORCE=1 global) → conserva el comportamiento del resto.
 *   · Usuario CON asignación → enforcement REAL vía RPC has_permission (fail-closed).
 * Permite restringir SOLO a los roles asignados (gerencia_comercial /
 * administracion_finanzas) sin afectar a quienes no tienen rol asignado.
 * (Reemplaza el bootstrap global por uno per-user; nota de seguridad en CHANGESET.)
 */
export async function canAccess(slug: string): Promise<boolean> {
  const supabase = createClient();
  if (!supabase) return true; // demo/preview sin Supabase → no bloquear
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;
  // ¿El usuario tiene algún rol asignado? (RLS permite leer filas propias)
  const { count } = await supabase
    .from("user_roles")
    .select("*", { count: "exact", head: true })
    .eq("user_id", user.id);
  if ((count ?? 0) === 0) {
    return !env.rbac.enforce; // no asignado → bootstrap per-user (permitir salvo enforce global)
  }
  const { data, error } = await supabase.rpc("has_permission", { p_slug: slug });
  if (error) return false;
  return data === true; // asignado → enforcement real
}

/** Variante para server actions: null = autorizado; string = mensaje de error. */
export async function denyReason(slug: string): Promise<string | null> {
  if (await canAccess(slug)) return null;
  return `No autorizado: se requiere el permiso ${slug}.`;
}
