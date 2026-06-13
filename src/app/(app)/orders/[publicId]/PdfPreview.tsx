import { Icon } from "@/components/Icon";
import { fmtCurrency, fmtDate, fmtDateTime, isUrgentOrder } from "@/lib/utils";
import type { Order } from "@/lib/types";

export function PdfPreview({ order, qrSvg }: { order: Order; qrSvg: string }) {
  return (
    <div
      className="pdf-paper card bg-white shadow-md mx-auto"
      style={{
        aspectRatio: "1 / 1.414",
        maxWidth: 760,
        padding: "32px 36px",
      }}
    >
      {/* Header */}
      <div className="flex items-start justify-between pb-3 border-b-2 border-tops-blue-900 mb-4">
        <div>
          <div className="flex items-end gap-1.5 mb-1">
            <span className="text-2xl font-black uppercase tracking-tight text-tops-blue-900">
              TOPS
            </span>
            <span className="text-[10px] uppercase tracking-[0.18em] font-bold text-tops-red mb-1">
              Logística
            </span>
          </div>
          <div className="text-[9px] text-fg-secondary leading-relaxed">
            Verotin S.A. · IVA Responsable Inscripto
            <br />
            Agustín Magaldi 1765 — CABA · Argentina
            <br />
            Tel/Fax: 4302-3944 · www.logisticatops.com
          </div>
        </div>
        <div className="text-right">
          <div className="text-[9px] font-bold uppercase tracking-[0.16em] text-tops-red mb-1">
            Orden de Servicio
          </div>
          <div className="font-mono text-lg font-bold text-fg-brand mb-1">{order.public_id}</div>
          {isUrgentOrder(order) && (
            <div className="inline-flex items-center gap-1 mb-1 px-2 py-0.5 rounded bg-tops-red text-white text-[9px] font-black uppercase tracking-[0.12em]">
              🚨 Urgente
            </div>
          )}
          <div className="text-[9px] text-fg-secondary leading-relaxed">
            Fecha: <strong className="text-fg-primary">{fmtDate(order.date)}</strong>
            <br />
            COD SAP: <strong className="font-mono text-fg-primary">{order.short_id}</strong>
          </div>
        </div>
      </div>

      <Section title="Datos del cliente">
        <div className="grid grid-cols-1 sm:grid-cols-[2fr_1.4fr] gap-3 text-[11px]">
          <Row label="Razón Social" value={order.client?.razon ?? "—"} bold />
          <Row label="C.U.I.T." value={order.client?.cuit ?? "—"} />
          <Row label="Domicilio" value={order.client?.domicilio ?? "—"} />
          <Row label="Contacto" value={order.client?.contacto ?? "—"} />
        </div>
      </Section>

      <Section title="Datos operativos">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-[11px]">
          <Row label="Depósito" value={order.depot === "MAGALDI" ? "Magaldi" : "Luján"} />
          <Row label="Responsable" value={order.operator?.full_name ?? "—"} />
          <Row label="Hora inicio" value={order.h_start ?? "—"} />
          <Row label="Hora fin" value={order.h_end ?? "—"} />
        </div>
      </Section>

      <Section title="Detalle del servicio">
        <table className="w-full text-[10px] border-collapse">
          <thead>
            <tr className="bg-tops-blue-900 text-white">
              <th className="px-2.5 py-1.5 text-left font-bold">Servicio</th>
              <th className="px-2.5 py-1.5 text-right font-bold">Cant.</th>
              <th className="px-2.5 py-1.5 text-left font-bold">Unidad</th>
              <th className="px-2.5 py-1.5 text-right font-bold">Tarifa</th>
              <th className="px-2.5 py-1.5 text-right font-bold">Subtotal</th>
            </tr>
          </thead>
          <tbody>
            {(order.services ?? []).map((s, i) => (
              <tr key={i} className="border-b border-stroke-soft">
                <td className="px-2.5 py-1.5 font-medium">{s.label}</td>
                <td className="px-2.5 py-1.5 text-right tabular">{s.qty}</td>
                <td className="px-2.5 py-1.5">{s.unit}</td>
                <td className="px-2.5 py-1.5 text-right tabular">{fmtCurrency(s.rate)}</td>
                <td className="px-2.5 py-1.5 text-right tabular font-semibold">
                  {fmtCurrency(s.subtotal)}
                </td>
              </tr>
            ))}
            <tr>
              <td colSpan={2} className="px-2.5 py-2 text-[9px] text-fg-muted">
                Pallets: {order.pallets} · Unidades: {order.units} · Km: {order.km}
              </td>
              <td colSpan={2} className="px-2.5 py-2 text-right font-bold text-fg-brand">
                Total estimado
              </td>
              <td className="px-2.5 py-2 text-right font-bold text-fg-brand tabular text-xs">
                {fmtCurrency(order.total)}
              </td>
            </tr>
          </tbody>
        </table>
      </Section>

      {order.observ && (
        <Section title="Observaciones">
          <div className="text-[10px] text-fg-primary leading-relaxed p-2.5 bg-neutral-50 rounded">
            {order.observ}
          </div>
        </Section>
      )}

      {/* Footer: firma + geo + QR */}
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_120px] gap-4 items-end pt-3 border-t border-stroke-soft mt-4">
        <div>
          <SectionLabel>Conforme del cliente</SectionLabel>
          <div className="border-b border-neutral-900 h-12 relative">
            {order.signature_url ? (
              <img
                src={order.signature_url}
                alt="Firma"
                className="absolute bottom-0 left-2 max-h-12 object-contain"
              />
            ) : (
              <ScriptSig name={order.signed_by ?? ""} />
            )}
          </div>
          <div className="text-[9px] text-fg-secondary mt-1">
            {order.signed_by ? (
              <>
                <strong className="text-fg-primary">{order.signed_by}</strong>
                {order.signed_at && <> · {fmtDateTime(order.signed_at)}</>}
              </>
            ) : (
              "Pendiente"
            )}
          </div>
        </div>
        <div>
          <SectionLabel>Geolocalización</SectionLabel>
          <div className="text-[9px] text-fg-secondary leading-relaxed">
            <Icon name="pin" size={10} className="inline-block text-tops-red -mt-0.5 mr-0.5" />
            {order.geo_lat && order.geo_lng
              ? `${order.geo_lat.toFixed(4)}, ${order.geo_lng.toFixed(4)}`
              : "—"}
            <br />
            IP: <span className="font-mono">{order.ip ?? "—"}</span>
            <br />
            {order.signature_hash && (
              <>
                Hash sha256:{" "}
                <span className="font-mono">{order.signature_hash.slice(0, 12)}…</span>
              </>
            )}
          </div>
        </div>
        <div className="w-[120px]">
          <SectionLabel>Verificar</SectionLabel>
          <div
            className="pdf-qr p-1.5 bg-white border border-stroke-soft rounded"
            dangerouslySetInnerHTML={{ __html: qrSvg }}
          />
          <div className="text-[7px] text-fg-muted text-center mt-1 tracking-wider uppercase">
            {order.public_id}
          </div>
        </div>
      </div>

      {/* Disclaimer */}
      <div className="mt-3 p-2 bg-neutral-50 rounded text-[8px] text-fg-secondary leading-relaxed">
        <strong className="text-fg-primary">SEGURO DE LAS MERCADERÍAS:</strong> Las mercaderías
        serán aseguradas por cuenta y riesgo del cliente, sin responsabilidad por los riesgos y/o
        daños que pudieran producirse durante el curso de su transporte, carga y/o descarga, con
        renuncia expresa del cliente y de la Cía. Aseguradora contratada a repetir y/o hacer
        cualquier reclamo eventual contra Logística TOPS.
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <SectionLabel>{title}</SectionLabel>
      {children}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[8px] font-bold uppercase tracking-[0.16em] text-fg-muted mb-1.5">
      {children}
    </div>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div>
      <div className="text-[8px] font-medium text-fg-muted tracking-wider mb-0.5">{label}</div>
      <div className={`text-[11px] ${bold ? "font-bold" : "font-medium"} text-fg-primary`}>
        {value}
      </div>
    </div>
  );
}

function ScriptSig({ name }: { name: string }) {
  if (!name) return null;
  return (
    <svg
      viewBox="0 0 240 60"
      className="absolute bottom-0 left-2 w-44 h-12"
      aria-label={`Firma de ${name}`}
    >
      <path
        d="M10 36 C 14 16, 24 20, 30 32 C 36 44, 32 22, 44 22 C 56 22, 50 42, 62 38 C 72 34, 68 18, 80 24 C 88 28, 84 42, 96 40 C 110 38, 100 18, 116 22 C 130 26, 124 44, 138 38 C 154 30, 144 18, 162 22 C 180 26, 178 40, 200 28"
        stroke="#214576"
        strokeWidth="1.8"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M50 46 Q 90 56, 140 46"
        stroke="#214576"
        strokeWidth="1.4"
        fill="none"
        strokeLinecap="round"
        opacity="0.7"
      />
    </svg>
  );
}
