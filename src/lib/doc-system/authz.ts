import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfileRole } from "@/lib/auth/roles";
import { rateLimit } from "@/lib/rate-limit";

/**
 * Autorización de las rutas que emiten documentos (PDF on-demand).
 *
 * Estos endpoints exponen datos que no tienen otra superficie HTTP: CUIT de
 * clientes y proveedores, domicilios, alias/CBU bancarios, lotes y cantidades.
 *
 * Contrato **fail-closed y explícito** (Resolución de Dirección R2-b):
 *
 *     sesión válida + asignación RBAC explícita + permiso canónico efectivo
 *
 * NO se acepta como autorización: la sola sesión autenticada, `profiles.role`,
 * su default `'operaciones'`, ni `canAccess()` mientras pueda operar en
 * fail-open. Una cuenta interna sin asignación explícita recibe 403 aunque su
 * `profiles.role` sea `'operaciones'`.
 *
 * Diferencias deliberadas con el resto del RBAC del repo:
 *
 *  · **No usa `canAccess()`** (`src/lib/rbac/guard.ts`), que devuelve `true`
 *    para usuarios sin fila en `user_roles` mientras `RBAC_ENFORCE != 1`.
 *  · **No usa la RPC `has_permission`**, porque termina en
 *    `or public.current_role() = 'admin'` (`0009_rbac.sql:174`) — es decir,
 *    `profiles.role` como sustituto de RBAC. Acá el permiso se resuelve con el
 *    join real `user_roles → role_permissions → permissions`.
 *  · **No consulta `RBAC_ENFORCE` ni el modo demo** en el núcleo. Sin backend
 *    disponible se deniega; ninguna bandera global afloja la exigencia de
 *    asignación y permiso. (Salvedad: la capa ADICIONAL de ámbito usa
 *    `getCurrentProfileRole()`, que sí devuelve `"admin"` bajo
 *    `NEXT_PUBLIC_DEMO_MODE`. Afecta sólo a esa capa aditiva; el RBAC estricto
 *    sigue exigiendo asignación real.)
 *
 * El permiso nunca proviene del request: es un literal de un tipo cerrado.
 */

/** Permisos canónicos admitidos. Cerrado a propósito: el request no elige. */
export type DocPermission =
  | "tesoreria.view"
  | "wms.view"
  | "servicios.view"
  | "compras.view"
  | "analytics.view";

/**
 * Ámbito adicional para los remitos: además del permiso, el solicitante debe
 * pertenecer a la organización. `user_role_t` es un enum de exactamente cuatro
 * valores (`0001_init.sql:23`) que ninguna migración altera, así que la lista
 * es exhaustiva. Es una capa ADICIONAL, nunca un reemplazo del RBAC.
 */
const INTERNAL_ROLES = new Set(["admin", "operaciones", "supervisor"]);

export type DocAuthzResult =
  | { ok: true; userId: string; scope: UserScope }
  | { ok: false; status: 401 | 403 | 429; reason: string };

/**
 * Ámbito del solicitante, leído del modelo existente — no se creó ninguna
 * tabla nueva:
 *   · `profiles.depot`     (enum MAGALDI|LUJAN) → jefatura de un depósito.
 *   · `profiles.client_id` (uuid)               → usuario del portal.
 *
 * `depot === null` significa **sin restricción por depósito**: es como el
 * modelo representa hoy a dirección, gerencia, administración y compliance.
 * ⚠️ En producción la columna está vacía para los 10 perfiles, incluidos los
 * dos `jefe_deposito`, así que la restricción por depósito queda INERTE hasta
 * que un data-op gobernado la complete. El mecanismo está implementado y
 * probado; su efecto real depende de ese dato.
 */
export interface UserScope {
  role: string | null;
  depot: string | null;
  clientId: string | null;
}

function audit(
  decision: "allow" | "deny",
  permission: DocPermission,
  userId: string | null,
  reason?: string
) {
  // Sin contenido documental: sólo quién, qué permiso y el resultado.
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    mod: "doc-authz",
    decision,
    permission,
    userId,
    ...(reason ? { reason } : {}),
  });
  if (decision === "allow") console.info(line);
  else console.warn(line);
}

/**
 * Núcleo estricto: sesión + asignación RBAC explícita + permiso efectivo.
 * No hay camino que devuelva `ok` sin que el usuario tenga al menos una fila
 * en `user_roles` y que alguno de esos roles conceda el permiso pedido.
 */
export async function requireExplicitPermission(
  permission: DocPermission
): Promise<DocAuthzResult> {
  const supabase = createClient();
  if (!supabase) {
    audit("deny", permission, null, "sin backend");
    return { ok: false, status: 403, reason: "sin backend" };
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    audit("deny", permission, null, "sin sesión");
    return { ok: false, status: 401, reason: "sin sesión" };
  }

  // Tope por usuario y por permiso: frena la enumeración secuencial de
  // `public_id` sin castigar a quien imprime un lote legítimo. Limitación
  // conocida: `rateLimit` es in-memory, así que en serverless es por contenedor.
  const rl = rateLimit(`doc-pdf:${permission}:${user.id}`, {
    limit: 60,
    windowMs: 60_000,
  });
  if (!rl.ok) {
    audit("deny", permission, user.id, "rate-limit");
    return { ok: false, status: 429, reason: "demasiadas solicitudes" };
  }

  // 1) Asignación RBAC explícita. Sin filas → 403, sin importar profiles.role.
  const { data: asignaciones, error: eAsg } = await supabase
    .from("user_roles")
    .select("role_id")
    .eq("user_id", user.id);
  if (eAsg) {
    audit("deny", permission, user.id, "error consultando asignaciones");
    return { ok: false, status: 403, reason: "no verificable" };
  }
  const roleIds = (asignaciones ?? []).map((a) => (a as { role_id: string }).role_id);
  if (roleIds.length === 0) {
    audit("deny", permission, user.id, "sin asignación RBAC explícita");
    return { ok: false, status: 403, reason: "sin asignación RBAC" };
  }

  // 2) Permiso efectivo por el join real, sin el fallback de admin de la RPC.
  // Se pide una fila en vez de un `count` con `head`: no depende de la
  // semántica del header Prefer y basta con saber si existe la concesión.
  const { data: concesion, error: ePerm } = await supabase
    .from("role_permissions")
    .select("permission_id, permissions!inner(slug)")
    .in("role_id", roleIds)
    .eq("permissions.slug", permission)
    .limit(1);
  if (ePerm) {
    audit("deny", permission, user.id, "error resolviendo permiso");
    return { ok: false, status: 403, reason: "no verificable" };
  }
  if ((concesion ?? []).length === 0) {
    audit("deny", permission, user.id, "permiso no concedido por sus roles");
    return { ok: false, status: 403, reason: "permiso insuficiente" };
  }

  // 3) Ámbito del solicitante, del modelo existente (no hay tabla nueva).
  //
  // El error NO se descarta: sin perfil legible no se puede determinar el
  // ámbito, y como `depotInScope`/`clientInScope` interpretan "sin dato" como
  // "sin restricción", tragarse el error concedería alcance global ante un
  // fallo transitorio — fail-open en un módulo que se declara fail-closed.
  const { data: perfil, error: ePerfil } = await supabase
    .from("profiles")
    .select("role, depot, client_id")
    .eq("id", user.id)
    .maybeSingle();
  if (ePerfil || !perfil) {
    audit("deny", permission, user.id, "ámbito no determinable");
    return { ok: false, status: 403, reason: "no verificable" };
  }
  const scope: UserScope = {
    role: (perfil as { role?: string } | null)?.role ?? null,
    depot: (perfil as { depot?: string | null } | null)?.depot ?? null,
    clientId: (perfil as { client_id?: string | null } | null)?.client_id ?? null,
  };

  audit("allow", permission, user.id);
  return { ok: true, userId: user.id, scope };
}

/**
 * ¿El solicitante alcanza un documento de este depósito?
 *
 * Un usuario con `profiles.depot` asignado sólo alcanza documentos de ESE
 * depósito. Sin depósito asignado no hay restricción por depósito (es como el
 * modelo representa a dirección/gerencia/compliance).
 *
 * Fail-closed ante ambigüedad: si el documento no permite determinar su
 * depósito y el usuario SÍ está acotado a uno, se deniega.
 */
export function depotInScope(scope: UserScope, docDepotCode: string | null): boolean {
  if (!scope.depot) return true;
  if (!docDepotCode) return false;
  return scope.depot.toUpperCase() === docDepotCode.toUpperCase();
}

/**
 * ¿El solicitante alcanza un documento de este cliente?
 *
 * Un usuario del portal (`profiles.client_id`) sólo alcanza documentos de su
 * propio cliente. Fail-closed: si el documento no declara cliente y el
 * solicitante está acotado a uno, se deniega.
 */
export function clientInScope(scope: UserScope, docClientId: string | null): boolean {
  if (!scope.clientId) return true;
  if (!docClientId) return false;
  return scope.clientId === docClientId;
}

/**
 * Entrada única de las rutas documentales.
 *
 * `scope: "internal"` agrega la comprobación de ámbito de los remitos: el
 * solicitante debe ser de la organización, no del portal. Se evalúa DESPUÉS
 * del RBAC estricto, como capa adicional.
 */
export async function authorizeDocumentAccess(
  permission: DocPermission,
  opts: { scope?: "internal" } = {}
): Promise<DocAuthzResult> {
  const base = await requireExplicitPermission(permission);
  if (!base.ok) return base;

  if (opts.scope === "internal") {
    const role = base.scope.role ?? (await getCurrentProfileRole());
    if (!role || !INTERNAL_ROLES.has(role)) {
      audit("deny", permission, base.userId, "fuera de ámbito interno");
      return { ok: false, status: 403, reason: "fuera de ámbito" };
    }
  }

  return base;
}
