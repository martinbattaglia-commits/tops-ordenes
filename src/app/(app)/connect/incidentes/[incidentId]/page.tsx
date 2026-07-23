// Nexus Link · detalle de incidente (F4.2): metadata + acciones de ciclo + hilo
// (motor de chat existente: comentarios/fotos = connect_messages/attachments).
// Gate connect.view heredado del layout; RLS de connect_incidents filtra por
// membresía del hilo (0164); las acciones re-validan en el RPC (0165).

import Link from "next/link";
import { Icon } from "@/components/Icon";
import { getIncident, hasIncidentAdmin } from "@/lib/connect/read/incidents-data";
import { getConversation, listMessages } from "@/lib/connect/read/inbox-data";
import { listParticipants } from "@/lib/connect/read/channel-data";
import { getCurrentUserId } from "@/lib/connect/data";
import { listTasks } from "@/lib/connect/read/tasks-data";
import { timeAgo, timeHM } from "@/lib/connect/format";
import { ThreadView } from "../../_components/ThreadView";
import { IncidentActions } from "../../_components/IncidentActions";
import { SeverityChip, StatusChip } from "../../_components/IncidentChips";
import { TaskStatusChip } from "../../_components/TaskChips";

export const dynamic = "force-dynamic";
export const metadata = { title: "Nexus Link · Incidente" };

export default async function IncidentDetailPage({
  params,
}: {
  params: { incidentId: string };
}) {
  const incident = await getIncident(params.incidentId);

  if (!incident) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
        <Icon name="x" size={22} className="text-fg-muted" />
        <p className="text-sm text-fg-muted">El incidente no existe o no tenés acceso.</p>
        <Link href="/connect/incidentes" className="btn btn-ghost btn-sm">Volver a incidentes</Link>
      </div>
    );
  }

  // hasIncidentAdmin: espejo FAIL-CLOSED del permiso real (no canAccess, que es
  // fail-open con RBAC dormido) — el RPC re-valida cada acción igual.
  const [conversation, messages, participants, currentUserId, isIncidentAdmin, linkedTasks] = await Promise.all([
    getConversation(incident.conversationId),
    listMessages(incident.conversationId),
    listParticipants(incident.conversationId),
    getCurrentUserId(),
    hasIncidentAdmin(),
    // F4.3: tareas originadas en este incidente (RLS de tareas aplica).
    listTasks({ vista: "todas", incidentId: incident.id }),
  ]);
  const mentionables = participants
    .filter((m) => m.profileId && m.name)
    .map((m) => ({ profileId: m.profileId as string, name: m.name as string }));

  const closed = incident.estado === "cerrado";

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <header className="border-b border-stroke-soft bg-bg-surface px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Link href="/connect/incidentes" className="btn btn-ghost btn-sm" aria-label="Volver a incidentes">
                <Icon name="arrow-left" size={14} />
              </Link>
              <span className="font-mono text-[11px] text-fg-link">{incident.publicId}</span>
              <SeverityChip severidad={incident.severidad} />
              <StatusChip estado={incident.estado} />
            </div>
            <h1 className="mt-1 truncate text-sm font-bold text-fg-primary">{incident.titulo}</h1>
            <p className="mt-0.5 text-[11px] text-fg-muted">
              {[
                incident.sector ? `Sector ${incident.sector}` : null,
                incident.ubicacion,
                incident.tipoAveria,
              ].filter(Boolean).join(" · ") || "Sin ubicación declarada"}
            </p>
          </div>
          <div className="shrink-0 text-right text-[11px] text-fg-muted">
            <p>Reportado {timeAgo(incident.createdAt)}{incident.reportadoPorName ? ` por ${incident.reportadoPorName}` : ""}</p>
            <p className="mt-0.5">
              {incident.asignadoA
                ? `Asignado a ${incident.asignadoAName ?? "usuario interno"}`
                : "Sin asignar"}
            </p>
            {incident.slaDueAt && (
              <p className="mt-0.5">
                <Icon name="clock" size={10} className="inline" /> SLA informativo: {timeHM(incident.slaDueAt)}
              </p>
            )}
          </div>
        </div>

        {incident.resolucionText && (
          <div className="mt-2 rounded-md bg-emerald-400/10 px-3 py-2 text-xs text-emerald-400">
            <span className="font-semibold">Resolución:</span> {incident.resolucionText}
          </div>
        )}

        {/* F4.3 · relación incidente→tarea (unidireccional, ADR-F4-3 §19 del plan) */}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {!closed && (
            <Link href={`/connect/tareas/nueva?incidente=${incident.id}`} className="btn btn-ghost btn-sm">
              <Icon name="plus" size={13} /> Crear tarea
            </Link>
          )}
          {linkedTasks.map((t) => (
            <Link key={t.id} href={`/connect/tareas/${t.id}`}
              className="flex items-center gap-1.5 text-[11px] text-fg-link hover:underline">
              <span className="font-mono">{t.publicId}</span>
              <TaskStatusChip estado={t.estado} />
            </Link>
          ))}
        </div>

        <div className="mt-3">
          <IncidentActions
            incident={incident}
            currentUserId={currentUserId}
            isIncidentAdmin={isIncidentAdmin}
          />
        </div>
      </header>

      {conversation ? (
        <ThreadView
          conversationId={conversation.id}
          initialMessages={messages}
          currentUserId={currentUserId}
          readOnly={closed || !!conversation.archivedAt}
          mentionables={mentionables}
        />
      ) : (
        <div className="flex flex-1 items-center justify-center p-8 text-center text-xs text-fg-muted">
          El hilo del incidente no está disponible.
        </div>
      )}
    </div>
  );
}
