import { Icon } from "@/components/Icon";
import { AmbaMap } from "@/components/ejecutivo/AmbaMap";
import { LOCATIONS } from "@/lib/ejecutivo/data";

export const metadata = { title: "Mapa operativo" };
export const dynamic = "force-dynamic";

/**
 * QW Fase 1 (2026-05-29):
 *  - Se eliminó la lista hardcoded FLEET (5 vehículos ficticios con choferes,
 *    patentes y ETAs inventados).
 *  - La flota real-time requiere integración con tracker GPS de los vehículos
 *    propios de Verotin S.A. — pendiente de Fase 2.
 *  - Las ocupaciones por depósito (occupancyPct, activeOps) ahora son null
 *    hasta que exista una fuente operativa real.
 */

export default function MapaOperativoPage() {
  return (
    <div className="p-4 md:p-7 lg:p-8 space-y-6">
      <div className="page-header">
        <div>
          <div className="eyebrow-tiny">Operaciones · CABA</div>
          <h1 className="page-title">Mapa operativo</h1>
          <p className="page-subtitle">
            {LOCATIONS.length} sedes operativas en CABA · monitoreo perimetral 24/7
          </p>
        </div>
        <div className="flex gap-2">
          <button className="btn btn-ghost btn-sm" type="button" disabled>
            <Icon name="refresh" size={14} />
            <span>Refrescar</span>
          </button>
        </div>
      </div>

      {/* Pendiente banner */}
      <div className="card p-4 border-status-warning/30 bg-status-warning/5 flex items-start gap-3">
        <Icon name="wand" size={18} className="text-status-warning mt-0.5 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-bold text-fg-primary">Tracking de flota — pendiente de integración</div>
          <div className="text-[12px] text-fg-secondary mt-1">
            La sección de flota en tiempo real (vehículos, choferes, ETAs) se conecta en Fase 2 con
            el tracker GPS de Verotin. Por el momento solo se muestran las locaciones operativas.
          </div>
        </div>
      </div>

      {/* Mapa */}
      <div className="card overflow-hidden">
        <div className="px-5 py-4 border-b border-stroke-soft flex items-center justify-between">
          <div>
            <div className="text-sm font-bold text-fg-primary">Locaciones en CABA</div>
            <div className="text-[11px] text-fg-secondary mt-0.5">
              Magaldi · Barracas · Pedro de Luján
            </div>
          </div>
        </div>
        <div className="p-5">
          <AmbaMap locations={LOCATIONS} />
        </div>
      </div>

      {/* Locations grid */}
      <div className="card overflow-hidden">
        <div className="px-5 py-4 border-b border-stroke-soft">
          <div className="text-sm font-bold text-fg-primary">Sedes</div>
          <div className="text-[11px] text-fg-secondary mt-0.5">
            Ocupación y operaciones activas pendientes de integración con sondas IoT y entrada operativa.
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-5">
          {LOCATIONS.map((loc) => (
            <div key={loc.id} className="card card-lift p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className={`text-[10px] font-bold uppercase tracking-[0.16em] ${loc.tag === "ANMAT" ? "text-tops-red" : "text-fg-muted"}`}>
                    {loc.tag}
                  </div>
                  <div className="text-lg font-bold text-fg-brand">{loc.name}</div>
                  <div className="text-[11px] text-fg-muted">{loc.address}</div>
                </div>
                <span className="flex items-center gap-1.5 text-[11px] text-status-success font-bold">
                  <span className="w-1.5 h-1.5 rounded-full bg-status-success animate-pulse" />
                  Online
                </span>
              </div>
              <div className="grid grid-cols-3 gap-3 mt-4 pt-4 border-t border-stroke-soft">
                <KV
                  label="Ocupación"
                  value={loc.occupancyPct !== null ? `${loc.occupancyPct}%` : "—"}
                  accent={loc.occupancyPct !== null}
                />
                <KV label="m² operativos" value={loc.m2.toLocaleString("es-AR")} />
                <KV
                  label="Ops activos"
                  value={loc.activeOps !== null ? String(loc.activeOps) : "—"}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function KV({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div>
      <div className="text-[9px] uppercase tracking-[0.16em] font-bold text-fg-muted">{label}</div>
      <div className={`text-sm font-bold tabular mt-0.5 ${accent ? "text-tops-red" : "text-fg-primary"}`}>
        {value}
      </div>
    </div>
  );
}
