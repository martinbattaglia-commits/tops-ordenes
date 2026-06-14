"use client";

/**
 * ContractDrawer.tsx — Ficha contractual lateral (drawer), réplica de la maqueta.
 * Datos generales + canon/ajuste/superficie/ubicación/vencimiento, penalidad,
 * hallazgos y recomendación. Se cierra con overlay, botón × o tecla Escape.
 */

import { useEffect } from "react";
import {
  SEMAFORO_META,
  estadoLabel,
  formatCanon,
  formatFecha,
  type ContractRecord,
} from "@/lib/comercial/contracts-types";
import { SemaforoDot, RiesgoTag, TipoTag } from "./ui";

function KV({ k, v, wide = false }: { k: string; v: React.ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? "col-span-2" : ""}>
      <div className="text-[10px] uppercase tracking-wide text-fg-muted">{k}</div>
      <div className="text-[13.5px] font-semibold text-fg-primary">{v}</div>
    </div>
  );
}

export function ContractDrawer({
  contract,
  onClose,
}: {
  contract: ContractRecord | null;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!contract) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [contract, onClose]);

  const open = Boolean(contract);

  return (
    <>
      {/* Overlay */}
      <div
        className={`fixed inset-0 z-40 bg-[rgba(10,20,33,0.45)] transition-opacity duration-200 ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        onClick={onClose}
        aria-hidden
      />
      {/* Panel */}
      <aside
        className={`fixed top-0 right-0 z-50 h-screen w-[540px] max-w-[94vw] overflow-y-auto bg-bg-surface shadow-[-8px_0_30px_rgba(0,0,0,0.18)] transition-transform duration-300 ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
        role="dialog"
        aria-modal="true"
        aria-label={contract ? `Ficha contractual · ${contract.n}` : "Ficha contractual"}
      >
        {contract && (
          <>
            <header className="relative bg-[#0E2A47] px-6 py-5 text-white">
              <button
                onClick={onClose}
                className="absolute right-4 top-3 text-2xl leading-none text-white/90 hover:text-white"
                aria-label="Cerrar ficha"
              >
                ×
              </button>
              <div className="text-[17px] font-bold pr-8">{contract.n}</div>
              <div className="mt-1.5 flex items-center gap-2 text-xs text-[#bcd]">
                <TipoTag tipo={contract.tipo} full />
                <RiesgoTag riesgo={contract.riesgo} />
                <SemaforoDot semaforo={contract.semaforo} size={12} />
                {SEMAFORO_META[contract.semaforo].label}
              </div>
            </header>

            <div className="px-6 py-5">
              <div className="grid grid-cols-2 gap-x-5 gap-y-3 mb-4">
                <KV k="CUIT" v={contract.cuit} />
                <KV k="Estado" v={estadoLabel(contract.estado)} />
                <KV k="Canon mensual" v={`${formatCanon(contract)} ${contract.mon}`} />
                <KV k="Ajuste" v={contract.ajuste} />
                <KV k="Superficie" v={contract.m2 ? `${contract.m2} m²` : "—"} />
                <KV k="Renov. automática" v={contract.renov ? "Sí" : "No"} />
                <KV k="Inicio" v={formatFecha(contract.ini)} />
                <KV
                  k="Vencimiento"
                  v={`${formatFecha(contract.venc)}${
                    contract.meses_rest != null ? ` · ${Math.round(contract.meses_rest)} m` : ""
                  }`}
                />
                <KV k="Plazo / Preaviso" v={`${contract.plazo} / ${contract.preaviso}`} />
                <KV k="Firma" v={contract.firma} />
                <KV k="Ubicación / depósito" v={contract.ubic} wide />
              </div>

              <Block
                label="Penalidad por rescisión anticipada"
                body={contract.pen}
                bg="#FBEDED"
                border="#D14343"
                labelColor="#D14343"
              />
              <Block label="Hallazgos" body={contract.hall} bg="#FBF6E9" border="#C8A24B" labelColor="#0E2A47" />
              <Block label="Recomendación" body={contract.reco} bg="#EAF3FB" border="#2E6FB0" labelColor="#0E2A47" />

              {contract.desact && (
                <p className="text-[11px] text-fg-muted">
                  * Canon a valor histórico de origen; el valor vigente actualizado por índice es
                  materialmente superior.
                </p>
              )}

              <DriveStub />
            </div>
          </>
        )}
      </aside>
    </>
  );
}

function Block({
  label,
  body,
  bg,
  border,
  labelColor,
}: {
  label: string;
  body: string;
  bg: string;
  border: string;
  labelColor: string;
}) {
  return (
    <div
      className="rounded-lg px-4 py-3 mb-2.5 text-[13px] leading-relaxed text-[#1C2733]"
      style={{ background: bg, borderLeft: `4px solid ${border}` }}
    >
      <span className="block mb-1 text-[10.5px] font-bold uppercase" style={{ color: labelColor }}>
        {label}
      </span>
      {body}
    </div>
  );
}

/**
 * Placeholder de la integración futura con Google Drive (Cap. 6.8): aquí se
 * vincularán contrato, adendas, rescisiones, cartas documento y NOSIS. La
 * arquitectura (`contract_documents.drive_file_id + url`) ya queda preparada; la
 * sincronización NO se implementa todavía.
 */
function DriveStub() {
  return (
    <div className="mt-3 rounded-lg border border-dashed border-stroke-soft px-4 py-3">
      <div className="text-[10.5px] font-bold uppercase tracking-wide text-fg-muted">
        Documentación vinculada
      </div>
      <p className="mt-1 text-[12px] text-fg-muted">
        Integración con Google Drive prevista (Fase 5): contrato, adendas, rescisiones, cartas
        documento y NOSIS. Arquitectura preparada — sincronización pendiente.
      </p>
    </div>
  );
}
