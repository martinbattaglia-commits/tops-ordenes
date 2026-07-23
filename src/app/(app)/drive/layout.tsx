/**
 * Guard de módulo (RBAC · Opción A).
 * Restringe el navegador Drive TOPS a quienes tengan `compliance.view`
 * (mismo permiso que exige el endpoint /api/drive/*). Semántica heredada de
 * canAccess() (src/lib/rbac/guard.ts): usuarios sin rol asignado pasan
 * (bootstrap); usuarios con rol asignado se evalúan contra has_permission.
 * Bloquea a jefe_deposito; deja pasar a gerencia / admins.
 */
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { canAccess } from "@/lib/rbac/guard";

export default async function DriveModuleLayout({ children }: { children: ReactNode }) {
  if (!(await canAccess("compliance.view"))) {
    redirect("/dashboard");
  }
  return <>{children}</>;
}
