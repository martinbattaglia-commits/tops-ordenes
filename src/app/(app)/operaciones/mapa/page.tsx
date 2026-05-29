import { Icon } from "@/components/Icon";
import { AmbaMap } from "@/components/ejecutivo/AmbaMap";
import { LOCATIONS } from "@/lib/ejecutivo/data";

export const metadata = { title: "Mapa operativo" };
export const dynamic = "force-dynamic";

interface Vehicle {
  id: string;
  type: "camion" | "utilitario" | "trailer";
  plate: string;
  driver: string;
  status: "en_ruta" | "carga" | "descarga" | "deposito" | "mantenimiento";
  from: string;
  to: string;
  etaMin?: number;
  lastUpdate: string;
}

const FLEET: Vehicle[] = [
  {
    id: "v01",
    type: "camion",
    plate: "AC-389-PT",
    driver: "Carlos Méndez",
    status: "en_ruta",
    from: "Magaldi",
    to: "Bidcom · Boyacá",
    etaMin: 24,
    lastUpdate: "hace 1 min",
  },
  {
    id: "v02",
    type: "trailer",
    plate: "AB-782-LM",
    driver: "Jorge Merino",
    status: "carga",
    from: "Pedro de Luján",
    to: "Mercado Libre · Arias",
    etaMin: 95,
    lastUpdate: "hace 4 min",
  },
  {
    id: "v03",
    type: "utilitario",
    plate: "AE-115-QW",
    driver: "Sebastián Romero",
    status: "descarga",
    from: "—",
    to: "L'Oréal · Libertador",
    etaMin: 0,
    lastUpdate: "hace 8 min",
  },
  {
    id: "v04",
    type: "camion",
    plate: "AD-456-NH",
    driver: "Luis Vega",
    status: "deposito",
    from: "—",
    to: "Magaldi",
    lastUpdate: "hace 12 min",
  },
  {
    id: "v05",
    type: "utilitario",
    plate: "AC-967-RT",
    driver: "Diego Pinto",
    status: "mantenimiento",
    from: "—",
    to: "Barracas (taller)",
    lastUpdate: "hace 2 h",
  },
];

const STATUS_META: Record<Vehicle["status"], { label: string; cls: string }> = {
  en_ruta: { label: "En ruta", cls: "badge-info" },
  carga: { label: "Cargando", cls: "badge-warning" },
  descarga: { label: "Descargando", cls: "badge-warning" },
  deposito: { label: "En depósito", cls: "badge-muted" },
  mantenimiento: { label: "Mantenimiento", cls: "badge-danger" },
};

export default function MapaOperativoPage() {
  const enRuta = FLEET.filter((v) => v.status === "en_ruta").length;
  const ops = FLEET.filter((v) => v.status === "carga" || v.status === "descarga").length;

  return (
    <div className="p-4 md:p-7 lg:p-8 space-y-6">
      <div className="page-header">
        <div>
          <div className="eyebrow-tiny">Operaciones · CABA · Tiempo real</div>
          <h1 className="page-title">Mapa operativo</h1>
          <p className="page-subtitle">
            3 sedes en CABA · {FLEET.length} vehículos en flota · {enRuta} en ruta · {ops} en operación
          </p>
        </div>
        <div className="flex gap-2">
          <button className="btn btn-ghost btn-sm" type="button">
            <Icon name="refresh" size={14} />
            <span className="hidden sm:inline">Refresh GPS</span>
          </button>
        </div>
      </div>

      <div className="grid gap-6" style={{ gridTemplateColumns: "minmax(0,1.6fr) minmax(0,1fr)" }}>
        {/* Map */}
        <div className="card overflow-hidden">
          <div className="p-5 md:p-6">
            <AmbaMap />
          </div>
          <div className="border-t border-stroke-soft px-5 py-3 flex items-center justify-between text-[11px] text-fg-muted">
            <span>Cobertura: CABA · 3 sedes operativas</span>
            <span className="font-mono">Lat -34.6 · Lng -58.4</span>
          </div>
        </div>

        {/* Locations cards */}
        <div className="space-y-3">
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
                <KV label="Ocupación" value={`${loc.occupancyPct}%`} accent />
                <KV label="m² operativos" value={loc.m2.toLocaleString("es-AR")} />
                <KV label="Ops activos" value={String(loc.activeOps)} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Fleet table */}
      <div className="card overflow-hidden">
        <div className="px-5 py-4 border-b border-stroke-soft flex items-center justify-between">
          <div>
            <div className="text-sm font-bold text-fg-primary">Flota propia · {FLEET.length} unidades</div>
            <div className="text-[11px] text-fg-secondary mt-0.5">
              Tracking GPS en tiempo real · cobertura CABA
            </div>
          </div>
          <span className="flex items-center gap-1.5 text-[11px] text-status-success font-bold">
            <span className="w-1.5 h-1.5 rounded-full bg-status-success animate-pulse" />
            LIVE
          </span>
        </div>
        <div className="hidden md:block overflow-x-auto">
          <table className="tbl">
            <thead>
              <tr>
                <th>Patente</th>
                <th>Tipo</th>
                <th>Chofer</th>
                <th>Origen → Destino</th>
                <th className="text-right">ETA</th>
                <th>Estado</th>
                <th>Última actualización</th>
              </tr>
            </thead>
            <tbody>
              {FLEET.map((v) => (
                <tr key={v.id}>
                  <td className="font-mono font-bold text-fg-brand">{v.plate}</td>
                  <td>
                    <span className="text-xs text-fg-secondary capitalize">{v.type}</span>
                  </td>
                  <td className="text-sm">{v.driver}</td>
                  <td className="text-xs text-fg-secondary">
                    {v.from} <Icon name="arrow-right" size={10} className="inline mx-1 text-fg-muted" /> {v.to}
                  </td>
                  <td className="text-right tabular text-sm">
                    {v.etaMin === undefined ? "—" : v.etaMin === 0 ? "Llegó" : `${v.etaMin} min`}
                  </td>
                  <td>
                    <span className={`badge ${STATUS_META[v.status].cls}`}>
                      <span className="dot" />
                      {STATUS_META[v.status].label}
                    </span>
                  </td>
                  <td className="text-[11px] text-fg-muted">{v.lastUpdate}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Mobile cards */}
        <div className="md:hidden divide-y divide-stroke-soft">
          {FLEET.map((v) => (
            <div key={v.id} className="p-4">
              <div className="flex items-center justify-between mb-1">
                <span className="font-mono font-bold text-fg-brand text-sm">{v.plate}</span>
                <span className={`badge ${STATUS_META[v.status].cls}`}>
                  <span className="dot" />
                  {STATUS_META[v.status].label}
                </span>
              </div>
              <div className="text-sm font-semibold text-fg-primary">{v.driver}</div>
              <div className="text-[11px] text-fg-secondary">
                {v.from} → {v.to}
              </div>
              <div className="text-[10px] text-fg-muted mt-0.5">{v.lastUpdate}</div>
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
      <div className="text-[10px] uppercase tracking-[0.1em] font-bold text-fg-muted mb-0.5">
        {label}
      </div>
      <div className={`text-lg font-bold tabular ${accent ? "text-tops-red" : "text-fg-primary"}`}>
        {value}
      </div>
    </div>
  );
}
