/**
 * Tipos del dominio RRHH (R6 · capa UI). Espejo de las tablas/RPC de R1–R5.
 * Sin lógica. Los cálculos viven en la base (FD-9).
 */

export type EmpleadoEstado = "activo" | "licencia" | "baja";

export interface Empleado {
  id: string;
  public_id: number;
  profile_id: string | null;
  apellido_nombre: string;
  dni: string;
  cuil: string;
  categoria: string | null;
  seccion: string | null;
  depot: string | null;
  convenio: string | null;
  fecha_ingreso: string | null;
  fecha_reconocida: string | null;
  supervisor_id: string | null;
  obra_social: string | null;
  estado: EmpleadoEstado;
}

export interface EmpleadoBancario {
  id: string;
  empleado_id: string;
  banco: string;
  cbu: string | null;
  alias: string | null;
  cuenta: string | null;
  vigente_desde: string | null;
}

export interface EmpleadoHistorial {
  id: string;
  empleado_id: string;
  campo: string;
  valor_anterior: string | null;
  valor_nuevo: string | null;
  vigente_desde: string | null;
}

export type SolicitudTipo = "vacaciones" | "permiso" | "licencia" | "hora_extra";
export type SolicitudEstado =
  | "borrador"
  | "pendiente_supervisor"
  | "pendiente_rrhh"
  | "aprobada"
  | "rechazada"
  | "cancelada"
  | "anulada";

export interface Solicitud {
  id: string;
  public_id: string;
  empleado_id: string;
  tipo: SolicitudTipo;
  subtipo: string | null;
  fecha_desde: string;
  fecha_hasta: string;
  cantidad_dias: number | null;
  motivo: string | null;
  estado: SolicitudEstado;
  created_at: string;
}

export interface SolicitudEvento {
  id: number;
  solicitud_id: string;
  ts: string;
  accion: string;
  nivel: string | null;
  comentario: string | null;
}

export interface Novedad {
  id: string;
  empleado_id: string;
  periodo: string;
  tipo: string;
  cantidad: number;
  confirmada: boolean;
  origen_solicitud_id: string | null;
}

export type DocClass =
  | "dni"
  | "cuil"
  | "cv"
  | "contrato"
  | "alta_afip"
  | "certificado"
  | "estudio"
  | "capacitacion"
  | "adjunto_solicitud"
  | "otro";

export interface Documento {
  id: string;
  empleado_id: string;
  solicitud_id: string | null;
  doc_class: DocClass;
  storage_bucket: string;
  titulo: string | null;
  mime_type: string | null;
  expires_at: string | null;
  created_at: string;
}

/** Grant devuelto por emit_rrhh_signed_url (la app firma el URL con el SDK). */
export interface SignedUrlGrant {
  document_id: string;
  bucket: string;
  path: string;
  issued_at: string;
}

/** KPIs simples del dashboard (D1: conteos, sin vistas rrhh_v_*). */
export interface DashboardCounts {
  dotacion_total: number;
  activos: number;
  en_licencia: number;
  solicitudes_pendientes: number;
  vacaciones_pendientes: number;
  licencias_activas: number;
}
