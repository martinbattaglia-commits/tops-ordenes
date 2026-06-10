import type { ReactNode } from "react";
import Shell from "@/components/shell/Shell";
import { env } from "@/lib/env";
import { getBootContext } from "@/lib/rbac/boot-permissions";

/**
 * Layout del shell autenticado.
 *
 * F1+F2 (hardening post-incidente splash eterno, 2026-06-09): TODOS los awaits
 * del boot (user + profiles.role + flags RBAC) se resuelven en UNA sola pasada
 * deduplicada (React cache) y bajo presupuesto duro (3s) — ver boot-permissions.ts.
 * Antes: ~8 round trips sin timeout (4× getUser + 3 counts + profiles) que podían
 * exceder el límite de la función SSR y dejar el stream (y el splash) colgado.
 * Semántica idéntica: Estrategia B intacta, page guards intactos.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  // ÚNICO await del boot — acotado por BOOT_BUDGET_MS (anti-cuelgue).
  const { user, profileRole, perms } = await getBootContext();

  // Datos de usuario para mostrar en el sidebar / topbar
  let userMeta = {
    name: "Ruth Cardozo",
    role: "Administración · Verotin S.A.",
    avatar: "RC",
  };

  if (!env.app.demoMode && user) {
    const meta = user.user_metadata as Record<string, string | undefined>;
    const name = meta.full_name || meta.name || user.email?.split("@")[0] || "Usuario";
    // Gate 5.5 (F-06): el rol mostrado viene de `profiles.role` (autoritativo, la
    // misma fuente que los guards / current_role()), NO de user_metadata.role —
    // que puede divergir y mostró "Operaciones" para un admin en el QA E2E.
    const ROLE_LABELS: Record<string, string> = {
      admin: "Admin",
      operaciones: "Operaciones",
      supervisor: "Supervisor",
      cliente: "Cliente",
    };
    const role = ROLE_LABELS[profileRole ?? ""] || meta.role || "Operaciones";
    userMeta = {
      name,
      role,
      avatar: name
        .split(" ")
        .map((p) => p[0])
        .filter(Boolean)
        .slice(0, 2)
        .join("")
        .toUpperCase(),
    };
  }

  // Flags del sidebar (misma semántica que antes, resueltos en la pasada única):
  //   exec → ítems ejecutivos del Cockpit · sistema → sección Sistema ·
  //   rrhhDocs → RRHH → Documentación. Estrategia B: sin rol asignado → permitir.
  return (
    <Shell
      user={userMeta}
      canViewExecutive={perms.exec}
      canViewSistema={perms.sistema}
      canViewRrhhDocs={perms.rrhhDocs}
    >
      {children}
    </Shell>
  );
}
