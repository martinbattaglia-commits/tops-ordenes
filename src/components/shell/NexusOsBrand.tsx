/**
 * Marca NEXUS OS (resolución de Dirección 07-26): reemplaza el wordmark
 * "TOPS NEXUS / OPERATING SYSTEM" bajo el isologo de Logística TOPS.
 * Reconstrucción vectorial fiel del arte provisto (ícono N de nodos en azul,
 * "CORE OPERATING SYSTEM" azul, "NEXUS OS" gris) — nítida en toda densidad.
 */
export function NexusOsBrand() {
  return (
    <div className="mt-2 flex items-center justify-center gap-2.5">
      <svg viewBox="0 0 100 100" className="h-9 w-9 shrink-0" aria-hidden="true">
        <g stroke="#3B4CC8" strokeWidth="9" strokeLinecap="round" fill="none">
          <line x1="24" y1="24" x2="24" y2="76" />
          <line x1="76" y1="24" x2="76" y2="76" />
          <line x1="24" y1="24" x2="76" y2="76" />
        </g>
        <g fill="none" stroke="#3B4CC8" strokeWidth="9">
          <circle cx="24" cy="24" r="10" />
          <circle cx="76" cy="24" r="10" />
          <circle cx="24" cy="76" r="10" />
          <circle cx="76" cy="76" r="10" />
        </g>
        <circle cx="50" cy="50" r="7" fill="#3B4CC8" />
      </svg>
      <div className="text-left leading-none">
        <div className="text-[8px] font-bold uppercase tracking-[0.22em] text-[#4C63D2]">
          Core Operating System
        </div>
        <div className="mt-1 text-[17px] font-black tracking-[0.08em] text-neutral-400">
          NEXUS OS
        </div>
      </div>
    </div>
  );
}
