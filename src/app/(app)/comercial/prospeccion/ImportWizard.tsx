"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  runProspectImportPreview,
  slugForDetectedFormat,
  confirmProspectImport,
  MAX_BATCH,
} from "@/lib/prospeccion/adapters/import/udie/prospect-import-engine";
import type { PreviewModel } from "@/lib/udie/kernel/types";
import type { ProspectImportInput } from "@/lib/prospeccion/domain/prospect";

type Preview = PreviewModel<ProspectImportInput>;
const DOT: Record<string, string> = { nuevo: "🟢", posible: "🟡", exacto: "🔴" };

interface ImportWizardProps {
  onImportSuccess?: (result: { inserted: number }) => void;
}

export function ImportWizard({ onImportSuccess }: ImportWizardProps = {}) {
  const router = useRouter();
  const [drag, setDrag] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, start] = useTransition();

  async function onFile(file: File) {
    setError(null); setDone(null); setPreview(null);
    const r = await runProspectImportPreview(file);
    if (!r.ok) { setError(r.error.message); return; }
    setPreview(r.value);
  }

  function onConfirm() {
    if (!preview) return;
    const rows = preview.rows.filter((r) => r.valid).map((r) => r.row).slice(0, MAX_BATCH);
    const slug = slugForDetectedFormat(preview.stats.detectedFormat);
    start(async () => {
      const r = await confirmProspectImport(rows, slug);
      if (!r.ok) { setError(r.error.message); return; }
      setDone(`Importados ${r.value.inserted} · duplicados ${r.value.duplicates} · rechazados ${r.value.rejected}`);
      setPreview(null);
      onImportSuccess?.({ inserted: r.value.inserted });
      router.refresh();
    });
  }

  const s = preview?.stats;
  return (
    <section className="card p-5 space-y-3">
      <h2 className="text-sm font-semibold">Importar prospectos</h2>
      <label
        className={`flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed p-10 cursor-pointer transition-all duration-200 ${drag ? "border-tops-blue-700 bg-tops-blue-700/10 scale-[1.01]" : "border-stroke-soft hover:border-tops-blue-700/40 hover:bg-bg-surface-alt"}`}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files?.[0]; if (f) onFile(f); }}
      >
        <div className={`flex h-12 w-12 items-center justify-center rounded-xl transition-colors ${drag ? "bg-tops-blue-700/10 text-fg-link" : "bg-bg-surface-alt text-fg-muted"}`}>
          <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
          </svg>
        </div>
        <div className="space-y-0.5 text-center">
          <span className="block text-sm font-semibold text-fg-secondary">
            {drag ? "Soltá aquí para importar" : "Arrastrá un CSV o XLSX, o hacé clic"}
          </span>
          <span className="block text-[11px] text-fg-muted">LinkedIn · Evaboot · Apollo · Wiza · Clientify · CSV genérico</span>
        </div>
        <input type="file" className="hidden" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }} />
      </label>

      {error && <p className="text-sm text-red-400">{error}</p>}
      {done && <p className="text-sm text-emerald-400">{done}</p>}

      {s && (
        <div className="space-y-2 text-sm">
          <p className="text-fg-secondary">Detectado: <span className="font-medium">{s.detectedFormat}</span> · {s.registros} filas · {s.columnas} columnas</p>
          <div className="flex flex-wrap gap-3 text-xs text-fg-muted">
            <span>✔ {s.pctValidos}% válidos</span>
            <span>✖ {s.pctRechazados}% rechazados</span>
            <span>🏢 {s.empresasUnicas} empresas</span>
            <span>👤 {s.contactosUnicos} contactos</span>
            <span>🟡 {s.posiblesDuplicados} posibles</span>
            <span>🔴 {s.duplicadosExactos} exactos</span>
          </div>
          {s.unmappedHeaders.length > 0 && <p className="text-xs text-fg-muted">Columnas no reconocidas: {s.unmappedHeaders.join(", ")}</p>}
          {s.excedeMaxBatch && <p className="text-xs text-amber-400">Se importarán solo las primeras 500 filas (límite por lote).</p>}

          <div className="max-h-64 overflow-auto rounded-md border border-stroke-soft">
            <table className="min-w-full text-xs">
              <thead className="bg-bg-surface-alt text-left">
                <tr><th className="px-2 py-1">#</th><th className="px-2 py-1">Estado</th><th className="px-2 py-1">Empresa</th><th className="px-2 py-1">Contacto</th><th className="px-2 py-1">Email</th><th className="px-2 py-1">Motivo</th></tr>
              </thead>
              <tbody>
                {preview!.rows.slice(0, 50).map((r) => (
                  <tr key={r.index} className={r.valid ? "" : "bg-tops-red/10"}>
                    <td className="px-2 py-1">{r.index + 1}</td>
                    <td className="px-2 py-1">{DOT[r.dedupStatus]} {r.dedupStatus}</td>
                    <td className="px-2 py-1">{r.row.company_name ?? "—"}</td>
                    <td className="px-2 py-1">{r.row.full_name ?? "—"}</td>
                    <td className="px-2 py-1">{r.row.email ?? "—"}</td>
                    <td className="px-2 py-1 text-red-400">{r.valid ? r.dedupReason : (r.diagnostics[0]?.message ?? "inválido")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <button onClick={onConfirm} disabled={pending || s.pctValidos === 0}
            className="btn btn-primary btn-sm disabled:opacity-50">
            {pending ? "Importando…" : `Confirmar importación (${preview!.rows.filter((r) => r.valid).length})`}
          </button>
        </div>
      )}
    </section>
  );
}
