"use client";

/**
 * Uploader de extracto bancario (S4 → E2 · TREAS-RECON-001). Drag&drop /
 * selección → POST multipart a /api/tesoreria/conciliacion/ingest.
 * No registra solo: la ingesta deja todo en 'sugerido' para aprobación.
 *
 * E2 · dos cambios de fondo (mismo layout, sin rediseño):
 *   · SELECTOR DE CUENTA explícito + confirmación visible de banco y cuenta
 *     antes de procesar (hallazgo E1: el piloto ingestó extractos Santander
 *     contra la cuenta «Caja Efectivo» porque la página fijaba accounts[0]).
 *   · ERRORES VISIBLES por etapa: nada de fallar en silencio.
 */
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { validarCoherenciaCuenta, bancoLabel, type CuentaParaIngesta } from "@/lib/tesoreria/conciliacion/account-guard";

type Banco = "santander" | "galicia";
type Source = "csv" | "xls" | "pdf";

export function ConciliacionUploader({
  cuentas,
  bankAccountId: inicial,
}: {
  cuentas: CuentaParaIngesta[];
  bankAccountId?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string; etapa?: string } | null>(null);
  const [banco, setBanco] = useState<Banco>("santander");
  const [source, setSource] = useState<Source>("csv");
  const [cuentaId, setCuentaId] = useState<string>(inicial ?? "");

  const cuenta = useMemo(() => cuentas.find((c) => c.id === cuentaId) ?? null, [cuentas, cuentaId]);
  const incoherencia = useMemo(() => (cuentaId ? validarCoherenciaCuenta(banco, cuenta) : "Elegí la cuenta del extracto."), [banco, cuenta, cuentaId]);
  const bloqueado = pending || incoherencia !== null;

  function subir(file: File) {
    setMsg(null);
    // Gate en cliente: el route y la RPC repiten la validación (3 capas).
    if (incoherencia) {
      setMsg({ ok: false, text: incoherencia, etapa: "cuenta" });
      return;
    }
    const fd = new FormData();
    fd.set("file", file);
    fd.set("bankAccountId", cuentaId);
    fd.set("banco", banco);
    fd.set("sourceKind", source);
    start(async () => {
      try {
        const r = await fetch("/api/tesoreria/conciliacion/ingest", { method: "POST", body: fd });
        const j = await r.json();
        if (j.ok) {
          setMsg({
            ok: true,
            text: `Ingestado en ${j.cuenta?.banco ?? ""} · ${j.cuenta?.nombre ?? ""} — Δ saldo ${j.deltaCents === 0 ? "0,00 ✔" : "≠ 0 (revisar)"} · ${j.resumen.sistemicos} sistémicos`,
          });
          router.replace(`/tesoreria/conciliacion?s=${j.statementId}`);
          router.refresh();
        } else {
          setMsg({ ok: false, text: j.message ?? `Error al ingestar (HTTP ${r.status}).`, etapa: j.etapa });
        }
      } catch (e) {
        setMsg({ ok: false, text: e instanceof Error ? e.message : "No se pudo contactar al servidor.", etapa: "red" });
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
          <span className="field-label block mb-1.5">Cuenta</span>
          <select className="input" value={cuentaId} onChange={(e) => setCuentaId(e.target.value)}>
            <option value="">Elegí la cuenta…</option>
            {cuentas.map((c) => (
              <option key={c.id} value={c.id}>{c.bank_name} · {c.account_name}</option>
            ))}
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

      {/* Confirmación explícita de destino antes de procesar. */}
      {incoherencia ? (
        <p className="text-sm text-tops-red mb-3">{incoherencia}</p>
      ) : (
        <p className="text-sm text-fg-secondary mb-3">
          Se ingestará un extracto de <strong>{bancoLabel(banco)}</strong> en la cuenta{" "}
          <strong>{cuenta?.bank_name} · {cuenta?.account_name}</strong>. Verificá que sea correcto.
        </p>
      )}

      <label
        className={`flex flex-col items-center justify-center gap-1 border-2 border-dashed border-stroke-strong rounded-lg p-8 transition-colors ${bloqueado ? "opacity-50 cursor-not-allowed" : "cursor-pointer hover:bg-fg-primary/5"}`}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); if (bloqueado) return; const f = e.dataTransfer.files?.[0]; if (f) subir(f); }}
      >
        <span className="text-sm font-semibold text-fg-secondary">{pending ? "Procesando…" : "Arrastrá el extracto, o hacé clic"}</span>
        <span className="text-[11px] text-fg-muted">{banco === "santander" ? "CSV / XLS" : "PDF"} · máx 20MB</span>
        <input type="file" className="hidden" accept=".csv,.xls,.pdf,text/csv,application/pdf" disabled={bloqueado}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) subir(f); }} />
      </label>

      {msg && (
        <p className={`text-sm mt-2 ${msg.ok ? "text-status-success" : "text-tops-red"}`}>
          {!msg.ok && msg.etapa && <span className="text-[11px] uppercase font-bold mr-1.5">[{msg.etapa}]</span>}
          {msg.text}
        </p>
      )}
    </div>
  );
}
