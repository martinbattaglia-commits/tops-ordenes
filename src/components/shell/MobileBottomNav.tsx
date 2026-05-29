"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "@/components/Icon";
import { cn } from "@/lib/utils";

interface Item {
  href: string;
  label: string;
  icon: IconName;
  fab?: boolean;
}

const ITEMS: Item[] = [
  { href: "/dashboard", label: "Inicio", icon: "dashboard" },
  { href: "/orders", label: "Órdenes", icon: "orders" },
  { href: "/orders/new", label: "Nueva", icon: "plus", fab: true },
  { href: "/clients", label: "Clientes", icon: "clients" },
  { href: "/settings", label: "Más", icon: "menu-dots" },
];

export default function MobileBottomNav() {
  const pathname = usePathname();

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-30 bg-white border-t border-stroke-soft flex items-stretch justify-around"
      style={{
        paddingBottom: "var(--safe-bottom)",
        boxShadow: "0 -8px 24px rgba(5,5,85,0.06)",
      }}
    >
      {ITEMS.map((it) => {
        const active =
          it.href === "/dashboard"
            ? pathname === "/dashboard"
            : pathname.startsWith(it.href);
        return (
          <Link
            key={it.href}
            href={it.href}
            className={cn(
              "flex flex-col items-center justify-center flex-1 py-2 text-[10px] font-bold uppercase tracking-wide",
              active ? "text-tops-blue-900" : "text-fg-muted",
              it.fab && "relative -mt-4"
            )}
          >
            <span
              className={cn(
                "flex items-center justify-center",
                it.fab
                  ? "w-12 h-12 rounded-full bg-tops-red text-white shadow-md"
                  : "w-9 h-9"
              )}
            >
              <Icon name={it.icon} size={it.fab ? 22 : 20} stroke={it.fab ? 2.4 : 1.8} />
            </span>
            <span className={cn("mt-0.5", it.fab && "text-tops-red")}>{it.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
