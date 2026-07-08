/**
 * Guard de módulo (RBAC · Opción A).
 * Restringe el acceso a Tesorería a quienes tengan el permiso `tesoreria.view`.
 * Semántica heredada de canAccess() (src/lib/rbac/guard.ts): usuarios sin rol
 * asignado pasan (bootstrap); usuarios con rol asignado se evalúan contra
 * has_permission. Bloquea a jefe_deposito; deja pasar a gerencia / admins.
 * (La subpágina /tesoreria/conciliacion mantiene además su guard propio.)
 */
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { canAccess } from "@/lib/rbac/guard";

export default async function TesoreriaModuleLayout({ children }: { children: ReactNode }) {
  if (!(await canAccess("tesoreria.view"))) {
    redirect("/dashboard");
  }
  return <>{children}</>;
}
