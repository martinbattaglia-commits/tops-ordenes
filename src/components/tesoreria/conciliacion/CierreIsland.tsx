"use client";

/**
 * Isla de cierre del extracto (E2 · TREAS-RECON-001). Dos acciones que ya
 * existían como server actions sin consumidor:
 *   · «Aceptar sistémicos» → un único ajuste por lote (D7), idempotente.
 *   · «Crear ajuste»       → una línea sin contraparte pasa a 'diferencia'.
 * Cada acción exige un click humano; nada se registra solo. Sin rediseño:
 * mismo lenguaje visual (card / btn / tabular) que el resto de Tesorería.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { aceptarSistemicosLoteAction, crearAjusteAction } from "@/lib/tesoreria/conciliacion/actions";
import { fmtMoney } from "@/lib/utils";
import type { ClosureTargets } from "@/lib/tesoreria/conciliacion/data";

export function CierreIsland({ statementId, targets }: { statementId: string; targets: ClosureTargets }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [ajustadas, setAjustadas] = useState<Record<string, true>>({});

  function aceptarSistemicos() {
    setMsg(null);
    start(async () => {
      const r = await aceptarSistemicosLoteAction(statementId);
      setMsg({ ok: r.ok, text: r.message });
      if (r.ok) router.refresh();
    });
  }

  function crearAjuste(lineId: string) {
    setMsg(null);
    start(async () => {
      const r = await crearAjusteAction({ lineId, bankAccountId: targets.bankAccountId });
      setMsg({ ok: r.ok, text: r.message });
      if (r.ok) {
        setAjustadas((a) => ({ ...a, [lineId]: true }));
        router.refresh();
      }
    });
  }

  if (targets.sistemicos === 0 && targets.lineasAbiertas.length === 0 && !targets.batchRegistrado) return null;

  return (
    <div className="card p-5">
      <h2 className="font-semibold mb-1">Cierre del extracto</h2>
      <p className="text-xs text-fg-muted mb-3">
        Los sistémicos se registran con un único ajuste por lote. Las líneas sin contraparte se cierran con un ajuste
        individual. Ninguna acción se ejecuta sin tu confirmación.
      </p>
      {msg && <p className={`text-sm mb-3 ${msg.ok ? "text-status-success" : "text-tops-red"}`}>{msg.text}</p>}

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <button
          disabled={pending || targets.batchRegistrado || targets.sistemicos === 0}
          onClick={aceptarSistemicos}
          className="btn btn-primary btn-sm"
        >
          Aceptar sistémicos ({targets.sistemicos})
        </button>
        {targets.batchRegistrado && (
          <span className="text-[11px] text-status-success font-bold">✔ Sistémicos ya registrados</span>
        )}
      </div>

      {targets.lineasAbiertas.length > 0 && (
        <>
          <h3 className="text-xs font-bold uppercase text-fg-muted mb-2">
            Líneas sin contraparte ({targets.lineasAbiertas.length})
          </h3>
          <table className="w-full text-sm">
            <tbody>
              {targets.lineasAbiertas.map((l) => (
                <tr key={l.id} className="border-t border-stroke-soft">
                  <td className="py-2 pr-3 whitespace-nowrap text-[11px] text-fg-secondary">{l.fecha}</td>
                  <td className="py-2 pr-3">
                    <div className="tabular text-fg-primary">{fmtMoney(l.importe)}</div>
                    <div className="text-[11px] text-fg-secondary">{l.descripcion.slice(0, 60)}</div>
                  </td>
                  <td className="py-2 text-[11px] uppercase text-fg-muted">{l.direction}</td>
                  <td className="py-2 text-right whitespace-nowrap">
                    {ajustadas[l.id] ? (
                      <span className="text-[11px] font-bold text-status-success">✔ Ajuste creado</span>
                    ) : (
                      <button disabled={pending} onClick={() => crearAjuste(l.id)} className="btn btn-ghost btn-sm">
                        Crear ajuste
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
