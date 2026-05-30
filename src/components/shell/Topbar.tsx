"use client";

import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Icon } from "@/components/Icon";
import { NotificationsBell } from "@/components/shell/NotificationsBell";
import { ThemeToggle } from "@/components/shell/ThemeToggle";
import { PRODUCT } from "@/lib/org";

export default function Topbar({ onMenuClick }: { onMenuClick: () => void }) {
  const router = useRouter();
  const [search, setSearch] = useState("");

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!search.trim()) return;
    router.push(`/compras/ordenes?search=${encodeURIComponent(search.trim())}`);
  };

  const fechaHoy = new Date().toLocaleDateString("es-AR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  return (
    <header
      className="sticky top-0 z-30 bg-bg-surface/95 backdrop-blur border-b border-stroke-soft flex items-center gap-3 px-3 lg:px-6"
      style={{ height: "calc(56px + var(--safe-top))", paddingTop: "var(--safe-top)" }}
    >
      <button
        onClick={onMenuClick}
        aria-label="Abrir menú"
        className="nx-icon-btn lg:hidden inline-flex items-center justify-center w-10 h-10 rounded-md"
      >
        <Icon name="menu" size={20} />
      </button>

      <Link href="/ejecutivo" className="flex items-center lg:hidden">
        <Image
          src="/icons/logo-isologo-primary.png"
          alt="Logística TOPS"
          width={500}
          height={500}
          priority
          className="w-auto h-10 object-contain rounded-md"
        />
      </Link>

      {/* Desktop: NEXUS wordmark + module pill */}
      <div className="hidden lg:flex items-center gap-3">
        <div className="text-[15px] font-black tracking-[0.18em] text-tops-blue-900">
          {PRODUCT.name}
        </div>
        <span className="text-[9px] font-bold uppercase tracking-[0.18em] text-tops-red border border-tops-red/30 bg-tops-red/5 px-2 py-0.5 rounded">
          {PRODUCT.shortTagline}
        </span>
      </div>

      <form onSubmit={submit} className="hidden md:flex flex-1 max-w-md relative ml-auto lg:ml-6">
        <Icon
          name="search"
          size={15}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted"
        />
        <input
          className="input nx-search pl-9 pr-12 h-10"
          placeholder="Buscar OC, OS, proveedor, cliente, CUIT…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <kbd className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-mono text-fg-muted bg-neutral-100 px-1.5 py-0.5 rounded border border-stroke-soft">
          ⌘K
        </kbd>
      </form>

      <div className="ml-auto flex items-center gap-2">
        <div className="hidden lg:flex items-center gap-1.5 px-3 py-1.5 text-xs text-fg-secondary border border-stroke-soft rounded-pill bg-bg-surface">
          <span className="nx-live-dot" />
          <span className="capitalize">{fechaHoy}</span>
        </div>
        <ThemeToggle />
        <NotificationsBell />
        <Link href="/compras/nueva" className="btn btn-danger btn-sm">
          <Icon name="plus" size={14} stroke={2.2} />
          <span className="hidden sm:inline">Nueva OC</span>
        </Link>
      </div>
    </header>
  );
}
