"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { Icon } from "@/components/Icon";

export function OrdersToolbar({
  initialSearch,
  initialDepot,
}: {
  initialSearch: string;
  initialDepot: string;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [search, setSearch] = useState(initialSearch);
  const [depot, setDepot] = useState(initialDepot);
  const [, startTransition] = useTransition();

  const push = (patch: Record<string, string>) => {
    const next = new URLSearchParams(params?.toString() ?? "");
    Object.entries(patch).forEach(([k, v]) => {
      if (!v || v === "todas" || v === "todos") next.delete(k);
      else next.set(k, v);
    });
    next.delete("page");
    startTransition(() => {
      router.push(`/orders?${next.toString()}`);
    });
  };

  return (
    <div className="card p-3 mt-2 flex flex-wrap items-center gap-2">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          push({ search });
        }}
        className="relative flex-1 min-w-[200px] max-w-md"
      >
        <Icon
          name="search"
          size={14}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted"
        />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por cliente, número o CUIT…"
          className="input pl-9 h-10"
        />
      </form>

      <FilterPill
        label="Depósito"
        value={depot}
        options={[
          ["todos", "Todos"],
          ["MAGALDI", "Magaldi"],
          ["LUJAN", "Luján"],
        ]}
        onChange={(v) => {
          setDepot(v);
          push({ depot: v });
        }}
      />
    </div>
  );
}

function FilterPill({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<[string, string]>;
  onChange: (v: string) => void;
}) {
  return (
    <div className="inline-flex items-center gap-2 px-3 py-2 border border-stroke-soft rounded-md bg-bg-surface-alt text-sm">
      <span className="text-fg-muted font-medium">{label}:</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-transparent font-semibold text-fg-primary outline-none cursor-pointer pr-1"
      >
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
      <Icon name="chevron-down" size={12} className="text-fg-muted" />
    </div>
  );
}
