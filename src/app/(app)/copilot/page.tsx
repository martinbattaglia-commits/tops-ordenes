// F5.2-lite · Nexus Copilot — página del piloto (read-only).
// Server component: el gate (kill-switch + ai_pilot_users) se evalúa acá y
// se RE-evalúa en cada server action (la página es solo la primera puerta).

import { EmptyState } from "@/components/ui/EmptyState";
import { checkGate } from "@/lib/ai/gate";
import { CopilotChat } from "./CopilotChat";

export const dynamic = "force-dynamic";
export const metadata = { title: "Nexus Copilot" };

export default async function CopilotPage() {
  const gate = await checkGate();

  if (!gate.ok) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <EmptyState
          icon="inbox"
          title={
            gate.outcome === "killed"
              ? "Copilot desactivado"
              : "Copilot en piloto cerrado"
          }
          hint={gate.message}
        />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <header className="border-b border-stroke-soft bg-bg-surface px-4 py-3">
        <h1 className="text-sm font-bold text-fg-primary">Nexus Copilot</h1>
        <p className="mt-0.5 text-[11px] text-fg-muted">
          Asistente read-only sobre datos de Nexus · piloto F5.2 · las
          respuestas citan sus fuentes — verificalas antes de decidir.
        </p>
      </header>
      <CopilotChat demo={gate.demo} />
    </div>
  );
}
