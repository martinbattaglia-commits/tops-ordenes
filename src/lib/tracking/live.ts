import type { FleetLastPosition, FleetVehicle } from "./types";
import { FLEET_COMM_FRESH_MS, FLEET_OFFLINE_AFTER_MS } from "./status";

/**
 * Estado de display del vehículo (4 estados, derivado en vivo, no persistido).
 *
 * Combina DOS ejes temporales + velocidad:
 *   · comunicación (created_at): ¿el dispositivo entregó algo reciente?
 *   · frescura del fix (recorded_at): ¿la posición GPS es actual?
 *   · velocidad: en marcha vs detenido.
 *
 * Prioridad (de mayor a menor):
 *   · offline  → sin comunicación reciente (gana sobre todo lo demás)
 *   · degraded → comunica, pero el fix GPS quedó viejo (iOS/Traccar congelado)
 *   · moving   → fix fresco y velocidad ≥ umbral
 *   · idle     → fix fresco pero detenido
 *
 * Da los 4 colores de marcador: 🟢 movimiento · 🟡 detenido · 🟠 señal
 * degradada · ⚫ offline.
 */
export type FleetMotionStatus = "moving" | "idle" | "degraded" | "offline";

/** Vehículo con su estado derivado (view-model del mapa/panel/tabla). */
export type LiveVehicle = FleetVehicle & { motion: FleetMotionStatus };

/** Umbral por debajo del cual se considera DETENIDO (km/h). */
export const FLEET_IDLE_SPEED_KMH = 3;

/**
 * Deriva el estado de display a partir de la última posición conocida.
 *
 * Eje 1 (comunicación, created_at): si el dispositivo no entrega nada hace más
 * de FLEET_COMM_FRESH_MS → OFFLINE. Eje 2 (frescura, recorded_at): si comunica
 * pero el fix GPS es más viejo que FLEET_OFFLINE_AFTER_MS → SEÑAL DEGRADADA
 * (el caso iOS: el teléfono reenvía un fix cacheado con HTTP 200). Si el fix es
 * fresco, se distingue movimiento/detenido por velocidad.
 */
export function deriveFleetState(
  pos: FleetLastPosition | null,
  nowMs: number
): FleetMotionStatus {
  if (!pos) return "offline";

  const commAge = nowMs - new Date(pos.created_at).getTime();
  if (commAge > FLEET_COMM_FRESH_MS) return "offline";

  const fixAge = nowMs - new Date(pos.recorded_at).getTime();
  if (fixAge > FLEET_OFFLINE_AFTER_MS) return "degraded";

  const speed = pos.speed ?? null; // ya normalizada a km/h por el provider
  return speed != null && speed >= FLEET_IDLE_SPEED_KMH ? "moving" : "idle";
}

/** Paleta de tokens Nexus por estado (clases utilitarias + hex para el mapa). */
export const MOTION_TONE: Record<
  FleetMotionStatus,
  { label: string; dot: string; text: string; ring: string; hex: string }
> = {
  moving: {
    label: "En movimiento",
    dot: "bg-status-success",
    text: "text-status-success",
    ring: "ring-status-success/40",
    hex: "#16a34a",
  },
  idle: {
    label: "Detenido",
    dot: "bg-status-warning",
    text: "text-status-warning",
    ring: "ring-status-warning/40",
    hex: "#d97706",
  },
  degraded: {
    label: "Señal degradada",
    dot: "bg-[#f4710f]",
    text: "text-[#f4710f]",
    ring: "ring-[#f4710f]/40",
    hex: "#f4710f",
  },
  offline: {
    label: "Offline",
    dot: "bg-fg-muted/50",
    text: "text-fg-muted",
    ring: "ring-fg-muted/20",
    hex: "#69738a",
  },
};
