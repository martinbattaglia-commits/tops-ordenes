"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "@/components/Icon";
import { cn } from "@/lib/utils";

interface NavItem {
  href: string;
  label: string;
  icon: IconName;
  count?: number;
  accent?: boolean;
}

const NAV: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: "dashboard" },
  { href: "/orders", label: "Órdenes", icon: "orders", count: 48 },
  { href: "/orders/new", label: "Nueva orden", icon: "plus", accent: true },
  { href: "/clients", label: "Clientes", icon: "clients" },
  { href: "/reports", label: "Reportes", icon: "report" },
  { href: "/billing", label: "Facturación", icon: "bill" },
];

const NAV_BOTTOM: NavItem[] = [
  { href: "/templates", label: "Plantillas email", icon: "mail" },
  { href: "/settings/users", label: "Usuarios", icon: "clients" },
  { href: "/settings", label: "Configuración", icon: "gear" },
];

interface Props {
  user: { name: string; role: string; avatar: string };
  onNavigate?: () => void;
}

export default function Sidebar({ user, onNavigate }: Props) {
  const pathname = usePathname();

  const isActive = (href: string) => {
    if (href === "/dashboard") return pathname === "/dashboard";
    if (href === "/orders") return pathname === "/orders";
    if (href === "/orders/new") return pathname.startsWith("/orders/new");
    return pathname.startsWith(href);
  };

  return (
    <div className="sidebar w-full h-full flex flex-col px-4 pb-4 overflow-y-auto">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-end gap-2">
          <span className="text-xl font-black uppercase tracking-tight text-white">TOPS</span>
          <span className="text-[10px] uppercase tracking-[0.18em] font-bold text-tops-red mb-1">
            Órdenes
          </span>
        </div>
      </div>

      <Section label="Operación">
        {NAV.map((item) => (
          <NavLink
            key={item.href}
            item={item}
            active={isActive(item.href)}
            onNavigate={onNavigate}
          />
        ))}
      </Section>

      <Section label="Sistema" className="mt-2">
        {NAV_BOTTOM.map((item) => (
          <NavLink
            key={item.href}
            item={item}
            active={isActive(item.href)}
            onNavigate={onNavigate}
          />
        ))}
      </Section>

      <div className="mt-auto pt-4">
        <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-white/40 px-1.5 mb-2">
          Depósitos activos
        </div>
        <div className="flex flex-col gap-1.5 mb-3">
          <DepotPing name="Magaldi · CABA" online ops={6} />
          <DepotPing name="Luján · BsAs" online ops={3} />
        </div>
        <Link
          href="/settings"
          onClick={onNavigate}
          className="flex items-center gap-2.5 p-2 rounded-md bg-white/5 hover:bg-white/10 transition-colors"
        >
          <div className="w-9 h-9 rounded-full bg-tops-red text-white grid place-items-center font-bold text-xs">
            {user.avatar}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[13px] font-semibold text-white truncate">{user.name}</div>
            <div className="text-[10px] text-white/55 truncate">{user.role}</div>
          </div>
          <Icon name="chevron-down" size={14} className="text-white/40" />
        </Link>
        <form action="/api/auth/signout" method="post" className="mt-2">
          <button
            type="submit"
            className="w-full flex items-center gap-2 px-2 py-2 rounded-md text-[12px] text-white/60 hover:text-white hover:bg-white/5 transition-colors"
          >
            <Icon name="logout" size={14} />
            Cerrar sesión
          </button>
        </form>
      </div>
    </div>
  );
}

function Section({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-white/40 px-1.5 mb-1">
        {label}
      </div>
      <nav className="flex flex-col gap-0.5">{children}</nav>
    </div>
  );
}

function NavLink({
  item,
  active,
  onNavigate,
}: {
  item: NavItem;
  active: boolean;
  onNavigate?: () => void;
}) {
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      className={cn("sidebar-link", active && "active", item.accent && "danger-accent")}
    >
      <Icon name={item.icon} size={17} />
      <span className="flex-1">{item.label}</span>
      {item.count != null && (
        <span className="text-[11px] font-bold text-white/55 bg-white/10 px-1.5 py-0.5 rounded">
          {item.count}
        </span>
      )}
    </Link>
  );
}

function DepotPing({ name, online, ops }: { name: string; online: boolean; ops: number }) {
  return (
    <div className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-md bg-white/5 text-[12px]">
      <span
        className={cn(
          "w-1.5 h-1.5 rounded-full",
          online ? "bg-emerald-400 shadow-[0_0_0_3px_rgba(54,194,117,0.25)]" : "bg-gray-500"
        )}
      />
      <span className="text-white/85 font-medium flex-1 truncate">{name}</span>
      <span className="text-white/50 text-[11px]">{ops} op.</span>
    </div>
  );
}
