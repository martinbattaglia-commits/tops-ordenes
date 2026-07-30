// LINK-WA-002 · Bandeja de sugerencias de IA (revisión humana).
// Gate FAIL-CLOSED: sólo rol admin; las server actions re-validan siempre.
// La IA sólo PROPONE. Aceptar deja constancia — no crea ninguna entidad.
//
// El provider, el modelo y los topes se LEEN del entorno del servidor en cada
// request y se pasan al cliente como un objeto cerrado. Antes eran texto fijo
// («provider mock, costo cero»), de modo que el Draft con Gemini seguía
// anunciando mock: el operador no podía distinguir una corrida real de una
// simulada. Un texto no atado al dato miente en silencio.

import { getProfileRole } from "@/lib/rbac/boot-permissions";
import { AccesoRestringido } from "@/components/shell/AccesoRestringido";
import { listSuggestions, listRuns, listWhatsappThreads } from "@/lib/ai/wa-analysis/read";
import { getAiRuntimeStatus } from "@/lib/ai/runtime-status";
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
  // Estado EFECTIVO del entorno. Cinco campos públicos + topes; cero secretos.
  const ai = getAiRuntimeStatus();

  return (
    <div className="mx-auto w-full max-w-4xl overflow-y-auto px-5 py-6">
      <div className="eyebrow-tiny">Nexus Link · LINK-WA-002</div>
      <h1 className="page-title">Sugerencias de IA</h1>
      <p className="page-subtitle">
        La IA analiza conversaciones históricas y <strong>propone</strong>. Nada se crea ni se
        modifica sin tu confirmación: aceptar una sugerencia deja constancia sin ejecutar
        ninguna acción.
      </p>
      <div className="mt-4">
        <SuggestionsInbox suggestions={suggestions} runs={runs} threads={threads} ai={ai} />
      </div>
    </div>
  );
}
