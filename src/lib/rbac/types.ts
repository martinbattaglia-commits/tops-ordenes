/**
 * Tipos del módulo RBAC — alineados con `supabase/migrations/0009_rbac.sql`.
 */

export type PermissionModule =
  | "cockpit"
  | "compras"
  | "servicios"
  | "comercial"
  | "compliance"
  | "cctv"
  | "documental"
  | "analytics"
  | "sistema"
  // H2 — módulos reales presentes en la DB (seeds) que faltaban en el tipo:
  | "wms"
  | "tracking"
  | "pedidos"
  | "tesoreria"
  | "cuentas_pagar"
  | "rrhh"
  // RBAC-PERMISSIONS-UPDATE (2026-06-08): "Mi Espacio" como permiso independiente
  // del módulo RRHH. Un usuario puede tener mi_espacio.view SIN tener rrhh.* —
  // acceso exclusivo a su propio legajo/datos/solicitudes/vacaciones/documentación.
  | "mi_espacio";

export type PermissionAction = "view" | "create" | "edit" | "delete" | "sign" | "export" | "admin";

export interface Permission {
  id: string;
  slug: string;
  module: PermissionModule;
  action: PermissionAction;
  label: string;
  description: string | null;
  created_at: string;
}

export interface Role {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  color: string;
  is_system: boolean;
  created_at: string;
  updated_at: string;
  // joins
  permission_count?: number;
  user_count?: number;
}

export interface RolePermission {
  role_id: string;
  permission_id: string;
  created_at: string;
}

export interface UserRoleAssignment {
  user_id: string;
  role_id: string;
  position_title: string | null;
  depot: "MAGALDI" | "LUJAN" | null;
  assigned_at: string;
  assigned_by: string | null;
  // joins
  role?: Role;
  user_email?: string;
  user_name?: string;
}

export interface RoleWithPermissions extends Role {
  permissions: Permission[];
}

export const MODULE_LABELS: Record<PermissionModule, string> = {
  cockpit: "Cockpit ejecutivo",
  compras: "Compras · OC",
  servicios: "Operaciones · OS",
  comercial: "Comercial · CRM",
  compliance: "Compliance · ANMAT",
  cctv: "Seguridad · CCTV",
  documental: "Centro documental",
  analytics: "Analytics & Finanzas",
  sistema: "Sistema",
  wms: "WMS · Depósito",
  tracking: "Tracking · Flota",
  pedidos: "Pedidos · Logística",
  tesoreria: "Tesorería · Finanzas",
  cuentas_pagar: "Cuentas a Pagar",
  rrhh: "Recursos Humanos",
  mi_espacio: "Mi Espacio (autoservicio)",
};

/**
 * Roles RBAC DEFINITIVOS (F3, aprobados por Presidencia — RBAC-AUDITORIA-EJECUTIVA).
 * Reemplazan el modelo genérico ADMIN/SUPERVISOR/OPERACIONES.
 */
export const APP_ROLES = [
  "super_admin",
  "admin_operativo",
  "gerencia_comercial",
  "administracion_finanzas",
  "jefe_deposito_central",
  "jefe_deposito_anexa",
  "cliente_b2b", // arquitectura preparada — NO activar (sin usuarios)
] as const;

export type AppRole = (typeof APP_ROLES)[number];

export const APP_ROLE_LABELS: Record<AppRole, string> = {
  super_admin: "Super Admin · Presidencia",
  admin_operativo: "Admin Operativo · Dirección de Operaciones",
  gerencia_comercial: "Gerencia Comercial",
  administracion_finanzas: "Administración y Finanzas",
  jefe_deposito_central: "Jefe Depósito Central · Magaldi",
  jefe_deposito_anexa: "Jefe Depósito Anexa · Luján",
  cliente_b2b: "Cliente B2B (inactivo)",
};

export const ACTION_LABELS: Record<PermissionAction, string> = {
  view: "Ver",
  create: "Crear",
  edit: "Editar",
  delete: "Borrar",
  sign: "Firmar",
  export: "Exportar",
  admin: "Administrar",
};
