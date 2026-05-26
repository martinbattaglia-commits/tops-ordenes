"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Icon } from "@/components/Icon";
import { NotificationsBell } from "@/components/shell/NotificationsBell";

export default function Topbar({ onMenuClick }: { onMenuClick: () => void }) {
  const router = useRouter();
  const [search, setSearch] = useState("");

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!search.trim()) return;
    router.push(`/orders?search=${encodeURIComponent(search.trim())}`);
  };

  const fechaHoy = new Date().toLocaleDateString("es-AR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  return (
    <header
      className="sticky top-0 z-30 bg-white/95 backdrop-blur border-b border-stroke-soft flex items-center gap-3 px-3 lg:px-6"
      style={{ height: "calc(56px + var(--safe-top))", paddingTop: "var(--safe-top)" }}
    >
      <button
        onClick={onMenuClick}
        aria-label="Abrir menú"
        className="lg:hidden inline-flex items-center justify-center w-10 h-10 rounded-md hover:bg-neutral-100 active:bg-neutral-200"
      >
        <Icon name="menu" size={20} />
      </button>

      <Link href="/dashboard" className="flex items-end gap-1.5 lg:hidden">
        <span className="text-lg font-black uppercase tracking-tight text-tops-blue-900">TOPS</span>
        <span className="text-[9px] uppercase tracking-[0.16em] font-bold text-tops-red mb-0.5">
          Órdenes
        </span>
      </Link>

      <form onSubmit={submit} className="hidden md:flex flex-1 max-w-md relative">
        <Icon
          name="search"
          size={15}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted"
        />
        <input
          className="input pl-9 pr-12 h-10"
          placeholder="Buscar orden, cliente, CUIT…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <kbd className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-mono text-fg-muted bg-neutral-100 px-1.5 py-0.5 rounded border border-stroke-soft">
          ⌘K
        </kbd>
      </form>

      <div className="ml-auto flex items-center gap-2">
        <div className="hidden lg:flex items-center gap-1.5 px-3 py-1.5 text-xs text-fg-secondary border border-stroke-soft rounded-pill bg-white">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
          <span className="capitalize">{fechaHoy}</span>
        </div>
        <NotificationsBell />
        <Link href="/orders/new" className="btn btn-danger btn-sm">
          <Icon name="plus" size={14} stroke={2.2} />
          <span className="hidden sm:inline">Nueva orden</span>
        </Link>
      </div>
    </header>
  );
}
