"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { Icon } from "@/components/Icon";
import { fmtCurrencyShort } from "@/lib/compras/format";
import type { Depot } from "@/lib/types";

interface Props {
  initialSearch: string;
  initialDepot: Depot | "todos";
  resultCount: number;
  sumTotal: number;
}

export function OrdersToolbar({ initialSearch, initialDepot, resultCount, sumTotal }: Props) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, start] = useTransition();
  const [search, setSearch] = useState(initialSearch);
  const [depot, setDepot] = useState<Depot | "todos">(initialDepot);

  const apply = (next: { search?: string; depot?: Depot | "todos" }) => {
    const sp = new URLSearchParams(params.toString());
    if (next.search !== undefined) {
      if (next.search) sp.set("search", next.search);
      else sp.delete("search");
    }
    if (next.depot !== undefined) {
      if (next.depot !== "todos") sp.set("depot", next.depot);
      else sp.delete("depot");
    }
    sp.set("page", "1");
    start(() => router.push(`/compras/ordenes?${sp.toString()}`));
  };

  return (
    <div className="card p-3 md:p-4 flex flex-col md:flex-row md:items-center gap-3">
      <div className="relative flex-1 min-w-0">
        <Icon
          name="search"
          size={14}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted"
        />
        <input
          type="search"
          inputMode="search"
          placeholder="Buscar OC, proveedor o CUIT…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") apply({ search });
          }}
          onBlur={() => apply({ search })}
          className="input pl-9"
        />
      </div>

      <FilterPill
        label="Depósito"
        value={depot === "todos" ? "Todos" : depot === "MAGALDI" ? "Magaldi" : "Luján"}
      >
        <select
          value={depot}
          onChange={(e) => {
            const v = e.target.value as Depot | "todos";
            setDepot(v);
            apply({ depot: v });
          }}
          className="absolute inset-0 opacity-0 cursor-pointer"
          aria-label="Filtro depósito"
        >
          <option value="todos">Todos</option>
          <option value="MAGALDI">Magaldi</option>
          <option value="LUJAN">Luján</option>
        </select>
      </FilterPill>

      <FilterPill label="Período" value="Este mes" />
      <FilterPill label="Monto" value="Cualquiera" />

      <div className="text-xs text-fg-secondary md:ml-auto flex items-center gap-3">
        <span>
          <strong className="text-fg-primary">{resultCount}</strong> resultados
        </span>
        <span>·</span>
        <span className="tabular font-bold text-fg-brand">{fmtCurrencyShort(sumTotal)}</span>
        {pending && <Icon name="refresh" size={12} className="text-fg-muted animate-spin" />}
      </div>
    </div>
  );
}

function FilterPill({
  label,
  value,
  children,
}: {
  label: string;
  value: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="relative inline-flex items-center gap-2 px-3 py-2 border border-stroke-soft bg-white rounded-md text-xs font-semibold text-fg-primary whitespace-nowrap cursor-pointer hover:border-stroke-strong transition-colors">
      <span className="text-fg-muted uppercase tracking-[0.08em] font-bold text-[10px]">
        {label}
      </span>
      <span>{value}</span>
      <Icon name="chevron-down" size={12} className="text-fg-muted" />
      {children}
    </div>
  );
}
