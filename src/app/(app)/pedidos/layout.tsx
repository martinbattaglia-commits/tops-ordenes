/**
 * Guard de módulo (RBAC · Opción A).
 * Restringe el acceso a Pedidos · Logística a quienes tengan `pedidos.view`.
 * Semántica heredada de canAccess() (src/lib/rbac/guard.ts): usuarios sin rol
 * asignado pasan (bootstrap); usuarios con rol asignado se evalúan contra
 * has_permission. Bloquea a jefe_deposito; deja pasar a gerencia / admins.
 */
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { canAccess } from "@/lib/rbac/guard";

export default async function PedidosModuleLayout({ children }: { children: ReactNode }) {
  if (!(await canAccess("pedidos.view"))) {
    redirect("/dashboard");
  }
  return <>{children}</>;
}
