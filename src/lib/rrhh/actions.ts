"use server";

/**
 * Server actions del dominio RRHH (R6). RPC-First: cada transición invoca el RPC
 * de R4/R5 (fail-closed, append-only, auditado en la base). La UI nunca escribe
 * estado directo ni calcula nada.
 */
import { revalidatePath } from "next/cache";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import { mapRrhhError, type RrhhActionResult } from "./errors";
import { solicitudCrearSchema, solicitudIdSchema, anularSchema, signedUrlSchema, empleadoCrearSchema } from "./validation";

/**
 * Validación de permiso a nivel acción (defensa en profundidad sobre la RLS/RPC).
 * Dormida hasta RBAC_ENFORCE=1 (igual que el resto del RBAC) → no rompe nada antes
 * de seedear roles. Con enforce on, exige el permiso vía has_permission (fail-closed).
 */
async function guard(slug: string): Promise<RrhhActionResult | null> {
  if (!env.rbac.enforce) return null; // bootstrap: no bloquear
  const supabase = createClient();
  if (!supabase) return { ok: false, message: "Supabase no disponible." };
  const { data, error } = await supabase.rpc("has_permission", { p_slug: slug });
  if (error || data !== true) return { ok: false, message: `No autorizado (${slug}).` };
  return null;
}

async function callRpc(fn: string, args: Record<string, unknown>): Promise<RrhhActionResult> {
  const supabase = createClient();
  if (!supabase) return { ok: false, message: "Supabase no disponible." };
  const { error } = await supabase.rpc(fn, args);
  if (error) return mapRrhhError(error);
  revalidatePath("/rrhh/solicitudes");
  revalidatePath("/rrhh");
  return { ok: true, message: "Operación realizada." };
}

export async function crearSolicitud(input: unknown): Promise<RrhhActionResult> {
  const d = await guard("mi_espacio.view"); if (d) return d;
  const p = solicitudCrearSchema.safeParse(input);
  if (!p.success) return { ok: false, message: "Datos inválidos." };
  return callRpc("rrhh_solicitud_crear", {
    p_empleado_id: p.data.empleado_id, p_tipo: p.data.tipo, p_subtipo: p.data.subtipo ?? null,
    p_fecha_desde: p.data.fecha_desde, p_fecha_hasta: p.data.fecha_hasta,
    p_motivo: p.data.motivo ?? null, p_cantidad_dias: p.data.cantidad_dias ?? null,
  });
}

export async function enviarSolicitud(id: string): Promise<RrhhActionResult> {
  const d = await guard("mi_espacio.view"); if (d) return d;
  const p = solicitudIdSchema.safeParse({ id });
  if (!p.success) return { ok: false, message: "Id inválido." };
  return callRpc("rrhh_solicitud_enviar", { p_id: p.data.id });
}

export async function aprobarL1(id: string, comentario?: string): Promise<RrhhActionResult> {
  const d = await guard("rrhh.edit"); if (d) return d;
  const p = solicitudIdSchema.safeParse({ id, comentario });
  if (!p.success) return { ok: false, message: "Id inválido." };
  return callRpc("rrhh_solicitud_aprobar_l1", { p_id: p.data.id, p_comentario: p.data.comentario ?? null });
}

export async function aprobarL2(id: string, comentario?: string): Promise<RrhhActionResult> {
  const d = await guard("rrhh.edit"); if (d) return d;
  const p = solicitudIdSchema.safeParse({ id, comentario });
  if (!p.success) return { ok: false, message: "Id inválido." };
  return callRpc("rrhh_solicitud_aprobar_l2", { p_id: p.data.id, p_comentario: p.data.comentario ?? null });
}

export async function rechazarSolicitud(id: string, comentario?: string): Promise<RrhhActionResult> {
  const d = await guard("rrhh.edit"); if (d) return d;
  const p = solicitudIdSchema.safeParse({ id, comentario });
  if (!p.success) return { ok: false, message: "Id inválido." };
  return callRpc("rrhh_solicitud_rechazar", { p_id: p.data.id, p_comentario: p.data.comentario ?? null });
}

export async function cancelarSolicitud(id: string, comentario?: string): Promise<RrhhActionResult> {
  const d = await guard("mi_espacio.view"); if (d) return d;
  const p = solicitudIdSchema.safeParse({ id, comentario });
  if (!p.success) return { ok: false, message: "Id inválido." };
  return callRpc("rrhh_solicitud_cancelar", { p_id: p.data.id, p_comentario: p.data.comentario ?? null });
}

export async function anularSolicitud(id: string, motivo: string): Promise<RrhhActionResult> {
  const d = await guard("rrhh.edit"); if (d) return d;
  const p = anularSchema.safeParse({ id, motivo });
  if (!p.success) return { ok: false, message: "Se requiere un motivo." };
  return callRpc("rrhh_solicitud_anular", { p_id: p.data.id, p_motivo: p.data.motivo });
}

/**
 * Emite un signed URL para un documento: (1) autoriza+audita en la base vía RPC
 * emit_rrhh_signed_url; (2) firma el binario con el cliente admin sobre el grant.
 * Nunca expone el storage_path crudo.
 */
/**
 * CH1 — Alta de empleado (Capital Humano). Gated `rrhh.edit`. Inserta en
 * rrhh_empleados bajo la sesión (RLS INSERT de 0058 aplica). Unicidad DNI/CUIL
 * la garantiza la constraint de la base (mapeada a mensaje amable).
 */
export async function crearEmpleado(input: unknown): Promise<RrhhActionResult> {
  const denied = await guard("rrhh.edit"); if (denied) return denied;
  const p = empleadoCrearSchema.safeParse(input);
  if (!p.success) return { ok: false, message: p.error.issues[0]?.message ?? "Datos inválidos." };
  const supabase = createClient();
  if (!supabase) return { ok: false, message: "Supabase no disponible." };
  const v = p.data;
  const blank = (s?: string | null) => (s && s.trim() !== "" ? s : null);
  const { error } = await supabase.from("rrhh_empleados").insert({
    apellido_nombre: v.apellido_nombre.trim(),
    dni: v.dni.trim(),
    cuil: v.cuil.trim(),
    fecha_nacimiento: blank(v.fecha_nacimiento),
    domicilio: blank(v.domicilio),
    telefono: blank(v.telefono),
    email_personal: blank(v.email_personal),
    estado_civil: blank(v.estado_civil),
    fecha_ingreso: v.fecha_ingreso,
    fecha_reconocida: blank(v.fecha_reconocida) ?? v.fecha_ingreso,
    categoria: blank(v.categoria),
    seccion: blank(v.seccion),
    convenio: blank(v.convenio),
    modalidad_contratacion: blank(v.modalidad_contratacion),
    depot: blank(v.depot),
    obra_social: blank(v.obra_social),
  });
  if (error) return mapRrhhError(error);
  revalidatePath("/rrhh/empleados");
  revalidatePath("/rrhh");
  return { ok: true, message: "Empleado dado de alta." };
}

export async function getDocumentoSignedUrl(input: unknown): Promise<{ ok: boolean; url?: string; message?: string }> {
  const d = await guard("mi_espacio.view"); if (d) return d;
  const p = signedUrlSchema.safeParse(input);
  if (!p.success) return { ok: false, message: "Datos inválidos." };
  const supabase = createClient();
  if (!supabase) return { ok: false, message: "Supabase no disponible." };
  const { data: grant, error } = await supabase.rpc("emit_rrhh_signed_url", {
    p_document_id: p.data.document_id, p_reason: p.data.reason ?? null,
  });
  if (error) return mapRrhhError(error);
  const admin = createAdminClient();
  if (!admin) return { ok: false, message: "Storage no disponible." };
  const { data: signed, error: sErr } = await admin.storage
    .from((grant as any).bucket).createSignedUrl((grant as any).path, 120);
  if (sErr || !signed) return { ok: false, message: "No se pudo generar el enlace." };
  return { ok: true, url: signed.signedUrl };
}
