import { Icon } from "@/components/Icon";

/**
 * Tarjeta de "Acceso restringido" para páginas gateadas por rol (Gate 5.5).
 * Se renderiza cuando un usuario sin el rol requerido alcanza una página sensible.
 */
export function RestrictedAccess({
  message = "Solo los administradores pueden acceder a esta sección.",
}: {
  message?: string;
}) {
  return (
    <div className="p-4 lg:p-8 max-w-2xl">
      <div className="card card-pad text-center">
        <Icon name="lock" size={28} className="mx-auto mb-2 text-fg-muted" />
        <h1 className="text-xl font-bold text-fg-brand mb-1">Acceso restringido</h1>
        <p className="text-fg-secondary text-sm">{message}</p>
      </div>
    </div>
  );
}
