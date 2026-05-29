"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Icon } from "@/components/Icon";

interface DriveEntry {
  id: string;
  name: string;
  mimeType: string;
  isFolder: boolean;
  size: number | null;
  modifiedAt: string | null;
  webViewLink: string | null;
  iconLink: string | null;
  parents: string[];
}

interface DriveBreadcrumb {
  id: string;
  name: string;
}

interface ListResponse {
  ok: boolean;
  configured: boolean;
  entries: DriveEntry[];
  breadcrumbs: DriveBreadcrumb[];
  error?: string;
  hint?: string;
  searchActive?: boolean;
}

interface Props {
  configured: boolean;
  serviceAccountEmail: string | null;
  rootFolderName: string | null;
}

/**
 * Drive TOPS browser — Finder/Notion style file navigator anclado al Google
 * Drive de la organización. Toda la auth se resuelve del lado server con
 * service account; el cliente solo ve listas y links públicos del propio Drive.
 */
export function DriveBrowser({ configured, serviceAccountEmail }: Props) {
  const [folderStack, setFolderStack] = useState<DriveBreadcrumb[]>([]);
  const [entries, setEntries] = useState<DriveEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [recent, setRecent] = useState<DriveEntry[]>([]);

  const currentFolderId = folderStack[folderStack.length - 1]?.id;

  const load = useCallback(
    async (opts: { folderId?: string; search?: string } = {}) => {
      if (!configured) return;
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        if (opts.folderId) params.set("folderId", opts.folderId);
        if (opts.search?.trim()) params.set("search", opts.search.trim());
        const res = await fetch(`/api/drive/list?${params.toString()}`, {
          cache: "no-store",
        });
        const data: ListResponse = await res.json();
        if (!res.ok || !data.ok) {
          setError(data.error || `HTTP ${res.status}`);
          setEntries([]);
          return;
        }
        setEntries(data.entries);
        if (!opts.search && data.breadcrumbs.length > 0) {
          setFolderStack(data.breadcrumbs);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Error al listar Drive");
        setEntries([]);
      } finally {
        setLoading(false);
      }
    },
    [configured]
  );

  // Carga inicial: root + recientes
  useEffect(() => {
    if (!configured) return;
    void load();
    void (async () => {
      try {
        const res = await fetch("/api/drive/list?recent=1", { cache: "no-store" });
        const data: ListResponse = await res.json();
        if (res.ok && data.ok) setRecent(data.entries);
      } catch {
        /* silencioso — recientes es opcional */
      }
    })();
  }, [configured, load]);

  // Búsqueda con debounce
  useEffect(() => {
    if (!configured) return;
    const term = search.trim();
    if (!term) {
      // si limpia búsqueda, volver al folder current
      void load({ folderId: currentFolderId });
      return;
    }
    const t = window.setTimeout(() => void load({ search: term }), 280);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, configured]);

  const openFolder = (f: DriveEntry) => {
    setSearch("");
    setFolderStack((prev) => [...prev, { id: f.id, name: f.name }]);
    void load({ folderId: f.id });
  };

  const jumpTo = (idx: number) => {
    setSearch("");
    if (idx < 0) {
      setFolderStack([]);
      void load();
      return;
    }
    const next = folderStack.slice(0, idx + 1);
    setFolderStack(next);
    void load({ folderId: next[next.length - 1]?.id });
  };

  const summary = useMemo(() => {
    const folders = entries.filter((e) => e.isFolder).length;
    const files = entries.length - folders;
    return { folders, files };
  }, [entries]);

  if (!configured) {
    return (
      <div className="p-4 md:p-7 lg:p-8">
        <div className="mb-6">
          <div className="eyebrow-tiny">Compliance · Drive corporativo</div>
          <h1 className="page-title">Drive TOPS</h1>
          <p className="page-subtitle">
            Google Drive de la organización integrado en NEXUS — habilitaciones,
            certificados, contratos y documentación regulatoria.
          </p>
        </div>
        <ConnectDriveState serviceAccountEmail={serviceAccountEmail} />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-7 lg:p-8 space-y-6">
      {/* Header */}
      <div className="page-header">
        <div>
          <div className="eyebrow-tiny">Compliance · Drive corporativo</div>
          <h1 className="page-title">Drive TOPS</h1>
          <p className="page-subtitle">
            {summary.folders} carpetas · {summary.files} archivos en este nivel
          </p>
        </div>
        <div className="flex gap-2">
          <div className="relative">
            <Icon
              name="search"
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted"
            />
            <input
              className="input pl-9 w-64"
              placeholder="Buscar en todo el Drive…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => void load({ folderId: currentFolderId })}
            type="button"
            disabled={loading}
          >
            <Icon name="refresh" size={14} className={loading ? "animate-spin" : ""} />
            <span className="hidden sm:inline">Refrescar</span>
          </button>
        </div>
      </div>

      {/* Breadcrumbs */}
      <nav className="flex flex-wrap items-center gap-1 text-xs text-fg-secondary">
        <button
          type="button"
          onClick={() => jumpTo(-1)}
          className="px-2 py-1 rounded-md hover:bg-neutral-50 font-bold text-fg-primary inline-flex items-center gap-1.5"
        >
          <Icon name="drive" size={12} />
          Drive raíz
        </button>
        {folderStack.map((b, i) => (
          <span key={b.id} className="flex items-center gap-1">
            <Icon name="chevron-right" size={12} className="text-fg-muted" />
            <button
              type="button"
              onClick={() => jumpTo(i)}
              className={`px-2 py-1 rounded-md hover:bg-neutral-50 ${
                i === folderStack.length - 1
                  ? "font-bold text-fg-primary"
                  : "text-fg-secondary"
              }`}
            >
              {b.name}
            </button>
          </span>
        ))}
      </nav>

      <div className="grid gap-6" style={{ gridTemplateColumns: "minmax(0,1.6fr) minmax(0,1fr)" }}>
        {/* Listado principal */}
        <div className="card overflow-hidden">
          <div className="px-5 py-3 border-b border-stroke-soft flex items-center justify-between">
            <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-fg-secondary">
              {search ? "Resultados de búsqueda" : "Contenido"}
            </div>
            <span className="text-[11px] text-fg-muted">
              {entries.length} {entries.length === 1 ? "ítem" : "ítems"}
            </span>
          </div>

          {error ? (
            <ErrorPanel message={error} />
          ) : loading && entries.length === 0 ? (
            <SkeletonRows />
          ) : entries.length === 0 ? (
            <EmptyState search={search} />
          ) : (
            <ul className="divide-y divide-stroke-soft">
              {entries.map((e) => (
                <EntryRow key={e.id} entry={e} onOpenFolder={openFolder} />
              ))}
            </ul>
          )}
        </div>

        {/* Sidebar derecho: recientes + service account info */}
        <aside className="space-y-4">
          <div className="card overflow-hidden">
            <div className="px-5 py-3 border-b border-stroke-soft">
              <div className="text-sm font-bold text-fg-primary">Recientes</div>
              <div className="text-[11px] text-fg-secondary mt-0.5">
                Últimos archivos modificados
              </div>
            </div>
            {recent.length === 0 ? (
              <div className="px-5 py-6 text-[11px] text-fg-muted text-center">
                Sin actividad reciente todavía
              </div>
            ) : (
              <ul className="divide-y divide-stroke-soft">
                {recent.slice(0, 8).map((e) => (
                  <li key={`r-${e.id}`} className="px-5 py-2.5">
                    <a
                      href={e.webViewLink ?? "#"}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-2 hover:opacity-80"
                    >
                      <FileMimeIcon mimeType={e.mimeType} isFolder={e.isFolder} />
                      <div className="flex-1 min-w-0">
                        <div className="text-[12px] font-bold text-fg-primary truncate">
                          {e.name}
                        </div>
                        <div className="text-[10px] text-fg-muted">
                          {e.modifiedAt ? fmtRel(e.modifiedAt) : "—"}
                        </div>
                      </div>
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="card p-4 text-[11px] text-fg-secondary space-y-1.5">
            <div className="font-bold text-fg-primary text-[12px]">
              Service Account
            </div>
            <div className="font-mono break-all text-fg-muted">
              {serviceAccountEmail ?? "—"}
            </div>
            <div className="pt-2 text-[10px] text-fg-muted">
              Para acceso de lectura/escritura, compartí carpetas de Drive con
              este email como editor.
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

function EntryRow({
  entry,
  onOpenFolder,
}: {
  entry: DriveEntry;
  onOpenFolder: (f: DriveEntry) => void;
}) {
  const isFolder = entry.isFolder;
  const Wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) =>
    isFolder ? (
      <button
        type="button"
        onClick={() => onOpenFolder(entry)}
        className="w-full text-left"
      >
        {children}
      </button>
    ) : (
      <a
        href={entry.webViewLink ?? "#"}
        target="_blank"
        rel="noreferrer"
        className="block"
      >
        {children}
      </a>
    );

  return (
    <li>
      <Wrapper>
        <div className="px-5 py-3 flex items-center gap-3 hover:bg-neutral-50 transition-colors drive-row">
          <FileMimeIcon mimeType={entry.mimeType} isFolder={isFolder} />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-bold text-fg-primary truncate">
              {entry.name}
            </div>
            <div className="text-[11px] text-fg-muted">
              {isFolder ? "Carpeta" : fmtMime(entry.mimeType)}
              {entry.size !== null && ` · ${fmtSize(entry.size)}`}
              {entry.modifiedAt && ` · ${fmtRel(entry.modifiedAt)}`}
            </div>
          </div>
          <Icon
            name={isFolder ? "chevron-right" : "arrow-up-right"}
            size={14}
            className="text-fg-muted flex-shrink-0"
          />
        </div>
      </Wrapper>
    </li>
  );
}

function FileMimeIcon({ mimeType, isFolder }: { mimeType: string; isFolder: boolean }) {
  if (isFolder) {
    return (
      <span className="w-9 h-9 rounded-md grid place-items-center bg-tops-blue-700/10 text-tops-blue-700 flex-shrink-0">
        <Icon name="folder" size={16} />
      </span>
    );
  }
  if (mimeType === "application/pdf") {
    return (
      <span className="w-9 h-9 rounded-md grid place-items-center bg-tops-red/10 text-tops-red flex-shrink-0">
        <Icon name="file-pdf" size={16} />
      </span>
    );
  }
  if (mimeType.includes("spreadsheet") || mimeType.includes("excel")) {
    return (
      <span className="w-9 h-9 rounded-md grid place-items-center bg-status-success/10 text-status-success flex-shrink-0">
        <Icon name="database" size={16} />
      </span>
    );
  }
  if (mimeType.includes("document") || mimeType.includes("word")) {
    return (
      <span className="w-9 h-9 rounded-md grid place-items-center bg-tops-blue-700/10 text-tops-blue-700 flex-shrink-0">
        <Icon name="file-pdf" size={16} />
      </span>
    );
  }
  if (mimeType.startsWith("image/")) {
    return (
      <span className="w-9 h-9 rounded-md grid place-items-center bg-status-warning/10 text-status-warning flex-shrink-0">
        <Icon name="eye" size={16} />
      </span>
    );
  }
  return (
    <span className="w-9 h-9 rounded-md grid place-items-center bg-neutral-100 text-fg-secondary flex-shrink-0">
      <Icon name="paperclip" size={16} />
    </span>
  );
}

function SkeletonRows() {
  return (
    <ul className="divide-y divide-stroke-soft">
      {Array.from({ length: 6 }).map((_, i) => (
        <li key={i} className="px-5 py-3 flex items-center gap-3">
          <div className="w-9 h-9 rounded-md bg-neutral-100 animate-pulse" />
          <div className="flex-1 space-y-2">
            <div className="h-3 w-2/3 bg-neutral-100 rounded animate-pulse" />
            <div className="h-2 w-1/3 bg-neutral-100 rounded animate-pulse" />
          </div>
        </li>
      ))}
    </ul>
  );
}

function EmptyState({ search }: { search: string }) {
  return (
    <div className="px-5 py-12 text-center">
      <div className="w-12 h-12 rounded-full bg-neutral-100 grid place-items-center mx-auto mb-3 text-fg-muted">
        <Icon name="folder" size={20} />
      </div>
      <div className="text-sm font-bold text-fg-primary">
        {search ? "Sin resultados" : "Carpeta vacía"}
      </div>
      <div className="text-[11px] text-fg-secondary mt-1">
        {search
          ? `No se encontraron archivos que coincidan con "${search}"`
          : "Esta carpeta aún no tiene contenido visible para la service account."}
      </div>
    </div>
  );
}

function ErrorPanel({ message }: { message: string }) {
  return (
    <div className="px-5 py-8 text-center">
      <div className="w-12 h-12 rounded-full bg-tops-red/10 text-tops-red grid place-items-center mx-auto mb-3">
        <Icon name="x" size={20} stroke={2} />
      </div>
      <div className="text-sm font-bold text-fg-primary">No se pudo cargar</div>
      <div className="text-[11px] text-fg-secondary mt-1 max-w-md mx-auto">
        {message}
      </div>
    </div>
  );
}

function ConnectDriveState({ serviceAccountEmail }: { serviceAccountEmail: string | null }) {
  return (
    <div className="card overflow-hidden">
      <div className="p-6 md:p-8 flex flex-col items-center text-center">
        <div className="w-16 h-16 rounded-xl bg-tops-blue-700/10 text-tops-blue-700 grid place-items-center mb-4">
          <Icon name="drive" size={32} />
        </div>
        <h2 className="text-xl font-bold text-fg-brand">
          Conectar Google Drive
        </h2>
        <p className="text-sm text-fg-secondary mt-2 max-w-lg">
          Una vez configurada la service account podrás navegar las carpetas
          regulatorias (Agencia Gubernamental de Control · Magaldi · Pedro de
          Luján) directamente desde NEXUS, con previews y búsqueda.
        </p>

        <ol className="text-left mt-6 space-y-3 text-[13px] text-fg-primary max-w-lg">
          <Step
            n={1}
            title="Crear service account en Google Cloud"
            detail="Console → IAM → Service Accounts → Create. Generar key JSON."
          />
          <Step
            n={2}
            title="Setear env vars en Netlify"
            detail="GOOGLE_SERVICE_ACCOUNT_JSON (JSON serializado) + GOOGLE_DRIVE_ROOT_FOLDER_ID"
          />
          <Step
            n={3}
            title="Compartir la carpeta raíz"
            detail={
              serviceAccountEmail
                ? `Con ${serviceAccountEmail} como editor.`
                : "Una vez seteada la service account, este panel mostrará el email exacto a compartir."
            }
          />
        </ol>

        <div className="mt-6 flex gap-2">
          <a
            href="/api/drive/ping"
            className="btn btn-ghost btn-sm"
            target="_blank"
            rel="noreferrer"
          >
            <Icon name="refresh" size={13} /> Diagnosticar conexión
          </a>
          <a
            href="https://console.cloud.google.com/iam-admin/serviceaccounts"
            className="btn btn-primary btn-sm"
            target="_blank"
            rel="noreferrer"
          >
            <Icon name="arrow-up-right" size={13} /> Abrir Google Cloud
          </a>
        </div>
      </div>
    </div>
  );
}

function Step({ n, title, detail }: { n: number; title: string; detail: string }) {
  return (
    <li className="flex gap-3">
      <span className="w-6 h-6 rounded-full bg-tops-blue-900 text-white grid place-items-center text-[11px] font-bold flex-shrink-0">
        {n}
      </span>
      <div>
        <div className="font-bold">{title}</div>
        <div className="text-[12px] text-fg-secondary">{detail}</div>
      </div>
    </li>
  );
}

// ------------- formatters -------------

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(0)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

function fmtMime(mime: string): string {
  if (mime === "application/pdf") return "PDF";
  if (mime.includes("spreadsheet")) return "Spreadsheet";
  if (mime.includes("document")) return "Documento";
  if (mime.includes("presentation")) return "Presentación";
  if (mime.startsWith("image/")) return mime.replace("image/", "").toUpperCase();
  return mime.split("/").pop() || mime;
}

function fmtRel(iso: string): string {
  const d = new Date(iso);
  const diffMs = Date.now() - d.getTime();
  const min = Math.round(diffMs / 60000);
  if (min < 1) return "hace segundos";
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  const days = Math.round(h / 24);
  if (days < 30) return `hace ${days} d`;
  return d.toLocaleDateString("es-AR", { day: "2-digit", month: "short" });
}
