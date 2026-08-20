/**
 * templates.ts — Plantillas Utility aprobadas por Meta para WhatsApp Business API.
 *
 * Se utilizan cuando la ventana de atención al cliente de 24h expira (candado rojo).
 */

export interface UtilityTemplateParam {
  name: string;
  label: string;
  placeholder: string;
}

export interface UtilityTemplate {
  id: string;
  name: string;
  category: "UTILITY";
  language: "es_AR";
  title: string;
  bodyTemplate: string;
  params: UtilityTemplateParam[];
}

export const APPROVED_UTILITY_TEMPLATES: UtilityTemplate[] = [
  {
    id: "propuesta_comercial",
    name: "propuesta_comercial",
    category: "UTILITY",
    language: "es_AR",
    title: "Propuesta Comercial TOPS",
    bodyTemplate: "Hola {{1}}, te enviamos la propuesta comercial acordada con Logística TOPS.",
    params: [{ name: "cliente", label: "Nombre Cliente", placeholder: "ej. Juan Pérez" }],
  },
  {
    id: "actualizacion_orden_tops",
    name: "actualizacion_orden_tops",
    category: "UTILITY",
    language: "es_AR",
    title: "Actualización de Orden TOPS",
    bodyTemplate: "Estimado/a {{1}}, tu orden {{2}} ha cambiado al estado {{3}}.",
    params: [
      { name: "cliente", label: "Nombre Cliente", placeholder: "ej. María González" },
      { name: "orden", label: "Nº de Orden", placeholder: "ej. ORD-2026-0042" },
      { name: "estado", label: "Nuevo Estado", placeholder: "ej. En Proceso" },
    ],
  },
  {
    id: "aviso_documentacion_pendiente",
    name: "aviso_documentacion_pendiente",
    category: "UTILITY",
    language: "es_AR",
    title: "Aviso de Documentación Pendiente",
    bodyTemplate: "Hola {{1}}, solicitamos el envío de la documentación pendiente para continuar con la gestión operativa.",
    params: [{ name: "cliente", label: "Nombre Cliente", placeholder: "ej. Carlos Ruiz" }],
  },
  {
    id: "soporte_operativo_tops",
    name: "soporte_operativo_tops",
    category: "UTILITY",
    language: "es_AR",
    title: "Soporte Operativo TOPS",
    bodyTemplate: "Estimado/a {{1}}, nos comunicamos por el ticket {{2}} para coordinar el soporte requerido.",
    params: [
      { name: "cliente", label: "Nombre Cliente", placeholder: "ej. Ana Torres" },
      { name: "ticket", label: "Nº de Ticket", placeholder: "ej. TCK-9912" },
    ],
  },
];

/** Formatea el texto de una plantilla reemplazando los parámetros {{1}}, {{2}}, etc. */
export function renderTemplateText(template: UtilityTemplate, paramValues: Record<string, string>): string {
  let result = template.bodyTemplate;
  template.params.forEach((param, index) => {
    const val = paramValues[param.name] ?? `[${param.label}]`;
    result = result.replace(new RegExp(`\\{\\{${index + 1}\\}\\}`, "g"), val);
  });
  return result;
}
