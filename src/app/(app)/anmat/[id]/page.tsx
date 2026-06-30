import type { CSSProperties } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Icon } from "@/components/Icon";
import { EntityConversationButton } from "@/components/connect/EntityConversationButton";
import { RiskBadge } from "@/components/compliance/ui";
import { RISK_HEX, RISK_LABEL } from "@/lib/compliance/data";
import { loadComplianceItem } from "@/lib/compliance/source";

export const metadata = { title: "Ficha regulatoria · Compliance Cockpit" };
export const dynamic = "force-dynamic";

function Field({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-fg-muted">{label}</div>
      <div className={`text-sm text-fg-primary ${mono ? "font-mono" : ""}`}>{value || <span className="text-fg-muted">—</span>}</div>
    </div>
  );
}

export default async function FichaRegulatoriaPage({ params }: { params: { id: string } }) {
  const item = await loadComplianceItem(params.id);
  if (!item) notFound();
  const hex = RISK_HEX[item.riesgo];
  const diasTxt = item.dias === null ? "—" : item.dias < 0 ? `${Math.abs(item.dias)} días vencido` : `${item.dias} días`;

  return (
    <div className="p-4 md:p-7 lg:p-8 space-y-6 nx-page-fade max-w-[1100px] mx-auto">
      <div>
        <Link href="/anmat#matriz" className="text-[11px] text-fg-link hover:underline">← Matriz regulatoria</Link>
        <div className="flex flex-wrap items-center gap-3 mt-1">
          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-bg-surface-alt text-fg-muted">{item.id}</span>
          <RiskBadge riesgo={item.riesgo}>{item.estado}</RiskBadge>
          <span className="text-[11px] text-fg-muted">{item.sede}</span>
        </div>
        <div className="flex flex-wrap items-start justify-between gap-3 mt-1">
          <div>
            <h1 className="page-title">{item.documento}</h1>
            <p className="page-subtitle">{item.categoria} · {item.organismo}</p>
          </div>
          <EntityConversationButton entityType="compliance_items" entityId={item.id} />
        </div>
      </div>

      {/* Riesgo + fechas destacado */}
      <section className="card p-5 grid grid-cols-1 md:grid-cols-[auto_1fr] gap-6 items-center">
        <div className="flex flex-col items-center justify-center rounded-lg p-5 min-w-[160px]" style={{ background: `${hex}14`, border: `1px solid ${hex}55` } as CSSProperties}>
          <Icon name="shield" size={26} style={{ color: hex } as CSSProperties} />
          <div className="text-lg font-black mt-1.5" style={{ color: hex } as CSSProperties}>{RISK_LABEL[item.riesgo]}</div>
          <div className="text-[11px] text-fg-muted mt-0.5">Riesgo {item.riesgo}</div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <Field label="Emisión" value={item.emi_fmt} />
          <Field label="Vencimiento" value={<span style={{ color: item.dias !== null && item.dias < 90 ? hex : undefined } as CSSProperties}>{item.venc_fmt}</span>} />
          <Field label="Días" value={<span className="tabular font-bold" style={{ color: item.dias !== null && item.dias < 90 ? hex : undefined } as CSSProperties}>{diasTxt}</span>} />
          <Field label="Estado" value={item.estado} />
        </div>
      </section>

      {/* Datos regulatorios */}
      <section className="card p-5">
        <h2 className="font-semibold mb-3 flex items-center gap-2"><Icon name="report" size={15} /> Datos regulatorios</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <Field label="Organismo" value={item.organismo} />
          <Field label="Categoría" value={item.categoria} />
          <Field label="Sede" value={item.sede} />
          <Field label="Tipo de documento" value={item.tipo} />
          <Field label="Frecuencia" value={item.frecuencia} />
          <Field label="Fuente de auditoría" value={item.fuente} />
        </div>
      </section>

      {/* Notas de auditoría */}
      <section className="card p-5">
        <h2 className="font-semibold mb-3 flex items-center gap-2"><Icon name="pen" size={15} /> Notas de auditoría</h2>
        <p className="text-sm text-fg-secondary leading-relaxed">{item.nota}</p>
      </section>

      {/* Documentación asociada (Drive) — arquitectura preparada, sin ingesta */}
      <section className="card p-5">
        <h2 className="font-semibold mb-3 flex items-center gap-2"><Icon name="drive" size={15} /> Documentación asociada (Drive)</h2>
        <div className="flex items-center justify-between gap-4 mb-3">
          <div className="text-sm text-fg-secondary">
            <span className="text-2xl font-black tabular text-fg-brand">{item.docs}</span>
            <span className="ml-2">documentos de respaldo identificados en la auditoría del Drive.</span>
          </div>
          <button type="button" disabled className="btn btn-ghost btn-sm opacity-60 cursor-not-allowed" title="Disponible con la ingesta automática">
            <Icon name="paperclip" size={14} /> Vincular documento
          </button>
        </div>
        <div className="rounded-lg border border-dashed border-stroke-soft p-4 text-[12.5px] text-fg-muted leading-relaxed">
          <b className="text-fg-secondary">Arquitectura preparada (sin ingesta aún).</b> La vinculación <span className="font-mono">Drive → Documento → Ítem regulatorio</span> se habilitará con la ingesta automática (fase futura). Modelo previsto:
          <code className="block mt-2 text-[11px] text-fg-secondary">compliance_documents (storage_path, sha256, item_id → compliance_items.id, fecha_extraida, organismo_detectado)</code>
          Hoy esta ficha lee del dataset oficial (snapshot 08/06/2026); no hay binarios vinculados.
        </div>
      </section>

      <div className="flex justify-between text-[11px] text-fg-muted">
        <Link href="/anmat#matriz" className="text-fg-link hover:underline">← Volver a la matriz</Link>
        <span>Fuente: COMPLIANCE-AUDIT-MASTER-REPORT · 08/06/2026</span>
      </div>
    </div>
  );
}
