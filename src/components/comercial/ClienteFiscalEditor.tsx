"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";
import { updateClientFiscal } from "@/app/(app)/clients/actions";
import { AccountPicker } from "@/components/erp/AccountPicker";
import { CONDICION_IVA_LABEL, CONDICION_IVA_VALUES, type CondicionIva } from "@/lib/invoicing/types";
import type { ChartAccount } from "@/lib/erp/types";

/**
 * Editor inline de la imputación fiscal/contable de un cliente (ficha).
 * Categoría fiscal (condición IVA) + Cuenta contable del Plan de Cuentas.
 */
export function ClienteFiscalEditor({
  clientId,
  initial,
  accounts,
}: {
  clientId: string;
  initial: { condicion_iva: CondicionIva; cuenta_contable: string };
  accounts: ChartAccount[];
}) {
  const router = useRouter();
  const [edit, setEdit] = useState(false);
  const [f, setF] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [pending, start] = useTransition();

  const accountName = accounts.find((a) => a.code === f.cuenta_contable)?.name;

  function save() {
    setError(null);
    setOk(false);
    start(async () => {
      const r = await updateClientFiscal({ id: clientId, condicion_iva: f.condicion_iva, cuenta_contable: f.cuenta_contable });
      if (r.ok) { setOk(true); setEdit(false); router.refresh(); }
      else setError(r.error);
    });
  }

  if (!edit) {
    return (
      <section className="card p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold flex items-center gap-2"><Icon name="report" size={15} /> Fiscal & contable</h2>
          <button onClick={() => setEdit(true)} className="btn btn-ghost btn-sm"><Icon name="pen" size={13} /> Editar</button>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <FieldRO label="Categoría fiscal (IVA)" value={CONDICION_IVA_LABEL[f.condicion_iva]} />
          <FieldRO label="Cuenta contable" value={f.cuenta_contable ? (accountName ? `${f.cuenta_contable} · ${accountName}` : f.cuenta_contable) : ""} />
        </div>
        {ok && <p className="text-xs text-status-success mt-2">Guardado.</p>}
      </section>
    );
  }

  return (
    <section className="card p-5">
      <h2 className="font-semibold mb-3 flex items-center gap-2"><Icon name="report" size={15} /> Fiscal & contable</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold text-fg-secondary">Categoría fiscal (IVA)</span>
          <select className="input" value={f.condicion_iva} onChange={(e) => setF((s) => ({ ...s, condicion_iva: e.target.value as CondicionIva }))}>
            {CONDICION_IVA_VALUES.map((o) => <option key={o} value={o}>{CONDICION_IVA_LABEL[o]}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold text-fg-secondary">Cuenta contable</span>
          <AccountPicker accounts={accounts} value={f.cuenta_contable} onChange={(c) => setF((s) => ({ ...s, cuenta_contable: c }))} />
        </label>
      </div>
      {error && <div className="mt-2 rounded-md bg-tops-red/10 text-tops-red text-sm px-3 py-2 border border-tops-red/20">{error}</div>}
      <div className="flex justify-end gap-2 mt-3">
        <button onClick={() => { setEdit(false); setF(initial); }} className="btn btn-ghost btn-sm" disabled={pending}>Cancelar</button>
        <button onClick={save} className="btn btn-primary btn-sm" disabled={pending}><Icon name="check" size={13} /> {pending ? "Guardando…" : "Guardar"}</button>
      </div>
    </section>
  );
}

function FieldRO({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-fg-muted">{label}</div>
      <div className="text-sm text-fg-primary">{value || <span className="text-fg-muted">—</span>}</div>
    </div>
  );
}
