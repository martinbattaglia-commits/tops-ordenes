// F4.1B — Ruteo de notificaciones (PURO, sin server-only): módulo compartido entre el
// read layer del Centro (data.ts, server) y NotificationsBell (shell, client), que hasta
// F3 hard-codeaba solo `orders` → una notificación connect no navegaba al hilo.
// entity='connect' + entity_id=<conversation_id> es la convención de 0147:15 / spec:776.

import { CONNECT_ENTITY_TYPES } from "@/lib/connect/types";

/** Ruta destino de una notificación según su entidad. */
export function hrefFor(entity: string | null, entityId: string | null): string {
  if (!entity) return "/connect/notificaciones";
  if (entity === "connect" && entityId) return `/connect/c/${entityId}`;
  // F4.2: entity='connect_incident' + entity_id=<incident_id> (convención 0165)
  // navega al detalle del incidente, NO al hilo (el detalle embebe el hilo).
  if (entity === "connect_incident" && entityId) return `/connect/incidentes/${entityId}`;
  // F4.3: entity='connect_task' + entity_id=<task_id> (convención 0169).
  if (entity === "connect_task" && entityId) return `/connect/tareas/${entityId}`;
  if (entity === "orders" && entityId) return `/orders/${entityId}`;
  if ((CONNECT_ENTITY_TYPES as readonly string[]).includes(entity) && entityId) {
    return `/connect/e/${entity}/${entityId}`;
  }
  return "/connect/notificaciones";
}
