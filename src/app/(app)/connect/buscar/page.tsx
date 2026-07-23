// Nexus Link · RC1.4 Búsqueda Global (página). Server Component: lee `q` de searchParams,
// llama searchConnect(q, 40) y renderiza resultados AGRUPADOS por resultType en el orden
// D-RC1.4-4 (conversación · contexto ERP · mensaje · adjunto). El layout /connect ya gatea
// connect.view, así que aquí NO se re-gatean permisos.

import Link from "next/link";
import { Icon, type IconName } from "@/components/Icon";
import { EmptyState } from "@/components/ui/EmptyState";
import { searchConnect, type SearchResult, type SearchResultType } from "@/lib/connect/read/search-data";
import { relTime } from "@/lib/utils";
import { GlobalSearch } from "../_components/GlobalSearch";

export const dynamic = "force-dynamic";
export const metadata = { title: "Nexus Link · Búsqueda global" };

// Orden D-RC1.4-4 + metadatos de presentación por tipo de resultado.
const GROUPS: Array<{ type: SearchResultType; label: string; icon: IconName }> = [
  { type: "conversation", label: "Conversaciones", icon: "chat" },
  { type: "erp_context", label: "Contextos ERP", icon: "database" },
  { type: "message", label: "Mensajes", icon: "chat" },
  { type: "attachment", label: "Adjuntos", icon: "paperclip" },
];

function hrefFor(r: SearchResult): string {
  if (r.resultType === "erp_context" && r.entityType && r.entityRef) {
    return `/connect/e/${encodeURIComponent(r.entityType)}/${encodeURIComponent(r.entityRef)}`;
  }
  // conversation · message · attachment · erp_context sin entidad → hilo de la conversación.
  return `/connect/c/${r.conversationId}`;
}

function ResultRow({ result, icon }: { result: SearchResult; icon: IconName }) {
  return (
    <Link
      href={hrefFor(result)}
      className="group flex items-start gap-2.5 rounded-lg border border-transparent px-3 py-2.5 transition-colors hover:border-stroke-soft hover:bg-bg-surface-alt"
    >
      <div className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-bg-surface-alt">
        <Icon name={icon} size={15} className="text-fg-secondary" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-[13px] font-semibold text-fg-primary">
            {result.title || "Sin título"}
          </span>
          {result.occurredAt && (
            <span className="shrink-0 text-[10px] text-fg-muted">{relTime(result.occurredAt)}</span>
          )}
        </div>
        {result.snippet && (
          <p className="mt-0.5 line-clamp-2 text-[12px] text-fg-secondary">{result.snippet}</p>
        )}
        <p className="mt-1 truncate font-mono text-[11px] text-fg-muted">{result.contextId}</p>
      </div>
      <Icon
        name="arrow-up-right"
        size={14}
        className="mt-1 shrink-0 text-fg-muted opacity-0 transition-opacity group-hover:opacity-100"
      />
    </Link>
  );
}

export default async function GlobalSearchPage({
  searchParams,
}: {
  searchParams: { q?: string };
}) {
  const q = (searchParams.q ?? "").trim();
  const results = q ? await searchConnect(q, 40) : [];

  const grouped = GROUPS.map((g) => ({
    ...g,
    items: results.filter((r) => r.resultType === g.type),
  })).filter((g) => g.items.length > 0);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="border-b border-stroke-soft bg-bg-surface px-5 py-4">
        <div className="mb-3 flex items-center gap-2">
          <Icon name="search" size={18} className="text-tops-red" />
          <h1 className="text-sm font-bold text-fg-primary">Búsqueda global</h1>
          {q && (
            <span className="text-[11px] text-fg-muted">
              {results.length} {results.length === 1 ? "resultado" : "resultados"}
            </span>
          )}
        </div>
        <GlobalSearch key={q} initialQuery={q} />
      </header>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        {!q ? (
          <EmptyState
            icon="search"
            title="Escribí para buscar…"
            hint="Buscá en conversaciones, contextos ERP, mensajes y adjuntos de Nexus Link."
          />
        ) : results.length === 0 ? (
          <EmptyState
            icon="search"
            title="Sin resultados"
            hint={`No encontramos nada para “${q}”. Probá con otros términos.`}
          />
        ) : (
          <div className="mx-auto w-full max-w-3xl space-y-6 px-5 py-6">
            {grouped.map((group) => (
              <section key={group.type}>
                <div className="mb-1.5 flex items-center gap-2 px-1">
                  <Icon name={group.icon} size={14} className="text-fg-muted" />
                  <h2 className="text-[11px] font-bold uppercase tracking-wide text-fg-muted">
                    {group.label}
                  </h2>
                  <span className="text-[10px] text-fg-muted">{group.items.length}</span>
                </div>
                <div className="space-y-0.5">
                  {group.items.map((result, i) => (
                    <ResultRow
                      key={`${result.resultType}-${result.conversationId}-${result.contextId}-${i}`}
                      result={result}
                      icon={group.icon}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
