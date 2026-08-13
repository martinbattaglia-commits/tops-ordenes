"use client";

/**
 * P3-N1B · Selector canónico de cliente para cabeceras WMS.
 *
 * Al servidor viaja EXCLUSIVAMENTE el UUID canónico (o el escape explícito
 * «cliente no listado» como texto libre). La razón social es sólo etiqueta.
 * No se puede tipear un cliente libre por defecto, no se crean clientes desde
 * acá y no se infiere nada por nombre.
 */

export interface ClientSelectOptionUI {
  id: string;
  razon: string;
}

export interface ClientSelectionState {
  client_id: string;
  unlisted: boolean;
  unlisted_name: string;
}

export const EMPTY_CLIENT_SELECTION: ClientSelectionState = {
  client_id: "",
  unlisted: false,
  unlisted_name: "",
};

/** ¿La selección está completa para habilitar el submit? */
export function clientSelectionValid(s: ClientSelectionState): boolean {
  return s.unlisted ? s.unlisted_name.trim().length > 0 : s.client_id.length > 0;
}

/** Payload que consume resolveClientSelection() server-side. */
export function toClientSelectionPayload(
  s: ClientSelectionState,
): { client_id?: string; unlisted_client_name?: string } {
  return s.unlisted
    ? { unlisted_client_name: s.unlisted_name.trim() }
    : { client_id: s.client_id };
}

export function ClientSelector({
  options,
  value,
  onChange,
  initialLabel,
}: {
  options: ClientSelectOptionUI[];
  value: ClientSelectionState;
  onChange: (next: ClientSelectionState) => void;
  /** Etiqueta descriptiva de la fila existente (edición de legados sin client_id). */
  initialLabel?: string | null;
}) {
  return (
    <div className="flex flex-col gap-2">
      {!value.unlisted ? (
        <select
          className="input w-full"
          value={value.client_id}
          onChange={(e) => onChange({ ...value, client_id: e.target.value })}
        >
          <option value="">— elegir cliente —</option>
          {options.map((c) => (
            <option key={c.id} value={c.id}>
              {c.razon}
            </option>
          ))}
        </select>
      ) : (
        <input
          className="input w-full"
          value={value.unlisted_name}
          placeholder="Nombre del cliente no listado"
          onChange={(e) => onChange({ ...value, unlisted_name: e.target.value })}
        />
      )}
      <label className="flex items-center gap-2 text-xs text-fg-muted cursor-pointer">
        <input
          type="checkbox"
          checked={value.unlisted}
          onChange={(e) =>
            onChange({ ...value, unlisted: e.target.checked, client_id: "", unlisted_name: "" })
          }
        />
        Cliente no listado (queda pendiente de resolución administrativa)
      </label>
      {initialLabel && !value.unlisted && !value.client_id && (
        <div className="text-[10px] text-fg-muted">
          Actual: <span className="font-medium">{initialLabel}</span> (sin identidad canónica — elegí el
          cliente para resolverla)
        </div>
      )}
    </div>
  );
}
