/**
 * Loading screen global (Root Suspense Fallback).
 *
 * Renderiza de forma ligera y robusta durante la transición inicial o de rutas.
 * Logo con clases estrictas (w-16 h-16 max-w-[80px] object-contain) para evitar desbordes.
 */
export default function Loading() {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-bg-page select-none">
      <div className="relative flex flex-col items-center gap-4 p-8">
        {/* Halo radial de fondo */}
        <div className="absolute inset-0 -z-10 rounded-full bg-tops-blue-900/5 blur-2xl pointer-events-none" aria-hidden />

        {/* Logo SVG oficial con tamaño estricto w-16 h-16 max-w-[80px] object-contain */}
        <div className="relative flex items-center justify-center w-16 h-16 max-w-[80px] max-h-[80px]">
          <svg
            viewBox="0 0 100 100"
            className="w-16 h-16 max-w-[80px] max-h-[80px] object-contain animate-pulse"
            aria-hidden="true"
          >
            <g stroke="#3B4CC8" strokeWidth="8" strokeLinecap="round" fill="none">
              <line x1="24" y1="24" x2="24" y2="76" />
              <line x1="76" y1="24" x2="76" y2="76" />
              <line x1="24" y1="24" x2="76" y2="76" />
            </g>
            <g fill="#3B4CC8" stroke="#3B4CC8" strokeWidth="4">
              <circle cx="24" cy="24" r="8" />
              <circle cx="76" cy="24" r="8" />
              <circle cx="24" cy="76" r="8" />
              <circle cx="76" cy="76" r="8" />
            </g>
            <circle cx="50" cy="50" r="6" fill="#C90812" />
          </svg>
        </div>

        {/* Wordmark */}
        <div className="flex flex-col items-center gap-0.5 text-center">
          <span className="text-sm font-black tracking-[0.25em] text-tops-blue-900 dark:text-fg-link">
            TOPS NEXUS
          </span>
          <span className="text-[9px] font-bold uppercase tracking-[0.25em] text-fg-muted">
            Sistema Operativo
          </span>
        </div>

        {/* Barra de progreso indeterminada */}
        <div
          className="w-40 h-1 rounded-full bg-neutral-200 dark:bg-neutral-800 overflow-hidden relative"
          role="progressbar"
          aria-label="Cargando"
        >
          <div className="absolute inset-y-0 w-1/3 bg-gradient-to-r from-[#3B4CC8] to-[#C90812] rounded-full animate-pulse" />
        </div>

        <div className="text-[10px] uppercase tracking-wider text-fg-muted/70 mt-1">
          Inicializando módulos · Logística TOPS
        </div>
      </div>
    </div>
  );
}
