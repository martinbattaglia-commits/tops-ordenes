// Nexus Link · INC-01/D-3 · el espejo server-side del permiso de archivado.
//
// Responde, para los hilos que están en pantalla, la MISMA pregunta que las RPC:
// ¿esta sesión puede archivar este hilo? La respuesta viaja como prop y la UI sólo
// la refleja (control habilitado/deshabilitado + tooltip).
//
// ⚠️ Por qué NO se usa `canAccess` de rbac/guard: su bootstrap per-user responde por
// PERMISO DE MÓDULO, no por las condiciones de estas dos RPC — mostraría el control
// a quien el servidor rechaza. Acá se reusan las MISMAS funciones del motor que las
// RPC invocan (`is_admin`, `has_permission`, `nexus_is_depot_manager_principal`) y
// las MISMAS tablas, leídas con la sesión bajo RLS. No hay una segunda definición de
// la regla: la aritmética vive en `archive-policy.ts` y es la única.
//
// ⚠️ Esto NO es una compuerta. Las RPC siguen re-validando todo. Si algo acá falla,
// los ítems salen SIN veredicto (`canArchive` undefined) y el control queda como
// antes de INC-01: habilitado, con el servidor decidiendo y el mensaje de D-1
// explicando la causa real. Nunca se afirma «podés» sin haberlo medido.

import { env } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import type { InboxItem } from "../types";
import {
  evaluateArchiveCapability, type ArchiveEntityFacts, type ArchiveFacts,
} from "../archive-policy";

type Client = NonNullable<ReturnType<typeof createClient>>;

type TaskRow = {
  conversation_id: string; estado: string | null;
  asignado_a: string | null; creado_por: string | null;
};
type IncidentRow = {
  conversation_id: string; estado: string | null;
  reportado_por: string | null; asignado_a: string | null;
};
type ParticipantRow = { conversation_id: string; member_role: string | null };

/**
 * Escalar booleano del motor.
 *
 * Devuelve `null` si la RPC falló. Es deliberado: asumir `false` NO sería fail-closed,
 * sería FALSEAR el veredicto — un `is_admin` caído dejaría a un administrador con toda
 * la bandeja deshabilitada y con un tooltip mintiéndole que no tiene el rol. Sin el
 * hecho no hay veredicto, y la bandeja sale sin anotar.
 */
async function flag(
  sb: Client, fn: string, args?: Record<string, unknown>,
): Promise<boolean | null> {
  const { data, error } = await supabaseRpc(sb, fn, args);
  if (error) return null;
  return data === true;
}

function supabaseRpc(sb: Client, fn: string, args?: Record<string, unknown>) {
  return args ? sb.rpc(fn, args) : sb.rpc(fn);
}

/**
 * Anota `canArchive` / `archiveBlockedMessage` sobre los ítems de la bandeja ACTIVA.
 *
 * Costo acotado y constante en cantidad de viajes, no en cantidad de hilos: 4 escalares
 * + 3 lecturas batcheadas por los ids que ya están en pantalla. Se resuelve una vez por
 * render del layout, no por fila.
 */
/**
 * Tope de hilos que se anotan por render. Los tres `.in(...)` viajan por GET: sin tope,
 * una bandeja muy grande arma un query string que PostgREST puede rechazar (414) y el
 * gate desaparecería justo en las cuentas más grandes. Por encima del tope los hilos
 * excedentes salen SIN veredicto — control habilitado y el servidor decidiendo, que es
 * el comportamiento previo a INC-01. Degradación declarada, no silenciosa.
 */
const ANNOTATE_LIMIT = 200;

export async function annotateArchiveCapability(items: InboxItem[]): Promise<InboxItem[]> {
  if (items.length === 0) return items;
  if (env.app.demoMode || env.app.needsSupabase) return items;
  const supabase = createClient();
  if (!supabase) return items;

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return items;
  const alcance = items.slice(0, ANNOTATE_LIMIT);
  const ids = alcance.map((i) => i.conversationId);
  const enAlcance = new Set(ids);

  try {
    const [isAdmin, isTaskAdmin, isIncidentAdmin, isDepotManager, tasks, incidents, parts] =
      await Promise.all([
        flag(supabase, "is_admin"),
        flag(supabase, "has_permission", { p_slug: "connect.task_admin" }),
        flag(supabase, "has_permission", { p_slug: "connect.incident_admin" }),
        flag(supabase, "nexus_is_depot_manager_principal"),
        supabase
          .from("connect_tasks")
          .select("conversation_id, estado, asignado_a, creado_por")
          .in("conversation_id", ids),
        supabase
          .from("connect_incidents")
          .select("conversation_id, estado, reportado_por, asignado_a")
          .in("conversation_id", ids),
        supabase
          .from("connect_participants")
          .select("conversation_id, member_role")
          .in("conversation_id", ids)
          .eq("profile_id", user.id),
      ]);

    // Sin los hechos no se inventa un veredicto: se devuelve la bandeja sin anotar.
    if (tasks.error || incidents.error || parts.error) return items;
    if (
      isAdmin === null || isTaskAdmin === null ||
      isIncidentAdmin === null || isDepotManager === null
    ) {
      return items;
    }

    const taskBy = new Map<string, TaskRow>();
    for (const t of (tasks.data ?? []) as TaskRow[]) taskBy.set(t.conversation_id, t);
    const incBy = new Map<string, IncidentRow>();
    for (const i of (incidents.data ?? []) as IncidentRow[]) incBy.set(i.conversation_id, i);
    const roleBy = new Map<string, string | null>();
    for (const p of (parts.data ?? []) as ParticipantRow[]) {
      roleBy.set(p.conversation_id, p.member_role);
    }

    return items.map((it) => {
      if (!enAlcance.has(it.conversationId)) return it;
      // El orden replica al del motor: primero tarea, y sólo si no hay, incidencia.
      const t = taskBy.get(it.conversationId);
      const i = incBy.get(it.conversationId);
      const entity: ArchiveEntityFacts = t
        ? { kind: "task", estado: t.estado, asignadoA: t.asignado_a, creadoPor: t.creado_por }
        : i
          ? {
              kind: "incident", estado: i.estado,
              reportadoPor: i.reportado_por, asignadoA: i.asignado_a,
            }
          : null;
      const facts: ArchiveFacts = {
        isAdmin, isTaskAdmin, isIncidentAdmin, isDepotManager,
        profileId: user.id,
        memberRole: roleBy.get(it.conversationId) ?? null,
        entity,
      };
      const verdict = evaluateArchiveCapability(facts);
      return verdict.can
        ? { ...it, canArchive: true, archiveBlockedMessage: null }
        : { ...it, canArchive: false, archiveBlockedMessage: verdict.message };
    });
  } catch {
    // Nunca se rompe la bandeja por el gate preventivo: se cae al comportamiento previo.
    return items;
  }
}
