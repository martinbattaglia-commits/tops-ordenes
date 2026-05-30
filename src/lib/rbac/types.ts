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
  | "sistema";

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
