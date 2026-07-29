// LINK-WA-002 · FASE 2 E1 — Bandeja de sugerencias de IA (revisión humana).
// Gate FAIL-CLOSED: sólo rol admin; las server actions re-validan siempre.
// E1: la IA sólo PROPONE. Aceptar deja constancia — no crea ninguna entidad.

import { getProfileRole } from "@/lib/rbac/boot-permissions";
import { AccesoRestringido } from "@/components/shell/AccesoRestringido";
import { listSuggestions, listRuns, listWhatsappThreads } from "@/lib/ai/wa-analysis/read";
import { SuggestionsInbox } from "../_components/SuggestionsInbox";

export const dynamic = "force-dynamic";
export const metadata = { title: "Nexus Link · Sugerencias de IA" };

export default async function IaSuggestionsPage() {
  const role = await getProfileRole();
  if (role !== "admin") {
    return <AccesoRestringido modulo="Sugerencias de IA" />;
  }
  const [suggestions, runs, threads] = await Promise.all([
    listSuggestions(),
    listRuns(),
    listWhatsappThreads(),
  ]);

  return (
    <div className="mx-auto w-full max-w-4xl overflow-y-auto px-5 py-6">
      <div className="eyebrow-tiny">Nexus Link · LINK-WA-002 · Fase 2 · E1</div>
      <h1 className="page-title">Sugerencias de IA</h1>
      <p className="page-subtitle">
        La IA analiza conversaciones históricas y <strong>propone</strong>. Nada se crea ni se
        modifica sin tu confirmación. En esta etapa el análisis corre con provider
        <strong> mock</strong> (determinista, costo cero) y aceptar una sugerencia deja
        constancia sin ejecutar ninguna acción.
      </p>
      <div className="mt-4">
        <SuggestionsInbox suggestions={suggestions} runs={runs} threads={threads} />
      </div>
    </div>
  );
}
