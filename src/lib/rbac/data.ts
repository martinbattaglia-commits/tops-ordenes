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
 *
 * Estrategia:
 *  - PRODUCCIÓN (Supabase configurado): consulta tablas reales `roles`,
 *    `permissions`, `role_permissions`, `user_roles`.
 *  - DEMO MODE (`NEXT_PUBLIC_DEMO_MODE=1`) o sin Supabase: usa los seeds
 *    constantes definidos abajo. Los seeds reflejan los **6 roles reales**
 *    de Logística TOPS (Director / Administración / Operaciones /
 *    Comercial / Depósito / Auditor) — no usuarios ficticios.
 *
 * NOTA · QW Fase 1 (2026-05-29):
 *  - Se eliminó la lista de asignaciones ficticias (MOCK_USER_ASSIGNMENTS).
 *  - `listUserAssignments()` retorna `[]` en demo mode hasta que existan
 *    asignaciones reales en `user_roles`. La UI debe mostrar "Sin usuarios
 *    asignados" en ese caso.
 *  - Para poblar `user_roles` en producción, ejecutar:
 *      `scripts/seed-rbac-real-roles.sql`
 *    (requiere gate ejecutivo; no se ejecuta automáticamente).
 */

// ------------------------------------------------------------------
// PERMISSIONS — 22 permisos seedeados (alineados con la migración 0009)
// ------------------------------------------------------------------

const SEED_PERMISSIONS: Permission[] = [
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

// ------------------------------------------------------------------
// 6 ROLES REALES — Logística TOPS
// ------------------------------------------------------------------

const SEED_ROLES: Role[] = [
  {
    id: "r1",
    slug: "director",
    name: "Director",
    description: "Máxima autoridad operativa y financiera. Único habilitado a firmar OC.",
    color: "#C90812",
    is_system: true,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-05-29T00:00:00Z",
    permission_count: 22,
    user_count: 0,
  },
  {
    id: "r2",
    slug: "administracion",
    name: "Administración",
    description: "Equipo financiero, fiscalía y compliance. Todos los permisos salvo firma de OC.",
    color: "#214576",
    is_system: true,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-05-29T00:00:00Z",
    permission_count: 21,
    user_count: 0,
  },
  {
    id: "r3",
    slug: "operaciones",
    name: "Operaciones",
    description: "Coordinación de depósitos, picking, recepción y servicios a clientes.",
    color: "#050555",
    is_system: true,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-05-29T00:00:00Z",
    permission_count: 9,
    user_count: 0,
  },
  {
    id: "r4",
    slug: "comercial",
    name: "Comercial",
    description: "Equipo CRM, ventas, gestión de pipeline en Clientify.",
    color: "#B45309",
    is_system: true,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-05-29T00:00:00Z",
    permission_count: 3,
    user_count: 0,
  },
  {
    id: "r5",
    slug: "deposito",
    name: "Depósito",
    description: "Operarios de picking, recepción, firma de OS y monitoreo de cámaras.",
    color: "#0E7C3A",
    is_system: true,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-05-29T00:00:00Z",
    permission_count: 4,
    user_count: 0,
  },
  {
    id: "r6",
    slug: "auditor",
    name: "Auditor",
    description: "Acceso de SOLO LECTURA a todos los módulos. Para auditorías internas y externas.",
    color: "#8A94A6",
    is_system: true,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-05-29T00:00:00Z",
    permission_count: 7,
    user_count: 0,
  },
];

// ------------------------------------------------------------------
// Mapeo role.slug → permission.slug[]
// ------------------------------------------------------------------

const ROLE_PERMS_MAP: Record<string, string[]> = {
  // Director: TODO
  director: SEED_PERMISSIONS.map((p) => p.slug),

  // Administración: TODO menos firma de OC
  administracion: SEED_PERMISSIONS.filter((p) => p.slug !== "compras.sign").map((p) => p.slug),

  // Operaciones: gestiona compras (sin firma), todo servicios (incl. firma), CCTV view, documental view+create
  operaciones: [
    "cockpit.view",
    "compras.view",
    "compras.create",
    "servicios.view",
    "servicios.create",
    "servicios.sign",
    "cctv.view",
    "documental.view",
    "documental.create",
  ],

  // Comercial: solo CRM
  comercial: ["cockpit.view", "comercial.view", "comercial.edit"],

  // Depósito (operario picking): OS (incl. firma), cámaras view
  deposito: ["servicios.view", "servicios.create", "servicios.sign", "cctv.view"],

  // Auditor: SOLO view en todos los módulos
  auditor: [
    "cockpit.view",
    "compras.view",
    "servicios.view",
    "comercial.view",
    "compliance.view",
    "cctv.view",
    "documental.view",
  ],
};

// ------------------------------------------------------------------
// User assignments — VACÍO por default (no usuarios ficticios)
// ------------------------------------------------------------------

const SEED_USER_ASSIGNMENTS: UserRoleAssignment[] = [];

// ------------------------------------------------------------------
// Mock-mode helper
// ------------------------------------------------------------------

function isMock(): boolean {
  return env.app.demoMode || env.app.needsSupabase;
}

// ------------------------------------------------------------------
// PUBLIC API
// ------------------------------------------------------------------

export async function listRoles(): Promise<Role[]> {
  if (isMock()) return SEED_ROLES;
  const supabase = createClient();
  if (!supabase) return SEED_ROLES;
  const { data, error } = await supabase
    .from("roles")
    .select("*, role_permissions(permission_id), user_roles(user_id)")
    .order("name");
  if (error) throw new Error(`listRoles: ${error.message}`);
  const rows = (data ?? []) as Array<Role & { role_permissions?: { permission_id: string }[]; user_roles?: { user_id: string }[] }>;
  // Si la tabla `roles` está vacía en DB, devolver el seed para no mostrar UI vacía
  if (rows.length === 0) return SEED_ROLES;
  return rows.map((r) => ({
    ...r,
    permission_count: r.role_permissions?.length ?? 0,
    user_count: r.user_roles?.length ?? 0,
  }));
}

export async function getRole(slug: string): Promise<RoleWithPermissions | null> {
  if (isMock()) {
    const role = SEED_ROLES.find((r) => r.slug === slug);
    if (!role) return null;
    const permSlugs = ROLE_PERMS_MAP[slug] ?? [];
    return {
      ...role,
      permissions: SEED_PERMISSIONS.filter((p) => permSlugs.includes(p.slug)),
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
  if (!data) {
    // Fallback al seed para que la UI siga navegable
    const role = SEED_ROLES.find((r) => r.slug === slug);
    if (!role) return null;
    const permSlugs = ROLE_PERMS_MAP[slug] ?? [];
    return {
      ...role,
      permissions: SEED_PERMISSIONS.filter((p) => permSlugs.includes(p.slug)),
    };
  }
  const r = data as Role & { permissions?: Array<{ permission: Permission }> };
  return {
    ...r,
    permissions: (r.permissions ?? []).map((rp) => rp.permission),
  };
}

export async function listPermissions(): Promise<Permission[]> {
  if (isMock()) return SEED_PERMISSIONS;
  const supabase = createClient();
  if (!supabase) return SEED_PERMISSIONS;
  const { data, error } = await supabase
    .from("permissions")
    .select("*")
    .order("module")
    .order("action");
  if (error) throw new Error(`listPermissions: ${error.message}`);
  const rows = (data ?? []) as Permission[];
  if (rows.length === 0) return SEED_PERMISSIONS;
  return rows;
}

export async function listUserAssignments(): Promise<UserRoleAssignment[]> {
  if (isMock()) return SEED_USER_ASSIGNMENTS;
  const supabase = createClient();
  if (!supabase) return SEED_USER_ASSIGNMENTS;
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
