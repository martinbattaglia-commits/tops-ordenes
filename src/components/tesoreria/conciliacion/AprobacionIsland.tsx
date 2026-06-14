"use client";

/**
 * Isla de aprobación humana (S4, client). Acepta/Rechaza sugerencias de match
 * vía server actions (RPC con LOCK). Sólo visible para rol con `…approve`.
 * NUNCA registra solo: cada fila exige un click humano.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { aceptarMatchAction, rechazarMatchAction } from "@/lib/tesoreria/conciliacion/actions";
import { fmtCurrency } from "@/lib/utils";
import type { PendingMatch } from "@/lib/tesoreria/conciliacion/data";

export function AprobacionIsland({ pendientes }: { pendientes: PendingMatch[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [done, setDone] = useState<Record<string, "aceptado" | "rechazado">>({});
  const [err, setErr] = useState<string | null>(null);

  function decidir(matchId: string, accion: "aceptar" | "rechazar") {
    setErr(null);
    start(async () => {
      const r = accion === "aceptar" ? await aceptarMatchAction(matchId) : await rechazarMatchAction(matchId);
      if (r.ok) {
        setDone((d) => ({ ...d, [matchId]: accion === "aceptar" ? "aceptado" : "rechazado" }));
        router.refresh();
      } else setErr(r.message);
    });
  }

  if (pendientes.length === 0) return <p className="text-sm text-fg-muted">Sin sugerencias pendientes de aprobación.</p>;

  return (
    <div className="card p-5">
      <h2 className="font-semibold mb-1">Aprobación de sugerencias ({pendientes.length})</h2>
      <p className="text-xs text-fg-muted mb-3">Confirmá o rechazá cada conciliación sugerida. La aceptación enlaza el movimiento (no crea asiento).</p>
      {err && <p className="text-sm text-tops-red mb-2">{err}</p>}
      <table className="w-full text-sm">
        <tbody>
          {pendientes.map((p) => {
            const estado = done[p.matchId];
            return (
              <tr key={p.matchId} className="border-t border-stroke-soft">
                <td className="py-2 pr-3">
                  <div className="tabular text-fg-primary">{fmtCurrency(p.importe)}</div>
                  <div className="text-[11px] text-fg-secondary">{p.descripcion.slice(0, 50)}</div>
                </td>
                <td className="py-2 text-center"><span className="tabular font-bold">{p.score}%</span><div className="text-[9px] uppercase text-fg-muted">{p.metodo}</div></td>
                <td className="py-2 text-[11px] text-fg-muted pr-3">{p.motivo}</td>
                <td className="py-2 text-right whitespace-nowrap">
                  {estado ? (
                    <span className={`text-[11px] font-bold ${estado === "aceptado" ? "text-status-success" : "text-fg-muted"}`}>{estado === "aceptado" ? "✔ Aceptado" : "Rechazado"}</span>
                  ) : (
                    <span className="inline-flex gap-1.5">
                      <button disabled={pending} onClick={() => decidir(p.matchId, "aceptar")} className="btn btn-primary btn-sm">Aceptar</button>
                      <button disabled={pending} onClick={() => decidir(p.matchId, "rechazar")} className="btn btn-ghost btn-sm">Rechazar</button>
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
