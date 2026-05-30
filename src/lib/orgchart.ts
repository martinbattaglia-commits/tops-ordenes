/**
 * Organigrama institucional — Verotin S.A. / Logística TOPS · Edición 2026.
 *
 * Fuente autoritativa: documento institucional "Organigrama_Logistica_TOPS_2026_FINAL"
 * (actualizado 12/05/2026), entregado por la Presidencia. Single source of truth para
 * la jerarquía mostrada en `/organigrama` y referencia para el mapeo RBAC.
 *
 * NOTA RBAC: el campo `rbac` mapea cada nodo al catálogo de roles VIVO (7 roles:
 * director_ops, admin, comercial, operaciones, seguridad, compliance, cliente_b2b).
 * `decided: true` = asignación resuelta por la Presidencia; `decided: false` = sugerencia
 * derivada del cargo, pendiente de confirmación. Ver docs/erp/RBAC-READONLY-VALIDATION.md.
 */

export type OrgTier =
  | "asamblea"
  | "direccion"
  | "gerencia"
  | "area"
  | "encargado"
  | "personal"
  | "externo";

export interface RbacHint {
  /** slug del catálogo vivo (público.roles). */
  slug: string;
  /** etiqueta legible. */
  label: string;
  /** true = decidido por Presidencia; false = sugerido por cargo. */
  decided: boolean;
}

export interface OrgNode {
  name: string;
  title: string;
  tier: OrgTier;
  /** Detalle secundario (ubicación, función, nota legal). */
  detail?: string;
  email?: string;
  /** Participación accionaria, sólo asamblea. */
  equity?: string;
  rbac?: RbacHint;
}

/** Metadatos del documento institucional. */
export const ORGCHART_META = {
  edition: "2026",
  updatedAt: "12/05/2026",
  legalName: "Verotin S.A.",
  brand: "Logística TOPS",
  cuit: "33-60489698-9",
  igj: "Inscripta IGJ 04/12/1984",
  /** PDF oficial servido desde /public. */
  pdfPath: "/docs/organigrama-2026.pdf",
} as const;

/** Asamblea de Accionistas · Propietarios. */
export const ASAMBLEA: OrgNode[] = [
  {
    name: "Martín F. Battaglia",
    title: "Presidente · CEO",
    tier: "asamblea",
    equity: "55 %",
    detail: "Capital social: 150.000 acciones ordinarias · VN $1 c/u",
  },
  {
    name: "Verónica F. Battaglia",
    title: "Directora Suplente",
    tier: "asamblea",
    equity: "45 %",
    detail: "Inscripta IGJ N° 8420 · 04/12/1984",
  },
];

/** Estructura ejecutiva: presidencia + vicepresidencia + dirección de operaciones. */
export const PRESIDENTE: OrgNode = {
  name: "Martín F. Battaglia",
  title: "Presidente · CEO",
  tier: "direccion",
  detail: "Estrategia · Finanzas · Tecnología · Marketing",
};

export const VICEPRESIDENTE: OrgNode = {
  name: "Ángel B. Fernández Calvo",
  title: "Vicepresidente · Consultor",
  tier: "externo",
  detail: "Asesoramiento estratégico",
};

export const DIRECTOR: OrgNode = {
  name: "José Luis Rodríguez Silva",
  title: "Director de Operaciones y Apoderado",
  tier: "direccion",
  email: "joseluis@logisticatops.com",
  rbac: { slug: "director_ops", label: "Director de Operaciones", decided: true },
};

/** Gerencia / administración (reportan a la Dirección de Operaciones). */
export const GERENCIA: OrgNode[] = [
  {
    name: "Cynthia Alba",
    title: "Gerente Comercial y Apoderada",
    tier: "gerencia",
    detail: "de Verotin S.A.",
    rbac: { slug: "comercial", label: "Comercial", decided: false },
  },
  {
    name: "Ruth Carrasquero",
    title: "Asistente Ejecutiva",
    tier: "gerencia",
    detail: "Responsable de Administración",
    email: "ruth@logisticatops.com",
    rbac: { slug: "admin", label: "Administración", decided: true },
  },
];

export interface OrgArea {
  label: string;
  scope: string;
  tier: OrgTier;
  rbac?: RbacHint;
  /** Encargado/responsable del área, si lo hay. */
  lead?: OrgNode;
  /** Sub-equipo bajo el área o el encargado. */
  team?: { label: string; members: string[] };
  /** Personal directo del área (sin encargado intermedio). */
  members?: string[];
}

/** Áreas operativas y su personal. */
export const AREAS: OrgArea[] = [
  {
    label: "Recepción · Asist. Comercial",
    scope: "Recepción VIP — Osvaldo Cruz 3201",
    tier: "area",
    members: ["VACANTE · A contratar 2026"],
  },
  {
    label: "Personal Operativo",
    scope: "Depósitos · Eslingaje · Distribución",
    tier: "area",
    rbac: { slug: "operaciones", label: "Operaciones", decided: false },
    // Dos encargados (uno por CD). Modelado como sub-áreas en la página.
  },
  {
    label: "Mantenimiento",
    scope: "Edilicio · Máquinas",
    tier: "area",
    lead: {
      name: "Víctor Martínez",
      title: "Responsable · Mantenimiento",
      tier: "encargado",
      detail: "Edilicio + Máquinas",
    },
    team: { label: "Operarios", members: ["Jaime Serrano", "Iván (operario)"] },
  },
  {
    label: "Personal de Seguridad",
    scope: "Vigilancia 24/7 · Control de Accesos",
    tier: "area",
    rbac: { slug: "seguridad", label: "Seguridad / CCTV", decided: false },
    team: {
      label: "Turnos de guardia 24/7 · 4 serenos",
      members: ["Néstor Véliz", "Juan Ojeda", "Ricardo Mendoza", "Sereno 4"],
    },
  },
  {
    label: "Limpieza · Mantenimiento Gral.",
    scope: "Higiene y mantenimiento general",
    tier: "area",
    members: ["Silvia González"],
  },
];

/** Encargados del Personal Operativo (un CD cada uno). */
export const ENCARGADOS_OPERATIVOS: Array<OrgNode & { team: { label: string; members: string[] } }> = [
  {
    name: "Juan Carlos Reynoso",
    title: "Encargado · CD Central",
    tier: "encargado",
    detail: "Agustín Magaldi 1765",
    team: { label: "Choferes · Chasis", members: ["Manuel Silva", "Ezequiel Velázquez"] },
  },
  {
    name: "Jorge Merino",
    title: "Encargado · Depósito",
    tier: "encargado",
    detail: "Pedro de Luján 3159",
    team: { label: "Maquinistas · Autoelevadores", members: ["Eliezer Rodríguez", "Carlos Fernández"] },
  },
];

export interface ExternalAdvisor {
  area: string;
  name: string;
  detail: string;
}

/** Asesores externos · profesionales contratados ad-hoc. */
export const ASESORES_EXTERNOS: ExternalAdvisor[] = [
  { area: "Asesores Legales", name: "Dra. Silvia Bottiroli", detail: "Contratos comerciales" },
  { area: "Asesores Legales", name: "Dra. Valeria Bril", detail: "Laboral" },
  { area: "Asesor Contable", name: "Cra. Mariela Camejo", detail: "Estudio Sullivan Camejo" },
  { area: "Gestión Municipal", name: "Adrián Calvo", detail: "Gestiones GCBA" },
  { area: "Sistemas e Informática", name: "Fernando Sande", detail: "Soporte IT · Redes" },
  { area: "Seguridad e Higiene", name: "Ing. Martín Molinari", detail: "Responsable externo · Ley 19.587" },
];

/** Leyenda de niveles (colores del documento institucional). */
export const ORG_LEGEND: Array<{ tier: OrgTier; label: string }> = [
  { tier: "asamblea", label: "Asamblea" },
  { tier: "direccion", label: "Dirección" },
  { tier: "gerencia", label: "Gerencia" },
  { tier: "area", label: "Área" },
  { tier: "encargado", label: "Encargado" },
  { tier: "personal", label: "Personal" },
  { tier: "externo", label: "Externo" },
];
