/**
 * boot-permissions.ts — F1+F2 · hardening del boot (incidente splash eterno, 2026-06-09).
 *
 * PROBLEMA: (app)/layout.tsx resolvía sus flags RBAC con 3 llamadas independientes
 * (canViewExecutiveFinancialBlocks + canAccess×2) ⇒ ~8 round trips bloqueantes por
 * page-view (4× auth.getUser + 3 counts + profiles), SIN timeout, dentro de una
 * función SSR con límite que streamea el fallback primero. Si la cadena se estanca
 * o excede el presupuesto, el stream muere y el splash queda para siempre.
 *
 * F1 — UNA sola pasada, deduplicada por request con React cache():
 *        getUser 1× · profiles.role 1× · user_roles count 1× · (+1 select anidado
 *        SOLO si el usuario tiene roles asignados) ⇒ 3-4 RTs, compartidos entre
 *        layout y página (cache() dedupe en el mismo render).
 * F2 — presupuesto duro (BOOT_BUDGET_MS): si la resolución no llega a tiempo,
 *        default PERMISIVO (= semántica bootstrap) + warn. El layout no puede
 *        colgar el boot bajo ninguna condición de red.
 *
 * SEMÁNTICA PRESERVADA AL 100% (Estrategia B, decisión 2026-06-08):
 *   · exec      ≡ checkPermission("cockpit.view").ok        → slug en set, SIN fallback admin.
 *   · sistema   ≡ canAccess("sistema.view")                 → RPC has_permission: slug en set ∨ profiles.role='admin'.
 *   · rrhhDocs  ≡ canAccess("rrhh.documentacion.view")      → ídem.
 *   · Usuario SIN user_roles → bootstrap per-user: todo !RBAC_ENFORCE (hoy: permitir).
 *   · demo / sin Supabase → permisivo (igual que antes).
 *   · Los PAGE GUARDS (canAccess en /settings/*, /rrhh/documentos, …) NO cambian:
 *     el enforcement real por URL directa sigue intacto página por página.
 */
import { cache } from "react";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";

export interface BootPermissions {
  /** Bloques ejecutivos/financieros del Cockpit (cockpit.view). */
  exec: boolean;
  /** Sección Sistema (sistema.view). */
  sistema: boolean;
  /** RRHH → Documentación (rrhh.documentacion.view). */
  rrhhDocs: boolean;
  /** Conocimiento → Panel administrativo (knowledge.admin). */
  knowledge: boolean;
  /** Nexus Link → Conversaciones (connect.view). */
  connect: boolean;
  /** Visibilidad del ítem "Nexus Copilot" = membresía en ai_pilot_users (kill-switch
   *  AI_ENABLED se aplica al ENTRAR a /copilot, no al mostrar el ítem). Indep. del RBAC. */
  copilot: boolean;
}

export interface BootContext {
  user: User | null;
  profileRole: string | null;
  perms: BootPermissions;
}

const PERMISSIVE: BootPermissions = { exec: true, sistema: true, rrhhDocs: true, knowledge: true, connect: true, copilot: true };
const CLOSED: BootPermissions = { exec: false, sistema: false, rrhhDocs: false, knowledge: false, connect: false, copilot: false };

/** Presupuesto máximo de awaits del boot (F2). */
const BOOT_BUDGET_MS = 3000;

/** Usuario de sesión — 1 sola llamada a Supabase Auth por request (cache). */
export const getSessionUser = cache(async (): Promise<User | null> => {
  const supabase = createClient();
  if (!supabase) return null;
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user ?? null;
});

/** profiles.role (autoritativo, Gate 5.5) — 1 sola query por request (cache). */
export const getProfileRole = cache(async (): Promise<string | null> => {
  const supabase = createClient();
  if (!supabase) return null;
  const user = await getSessionUser();
  if (!user) return null;
  const { data } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  return (data?.role as string | undefined) ?? null;
});

/** Resolución real de los 3 flags — deduplicada por request (cache). */
const resolveBootPermissions = cache(async (): Promise<BootPermissions> => {
  // Demo / Supabase no configurado → permisivo (espejo de checkPermission demo
  // fail-open y de canAccess sin cliente).
  if (env.app.demoMode || env.app.needsSupabase) return PERMISSIVE;
  const supabase = createClient();
  if (!supabase) return PERMISSIVE;

  const user = await getSessionUser();
  if (!user) return CLOSED; // espejo: checkPermission 401 / canAccess false

  // VISIBILIDAD del ítem "Nexus Copilot" en el sidebar = membresía en ai_pilot_users.
  // NO se acopla a AI_ENABLED: ese env var es de contexto `production` únicamente, así
  // que en deploy-preview/branch-deploy sería false y el ítem nunca se podría testear en
  // un DRAFT. El KILL-SWITCH AI_ENABLED se sigue aplicando en `/copilot` (checkGate,
  // gate.ts): si está apagado, el piloto ve el ítem pero al entrar recibe "desactivado".
  // Fail-closed para no-pilotos. Independiente del RBAC de roles (un piloto sin roles
  // igual debe verlo). Se consulta EN PARALELO con el count de roles (sin latencia extra).
  const [{ count, error: countErr }, pilot] = await Promise.all([
    supabase.from("user_roles").select("*", { count: "exact", head: true }).eq("user_id", user.id),
    supabase.from("ai_pilot_users").select("user_id").eq("user_id", user.id).maybeSingle(),
  ]);
  const copilot = !pilot.error && !!pilot.data;

  if (countErr) {
    // Espejo exacto de la asimetría previa:
    //   checkPermission: error de count → fail-closed (exec=false)
    //   canAccess: error → count null → bootstrap → !enforce
    const open = !env.rbac.enforce;
    return { exec: false, sistema: open, rrhhDocs: open, knowledge: open, connect: open, copilot };
  }

  if ((count ?? 0) === 0) {
    // Bootstrap per-user (no asignado): permitir salvo RBAC_ENFORCE=1.
    const open = !env.rbac.enforce;
    return { exec: open, sistema: open, rrhhDocs: open, knowledge: open, connect: open, copilot };
  }

  // Asignado → enforcement real con UNA query anidada (set completo de slugs).
  const { data: rows, error: qErr } = await supabase
    .from("user_roles")
    .select("role:roles(role_permissions(permission:permissions(slug)))")
    .eq("user_id", user.id);
  if (qErr) return { ...CLOSED, copilot }; // espejo: checkPermission query-failed → 403 · RPC error → false

  type RowShape = {
    role?: { role_permissions?: Array<{ permission?: { slug: string } }> };
  };
  const slugs = new Set<string>();
  for (const row of (rows ?? []) as RowShape[]) {
    for (const rp of row.role?.role_permissions ?? []) {
      if (rp.permission?.slug) slugs.add(rp.permission.slug);
    }
  }

  // has_permission (RPC) incluye fallback `current_role()='admin'` → lo replicamos
  // SOLO para los flags que antes resolvía el RPC (sistema/rrhhDocs), no para exec.
  const isLegacyAdmin = (await getProfileRole()) === "admin";

  return {
    exec: slugs.has("cockpit.view"),
    sistema: slugs.has("sistema.view") || isLegacyAdmin,
    rrhhDocs: slugs.has("rrhh.documentacion.view") || isLegacyAdmin,
    knowledge: slugs.has("knowledge.admin") || isLegacyAdmin,
    connect: slugs.has("connect.view") || isLegacyAdmin,
    copilot,
  };
});

/** F2 — race con presupuesto: ante timeout devuelve fallback y loguea. */
async function withBudget<T>(p: Promise<T>, fallback: T, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => {
      console.warn(
        JSON.stringify({
          ts: new Date().toISOString(),
          level: "warn",
          mod: "rbac",
          op: "boot-budget-exceeded",
          label,
          budgetMs: BOOT_BUDGET_MS,
          action: "fallback aplicado (boot no se bloquea)",
        })
      );
      resolve(fallback);
    }, BOOT_BUDGET_MS);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Flags RBAC del boot con presupuesto duro (para layout/páginas).
 * Ante timeout → PERMISIVO (= bootstrap; la seguridad por URL directa la
 * garantizan los page guards, que no dependen de esto).
 */
export async function getBootPermissions(): Promise<BootPermissions> {
  return withBudget(resolveBootPermissions(), PERMISSIVE, "boot-permissions");
}

/**
 * Contexto completo del boot (user + profileRole + flags) bajo UN solo presupuesto.
 * Es lo único que el (app)/layout debe esperar: acotado a BOOT_BUDGET_MS.
 */
export async function getBootContext(): Promise<BootContext> {
  return withBudget(
    (async (): Promise<BootContext> => {
      const [user, profileRole, perms] = await Promise.all([
        getSessionUser(),
        getProfileRole(),
        resolveBootPermissions(),
      ]);
      return { user, profileRole, perms };
    })(),
    { user: null, profileRole: null, perms: PERMISSIVE },
    "boot-context"
  );
}
