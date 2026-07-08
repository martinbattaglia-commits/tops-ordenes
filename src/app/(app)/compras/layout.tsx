/**
 * Guard de módulo (RBAC · Opción A).
 * Restringe el acceso a Compras a quienes tengan el permiso `compras.view`.
 * Semántica heredada de canAccess() (src/lib/rbac/guard.ts):
 *   · usuario SIN rol asignado → pasa (bootstrap, no rompe nada);
 *   · usuario CON rol asignado → se evalúa contra has_permission (ya efectivo,
 *     sin depender de RBAC_ENFORCE). Esto bloquea a jefe_deposito y deja pasar a
 *     gerencia / admins, que tienen compras.view.
 */
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { canAccess } from "@/lib/rbac/guard";

export default async function ComprasModuleLayout({ children }: { children: ReactNode }) {
  if (!(await canAccess("compras.view"))) {
    redirect("/dashboard");
  }
  return <>{children}</>;
}
