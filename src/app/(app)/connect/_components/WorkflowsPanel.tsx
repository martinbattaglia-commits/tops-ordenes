"use client";

// Nexus Link · panel de workflows lineales (F4.3, D-F43-6): catálogo por seed,
// instanciable con un click. Sin builder/edición (fuera de alcance).

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";
import { instantiateWorkflowAction } from "@/lib/connect/adapters/driving/task-actions";
import type { WorkflowTemplate } from "@/lib/connect/types";

export function WorkflowsPanel({ templates }: { templates: WorkflowTemplate[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function start(t: WorkflowTemplate) {
    if (busy) return;
    setError(null);
    setBusy(t.id);
    try {
      const r = await instantiateWorkflowAction({ templateId: t.id });
      if (!r.ok) {
        setError(r.message);
        return;
      }
      router.push(`/connect/tareas/${r.taskId}`);
      router.refresh();
    } catch {
      setError("No se pudo iniciar el workflow. Reintentá.");
    } finally {
      setBusy(null);
    }
  }

  if (templates.length === 0) return null;

  return (
    <div className="card space-y-2 p-3">
      <p className="text-[11px] font-bold uppercase tracking-wide text-fg-muted">
        Workflows entre áreas
      </p>
      <ul className="space-y-2">
        {templates.map((t) => (
          <li key={t.id} className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-xs font-semibold text-fg-primary">{t.nombre}</p>
              <p className="truncate text-[11px] text-fg-muted">
                {t.steps.map((s) => s.titulo).join(" → ")}
              </p>
            </div>
            <button type="button" className="btn btn-ghost btn-sm" disabled={busy != null}
              onClick={() => void start(t)}>
              <Icon name="play" size={13} /> {busy === t.id ? "Iniciando…" : "Iniciar"}
            </button>
          </li>
        ))}
      </ul>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}
