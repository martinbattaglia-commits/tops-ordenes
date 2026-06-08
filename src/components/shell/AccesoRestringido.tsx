import { Icon } from "@/components/Icon";

/** Pantalla de acceso restringido por RBAC (reutiliza el patrón visual del codebase). */
export function AccesoRestringido({ modulo }: { modulo: string }) {
  return (
    <div className="p-8 max-w-xl">
      <div className="card p-6">
        <div className="flex items-center gap-2 mb-2">
          <Icon name="lock" size={16} className="text-tops-red" />
          <h1 className="text-lg font-bold text-fg-primary">Acceso restringido</h1>
        </div>
        <p className="text-sm text-fg-muted">
          No tenés permiso para ver <strong>{modulo}</strong>. Si creés que es un error,
          contactá a la Administración del sistema.
        </p>
      </div>
    </div>
  );
}
