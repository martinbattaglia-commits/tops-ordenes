"use client";

import { useState, useTransition } from "react";
import { fmtMoney } from "@/lib/utils";
import { SOURCE_TYPE_LABEL, type ComprobanteSinAsiento, type SimulacionResult } from "@/lib/contabilidad/types";
import { simularAsiento } from "./actions";

interface Props {
  rows: ComprobanteSinAsiento[];
  /** ¿El usuario puede simular? (contabilidad.create — el motor lo re-valida). */
  canSimulate: boolean;
}

/**
 * Tabla de comprobantes sin asiento con simulador dry-run por fila.
 * La simulación NUNCA persiste: el server action fija p_dry_run=true.
 */
export function ComprobantesTable({ rows, canSimulate }: Props) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, SimulacionResult>>({});
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const keyOf = (r: ComprobanteSinAsiento) => `${r.source_type}-${r.source_id}`;

  const simulate = (r: ComprobanteSinAsiento) => {
    const key = keyOf(r);
    setOpenKey(key);
    if (results[key]) return; // ya simulado en esta vista
    setPendingKey(key);
    startTransition(async () => {
      const res = await simularAsiento(r.source_type, r.source_id);
      setResults((prev) => ({ ...prev, [key]: res }));
      setPendingKey(null);
    });
  };

  const colSpan = canSimulate ? 6 : 5;

  return (
    <div className="card" style={{ padding: 0, overflow: "hidden" }}>
      <div style={{ overflowX: "auto" }}>
        <table className="w-full text-sm" style={{ borderCollapse: "collapse", minWidth: canSimulate ? 780 : 680 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--border, #e5e7eb)", textAlign: "left" }}>
              <th style={{ padding: "10px 12px", width: 110 }}>Fecha</th>
              <th style={{ padding: "10px 12px", width: 170 }}>Comprobante</th>
              <th style={{ padding: "10px 12px", width: 150 }}>Referencia</th>
              <th style={{ padding: "10px 12px" }}>Entidad</th>
              <th style={{ padding: "10px 12px", width: 140, textAlign: "right" }}>Importe</th>
              {canSimulate && <th style={{ padding: "10px 12px", width: 110 }} />}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const key = keyOf(r);
              const open = openKey === key;
              const res = results[key];
              return (
                <RowGroup
                  key={key}
                  row={r}
                  open={open}
                  result={res}
                  pending={pendingKey === key}
                  canSimulate={canSimulate}
                  colSpan={colSpan}
                  onSimulate={() => simulate(r)}
                  onClose={() => setOpenKey(null)}
                />
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RowGroup({
  row,
  open,
  result,
  pending,
  canSimulate,
  colSpan,
  onSimulate,
  onClose,
}: {
  row: ComprobanteSinAsiento;
  open: boolean;
  result?: SimulacionResult;
  pending: boolean;
  canSimulate: boolean;
  colSpan: number;
  onSimulate: () => void;
  onClose: () => void;
}) {
  return (
    <>
      <tr style={{ borderBottom: "1px solid var(--border-soft, #f1f3f5)" }}>
        <td style={{ padding: "8px 12px", fontVariantNumeric: "tabular-nums" }}>{row.fecha}</td>
        <td style={{ padding: "8px 12px" }}>{SOURCE_TYPE_LABEL[row.source_type] ?? row.source_type}</td>
        <td style={{ padding: "8px 12px" }} className="text-fg-muted">{row.referencia ?? "—"}</td>
        <td style={{ padding: "8px 12px" }}>{row.entidad ?? "—"}</td>
        <td style={{ padding: "8px 12px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
          {fmtMoney(row.importe)}
        </td>
        {canSimulate && (
          <td style={{ padding: "8px 12px" }}>
            {open ? (
              <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
                Cerrar
              </button>
            ) : (
              <button type="button" className="btn btn-ghost btn-sm" onClick={onSimulate}>
                Simular
              </button>
            )}
          </td>
        )}
      </tr>
      {open && (
        <tr style={{ borderBottom: "1px solid var(--border, #e5e7eb)" }}>
          <td colSpan={colSpan} style={{ padding: "12px 16px", background: "var(--surface-2, #f9fafb)" }}>
            {pending || !result ? (
              <p className="text-xs text-fg-muted">Simulando contabilización (dry-run)…</p>
            ) : (
              <SimulacionDetalle result={result} />
            )}
          </td>
        </tr>
      )}
    </>
  );
}

function SimulacionDetalle({ result }: { result: SimulacionResult }) {
  if (!result.ok) {
    return (
      <div>
        <p className="text-xs font-semibold" style={{ color: "var(--status-warning-400, #b45309)" }}>
          Simulación no disponible
        </p>
        <p className="text-xs text-fg-muted mt-1">{result.error}</p>
      </div>
    );
  }
  if (result.yaContabilizado) {
    return (
      <p className="text-xs text-fg-muted">
        Este comprobante ya tiene un asiento activo en el libro — el motor no generaría uno nuevo (idempotencia).
      </p>
    );
  }
  return (
    <div>
      <p className="text-xs font-semibold text-fg-primary mb-2">
        Asiento propuesto (simulación dry-run — nada se persistió)
        {result.balanced ? (
          <span className="ml-2" style={{ color: "var(--status-success-400, #15803d)" }}>✓ cuadra</span>
        ) : (
          <span className="ml-2" style={{ color: "var(--status-warning-400, #b45309)" }}>⚠ no cuadra</span>
        )}
      </p>
      <table className="w-full text-xs" style={{ borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "1px solid var(--border, #e5e7eb)" }}>
            <th style={{ padding: "6px 8px", width: 90 }}>Cuenta</th>
            <th style={{ padding: "6px 8px" }}>Detalle</th>
            <th style={{ padding: "6px 8px", width: 120, textAlign: "right" }}>Debe</th>
            <th style={{ padding: "6px 8px", width: 120, textAlign: "right" }}>Haber</th>
            <th style={{ padding: "6px 8px", width: 130 }}>Centro de costo</th>
          </tr>
        </thead>
        <tbody>
          {(result.lineas ?? []).map((l) => (
            <tr key={`${l.line_no}-${l.account_id}-${l.debit}-${l.credit}`} style={{ borderBottom: "1px solid var(--border-soft, #f1f3f5)" }}>
              <td style={{ padding: "6px 8px", fontVariantNumeric: "tabular-nums" }} className="text-fg-muted">
                {l.cuenta_codigo ?? "?"}
              </td>
              <td style={{ padding: "6px 8px" }}>
                {l.cuenta_nombre ?? l.account_id}
                {l.description && <span className="text-fg-muted"> — {l.description}</span>}
              </td>
              <td style={{ padding: "6px 8px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                {l.debit > 0 ? fmtMoney(l.debit) : ""}
              </td>
              <td style={{ padding: "6px 8px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                {l.credit > 0 ? fmtMoney(l.credit) : ""}
              </td>
              <td style={{ padding: "6px 8px" }} className="text-fg-muted">{l.centro_costo ?? "—"}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr style={{ fontWeight: 700 }}>
            <td colSpan={2} style={{ padding: "6px 8px", textAlign: "right" }} className="text-fg-muted">Totales</td>
            <td style={{ padding: "6px 8px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtMoney(result.debit ?? 0)}</td>
            <td style={{ padding: "6px 8px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtMoney(result.credit ?? 0)}</td>
            <td />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
