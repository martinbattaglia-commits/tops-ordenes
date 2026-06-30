"use client";

// Nexus Link · RC1.4 Búsqueda Global (input controlado). Navega a /connect/buscar?q=...
// con debounce; Enter fuerza la navegación inmediata. NO consulta datos — eso lo hace el
// Server Component de la página. Solo interactividad.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";

export function GlobalSearch({ initialQuery = "" }: { initialQuery?: string }) {
  const router = useRouter();
  const [value, setValue] = useState(initialQuery);
  const lastPushed = useRef(initialQuery);

  // Debounce: empuja la query a la URL ~350ms después de dejar de tipear.
  useEffect(() => {
    const next = value.trim();
    if (next === lastPushed.current.trim()) return;
    const t = setTimeout(() => {
      lastPushed.current = next;
      router.push(next ? `/connect/buscar?q=${encodeURIComponent(next)}` : "/connect/buscar");
    }, 350);
    return () => clearTimeout(t);
  }, [value, router]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const next = value.trim();
    lastPushed.current = next;
    router.push(next ? `/connect/buscar?q=${encodeURIComponent(next)}` : "/connect/buscar");
  }

  return (
    <form onSubmit={submit} className="relative" role="search">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted">
        <Icon name="search" size={16} />
      </span>
      <input
        type="search"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Buscá conversaciones, contextos ERP, mensajes o adjuntos…"
        autoComplete="off"
        aria-label="Búsqueda global"
        className="w-full rounded-pill border border-stroke-soft bg-bg-page py-2 pl-9 pr-9 text-sm text-fg-primary outline-none placeholder:text-fg-muted focus:border-tops-red"
      />
      {value && (
        <button
          type="button"
          onClick={() => setValue("")}
          aria-label="Limpiar búsqueda"
          className="absolute right-2.5 top-1/2 -translate-y-1/2 grid h-6 w-6 place-items-center rounded-full text-fg-muted hover:bg-bg-surface-alt hover:text-fg-primary"
        >
          <Icon name="x" size={14} />
        </button>
      )}
    </form>
  );
}
