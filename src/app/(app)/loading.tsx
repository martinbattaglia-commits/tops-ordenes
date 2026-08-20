/**
 * Loading skeleton para rutas autenticadas dentro del Shell.
 *
 * Skeleton ligero no bloqueante que renderiza dentro del contenedor de contenido ({children}).
 */
export default function AppLoading() {
  return (
    <div className="p-6 md:p-8 animate-pulse space-y-6" role="status" aria-label="Cargando vista">
      <div className="space-y-2">
        <div className="h-4 w-32 bg-neutral-200 dark:bg-neutral-800 rounded" />
        <div className="h-7 w-64 bg-neutral-200 dark:bg-neutral-800 rounded" />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="h-28 bg-neutral-100 dark:bg-neutral-900 border border-stroke-soft rounded-lg p-4 space-y-3"
          >
            <div className="h-3 w-20 bg-neutral-200 dark:bg-neutral-800 rounded" />
            <div className="h-6 w-16 bg-neutral-200 dark:bg-neutral-700 rounded" />
          </div>
        ))}
      </div>
    </div>
  );
}
