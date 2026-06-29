/**
 * Máquina de estados administrativos (D11): impide cambios inconsistentes.
 * `from → [destinos permitidos]`. Auto-transición (X→X) siempre válida.
 * `sin_iniciar` como origen = creación: permite cualquier estado inicial.
 * Tuneable (constante en código; promovible a tabla en una iteración futura).
 */
import type { EstadoAdministrativo } from "./types";

export const TRANSICIONES: Record<EstadoAdministrativo, EstadoAdministrativo[]> = {
  sin_iniciar:       ["vigente", "en_tramite", "observado", "pendiente_emision", "aprobado", "rechazado"],
  en_tramite:        ["observado", "pendiente_emision", "aprobado", "rechazado", "vigente"],
  observado:         ["en_tramite", "pendiente_emision", "aprobado", "rechazado"],
  pendiente_emision: ["vigente", "aprobado", "rechazado"],
  aprobado:          ["vigente", "pendiente_emision"],
  vigente:           ["en_tramite", "observado", "rechazado"],
  rechazado:         ["en_tramite", "sin_iniciar"],
};

/** ¿Se permite la transición from→to? La auto-transición siempre es válida. */
export function canTransition(from: EstadoAdministrativo, to: EstadoAdministrativo): boolean {
  if (from === to) return true;
  return TRANSICIONES[from]?.includes(to) ?? false;
}
