import { Icon } from "@/components/Icon";

/**
 * Fallback uniforme para módulos cuyo backend (tabla/migración) todavía no
 * está disponible en el entorno actual. Se usa dentro de un try/catch a nivel
 * de página para degradar con gracia en vez de propagar el throw al
 * `app/error.tsx` raíz (que rompería todo el shell de la app).
 *
 * El módulo se enciende solo cuando la migración correspondiente se aplica en
 * la base — no requiere cambios de código.
 */
export function ModuleUnavailable({
  title,
  migration,
  detail,
}: {
  title: string;
  /** Nombre de la migración pendiente, ej. "0011_arca_billing". */
  migration: string;
  /** Mensaje técnico del error (se muestra colapsado para debug). */
  detail?: string;
}) {
  return (
    <div className="p-8">
      <div className="card p-8 max-w-2xl mx-auto">
        <div className="w-12 h-12 rounded-lg bg-status-warning/10 text-status-warning grid place-items-center mb-4">
          <Icon name="bolt" size={24} />
        </div>
        <h1 className="text-xl font-bold text-fg-brand mb-2">{title}</h1>
        <p className="text-sm text-fg-secondary mb-4">
          Este módulo depende de un esquema de base de datos que todavía no está
          aplicado en este entorno. Se activará automáticamente cuando se aplique
          la migración{" "}
          <code className="font-mono text-xs bg-neutral-100 px-1.5 py-0.5 rounded">
            {migration}
          </code>{" "}
          en Supabase — no requiere cambios de código.
        </p>
        {detail && (
          <details className="text-xs text-fg-muted">
            <summary className="cursor-pointer select-none font-semibold">
              Detalle técnico
            </summary>
            <pre className="mt-2 font-mono whitespace-pre-wrap break-all bg-neutral-50 p-3 rounded border border-stroke-soft">
              {detail}
            </pre>
          </details>
        )}
      </div>
    </div>
  );
}
