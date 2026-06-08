import Link from "next/link";
import { Icon } from "@/components/Icon";
import { getPipelineSnapshot, clientifyConfigured } from "@/lib/clientify/data";
import { fmtDate, truncate } from "@/lib/compras/format";

export const metadata = { title: "Pipeline comercial · Clientify" };
export const dynamic = "force-dynamic";
export const revalidate = 0;

interface PageProps {
  searchParams?: { pipeline?: string };
}

const STAGE_PALETTE = ["#8A94A6", "#214576", "#3a6db0", "#050555", "#B45309", "#0E7C3A"];

function fmtArs(n: number): string {
  return `$ ${Math.round(n).toLocaleString("es-AR")}`;
}
function fmtArsShort(n: number): string {
  if (n >= 1e6) return `$ ${(n / 1e6).toFixed(1).replace(".", ",")} M`;
  if (n >= 1e3) return `$ ${Math.round(n / 1e3)} K`;
  return `$ ${Math.round(n)}`;
}

export default async function PipelinePage({ searchParams }: PageProps) {
  if (!clientifyConfigured()) {
    return <NotConfigured />;
  }

  let snapshot;
  try {
    const pipelineId = searchParams?.pipeline ? parseInt(searchParams.pipeline, 10) : undefined;
    snapshot = await getPipelineSnapshot(pipelineId);
  } catch (e) {
    return <ApiError error={e instanceof Error ? e.message : String(e)} />;
  }

  const { pipelines, active, dealsByStage, openDeals, wonYtd, pipelineTotal, openCount, topDeals, pipelineCounts } =
    snapshot;

  return (
    <div className="p-4 md:p-7 lg:p-8 space-y-6">
      <div className="page-header">
        <div>
          <div className="eyebrow-tiny">Clientify CRM · live sync · Logística TOPS</div>
          <h1 className="page-title">Pipeline comercial</h1>
          <p className="page-subtitle">
            {pipelines.length} pipelines · {openCount} oportunidades abiertas ·{" "}
            <span className="font-bold tabular text-fg-brand">{fmtArs(pipelineTotal)}</span> en
            negociación · <span className="font-bold tabular text-status-success">{fmtArs(wonYtd)}</span>{" "}
            ganado YTD
          </p>
        </div>
        <div className="flex gap-2">
          <span className="btn btn-ghost btn-sm pointer-events-none">
            <span className="w-1.5 h-1.5 rounded-full bg-status-success animate-pulse" />
            <span className="hidden sm:inline">Clientify conectado</span>
          </span>
          <a
            href="https://new.clientify.com/"
            target="_blank"
            rel="noopener"
            className="btn btn-primary btn-sm"
          >
            <Icon name="arrow-up-right" size={14} />
            <span className="hidden sm:inline">Abrir en Clientify</span>
          </a>
        </div>
      </div>

      {/* Pipeline switcher */}
      {pipelines.length > 1 && (
        <div className="flex overflow-x-auto gap-1 p-1 bg-bg-surface border border-stroke-soft rounded-lg w-fit max-w-full">
          {pipelines.map((p) => (
            <Link
              key={p.id}
              href={`/comercial/pipeline?pipeline=${p.id}`}
              className={`btn btn-sm whitespace-nowrap ${
                active?.id === p.id ? "btn-primary" : "btn-ghost border-none bg-transparent"
              }`}
            >
              {p.name}
              <span
                className={`text-[10px] font-bold ml-1 ${
                  active?.id === p.id ? "text-white/70" : "text-fg-muted"
                }`}
              >
                {pipelineCounts[p.id] ?? 0}
              </span>
            </Link>
          ))}
        </div>
      )}

      {active ? (
        <>
          {/* Kanban stages */}
          <div
            className="grid gap-3"
            style={{
              gridTemplateColumns: `repeat(${Math.max(2, Math.min(active.stages.length, 6))}, minmax(220px, 1fr))`,
              overflowX: "auto",
            }}
          >
            {active.stages
              .sort((a, b) => a.position - b.position)
              .map((stage, i) => {
                const deals = dealsByStage.get(stage.id) ?? [];
                const total = deals.reduce((a, d) => a + d.amount, 0);
                const color = STAGE_PALETTE[i % STAGE_PALETTE.length];
                return (
                  <div key={stage.id} className="card overflow-hidden flex flex-col">
                    <div className="px-4 py-3 border-b border-stroke-soft" style={{ borderTopColor: color, borderTopWidth: 3 }}>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="w-2 h-2 rounded-full" style={{ background: color }} />
                        <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-fg-secondary">
                          {stage.name}
                        </span>
                      </div>
                      <div className="flex items-end justify-between">
                        <span className="text-2xl font-bold tabular text-fg-brand leading-none">
                          {deals.length}
                        </span>
                        <span className="text-[11px] tabular text-fg-muted">{fmtArsShort(total)}</span>
                      </div>
                    </div>
                    <div className="flex-1 divide-y divide-stroke-soft overflow-y-auto max-h-[480px]">
                      {deals.slice(0, 12).map((d) => (
                        <a
                          key={d.id}
                          href={d.href}
                          target="_blank"
                          rel="noopener"
                          title="Abrir oportunidad en Clientify"
                          className="block px-3 py-2 hover:bg-neutral-50 transition-colors cursor-pointer"
                        >
                          <div className="text-[12px] font-bold text-fg-primary truncate">
                            {truncate(d.title, 32)}
                          </div>
                          {d.contactName && (
                            <div className="text-[10px] text-fg-muted truncate">{d.contactName}</div>
                          )}
                          <div className="flex items-center justify-between mt-1">
                            <span className="text-[11px] tabular font-bold text-fg-brand">
                              {fmtArsShort(d.amount)}
                            </span>
                            <span className="text-[9px] font-mono text-fg-muted">
                              {d.probabilityLabel}
                            </span>
                          </div>
                        </a>
                      ))}
                      {deals.length > 12 && (
                        <div className="px-3 py-1.5 text-[10px] text-fg-muted text-center">
                          +{deals.length - 12} más
                        </div>
                      )}
                      {deals.length === 0 && (
                        <div className="px-3 py-6 text-[11px] text-fg-muted text-center">
                          Sin deals en esta etapa
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
          </div>

          {/* Top deals table */}
          <div className="card overflow-hidden">
            <div className="px-5 py-4 border-b border-stroke-soft flex items-center justify-between">
              <div>
                <div className="text-sm font-bold text-fg-primary">Top oportunidades abiertas</div>
                <div className="text-[11px] text-fg-secondary mt-0.5">Pipeline {active.name} · ordenadas por monto</div>
              </div>
              <span className="text-[11px] text-fg-muted">
                {openCount} totales · {fmtArs(pipelineTotal)}
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Oportunidad</th>
                    <th>Contacto</th>
                    <th>Empresa</th>
                    <th className="text-right">Monto</th>
                    <th>Etapa</th>
                    <th>Owner</th>
                    <th>Cierre</th>
                  </tr>
                </thead>
                <tbody>
                  {topDeals.map((d) => (
                    <tr key={d.id}>
                      <td className="text-sm font-bold text-fg-primary truncate max-w-[260px]">
                        <a
                          href={d.href}
                          target="_blank"
                          rel="noopener"
                          title="Abrir oportunidad en Clientify"
                          className="hover:text-fg-link hover:underline cursor-pointer"
                        >
                          {d.title}
                        </a>
                      </td>
                      <td className="text-sm">{d.contactName ?? "—"}</td>
                      <td className="text-xs text-fg-secondary">{d.companyName ?? "—"}</td>
                      <td className="text-right tabular font-bold text-fg-brand">
                        {fmtArs(d.amount)}
                      </td>
                      <td>
                        <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded bg-tops-blue-700/10 text-tops-blue-700">
                          {d.stage}
                        </span>
                      </td>
                      <td className="text-xs text-fg-secondary">{d.ownerName ?? "—"}</td>
                      <td className="text-xs text-fg-muted tabular">
                        {d.expectedClose ? fmtDate(d.expectedClose) : "—"}
                      </td>
                    </tr>
                  ))}
                  {topDeals.length === 0 && (
                    <tr>
                      <td colSpan={7} className="text-center py-10 text-fg-muted">
                        No hay deals abiertos en este pipeline.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="px-5 py-3 border-t border-stroke-soft bg-neutral-50 text-[11px] text-fg-muted flex items-center justify-between">
              <span>
                Datos sincronizados desde <strong className="text-fg-primary">Clientify CRM</strong> ·{" "}
                <span className="font-mono">{openDeals.length} deals abiertos cargados</span>
              </span>
              <a
                href="/api/clientify/ping"
                className="text-fg-link hover:underline font-semibold"
                target="_blank"
                rel="noopener"
              >
                Estado de sync →
              </a>
            </div>
          </div>
        </>
      ) : (
        <div className="card p-10 text-center text-fg-muted">No hay pipelines configurados en Clientify.</div>
      )}
    </div>
  );
}

function NotConfigured() {
  return (
    <div className="p-8">
      <div className="card p-8 max-w-2xl mx-auto">
        <Icon name="bolt" size={32} className="text-status-warning mb-3" />
        <h1 className="text-xl font-bold text-fg-brand mb-2">Clientify no configurado</h1>
        <p className="text-sm text-fg-secondary mb-4">
          Para usar el pipeline real, configurá la variable de entorno{" "}
          <code className="font-mono text-xs bg-neutral-100 px-1.5 py-0.5 rounded">CLIENTIFY_API_KEY</code> en{" "}
          <code className="font-mono text-xs bg-neutral-100 px-1.5 py-0.5 rounded">.env.local</code>.
        </p>
        <p className="text-xs text-fg-muted">
          La key se obtiene en{" "}
          <a
            href="https://new.clientify.com/settings/api"
            target="_blank"
            rel="noopener"
            className="text-fg-link font-semibold"
          >
            new.clientify.com → Settings → API
          </a>
          .
        </p>
      </div>
    </div>
  );
}

function ApiError({ error }: { error: string }) {
  return (
    <div className="p-8">
      <div className="card p-8 max-w-2xl mx-auto border-tops-red/40 bg-tops-red/5">
        <Icon name="x" size={28} className="text-tops-red mb-2" />
        <h1 className="text-lg font-bold text-tops-red mb-2">Error consultando Clientify</h1>
        <pre className="text-xs font-mono text-fg-secondary whitespace-pre-wrap break-all">
          {error}
        </pre>
      </div>
    </div>
  );
}
