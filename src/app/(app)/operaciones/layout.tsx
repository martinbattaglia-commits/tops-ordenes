/**
 * Guard de módulo (RBAC · Opción A).
 * Restringe Operaciones (tracking de flota / mapas) a quienes tengan
 * `operaciones.view`. Semántica heredada de canAccess() (src/lib/rbac/guard.ts):
 * usuarios sin rol asignado pasan (bootstrap); usuarios con rol asignado se
 * evalúan contra has_permission. Bloquea a jefe_deposito; deja pasar a
 * gerencia / admins.
 */
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { canAccess } from "@/lib/rbac/guard";

export default async function OperacionesModuleLayout({ children }: { children: ReactNode }) {
  if (!(await canAccess("operaciones.view"))) {
    redirect("/dashboard");
  }
  return <>{children}</>;
}
