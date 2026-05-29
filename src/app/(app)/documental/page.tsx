import { Icon, type IconName } from "@/components/Icon";
import { listDocs, getDocTypes, type DocType } from "@/lib/documental/data";
import { fmtDate } from "@/lib/compras/format";
import { UploadDocument } from "./UploadDocument";

export const metadata = { title: "Centro documental" };
export const dynamic = "force-dynamic";

interface PageProps {
  searchParams?: { type?: string; q?: string };
}

const TYPE_ICONS: Record<DocType, IconName> = {
  "OC PDF": "cart",
  Contrato: "file-pdf",
  Habilitación: "shield",
  Auditoría: "shield",
  Procedimiento: "file-pdf",
  Capacitación: "users",
  Factura: "wallet",
  Remito: "package",
  Otro: "file-pdf",
};

export default async function DocumentalPage({ searchParams }: PageProps) {
  const docs = await listDocs();
  const filterType = searchParams?.type as DocType | undefined;
  const q = searchParams?.q ?? "";

  const filtered = docs.filter((d) => {
    if (filterType && d.type !== filterType) return false;
    if (q) {
      const lo = q.toLowerCase();
      return (
        d.title.toLowerCase().includes(lo) ||
        (d.vendor ?? "").toLowerCase().includes(lo) ||
        (d.client ?? "").toLowerCase().includes(lo) ||
        d.tags.some((t) => t.toLowerCase().includes(lo))
      );
    }
    return true;
  });

  const types = getDocTypes();
  const typeCounts: Record<string, number> = { todos: docs.length };
  for (const t of types) typeCounts[t] = docs.filter((d) => d.type === t).length;

  return (
    <div className="p-4 md:p-7 lg:p-8 space-y-6">
      <div className="page-header">
        <div>
          <div className="eyebrow-tiny">Centro documental · {docs.length} archivos</div>
          <h1 className="page-title">Documentos corporativos</h1>
          <p className="page-subtitle">
            Contratos, OC firmadas, habilitaciones, auditorías, capacitaciones, facturas y remitos —
            todos con hash SHA-256 de integridad.
          </p>
        </div>
        <div className="flex gap-2">
          <button className="btn btn-ghost btn-sm" type="button">
            <Icon name="export" size={14} />
            <span className="hidden sm:inline">Exportar índice</span>
          </button>
        </div>
      </div>

      {/* Upload + OCR client-side */}
      <section>
        <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-fg-muted mb-3">
          Subir documento · OCR automático con GPT-4o-mini
        </div>
        <UploadDocument />
      </section>

      {/* Filter pills */}
      <div className="flex overflow-x-auto -mx-1 gap-1 p-1 bg-white border border-stroke-soft rounded-lg w-fit max-w-full">
        <FilterChip label="Todos" count={typeCounts.todos} active={!filterType} href="/documental" />
        {types.map((t) => (
          <FilterChip
            key={t}
            label={t}
            count={typeCounts[t]}
            active={filterType === t}
            href={`/documental?type=${encodeURIComponent(t)}`}
          />
        ))}
      </div>

      {/* Search */}
      <form className="card p-3 md:p-4 flex flex-col md:flex-row gap-3" action="/documental">
        {filterType && <input type="hidden" name="type" value={filterType} />}
        <div className="relative flex-1 min-w-0">
          <Icon
            name="search"
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted"
          />
          <input
            name="q"
            type="search"
            defaultValue={q}
            placeholder="Buscar por título, cliente, proveedor, tag…"
            className="input pl-9"
          />
        </div>
        <button type="submit" className="btn btn-primary btn-sm">
          Buscar
        </button>
      </form>

      {/* Table */}
      <div className="card overflow-hidden">
        <div className="hidden md:block overflow-x-auto">
          <table className="tbl">
            <thead>
              <tr>
                <th>Documento</th>
                <th>Tipo</th>
                <th>Relación</th>
                <th>Tags</th>
                <th>Fecha</th>
                <th className="text-right">Tamaño</th>
                <th>Hash</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((d) => (
                <tr key={d.id}>
                  <td>
                    <div className="flex items-center gap-3">
                      <Icon name={TYPE_ICONS[d.type] ?? "file-pdf"} size={16} className="text-tops-red flex-shrink-0" />
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-fg-primary truncate">
                          {d.title}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <span className="text-[10px] font-bold uppercase tracking-wide text-fg-secondary px-2 py-0.5 rounded bg-neutral-100">
                      {d.type}
                    </span>
                  </td>
                  <td className="text-xs text-fg-secondary truncate max-w-[180px]">
                    {d.vendor ?? d.client ?? "—"}
                  </td>
                  <td>
                    <div className="flex gap-1 flex-wrap">
                      {d.tags.slice(0, 3).map((t) => (
                        <span
                          key={t}
                          className="text-[10px] font-bold text-fg-secondary bg-neutral-100 px-1.5 py-0.5 rounded"
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="text-xs text-fg-secondary">{fmtDate(d.uploadedAt)}</td>
                  <td className="text-right text-xs text-fg-muted tabular">{d.size}</td>
                  <td className="text-[10px] font-mono text-fg-muted">{d.hash}</td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="text-center py-10 text-fg-muted">
                    {docs.length === 0
                      ? "Sin documentos cargados aún. Usá el panel de arriba para subir el primero."
                      : "No hay documentos que coincidan con los filtros aplicados."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Mobile cards */}
        <div className="md:hidden divide-y divide-stroke-soft">
          {filtered.length === 0 && (
            <div className="p-6 text-center text-fg-muted text-sm">
              {docs.length === 0
                ? "Sin documentos cargados aún."
                : "No hay documentos que coincidan."}
            </div>
          )}
          {filtered.map((d) => (
            <div key={d.id} className="p-4 flex items-start gap-3">
              <Icon name={TYPE_ICONS[d.type] ?? "file-pdf"} size={18} className="text-tops-red mt-0.5 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-bold text-fg-primary truncate">{d.title}</div>
                <div className="text-[11px] text-fg-muted">
                  {d.type} · {fmtDate(d.uploadedAt)} · {d.size}
                </div>
                <div className="text-[10px] font-mono text-fg-muted mt-0.5 truncate">{d.hash}</div>
                <div className="flex gap-1 flex-wrap mt-1">
                  {d.tags.slice(0, 3).map((t) => (
                    <span
                      key={t}
                      className="text-[10px] font-bold text-fg-secondary bg-neutral-100 px-1.5 py-0.5 rounded"
                    >
                      {t}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="px-4 py-3 border-t border-stroke-soft bg-neutral-50 text-xs text-fg-secondary">
          Mostrando <strong className="text-fg-primary">{filtered.length}</strong> de{" "}
          <strong className="text-fg-primary">{docs.length}</strong> documentos · todos con
          integridad verificada vía SHA-256
        </div>
      </div>
    </div>
  );
}

function FilterChip({
  label,
  count,
  active,
  href,
}: {
  label: string;
  count: number;
  active: boolean;
  href: string;
}) {
  return (
    <a
      href={href}
      className={`btn btn-sm whitespace-nowrap ${
        active ? "btn-primary" : "btn-ghost border-none bg-transparent"
      }`}
    >
      {label}
      <span
        className={`text-[10px] font-bold ml-1 tabular ${
          active ? "text-white/70" : "text-fg-muted"
        }`}
      >
        {count}
      </span>
    </a>
  );
}
