/**
 * Data accessors del dominio RRHH (R6 · capa UI). READ-ONLY.
 *
 * Cliente de sesión → la RLS de R3–R5 aplica (empleado ve lo suyo, supervisor su
 * equipo, RRHH según permiso, operaciones nada). Si las migraciones 0056–0060 no
 * estuvieran aplicadas, los accessors lanzan y la página degrada con <ModuleUnavailable/>.
 *
 * FD-9: ningún cálculo en TS. Los KPIs del dashboard son CONTEOS simples (D1, sin
 * vistas rrhh_v_*); no se derivan saldos/ausentismo en el cliente.
 */
import { createClient } from "@/lib/supabase/server";
import type {
  Empleado, EmpleadoBancario, EmpleadoHistorial,
  Solicitud, SolicitudEvento, Novedad, Documento, DashboardCounts,
} from "./types";

const EMP_COLS =
  "id,public_id,profile_id,apellido_nombre,dni,cuil,categoria,seccion,depot,convenio,fecha_ingreso,fecha_reconocida,supervisor_id,obra_social,estado";

/** Chequeo de permiso server-side vía RPC (RBAC, fail-closed en la base). */
export async function hasPerm(slug: string): Promise<boolean> {
  const supabase = createClient();
  if (!supabase) return false;
  const { data, error } = await supabase.rpc("has_permission", { p_slug: slug });
  if (error) return false;
  return data === true;
}

async function currentUserId(): Promise<string | null> {
  const supabase = createClient();
  if (!supabase) return null;
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

export async function getDashboardCounts(): Promise<DashboardCounts> {
  const supabase = createClient();
  if (!supabase) throw new Error("supabase no disponible");
  const c = (q: any) => q.select("*", { count: "exact", head: true });
  const [tot, act, lic, solPend, vacPend, licAct] = await Promise.all([
    c(supabase.from("rrhh_empleados")),
    c(supabase.from("rrhh_empleados")).eq("estado", "activo"),
    c(supabase.from("rrhh_empleados")).eq("estado", "licencia"),
    c(supabase.from("rrhh_solicitudes")).in("estado", ["pendiente_supervisor", "pendiente_rrhh"]),
    c(supabase.from("rrhh_solicitudes")).eq("tipo", "vacaciones").in("estado", ["pendiente_supervisor", "pendiente_rrhh"]),
    c(supabase.from("rrhh_solicitudes")).eq("tipo", "licencia").eq("estado", "aprobada"),
  ]);
  // el primer error real propaga (degradación con ModuleUnavailable a nivel page)
  for (const r of [tot, act, lic, solPend, vacPend, licAct]) if (r.error) throw r.error;
  return {
    dotacion_total: tot.count ?? 0,
    activos: act.count ?? 0,
    en_licencia: lic.count ?? 0,
    solicitudes_pendientes: solPend.count ?? 0,
    vacaciones_pendientes: vacPend.count ?? 0,
    licencias_activas: licAct.count ?? 0,
  };
}

export async function listEmpleados(): Promise<Empleado[]> {
  const supabase = createClient();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("rrhh_empleados").select(EMP_COLS)
    .order("apellido_nombre", { ascending: true });
  if (error) throw error;
  return (data ?? []) as Empleado[];
}

export async function getEmpleado(id: string): Promise<Empleado | null> {
  const supabase = createClient();
  if (!supabase) return null;
  const { data, error } = await supabase.from("rrhh_empleados").select(EMP_COLS).eq("id", id).maybeSingle();
  if (error) throw error;
  return (data as Empleado) ?? null;
}

/** Bancario: la RLS solo lo devuelve a rrhh.admin o al dueño. */
export async function getEmpleadoBancario(empleadoId: string): Promise<EmpleadoBancario[]> {
  const supabase = createClient();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("rrhh_empleado_bancario").select("id,empleado_id,banco,cbu,alias,cuenta,vigente_desde")
    .eq("empleado_id", empleadoId).order("vigente_desde", { ascending: false });
  if (error) return []; // sin permiso → simplemente no se muestra
  return (data ?? []) as EmpleadoBancario[];
}

export async function getEmpleadoHistorial(empleadoId: string): Promise<EmpleadoHistorial[]> {
  const supabase = createClient();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("rrhh_empleado_historial").select("id,empleado_id,campo,valor_anterior,valor_nuevo,vigente_desde")
    .eq("empleado_id", empleadoId).order("vigente_desde", { ascending: false });
  if (error) return [];
  return (data ?? []) as EmpleadoHistorial[];
}

export async function listSolicitudes(): Promise<Solicitud[]> {
  const supabase = createClient();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("rrhh_solicitudes")
    .select("id,public_id,empleado_id,tipo,subtipo,fecha_desde,fecha_hasta,cantidad_dias,motivo,estado,created_at")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as Solicitud[];
}

export async function getSolicitudEventos(solicitudId: string): Promise<SolicitudEvento[]> {
  const supabase = createClient();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("rrhh_solicitud_eventos").select("id,solicitud_id,ts,accion,nivel,comentario")
    .eq("solicitud_id", solicitudId).order("ts", { ascending: true });
  if (error) return [];
  return (data ?? []) as SolicitudEvento[];
}

export async function listNovedades(periodo?: string): Promise<Novedad[]> {
  const supabase = createClient();
  if (!supabase) return [];
  let q = supabase.from("rrhh_novedades")
    .select("id,empleado_id,periodo,tipo,cantidad,confirmada,origen_solicitud_id")
    .order("periodo", { ascending: false });
  if (periodo) q = q.eq("periodo", periodo);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as Novedad[];
}

export async function listDocumentos(): Promise<Documento[]> {
  const supabase = createClient();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("rrhh_documents")
    .select("id,empleado_id,solicitud_id,doc_class,storage_bucket,titulo,mime_type,expires_at,created_at")
    .is("deleted_at", null).order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as Documento[];
}

/** Portal del empleado: su propio legajo (RLS por propiedad). */
export async function getMiLegajo(): Promise<Empleado | null> {
  const uid = await currentUserId();
  if (!uid) return null;
  const supabase = createClient();
  if (!supabase) return null;
  const { data, error } = await supabase.from("rrhh_empleados").select(EMP_COLS).eq("profile_id", uid).maybeSingle();
  if (error) return null;
  return (data as Empleado) ?? null;
}
