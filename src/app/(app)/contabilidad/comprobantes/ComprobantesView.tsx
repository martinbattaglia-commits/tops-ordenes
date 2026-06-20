"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { fmtCurrency } from "@/lib/utils";
import { contabilizarDocumento, backfill } from "@/lib/contabilidad/actions";
import { SOURCE_LABEL, type ComprobanteSinAsiento } from "@/lib/contabilidad/types";

const SOURCES = ["customer_invoice", "supplier_invoice", "customer_receipt", "supplier_payment"] as const;

export function ComprobantesView({
  rows,
  canPost,
}: {
  rows: ComprobanteSinAsiento[];
  canPost: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const counts = SOURCES.map((s) => ({
    source: s,
    count: rows.filter((r) => r.sourceType === s).length,
  }));

  function run(fn: () => Promise<{ ok: boolean; message: string }>, id?: string) {
    setMsg(null);
    setBusyId(id ?? "bulk");
    startTransition(async () => {
      const res = await fn();
      setMsg(res.message);
      setBusyId(null);
      router.refresh();
    });
  }

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-bold text-fg-brand">Pendientes de contabilizar</h1>
        <p className="text-sm text-fg-secondary">
          Comprobantes en estado contabilizable que todavía no tienen asiento. Simulá (dry-run)
          antes de ejecutar el backfill.
        </p>
      </header>

      {msg && (
        <div className="card p-3 text-sm bg-bg-subtle border border-border-subtle">{msg}</div>
      )}

      <section className="card p-4">
        <div className="text-sm font-semibold text-fg-brand mb-3">Backfill por tipo</div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {counts.map((c) => (
            <div key={c.source} className="border border-border-subtle rounded p-3">
              <div className="text-xs text-fg-muted">{SOURCE_LABEL[c.source]}</div>
              <div className="text-lg font-bold text-fg-brand">{c.count}</div>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => run(() => backfill(c.source, true), `dry-${c.source}`)}
                  className="text-xs px-2 py-1 rounded border border-border-subtle hover:bg-bg-subtle disabled:opacity-50"
                >
                  Simular
                </button>
                {canPost && (
                  <button
                    type="button"
                    disabled={pending || c.count === 0}
                    onClick={() => run(() => backfill(c.source, false), `real-${c.source}`)}
                    className="text-xs px-2 py-1 rounded bg-bg-brand text-white hover:opacity-90 disabled:opacity-50"
                  >
                    Contabilizar
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
        {!canPost && (
          <p className="text-xs text-fg-muted mt-3">
            Tenés acceso de lectura. La contabilización requiere el permiso{" "}
            <code className="font-mono">contabilidad.create</code>.
          </p>
        )}
      </section>

      <section className="card overflow-x-auto">
        <div className="px-4 py-2 border-b border-border-subtle font-semibold text-fg-brand">
          Detalle ({rows.length})
        </div>
        {rows.length === 0 ? (
          <div className="p-8 text-sm text-status-success">
            ✓ No hay comprobantes pendientes de contabilizar.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-fg-muted border-b border-border-subtle">
                <th className="p-3">Tipo</th>
                <th className="p-3">Fecha</th>
                <th className="p-3">Referencia</th>
                <th className="p-3">Entidad</th>
                <th className="p-3 text-right">Importe</th>
                {canPost && <th className="p-3"></th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.sourceType}-${r.sourceId}`} className="border-b border-border-subtle/40">
                  <td className="p-3">{SOURCE_LABEL[r.sourceType] ?? r.sourceType}</td>
                  <td className="p-3">{r.fecha}</td>
                  <td className="p-3 font-mono text-xs">{r.referencia}</td>
                  <td className="p-3">{r.entidad}</td>
                  <td className="p-3 text-right">{fmtCurrency(r.importe)}</td>
                  {canPost && (
                    <td className="p-3 text-right">
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => run(() => contabilizarDocumento(r.sourceType, r.sourceId), r.sourceId)}
                        className="text-xs px-2 py-1 rounded bg-bg-brand text-white hover:opacity-90 disabled:opacity-50"
                      >
                        {busyId === r.sourceId ? "..." : "Contabilizar"}
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
