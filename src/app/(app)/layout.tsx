import type { ReactNode } from "react";
import Shell from "@/components/shell/Shell";
import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import { canViewExecutiveFinancialBlocks } from "@/lib/rbac/cockpit-visibility";
import { canAccess } from "@/lib/rbac/guard";

export default async function AppLayout({ children }: { children: ReactNode }) {
  // Datos de usuario para mostrar en el sidebar / topbar
  let userMeta = {
    name: "Ruth Cardozo",
    role: "Administración · Verotin S.A.",
    avatar: "RC",
  };

  if (!env.app.demoMode) {
    const supabase = createClient();
    if (supabase) {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const meta = user.user_metadata as Record<string, string | undefined>;
        const name = meta.full_name || meta.name || user.email?.split("@")[0] || "Usuario";
        // Gate 5.5 (F-06): el rol mostrado viene de `profiles.role` (autoritativo, la
        // misma fuente que los guards / current_role()), NO de user_metadata.role —
        // que puede divergir y mostró "Operaciones" para un admin en el QA E2E.
        const { data: prof } = await supabase
          .from("profiles")
          .select("role")
          .eq("id", user.id)
          .maybeSingle();
        const ROLE_LABELS: Record<string, string> = {
          admin: "Admin",
          operaciones: "Operaciones",
          supervisor: "Supervisor",
          cliente: "Cliente",
        };
        const role = ROLE_LABELS[(prof?.role as string) ?? ""] || meta.role || "Operaciones";
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
    }
  }

  // Visibilidad condicional del Cockpit (único): los ítems ejecutivos/financieros
  // del menú (Cockpit ejecutivo, Analytics Ejecutivo) se ocultan a quien no tenga
  // permiso ejecutivo. Resuelto server-side.
  const canViewExecutive = await canViewExecutiveFinancialBlocks();

  // Gating RBAC del sidebar (Estrategia B): Sistema (sistema.view) y RRHH →
  // Documentación (rrhh.documentacion.view). Resuelto server-side. Para usuarios
  // sin rol asignado, canAccess devuelve true (bootstrap per-user) → no sobre-oculta.
  const [canViewSistema, canViewRrhhDocs] = await Promise.all([
    canAccess("sistema.view"),
    canAccess("rrhh.documentacion.view"),
  ]);

  return (
    <Shell
      user={userMeta}
      canViewExecutive={canViewExecutive}
      canViewSistema={canViewSistema}
      canViewRrhhDocs={canViewRrhhDocs}
    >
      {children}
    </Shell>
  );
}
