import Link from "next/link";
import { Icon } from "@/components/Icon";
import { getTwin, type TwinSector, type TwinPosition } from "@/lib/wms/twin";
import { POSITION_STATUS_META, type PositionStatus } from "@/lib/wms/types";
import { ModuleUnavailable } from "@/components/shell/ModuleUnavailable";

export const metadata = { title: "Mapa Inteligente · Operaciones" };
export const dynamic = "force-dynamic";

const STATUSES: PositionStatus[] = ["disponible", "reservado", "ocupado", "mantenimiento"];

const TYPE_BADGE: Record<string, string> = {
  mixed: "Mixto",
  anmat: "ANMAT",
  general: "General",
};

export default async function MapaInteligentePage({
  searchParams,
}: {
  searchParams: { pos?: string };
}) {
  const highlight = searchParams?.pos;

  let twin: Awaited<ReturnType<typeof getTwin>>;
  try {
    twin = await getTwin();
  } catch (e) {
    return (
      <ModuleUnavailable
        title="Mapa Inteligente no disponible"
        migration="0020_wms_physical_model · 0023_lujan_cubiculos"
        detail={e instanceof Error ? e.message : String(e)}
      />
    );
  }

  return (
    <div className="p-4 lg:p-8 nx-page-fade">
      <div className="page-header">
        <div>
          <div className="eyebrow-tiny">Operaciones · Digital Twin</div>
          <h1 className="page-title">Mapa Inteligente de Depósitos</h1>
          <p className="page-subtitle">
            Gemelo digital logístico de TOPS: sedes, pisos, sectores y cubículos. La
            ocupación se deriva automáticamente del inventario.
          </p>
        </div>
        <Link href="/operaciones/mapa" className="btn btn-ghost btn-sm mt-1">
          <Icon name="arrow-left" size={12} /> Mapa operativo
        </Link>
      </div>

      {/* Leyenda */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        {STATUSES.map((s) => (
          <span key={s} className="inline-flex items-center gap-1.5 text-xs text-fg-secondary">
            <span
              className="w-3 h-3 rounded"
              style={{ background: POSITION_STATUS_META[s].color }}
            />
            {POSITION_STATUS_META[s].label}
          </span>
        ))}
        {highlight && (
          <span className="inline-flex items-center gap-1.5 text-xs text-fg-brand font-semibold ml-auto">
            <Icon name="pin" size={12} /> Posición resaltada desde el inventario
          </span>
        )}
      </div>

      <div className="flex flex-col gap-6">
        {twin.map((wh) => (
          <div key={wh.id} className="nx-surface card overflow-hidden">
            <div className="px-4 py-3 border-b border-stroke-soft flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Icon name="building" size={16} className="text-fg-muted" />
                <span className="font-mono text-sm font-bold text-fg-brand">{wh.code}</span>
                <span className="text-xs text-fg-muted">· {wh.name}</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded bg-bg-surface-alt text-fg-secondary">
                  {TYPE_BADGE[wh.warehouse_type] ?? wh.warehouse_type}
                </span>
                {wh.surface_m2 != null && (
                  <span className="text-xs text-fg-muted tabular">
                    {wh.surface_m2.toLocaleString("es-AR")} m²
                  </span>
                )}
              </div>
            </div>

            <div className="p-4 flex flex-col gap-5">
              {wh.floors.map((fl) => (
                <div key={fl.id}>
                  <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-fg-muted mb-2">
                    {fl.code} · {fl.name}
                  </div>

                  {fl.sectors.length === 0 ? (
                    <div className="text-xs text-fg-muted italic">Sin sectores cargados.</div>
                  ) : (
                    <div className="flex flex-col gap-4">
                      {fl.sectors.map((sec) =>
                        sec.positions.length > 0 ? (
                          <CubicleSector key={sec.id} sector={sec} highlight={highlight} />
                        ) : (
                          <SectorChip key={sec.id} sector={sec} />
                        )
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SectorChip({ sector }: { sector: TwinSector }) {
  return (
    <div className="inline-flex items-center gap-2 self-start rounded-lg border border-stroke-soft bg-bg-surface-alt px-3 py-2">
      <span className="font-mono text-xs font-bold text-fg-brand">{sector.code}</span>
      <span className="text-xs text-fg-secondary">{sector.name}</span>
      {sector.surface_m2 != null && (
        <span className="text-[11px] text-fg-muted tabular">{sector.surface_m2} m²</span>
      )}
    </div>
  );
}

function CubicleSector({
  sector,
  highlight,
}: {
  sector: TwinSector;
  highlight?: string;
}) {
  const left = sector.positions.filter((p) => (p.rack_code ?? "A") === "A");
  const right = sector.positions.filter((p) => p.rack_code === "B");
  // Fallback si rack_code no viene: partir por mitad.
  const hasRacks = right.length > 0;
  const colL = hasRacks ? left : sector.positions.slice(0, Math.ceil(sector.positions.length / 2));
  const colR = hasRacks ? right : sector.positions.slice(Math.ceil(sector.positions.length / 2));

  return (
    <div className="rounded-lg border border-stroke-soft p-3">
      <div className="flex items-center gap-2 mb-3">
        <span className="font-mono text-xs font-bold text-fg-brand">{sector.code}</span>
        <span className="text-xs text-fg-secondary">{sector.name}</span>
        <span className="text-[11px] text-fg-muted">· {sector.positions.length} cubículos</span>
      </div>

      <div className="flex items-stretch gap-3 max-w-md">
        <Column positions={colL} highlight={highlight} />
        <div className="flex flex-col items-center justify-center px-1">
          <div className="flex-1 w-px bg-stroke-soft" />
          <span className="text-[8px] font-bold uppercase tracking-[0.2em] text-fg-muted [writing-mode:vertical-rl] my-1">
            Pasillo
          </span>
          <div className="flex-1 w-px bg-stroke-soft" />
        </div>
        <Column positions={colR} highlight={highlight} />
      </div>
    </div>
  );
}

function Column({ positions, highlight }: { positions: TwinPosition[]; highlight?: string }) {
  return (
    <div className="flex-1 flex flex-col gap-1.5">
      {positions.map((p) => (
        <Cubicle key={p.id} pos={p} active={highlight === p.id} />
      ))}
    </div>
  );
}

function Cubicle({ pos, active }: { pos: TwinPosition; active: boolean }) {
  const meta = POSITION_STATUS_META[pos.status];
  const total = pos.stock_available + pos.stock_reserved;
  const title = pos.occupied
    ? `${pos.code} · ${meta.label} (${pos.stock_available.toLocaleString("es-AR")} disp` +
      (pos.stock_reserved > 0 ? ` + ${pos.stock_reserved.toLocaleString("es-AR")} res` : "") +
      `)`
    : `${pos.code} · ${meta.label}`;
  return (
    <div
      className="flex items-center justify-between rounded px-2.5 py-2 text-xs font-semibold transition-all"
      style={{
        background: `${meta.color}1a`,
        border: `1px solid ${meta.color}`,
        color: meta.color,
        boxShadow: active ? `0 0 0 2px var(--bg-surface), 0 0 0 4px ${meta.color}` : undefined,
      }}
      title={title}
    >
      <span className="font-mono tabular text-fg-primary">{pos.code}</span>
      <span className="inline-flex items-center gap-1.5">
        {pos.occupied && (
          <span className="text-[10px] tabular opacity-80">{total.toLocaleString("es-AR")}</span>
        )}
        {active && <Icon name="pin" size={11} />}
        <span className="w-1.5 h-1.5 rounded-full" style={{ background: meta.color }} />
      </span>
    </div>
  );
}
