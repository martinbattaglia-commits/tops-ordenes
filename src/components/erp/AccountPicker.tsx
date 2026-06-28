"use client";

import { ACCOUNT_TYPE_LABEL, type AccountType, type ChartAccount } from "@/lib/erp/types";

/**
 * Selector reutilizable de cuenta del Plan de Cuentas. Alimentado por
 * `listChartOfAccounts()` (el server component padre pasa las cuentas).
 * Usado en legajos (proveedores/clientes) y donde haga falta imputar a una cuenta.
 * El valor es el `code` de la cuenta (ej. '6.1.10'), consistente con
 * `accounting_rules.account_code` y `vendors/clients.cuenta_contable`.
 */
export function AccountPicker({
  accounts,
  value,
  onChange,
  placeholder = "Sin imputar",
  disabled,
  id,
}: {
  accounts: ChartAccount[];
  value: string;
  onChange: (code: string) => void;
  placeholder?: string;
  disabled?: boolean;
  id?: string;
}) {
  // Solo cuentas imputables y activas pueden seleccionarse.
  const selectable = accounts.filter((a) => a.is_postable && a.is_active);

  // Agrupar por tipo, respetando orden contable.
  const order: AccountType[] = ["activo", "pasivo", "patrimonio_neto", "ingreso", "gasto", "orden"];
  const groups = order
    .map((t) => ({ type: t, rows: selectable.filter((a) => a.type === t) }))
    .filter((g) => g.rows.length > 0);

  // Si el valor guardado no está en la lista seleccionable (otro tipo, cuenta
  // luego marcada no-imputable, o catálogo degradado), lo mostramos igual para
  // NO blanquearlo silenciosamente. Preserva el código persistido.
  const currentInList = !value || selectable.some((a) => a.code === value);
  const currentAcc = value ? accounts.find((a) => a.code === value) : undefined;

  return (
    <select
      id={id}
      className="input"
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">{placeholder}</option>
      {!currentInList && value && (
        <option value={value}>
          {currentAcc ? `${value} · ${currentAcc.name}` : value} (cuenta actual)
        </option>
      )}
      {groups.map((g) => (
        <optgroup key={g.type} label={ACCOUNT_TYPE_LABEL[g.type]}>
          {g.rows.map((a) => (
            <option key={a.code} value={a.code}>
              {a.code} · {a.name}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}
