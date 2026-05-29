import Link from "next/link";
import { Icon } from "@/components/Icon";
import { getContactsPage, clientifyConfigured } from "@/lib/clientify/data";
import { truncate } from "@/lib/compras/format";

export const metadata = { title: "Contactos · Clientify" };
export const dynamic = "force-dynamic";
export const revalidate = 0;

interface PageProps {
  searchParams?: { page?: string; q?: string };
}

export default async function ContactosPage({ searchParams }: PageProps) {
  if (!clientifyConfigured()) {
    return (
      <div className="p-8">
        <div className="card p-8 max-w-2xl mx-auto">
          <Icon name="bolt" size={32} className="text-status-warning mb-3" />
          <h1 className="text-xl font-bold text-fg-brand mb-2">Clientify no configurado</h1>
          <p className="text-sm text-fg-secondary">
            Configurá <code className="font-mono text-xs bg-neutral-100 px-1.5 py-0.5 rounded">CLIENTIFY_API_KEY</code> en{" "}
            <code className="font-mono text-xs bg-neutral-100 px-1.5 py-0.5 rounded">.env.local</code>.
          </p>
        </div>
      </div>
    );
  }

  const page = Math.max(1, parseInt(searchParams?.page ?? "1", 10) || 1);
  const q = searchParams?.q ?? "";
  const pageSize = 30;

  let result;
  try {
    result = await getContactsPage({ page, pageSize, search: q });
  } catch (e) {
    return (
      <div className="p-8">
        <div className="card p-8 border-tops-red/40 bg-tops-red/5">
          <Icon name="x" size={28} className="text-tops-red mb-2" />
          <h1 className="text-lg font-bold text-tops-red mb-2">Error consultando Clientify</h1>
          <pre className="text-xs font-mono text-fg-secondary whitespace-pre-wrap break-all">
            {e instanceof Error ? e.message : String(e)}
          </pre>
        </div>
      </div>
    );
  }

  const { contacts, total, hasNext } = result;
  const totalPages = Math.ceil(total / pageSize);
  const buildHref = (patch: Record<string, string>) => {
    const sp = new URLSearchParams();
    if (q) sp.set("q", q);
    sp.set("page", String(page));
    for (const [k, v] of Object.entries(patch)) sp.set(k, v);
    return `/comercial/contactos?${sp.toString()}`;
  };

  return (
    <div className="p-4 md:p-7 lg:p-8 space-y-6">
      <div className="page-header">
        <div>
          <div className="eyebrow-tiny">Clientify CRM · live sync · {total.toLocaleString("es-AR")} contactos</div>
          <h1 className="page-title">Contactos comerciales</h1>
          <p className="page-subtitle">
            Maestro completo de contactos sincronizado con Clientify CRM. Búsqueda full-text · sync bidireccional.
          </p>
        </div>
        <div className="flex gap-2">
          <a
            href="https://app.clientify.com/contacts/"
            target="_blank"
            rel="noopener"
            className="btn btn-primary btn-sm"
          >
            <Icon name="arrow-up-right" size={14} />
            <span className="hidden sm:inline">Abrir en Clientify</span>
          </a>
        </div>
      </div>

      {/* Search */}
      <form className="card p-3 md:p-4 flex flex-col md:flex-row gap-3" action="/comercial/contactos">
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
            placeholder="Buscar por nombre, email, teléfono…"
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
                <th>Contacto</th>
                <th>Empresa</th>
                <th>Email</th>
                <th>Teléfono</th>
                <th>Estado</th>
                <th>Owner</th>
                <th>Canal</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {contacts.map((c) => (
                <tr key={c.id}>
                  <td>
                    <div className="flex items-center gap-3">
                      {c.pictureUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={c.pictureUrl}
                          alt={c.name}
                          className="w-8 h-8 rounded-full object-cover flex-shrink-0"
                        />
                      ) : (
                        <div className="w-8 h-8 rounded-full bg-tops-blue-700 text-white grid place-items-center font-bold text-xs flex-shrink-0">
                          {c.name.charAt(0).toUpperCase()}
                        </div>
                      )}
                      <div className="min-w-0">
                        <div className="text-sm font-bold text-fg-primary truncate">{c.name}</div>
                        {c.taxId && <div className="text-[11px] text-fg-muted font-mono">{c.taxId}</div>}
                      </div>
                    </div>
                  </td>
                  <td className="text-xs text-fg-secondary truncate max-w-[160px]">
                    {c.companyUrl ? "Vinculada" : "—"}
                  </td>
                  <td className="text-xs">
                    {c.email ? (
                      <a href={`mailto:${c.email}`} className="text-fg-link hover:underline">
                        {truncate(c.email, 28)}
                      </a>
                    ) : (
                      <span className="text-fg-muted">—</span>
                    )}
                  </td>
                  <td className="text-xs font-mono text-fg-secondary">{c.phone ?? "—"}</td>
                  <td>
                    <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded bg-neutral-100 text-fg-secondary">
                      {c.status}
                    </span>
                  </td>
                  <td className="text-xs text-fg-secondary truncate max-w-[140px]">
                    {c.ownerName ?? "—"}
                  </td>
                  <td className="text-[10px] text-fg-muted uppercase tracking-wide font-mono">
                    {c.channel}
                  </td>
                  <td>
                    <a
                      href={c.href}
                      target="_blank"
                      rel="noopener"
                      className="text-fg-muted hover:text-fg-primary"
                      aria-label="Abrir en Clientify"
                    >
                      <Icon name="arrow-up-right" size={14} />
                    </a>
                  </td>
                </tr>
              ))}
              {contacts.length === 0 && (
                <tr>
                  <td colSpan={8} className="text-center py-10 text-fg-muted">
                    No hay contactos que coincidan con la búsqueda.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Mobile cards */}
        <div className="md:hidden divide-y divide-stroke-soft">
          {contacts.map((c) => (
            <div key={c.id} className="p-4 flex items-start gap-3">
              {c.pictureUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={c.pictureUrl}
                  alt={c.name}
                  className="w-10 h-10 rounded-full object-cover flex-shrink-0"
                />
              ) : (
                <div className="w-10 h-10 rounded-full bg-tops-blue-700 text-white grid place-items-center font-bold flex-shrink-0">
                  {c.name.charAt(0).toUpperCase()}
                </div>
              )}
              <div className="flex-1 min-w-0">
                <div className="text-sm font-bold text-fg-primary truncate">{c.name}</div>
                {c.email && (
                  <div className="text-xs text-fg-link truncate">{c.email}</div>
                )}
                {c.phone && (
                  <div className="text-xs text-fg-muted font-mono">{c.phone}</div>
                )}
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-neutral-100 text-fg-secondary">
                    {c.status}
                  </span>
                  <span className="text-[10px] text-fg-muted">{c.ownerName ?? "—"}</span>
                </div>
              </div>
              <a
                href={c.href}
                target="_blank"
                rel="noopener"
                className="text-fg-muted hover:text-fg-primary p-1"
                aria-label="Abrir en Clientify"
              >
                <Icon name="arrow-up-right" size={14} />
              </a>
            </div>
          ))}
        </div>

        {/* Pagination */}
        <div className="px-4 py-3 border-t border-stroke-soft bg-neutral-50 flex items-center justify-between text-xs">
          <div className="text-fg-secondary">
            Mostrando {contacts.length === 0 ? 0 : (page - 1) * pageSize + 1}–
            {(page - 1) * pageSize + contacts.length} de{" "}
            <strong className="text-fg-primary">{total.toLocaleString("es-AR")}</strong> contactos · página{" "}
            <strong className="text-fg-primary">{page}</strong> de {totalPages}
          </div>
          <div className="flex gap-1">
            {page > 1 && (
              <Link href={buildHref({ page: String(page - 1) })} className="btn btn-ghost btn-sm">
                <Icon name="arrow-left" size={12} />
              </Link>
            )}
            <span className="btn btn-primary btn-sm pointer-events-none">{page}</span>
            {hasNext && (
              <Link href={buildHref({ page: String(page + 1) })} className="btn btn-ghost btn-sm">
                <Icon name="arrow-right" size={12} />
              </Link>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
