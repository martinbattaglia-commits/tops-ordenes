/**
 * Tipos del modelo de casos regulatorios.
 * Estado administrativo y Nivel de riesgo son dimensiones INDEPENDIENTES.
 * El Semáforo (color) se computa (ver ../semaforo.ts); el riesgo NO lo determina.
 */
import type { Riesgo } from "../data";

export const ESTADOS = [
  "sin_iniciar", "vigente", "en_tramite", "observado",
  "pendiente_emision", "aprobado", "rechazado",
] as const;
export type EstadoAdministrativo = (typeof ESTADOS)[number];

export const ETAPAS = ["iniciado", "pronto_despacho", "esperando_resolucion", "subsanando"] as const;
export type Etapa = (typeof ETAPAS)[number];

export const NIVELES_RIESGO = ["bajo", "medio", "alto", "critico"] as const;
export type NivelRiesgo = (typeof NIVELES_RIESGO)[number];

/** El semáforo (color) coincide con el tipo Riesgo existente del cockpit. */
export const SEMAFOROS = ["Verde", "Amarillo", "Naranja", "Rojo"] as const;
export type Semaforo = Riesgo;

export const ORIGENES = ["manual", "sheet", "documento", "correo", "ia", "nombre_archivo"] as const;
export type Origen = (typeof ORIGENES)[number];

export const CONFIANZAS = ["confirmada", "alta", "media", "baja"] as const;
export type Confianza = (typeof CONFIANZAS)[number];

/** Eje temporal derivado de las fechas (independiente del estado). */
export type Temporal = "vigente" | "proximo" | "vencido" | "sin_fecha" | "falta";

export interface ComplianceCase {
  id: string;
  itemId: string | null;
  sede: string | null;
  tipoCertificado: string | null;
  expedienteNro: string | null;
  organismo: string | null;
  estadoAdministrativo: EstadoAdministrativo;
  etapa: Etapa | null;
  nivelRiesgo: NivelRiesgo | null;
  fechaInicio: string | null;
  fechaProntoDespacho: string | null;
  ultimaActuacion: string | null;
  proximaAccion: string | null;
  observaciones: string | null;
  origen: Origen;
  confianza: Confianza;
  activo: boolean;
}

/** Vista mínima del caso activo que consume deriveComplianceStatus. */
export interface ComplianceCaseLite {
  estadoAdministrativo: EstadoAdministrativo;
  etapa: Etapa | null;
  nivelRiesgo: NivelRiesgo | null;
  origen: Origen;
  confianza: Confianza;
}
