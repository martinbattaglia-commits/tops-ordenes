import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import type {
  Role,
  Permission,
  PermissionModule,
  RoleWithPermissions,
  UserRoleAssignment,
} from "./types";

/**
 * Data layer del módulo RBAC.
 * En demo mode devuelve un set seed coherente para que la UI sea
 * navegable sin Supabase aplicado.
 */

// ------------------------------------------------------------------
// MOCK SEED (demo mode)
// ------------------------------------------------------------------

const MOCK_PERMISSIONS: Permission[] = [
  { id: "p1", slug: "cockpit.view", module: "cockpit", action: "view", label: "Ver cockpit ejecutivo", description: "Acceso al panel /ejecutivo", created_at: "2026-05-26T00:00:00Z" },
  { id: "p2", slug: "cockpit.export", module: "cockpit", action: "export", label: "Exportar reportes ejecutivos", description: null, created_at: "2026-05-26T00:00:00Z" },
  { id: "p3", slug: "compras.view", module: "compras", action: "view", label: "Ver órdenes de compra", description: null, created_at: "2026-05-26T00:00:00Z" },
  { id: "p4", slug: "compras.create", module: "compras", action: "create", label: "Crear OC", description: null, created_at: "2026-05-26T00:00:00Z" },
  { id: "p5", slug: "compras.edit", module: "compras", action: "edit", label: "Editar OC en borrador", description: null, created_at: "2026-05-26T00:00:00Z" },
  { id: "p6", slug: "compras.sign", module: "compras", action: "sign", label: "Firmar OC", description: "Único permiso para emitir firma digital", created_at: "2026-05-26T00:00:00Z" },
  { id: "p7", slug: "compras.export", module: "compras", action: "export", label: "Exportar CSV / PDF", description: null, created_at: "2026-05-26T00:00:00Z" },
  { id: "p8", slug: "compras.delete", module: "compras", action: "delete", label: "Anular OC", description: null, created_at: "2026-05-26T00:00:00Z" },
  { id: "p9", slug: "servicios.view", module: "servicios", action: "view", label: "Ver órdenes de servicio", description: null, created_at: "2026-05-26T00:00:00Z" },
  { id: "p10", slug: "servicios.create", module: "servicios", action: "create", label: "Crear OS", description: null, created_at: "2026-05-26T00:00:00Z" },
  { id: "p11", slug: "servicios.sign", module: "servicios", action: "sign", label: "Firmar OS", description: null, created_at: "2026-05-26T00:00:00Z" },
  { id: "p12", slug: "comercial.view", module: "comercial", action: "view", label: "Ver pipeline + contactos", description: null, created_at: "2026-05-26T00:00:00Z" },
  { id: "p13", slug: "comercial.edit", module: "comercial", action: "edit", label: "Editar contactos / deals", description: null, created_at: "2026-05-26T00:00:00Z" },
  { id: "p14", slug: "compliance.view", module: "compliance", action: "view", label: "Ver ANMAT cockpit", description: null, created_at: "2026-05-26T00:00:00Z" },
  { id: "p15", slug: "compliance.edit", module: "compliance", action: "edit", label: "Editar credenciales ANMAT", description: null, created_at: "2026-05-26T00:00:00Z" },
  { id: "p16", slug: "cctv.view", module: "cctv", action: "view", label: "Ver cámaras", description: null, created_at: "2026-05-26T00:00:00Z" },
  { id: "p17", slug: "cctv.admin", module: "cctv", action: "admin", label: "Administrar NVR", description: null, created_at: "2026-05-26T00:00:00Z" },
  { id: "p18", slug: "documental.view", module: "documental", action: "view", label: "Ver centro documental", description: null, created_at: "2026-05-26T00:00:00Z" },
  { id: "p19", slug: "documental.create", module: "documental", action: "create", label: "Subir documentos", description: null, created_at: "2026-05-26T00:00:00Z" },
  { id: "p20", slug: "documental.delete", module: "documental", action: "delete", label: "Borrar documentos", description: null, created_at: "2026-05-26T00:00:00Z" },
  { id: "p21", slug: "analytics.view", module: "analytics", action: "view", label: "Ver reportes & finanzas", description: null, created_at: "2026-05-26T00:00:00Z" },
  { id: "p22", slug: "sistema.admin", module: "sistema", action: "admin", label: "Administración del sistema", description: null, created_at: "2026-05-26T00:00:00Z" },
];

const MOCK_ROLES: Role[] = [
  { id: "r1", slug: "director_ops", name: "Director de Operaciones", description: "Único habilitado a firmar OC. Acceso total operativo.", color: "#C90812", is_system: true, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z", permission_count: 22, user_count: 1 },
  { id: "r2", slug: "admin", name: "Administración", description: "Equipo de administración financiera y compliance.", color: "#214576", is_system: true, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z", permission_count: 21, user_count: 2 },
  { id: "r3", slug: "operaciones", name: "Operaciones", description: "Encargados de depósito, picking, recepción.", color: "#050555", is_system: true, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z", permission_count: 8, user_count: 6 },
  { id: "r4", slug: "compliance", name: "Compliance / DT", description: "Director técnico, auditorías ANMAT, documental.", color: "#0E7C3A", is_system: true, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z", permission_count: 6, user_count: 1 },
  { id: "r5", slug: "comercial", name: "Comercial", description: "Equipo CRM, ventas, pipeline Clientify.", color: "#B45309", is_system: true, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z", permission_count: 3, user_count: 2 },
  { id: "r6", slug: "seguridad", name: "Seguridad / CCTV", description: "Monitoreo Verisure 24/7, eventos CCTV.", color: "#3a6db0", is_system: true, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z", permission_count: 3, user_count: 1 },
  { id: "r7", slug: "cliente_b2b", name: "Cliente B2B", description: "Solo lectura de sus propias OS/OC (rol futuro F3).", color: "#8A94A6", is_system: true, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z", permission_count: 1, user_count: 0 },
];

const ROLE_PERMS_MAP: Record<string, string[]> = {
  director_ops: MOCK_PERMISSIONS.map((p) => p.slug),
  admin: MOCK_PERMISSIONS.filter((p) => p.slug !== "compras.sign").map((p) => p.slug),
  operaciones: ["cockpit.view", "compras.view", "compras.create", "servicios.view", "servicios.create", "servicios.sign", "cctv.view", "documental.view"],
  compliance: ["cockpit.view", "compliance.view", "compliance.edit", "documental.view", "documental.create", "cctv.view"],
  comercial: ["cockpit.view", "comercial.view", "comercial.edit"],
  seguridad: ["cockpit.view", "cctv.view", "cctv.admin"],
  cliente_b2b: ["servicios.view"],
};

const MOCK_USER_ASSIGNMENTS: UserRoleAssignment[] = [
  { user_id: "u1", role_id: "r1", position_title: "Director de Operaciones", depot: null, assigned_at: "2026-01-01T00:00:00Z", assigned_by: null, user_email: "joseluis@logisticatops.com", user_name: "José Luis Battaglia", role: MOCK_ROLES[0] },
  { user_id: "u2", role_id: "r2", position_title: "Jefa de Administración", depot: null, assigned_at: "2026-01-01T00:00:00Z", assigned_by: "u1", user_email: "ruth@logisticatops.com", user_name: "Ruth Cardozo", role: MOCK_ROLES[1] },
  { user_id: "u3", role_id: "r3", position_title: "Encargado Magaldi", depot: "MAGALDI", assigned_at: "2026-01-15T00:00:00Z", assigned_by: "u1", user_email: "juancarlos@logisticatops.com", user_name: "Juan Carlos", role: MOCK_ROLES[2] },
  { user_id: "u4", role_id: "r3", position_title: "Encargado Luján", depot: "LUJAN", assigned_at: "2026-01-15T00:00:00Z", assigned_by: "u1", user_email: "despachos@logisticatops.com", user_name: "Jorge Merino", role: MOCK_ROLES[2] },
  { user_id: "u5", role_id: "r4", position_title: "DT — Lic. en Farmacia", depot: null, assigned_at: "2026-02-01T00:00:00Z", assigned_by: "u1", user_email: "dt@logisticatops.com", user_name: "Lic. María Inés Cardozo", role: MOCK_ROLES[3] },
  { user_id: "u6", role_id: "r5", position_title: "Account Manager", depot: null, assigned_at: "2026-03-01T00:00:00Z", assigned_by: "u1", user_email: "cynthia@logisticatops.com", user_name: "Cynthia LogisticaTops", role: MOCK_ROLES[4] },
  { user_id: "u7", role_id: "r5", position_title: "Comercial AR", depot: null, assigned_at: "2026-03-15T00:00:00Z", assigned_by: "u1", user_email: "ruth.carrasquero@logisticatops.com", user_name: "Ruth Carrasquero", role: MOCK_ROLES[4] },
  { user_id: "u8", role_id: "r6", position_title: "Coord. Seguridad", depot: null, assigned_at: "2026-02-01T00:00:00Z", assigned_by: "u1", user_email: "seguridad@logisticatops.com", user_name: "Coord. Seguridad", role: MOCK_ROLES[5] },
  { user_id: "u9", role_id: "r3", position_title: "Operario picking", depot: "MAGALDI", assigned_at: "2026-04-01T00:00:00Z", assigned_by: "u3", user_email: "carlos.mendez@logisticatops.com", user_name: "Carlos Méndez", role: MOCK_ROLES[2] },
  { user_id: "u10", role_id: "r3", position_title: "Operario picking", depot: "MAGALDI", assigned_at: "2026-04-01T00:00:00Z", assigned_by: "u3", user_email: "sebastian.romero@logisticatops.com", user_name: "Sebastián Romero", role: MOCK_ROLES[2] },
];

function isMock(): boolean {
  return env.app.demoMode || env.app.needsSupabase;
}

// ------------------------------------------------------------------
// PUBLIC API
// ------------------------------------------------------------------

export async function listRoles(): Promise<Role[]> {
  if (isMock()) return MOCK_ROLES;
  const supabase = createClient();
  if (!supabase) return MOCK_ROLES;
  const { data, error } = await supabase
    .from("roles")
    .select("*, role_permissions(permission_id), user_roles(user_id)")
    .order("name");
  if (error) throw new Error(`listRoles: ${error.message}`);
  return ((data ?? []) as Array<Role & { role_permissions?: { permission_id: string }[]; user_roles?: { user_id: string }[] }>).map((r) => ({
    ...r,
    permission_count: r.role_permissions?.length ?? 0,
    user_count: r.user_roles?.length ?? 0,
  }));
}

export async function getRole(slug: string): Promise<RoleWithPermissions | null> {
  if (isMock()) {
    const role = MOCK_ROLES.find((r) => r.slug === slug);
    if (!role) return null;
    const permSlugs = ROLE_PERMS_MAP[slug] ?? [];
    return {
      ...role,
      permissions: MOCK_PERMISSIONS.filter((p) => permSlugs.includes(p.slug)),
    };
  }
  const supabase = createClient();
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("roles")
    .select("*, permissions:role_permissions(permission:permissions(*))")
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw new Error(`getRole: ${error.message}`);
  if (!data) return null;
  const r = data as Role & { permissions?: Array<{ permission: Permission }> };
  return {
    ...r,
    permissions: (r.permissions ?? []).map((rp) => rp.permission),
  };
}

export async function listPermissions(): Promise<Permission[]> {
  if (isMock()) return MOCK_PERMISSIONS;
  const supabase = createClient();
  if (!supabase) return MOCK_PERMISSIONS;
  const { data, error } = await supabase
    .from("permissions")
    .select("*")
    .order("module")
    .order("action");
  if (error) throw new Error(`listPermissions: ${error.message}`);
  return (data ?? []) as Permission[];
}

export async function listUserAssignments(): Promise<UserRoleAssignment[]> {
  if (isMock()) return MOCK_USER_ASSIGNMENTS;
  const supabase = createClient();
  if (!supabase) return MOCK_USER_ASSIGNMENTS;
  const { data, error } = await supabase
    .from("user_roles")
    .select("*, role:roles(*), profile:profiles(email, full_name)")
    .order("assigned_at", { ascending: false });
  if (error) throw new Error(`listUserAssignments: ${error.message}`);
  return ((data ?? []) as Array<UserRoleAssignment & { profile?: { email: string; full_name: string } }>).map((u) => ({
    ...u,
    user_email: u.profile?.email,
    user_name: u.profile?.full_name,
  }));
}

export function groupPermissionsByModule(permissions: Permission[]): Map<PermissionModule, Permission[]> {
  const out = new Map<PermissionModule, Permission[]>();
  for (const p of permissions) {
    const arr = out.get(p.module) ?? [];
    arr.push(p);
    out.set(p.module, arr);
  }
  return out;
}
