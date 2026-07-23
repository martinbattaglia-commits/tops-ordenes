// Nexus Link · detalle de tarea (F4.3): metadata + acciones de ciclo +
// seguidores + hilo LAZY (si existe, embebe ThreadView; si no, botón para
// iniciarlo). Gate connect.view heredado; RLS privado-por-involucrados (0168).

import Link from "next/link";
import { Icon } from "@/components/Icon";
import { getTask, hasTaskAdmin, listTaskFollowers } from "@/lib/connect/read/tasks-data";
import { getIncident } from "@/lib/connect/read/incidents-data";
import { getConversation, listMessages } from "@/lib/connect/read/inbox-data";
import { listParticipants } from "@/lib/connect/read/channel-data";
import { getCurrentUserId } from "@/lib/connect/data";
import { isOverdue } from "@/lib/connect/domain/task";
import { timeAgo } from "@/lib/connect/format";
import { ThreadView } from "../../_components/ThreadView";
import { TaskActions } from "../../_components/TaskActions";
import { OverdueChip, TaskPriorityChip, TaskStatusChip } from "../../_components/TaskChips";

export const dynamic = "force-dynamic";
export const metadata = { title: "Nexus Link · Tarea" };

export default async function TaskDetailPage({
  params,
}: {
  params: { taskId: string };
}) {
  const task = await getTask(params.taskId);

  if (!task) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
        <Icon name="x" size={22} className="text-fg-muted" />
        <p className="text-sm text-fg-muted">La tarea no existe o no tenés acceso.</p>
        <Link href="/connect/tareas" className="btn btn-ghost btn-sm">Volver a tareas</Link>
      </div>
    );
  }

  const [followers, currentUserId, isTaskAdmin, incident] = await Promise.all([
    listTaskFollowers(task.id),
    getCurrentUserId(),
    hasTaskAdmin(),
    task.incidentId ? getIncident(task.incidentId) : Promise.resolve(null),
  ]);

  const [conversation, messages, participants] = task.conversationId
    ? await Promise.all([
        getConversation(task.conversationId),
        listMessages(task.conversationId),
        listParticipants(task.conversationId),
      ])
    : [null, [], []];
  const mentionables = participants
    .filter((m) => m.profileId && m.name)
    .map((m) => ({ profileId: m.profileId as string, name: m.name as string }));

  const isFollower = currentUserId != null && followers.some((f) => f.profileId === currentUserId);
  const terminal = task.estado === "completada" || task.estado === "cancelada";
  const nowIso = new Date().toISOString();

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <header className="border-b border-stroke-soft bg-bg-surface px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Link href="/connect/tareas" className="btn btn-ghost btn-sm" aria-label="Volver a tareas">
                <Icon name="arrow-left" size={14} />
              </Link>
              <span className="font-mono text-[11px] text-fg-link">{task.publicId}</span>
              <TaskPriorityChip prioridad={task.prioridad} />
              <TaskStatusChip estado={task.estado} />
              {isOverdue(task, nowIso) && <OverdueChip />}
              {task.workflowInstanceId && (
                <span className="chip text-[10px]">Workflow · paso {task.stepNo}</span>
              )}
            </div>
            <h1 className="mt-1 truncate text-sm font-bold text-fg-primary">{task.titulo}</h1>
            {task.descripcion && (
              <p className="mt-1 max-w-2xl whitespace-pre-wrap text-xs text-fg-muted">{task.descripcion}</p>
            )}
          </div>
          <div className="shrink-0 text-right text-[11px] text-fg-muted">
            <p>Creada {timeAgo(task.createdAt)}{task.creadoPorName ? ` por ${task.creadoPorName}` : ""}</p>
            <p className="mt-0.5">
              {task.asignadoA
                ? `Responsable: ${task.asignadoAName ?? "usuario interno"}`
                : "Vacante — reclamable"}
            </p>
            {task.dueAt && (
              <p className="mt-0.5">
                <Icon name="calendar" size={10} className="inline" /> Vence:{" "}
                {new Date(task.dueAt).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" })}
              </p>
            )}
          </div>
        </div>

        {incident && (
          <p className="mt-2 text-[11px]">
            <Link href={`/connect/incidentes/${incident.id}`} className="text-fg-link hover:underline">
              <Icon name="bolt" size={11} className="inline" /> Origen: incidente {incident.publicId} — {incident.titulo}
            </Link>
          </p>
        )}

        {task.estado === "cancelada" && task.cancelReason && (
          <div className="mt-2 rounded-md bg-slate-400/10 px-3 py-2 text-xs text-fg-muted">
            <span className="font-semibold">Cancelada:</span> {task.cancelReason}
          </div>
        )}

        {followers.length > 0 && (
          <p className="mt-2 text-[11px] text-fg-muted">
            <Icon name="star" size={10} className="inline" /> Seguidores:{" "}
            {followers.map((f) => f.name ?? "usuario interno").join(", ")}
          </p>
        )}

        <div className="mt-3">
          <TaskActions
            task={task}
            currentUserId={currentUserId}
            isTaskAdmin={isTaskAdmin}
            isFollower={isFollower}
            hasThread={!!task.conversationId}
          />
        </div>
      </header>

      {conversation ? (
        <ThreadView
          conversationId={conversation.id}
          initialMessages={messages}
          currentUserId={currentUserId}
          readOnly={terminal || !!conversation.archivedAt}
          mentionables={mentionables}
        />
      ) : (
        <div className="flex flex-1 items-center justify-center p-8 text-center text-xs text-fg-muted">
          Esta tarea todavía no tiene conversación. Usá &quot;Iniciar conversación&quot; para
          comentar o adjuntar fotos.
        </div>
      )}
    </div>
  );
}
