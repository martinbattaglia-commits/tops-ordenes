"use client";

/**
 * Alta de un movimiento de Caja Chica (CCN-001B · F3). RPC-First: sólo
 * registrarCajaMovimientoAction. Ninguna regla financiera acá.
 *
 * Se abre como MODAL DENTRO de la pantalla (no es una pantalla aparte).
 * La CUENTA no se elige: la resuelve la RPC (cuenta `caja` del motor).
 */
import { useEffect, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { registrarCajaMovimientoAction } from "@/lib/tesoreria/caja-chica/actions";
import type { Responsable } from "@/lib/tesoreria/caja-chica/native-data";

const today = () => new Date().toISOString().slice(0, 10);

export function RegistrarCajaModal({ responsables }: { responsables: Responsable[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [direction, setDirection] = useState<"ingreso" | "egreso">("egreso");
  const [date, setDate] = useState(today);
  const [amount, setAmount] = useState("");
  const [concept, setConcept] = useState("");
  const [responsableId, setResponsableId] = useState("");
  const [observations, setObservations] = useState("");

  // Esc cierra el modal (accesibilidad).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  function reset() {
    setAmount("");
    setConcept("");
    setObservations("");
    setMsg(null);
  }

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMsg(null);
    start(async () => {
      const r = await registrarCajaMovimientoAction({
        date,
        direction,
        amount,
        concept,
        responsable_id: responsableId,
        observations: observations || null,
      });
      setMsg({ ok: r.ok, text: r.message });
      if (r.ok) {
        reset();
        setOpen(false);
        router.refresh();
      }
    });
  }

  if (!open) {
    return (
      <button type="button" className="btn btn-primary btn-sm" onClick={() => setOpen(true)}>
        + Registrar movimiento
      </button>
    );
  }

  return (
    <>
      <button type="button" className="btn btn-primary btn-sm" onClick={() => setOpen(true)}>
        + Registrar movimiento
      </button>

      <div
        className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-8"
        role="dialog"
        aria-modal="true"
        aria-label="Registrar movimiento de caja"
        onClick={(e) => {
          if (e.target === e.currentTarget) setOpen(false);
        }}
      >
        <form onSubmit={submit} className="card w-full max-w-xl p-5 grid gap-3">
          <div>
            <h3 className="font-semibold">Registrar movimiento de caja</h3>
            <p className="text-xs text-fg-muted mt-0.5">
              El movimiento queda confirmado y auditado al registrarlo.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="block col-span-2">
              <span className="field-label block mb-1.5">Tipo</span>
              <div className="inline-flex rounded-md overflow-hidden border border-stroke-soft">
                <button
                  type="button"
                  className={`px-4 py-2 text-sm font-bold ${
                    direction === "ingreso" ? "bg-status-success text-white" : "text-fg-secondary"
                  }`}
                  onClick={() => setDirection("ingreso")}
                >
                  Ingreso
                </button>
                <button
                  type="button"
                  className={`px-4 py-2 text-sm font-bold ${
                    direction === "egreso" ? "bg-tops-red text-white" : "text-fg-secondary"
                  }`}
                  onClick={() => setDirection("egreso")}
                >
                  Egreso
                </button>
              </div>
            </label>

            <label className="block">
              <span className="field-label block mb-1.5">Fecha</span>
              <input
                className="input"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                required
              />
            </label>

            <label className="block">
              <span className="field-label block mb-1.5">Importe (ARS)</span>
              <input
                className="input"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                required
              />
            </label>

            <label className="block col-span-2">
              <span className="field-label block mb-1.5">Concepto</span>
              <input
                className="input"
                value={concept}
                onChange={(e) => setConcept(e.target.value)}
                placeholder="Ej.: Compra de insumos de limpieza"
                required
              />
            </label>

            <label className="block col-span-2">
              <span className="field-label block mb-1.5">Responsable</span>
              <select
                className="input"
                value={responsableId}
                onChange={(e) => setResponsableId(e.target.value)}
                required
              >
                <option value="">Seleccionar…</option>
                {responsables.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.full_name}
                  </option>
                ))}
              </select>
            </label>

            <label className="block col-span-2">
              <span className="field-label block mb-1.5">
                Observaciones <span className="text-fg-muted">(opcional)</span>
              </span>
              <input
                className="input"
                value={observations}
                onChange={(e) => setObservations(e.target.value)}
              />
            </label>
          </div>

          <p className="text-xs text-fg-muted bg-neutral-50 rounded-md px-3 py-2">
            La cuenta se resuelve automáticamente (cuenta <b>Caja</b> del motor de Tesorería). No se
            elige cuenta manualmente.
          </p>

          {msg && <p className={msg.ok ? "text-green-600 text-sm" : "text-red-600 text-sm"}>{msg.text}</p>}

          <div className="flex items-center justify-end gap-2">
            <button type="button" className="btn btn-sm" onClick={() => setOpen(false)} disabled={pending}>
              Cancelar
            </button>
            <button
              type="submit"
              className="btn btn-primary btn-sm"
              disabled={pending || !amount.trim() || !concept.trim() || !responsableId}
            >
              {pending ? "Registrando…" : "Registrar"}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
