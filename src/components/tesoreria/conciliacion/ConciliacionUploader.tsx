"use client";

/**
 * Uploader de extracto bancario (S4, client island). Drag&drop / selección →
 * POST multipart a /api/tesoreria/conciliacion/ingest. Misma UX que Facturas.
 * No registra solo: la ingesta deja todo en 'sugerido' para aprobación.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type Banco = "santander" | "galicia";
type Source = "csv" | "xls" | "pdf";

export function ConciliacionUploader({ bankAccountId }: { bankAccountId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [banco, setBanco] = useState<Banco>("santander");
  const [source, setSource] = useState<Source>("csv");

  function subir(file: File) {
    setMsg(null);
    const fd = new FormData();
    fd.set("file", file);
    fd.set("bankAccountId", bankAccountId);
    fd.set("banco", banco);
    fd.set("sourceKind", source);
    start(async () => {
      const r = await fetch("/api/tesoreria/conciliacion/ingest", { method: "POST", body: fd });
      const j = await r.json();
      if (j.ok) {
        setMsg({ ok: true, text: `Ingestado · Δ saldo ${j.deltaCents === 0 ? "0,00 ✔" : "≠ 0 (revisar)"} · ${j.resumen.sistemicos} sistémicos` });
        router.replace(`/tesoreria/conciliacion?s=${j.statementId}`);
        router.refresh();
      } else {
        setMsg({ ok: false, text: j.message ?? "Error al ingestar." });
      }
    });
  }

  return (
    <div className="card p-5">
      <div className="flex flex-wrap items-end gap-3 mb-3">
        <label className="block">
          <span className="field-label block mb-1.5">Banco</span>
          <select className="input" value={banco} onChange={(e) => { const b = e.target.value as Banco; setBanco(b); setSource(b === "galicia" ? "pdf" : "csv"); }}>
            <option value="santander">Santander</option>
            <option value="galicia">Galicia</option>
          </select>
        </label>
        <label className="block">
          <span className="field-label block mb-1.5">Formato</span>
          <select className="input" value={source} onChange={(e) => setSource(e.target.value as Source)}>
            {banco === "santander" ? (
              <>
                <option value="csv">CSV (primario)</option>
                <option value="xls">XLS (alterno)</option>
              </>
            ) : (
              <option value="pdf">PDF</option>
            )}
          </select>
        </label>
      </div>
      <label
        className="flex flex-col items-center justify-center gap-1 border-2 border-dashed border-stroke-strong rounded-lg p-8 cursor-pointer hover:bg-fg-primary/5 transition-colors"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) subir(f); }}
      >
        <span className="text-sm font-semibold text-fg-secondary">{pending ? "Procesando…" : "Arrastrá el extracto, o hacé clic"}</span>
        <span className="text-[11px] text-fg-muted">{banco === "santander" ? "CSV / XLS" : "PDF"} · máx 20MB</span>
        <input type="file" className="hidden" accept=".csv,.xls,.pdf,text/csv,application/pdf" disabled={pending}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) subir(f); }} />
      </label>
      {msg && <p className={`text-sm mt-2 ${msg.ok ? "text-status-success" : "text-tops-red"}`}>{msg.text}</p>}
    </div>
  );
}
