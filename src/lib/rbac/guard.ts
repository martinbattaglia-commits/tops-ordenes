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

/** ¿El usuario puede acceder al recurso protegido por `slug`? (true en bootstrap) */
export async function canAccess(slug: string): Promise<boolean> {
  if (!env.rbac.enforce) return true; // bootstrap: RBAC no activado → no bloquear
  const supabase = createClient();
  if (!supabase) return false;
  const { data, error } = await supabase.rpc("has_permission", { p_slug: slug });
  if (error) return false;
  return data === true;
}

/** Variante para server actions: null = autorizado; string = mensaje de error. */
export async function denyReason(slug: string): Promise<string | null> {
  if (await canAccess(slug)) return null;
  return `No autorizado: se requiere el permiso ${slug}.`;
}
