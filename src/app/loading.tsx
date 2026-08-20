/**
 * Root Loading (Suspense Fallback).
 *
 * Spinner CSS puro mínimo y neutro, sin assets externos, sin imágenes y sin SVGs complejos.
 * Evita desbordes o bloqueos de render en Safari y navegadores WebKit.
 */
export default function Loading() {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-bg-page select-none">
      <div className="flex flex-col items-center gap-3">
        <div
          className="h-8 w-8 animate-spin rounded-full border-2 border-neutral-300 border-t-tops-blue-600 dark:border-neutral-700 dark:border-t-fg-link"
          style={{ width: "32px", height: "32px", maxWidth: "32px", maxHeight: "32px" }}
          role="status"
          aria-label="Cargando"
        />
        <span className="text-[11px] font-medium tracking-wider text-fg-muted uppercase">
          Cargando…
        </span>
      </div>
    </div>
  );
}
