"use client";

import { useMemo, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import type { CustodyEventType, CustodyStage, EvidenceKind } from "@/lib/custody/types";
import { attachEvidenceAction, generatePodAction, registerEventAction } from "../actions";
import { createSingleFlightGuard } from "@/lib/custody/single-flight";

type ActionResult = { ok: true; data?: unknown } | { ok: false; error: string };

/** Presets de captura: cada uno fija kind/stage/event_type válidos (CHECK de 0036). */
const EVIDENCE_PRESETS: { label: string; kind: EvidenceKind; stage: CustodyStage; event_type: CustodyEventType }[] = [
  { label: "Foto de carga", kind: "foto", stage: "despacho", event_type: "cargado" },
  { label: "Foto de entrega", kind: "foto", stage: "entrega", event_type: "foto_entrega" },
  { label: "Documento (entrega)", kind: "documento", stage: "entrega", event_type: "foto_entrega" },
];

export function CustodyShipmentActions({
  shipmentId,
  podPresent,
  revalidate,
  podReadiness,
}: {
  shipmentId: string;
  podPresent: boolean;
  revalidate: string;
  podReadiness: "delivered" | "pending_delivery" | "unavailable";
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [preset, setPreset] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const guard = useMemo(() => createSingleFlightGuard(), []);

  const run = (
    fn: () => Promise<ActionResult>,
    okMsg: string,
    onSuccess?: () => void,
  ) => {
    void guard.run("shipment-custody-mutation", async () => {
      setBusy(true);
      setErr(null); setMsg(null);
      try {
        const res = await fn();
        if (!res.ok) setErr(res.error);
        else {
          setMsg(okMsg);
          onSuccess?.();
        }
      } catch {
        setErr("No se pudo completar la operación");
      } finally {
        setBusy(false);
      }
    });
  };

  const registerEvent = (stage: CustodyStage, eventType: CustodyEventType, okMsg: string) =>
    run(() => registerEventAction({ shipmentId, stage, eventType }, revalidate), okMsg);

  const submitEvidence = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) { setErr("Elegí un archivo"); return; }
    const p = EVIDENCE_PRESETS[preset];
    if (!p || (p.stage === "entrega" && podReadiness !== "delivered")) {
      setErr("La evidencia de entrega se habilita después de confirmar la entrega");
      return;
    }
    const fd = new FormData();
    fd.set("file", file);
    fd.set("scope", "shipment");
    fd.set("entity_id", shipmentId);
    fd.set("kind", p.kind);
    fd.set("stage", p.stage);
    fd.set("event_type", p.event_type);
    fd.set("revalidate", revalidate);
    run(() => attachEvidenceAction(fd), "Evidencia adjuntada", () => {
      if (fileRef.current) fileRef.current.value = "";
    });
  };

  const submitPod = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const receiverName = String(f.get("receiver_name") ?? "").trim();
    if (!receiverName) { setErr("Nombre del receptor requerido"); return; }
    const form = e.currentTarget;
    run(
      () => {
        f.set("shipment_id", shipmentId);
        return generatePodAction(f, revalidate);
      },
      "POD generado",
      () => form.reset(),
    );
  };

  return (
    <div className="nx-surface card card-pad flex flex-col gap-3">
      <h3 className="text-sm font-semibold flex items-center gap-1.5"><Icon name="shield" size={13} /> Registrar custodia</h3>

      {/* Eventos sin archivo */}
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => registerEvent("despacho", "cargado", "Evento registrado")} disabled={busy} className="btn btn-ghost btn-sm">
          <Icon name="truck" size={12} /> Cargado al vehículo
        </button>
        <button onClick={() => registerEvent("transporte", "en_transito", "Evento registrado")} disabled={busy} className="btn btn-ghost btn-sm">
          <Icon name="pin" size={12} /> En tránsito
        </button>
      </div>

      {/* Adjuntar evidencia (archivo) */}
      <form onSubmit={submitEvidence} className="flex flex-wrap items-end gap-2 border-t border-stroke-soft pt-3">
        <label className="flex flex-col gap-1">
          <span className="kpi-label">Tipo de evidencia</span>
          <select value={preset} onChange={(e) => setPreset(Number(e.target.value))} className="input" disabled={busy}>
            {EVIDENCE_PRESETS.map((p, i) =>
              p.stage !== "entrega" || podReadiness === "delivered"
                ? <option key={p.label} value={i}>{p.label}</option>
                : null,
            )}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="kpi-label">Archivo</span>
          <input ref={fileRef} type="file" accept="image/*,application/pdf" className="input" disabled={busy} />
        </label>
        <button type="submit" disabled={busy} className="btn btn-primary btn-sm">
          <Icon name="paperclip" size={12} /> Adjuntar
        </button>
      </form>

      {/* Generar POD */}
      {!podPresent && podReadiness === "delivered" && (
        <form onSubmit={submitPod} className="flex flex-wrap items-end gap-2 border-t border-stroke-soft pt-3">
          <label className="flex flex-col gap-1">
            <span className="kpi-label">Receptor</span>
            <input name="receiver_name" className="input" placeholder="Nombre aclarado" disabled={busy} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="kpi-label">Documento</span>
            <input name="receiver_document" className="input" placeholder="DNI (opcional)" disabled={busy} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="kpi-label">Observaciones</span>
            <input name="observations" className="input" placeholder="(opcional)" disabled={busy} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="kpi-label">Firma del receptor (opcional)</span>
            <input name="signature" type="file" accept="image/jpeg,image/png,image/webp" className="input" disabled={busy} />
          </label>
          <button type="submit" disabled={busy} className="btn btn-primary btn-sm">
            <Icon name="check-circle" size={12} /> Generar POD
          </button>
          <p className="w-full text-xs text-fg-muted">
            La firma se autoriza para este receptor y este estado exacto al generar el POD; no se reutilizan firmas previas.
          </p>
        </form>
      )}

      {!podPresent && podReadiness === "pending_delivery" && (
        <p className="border-t border-stroke-soft pt-3 text-xs text-fg-muted">
          La firma del receptor y el POD se habilitan después de confirmar la entrega.
        </p>
      )}

      {!podPresent && podReadiness === "unavailable" && (
        <p role="alert" className="border-t border-stroke-soft pt-3 text-xs text-status-warning">
          Estado de entrega no verificable: firma y POD bloqueados.
        </p>
      )}

      {err && <span className="text-[11px] text-status-danger" title={err}>{err}</span>}
      {msg && <span className="text-[11px] text-status-success">{msg}</span>}
    </div>
  );
}
