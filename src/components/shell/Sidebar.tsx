"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "@/components/Icon";
import { cn } from "@/lib/utils";
import { PRODUCT } from "@/lib/org";

interface NavItem {
  href: string;
  label: string;
  icon: IconName;
  count?: number;
  accent?: boolean;
  badge?: string;
}

interface Domain {
  id: string;
  label: string;
  items: NavItem[];
}

/**
 * Dominios del Operating System. Cada dominio agrupa rutas relacionadas
 * y se renderea como una sección colapsable del sidebar.
 */
const DOMAINS: Domain[] = [
  {
    id: "cockpit",
    label: "Cockpit",
    items: [
      { href: "/ejecutivo", label: "Cockpit ejecutivo", icon: "dashboard" },
      { href: "/operaciones/mapa", label: "Mapa operativo", icon: "pin" },
      { href: "/operaciones/mapa-inteligente", label: "Mapa Inteligente", icon: "pin" },
      { href: "/operaciones/tracking", label: "Tracking de flota", icon: "truck" },
    ],
  },
  {
    id: "workspace",
    label: "Google Workspace",
    items: [
      { href: "/workspace", label: "Accesos Google", icon: "google" },
    ],
  },
  {
    id: "compras",
    label: "Compras · Proveedores",
    items: [
      { href: "/compras", label: "Dashboard compras", icon: "dashboard" },
      { href: "/compras/ordenes", label: "Órdenes de compra", icon: "cart", count: 64 },
      { href: "/compras/nueva", label: "Nueva OC", icon: "plus", accent: true },
      { href: "/compras/proveedores", label: "Proveedores", icon: "vendors" },
      { href: "/compras/facturas", label: "Facturas proveedor", icon: "wallet" },
    ],
  },
  {
    id: "servicios",
    label: "Operaciones · Servicios",
    items: [
      { href: "/dashboard", label: "Dashboard servicio", icon: "dashboard" },
      { href: "/orders", label: "Órdenes de servicio", icon: "orders", count: 48 },
      { href: "/orders/new", label: "Nueva OS", icon: "plus", accent: true },
      { href: "/clients", label: "Clientes (OS)", icon: "clients" },
    ],
  },
  {
    id: "wms",
    label: "WMS · Depósito",
    items: [
      { href: "/wms", label: "Dashboard WMS", icon: "dashboard" },
      { href: "/wms/inventario", label: "Inventario", icon: "package" },
      { href: "/wms/recepciones", label: "Recepciones", icon: "download" },
      { href: "/wms/movimientos", label: "Movimientos", icon: "refresh" },
      { href: "/wms/picking", label: "Picking", icon: "qr" },
      { href: "/wms/packing", label: "Packing", icon: "folder" },
      { href: "/wms/despachos", label: "Despachos", icon: "truck" },
      { href: "/wms/custody", label: "Custodia", icon: "shield" },
      { href: "/wms/lotes", label: "Lotes", icon: "tag-alt" },
      { href: "/wms/vencimientos", label: "Vencimientos", icon: "clock" },
    ],
  },
  {
    id: "pedidos",
    label: "Pedidos · Logística",
    items: [
      { href: "/pedidos", label: "Tablero de pedidos", icon: "package" },
    ],
  },
  {
    id: "comercial",
    label: "Comercial · CRM",
    items: [
      { href: "/comercial/contactos", label: "Contactos", icon: "users", badge: "Clientify" },
      { href: "/comercial/pipeline", label: "Pipeline", icon: "trend-up", badge: "Clientify" },
      { href: "/comercial/herramientas", label: "Herramientas", icon: "bolt" },
      { href: "/comercial/herramientas/cotizador", label: "Cotizador", icon: "calculator" },
    ],
  },
  {
    id: "compliance",
    label: "Compliance · ANMAT",
    items: [
      { href: "/anmat", label: "ANMAT cockpit", icon: "shield" },
      { href: "/drive", label: "Drive TOPS", icon: "drive" },
    ],
  },
  {
    id: "seguridad",
    label: "Seguridad · CCTV",
    items: [
      { href: "/cctv", label: "Centro de monitoreo", icon: "eye", badge: "Hikvision" },
    ],
  },
  {
    id: "analytics",
    label: "Analytics & Finanzas",
    items: [
      { href: "/reports", label: "Reportes", icon: "report" },
      { href: "/billing", label: "Facturación", icon: "bill" },
      { href: "/compras/drive", label: "Drive sync", icon: "drive" },
      { href: "/compras/email", label: "Plantilla email", icon: "mail" },
    ],
  },
  {
    id: "sistema",
    label: "Sistema",
    items: [
      { href: "/organigrama", label: "Organigrama", icon: "building" },
      { href: "/settings/roles", label: "Roles & permisos", icon: "shield" },
      { href: "/settings/users", label: "Usuarios", icon: "users" },
      { href: "/settings/centros-costo", label: "Centros de costo", icon: "tag-alt" },
      { href: "/settings/tracking", label: "Tracking", icon: "truck" },
      { href: "/templates", label: "Plantillas OS", icon: "mail" },
      { href: "/settings", label: "Configuración", icon: "gear" },
    ],
  },
];

interface Props {
  user: { name: string; role: string; avatar: string };
  onNavigate?: () => void;
}

export default function Sidebar({ user, onNavigate }: Props) {
  const pathname = usePathname();

  const isActive = (href: string) => {
    // Rutas exactas (no usar prefix match — evita colisiones tipo /compras y /compras/ordenes)
    const exact = new Set([
      "/ejecutivo",
      "/dashboard",
      "/orders",
      "/compras",
      "/compras/ordenes",
      "/compras/facturas",
      "/clients",
      "/reports",
      "/billing",
      "/anmat",
      "/cctv",
      "/operaciones/mapa",
      "/operaciones/mapa-inteligente",
      "/operaciones/tracking",
      "/wms",
      "/wms/inventario",
      "/wms/recepciones",
      "/wms/movimientos",
      "/wms/picking",
      "/wms/packing",
      "/wms/despachos",
      "/wms/custody",
      "/wms/lotes",
      "/wms/vencimientos",
      "/pedidos",
      "/organigrama",
      "/workspace",
      "/comercial/contactos",
      "/comercial/pipeline",
      "/comercial/herramientas",
      "/comercial/herramientas/cotizador",
      "/settings",
      "/settings/roles",
      "/settings/users",
      "/settings/centros-costo",
      "/settings/tracking",
      "/templates",
    ]);
    if (exact.has(href)) return pathname === href;
    return pathname.startsWith(href);
  };

  return (
    <div className="sidebar w-full h-full flex flex-col px-3 pb-3 overflow-y-auto">
      {/* Brand block */}
      <Link
        href="/ejecutivo"
        onClick={onNavigate}
        className="flex flex-col items-center mt-2 mb-5 hover:opacity-95 transition-opacity"
      >
        <Image
          src="/icons/logo-isologo-primary.png"
          alt="Logística TOPS"
          width={500}
          height={500}
          priority
          className="w-auto h-20 object-contain"
        />
        <div className="mt-2 text-center">
          <div className="text-[15px] font-black tracking-[0.18em] text-white leading-none">
            {PRODUCT.name}
          </div>
          <div className="mt-1 text-[9px] font-bold uppercase tracking-[0.18em] text-tops-red">
            {PRODUCT.shortTagline}
          </div>
        </div>
      </Link>

      {/* Domain sections */}
      <div className="flex flex-col gap-3">
        {DOMAINS.map((domain) => (
          <Section key={domain.id} label={domain.label}>
            {domain.items.map((item) => (
              <NavLink
                key={item.href}
                item={item}
                active={isActive(item.href)}
                onNavigate={onNavigate}
              />
            ))}
          </Section>
        ))}
      </div>

      {/* Footer: depots + user */}
      <div className="mt-auto pt-4">
        <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-white/40 px-1.5 mb-2">
          Locaciones · CABA
        </div>
        <div className="flex flex-col gap-1.5 mb-3">
          <DepotPing name="Magaldi · ANMAT" online ops={6} />
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
        <div className="mt-3 px-1.5 text-[9px] text-white/30 text-center font-mono tracking-tight">
          NEXUS · v{PRODUCT.version} · {PRODUCT.edition}
        </div>
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
      <div className="text-[9px] font-bold uppercase tracking-[0.18em] text-white/40 px-1.5 mb-1">
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
      <Icon name={item.icon} size={16} />
      <span className="flex-1 truncate">{item.label}</span>
      {item.count != null && (
        <span className="text-[10px] font-bold text-white/55 bg-white/10 px-1.5 py-0.5 rounded tabular-nums">
          {item.count}
        </span>
      )}
      {item.badge && (
        <span className="text-[9px] font-bold uppercase tracking-wider text-white/70 bg-tops-red/30 border border-tops-red/40 px-1.5 py-0.5 rounded">
          {item.badge}
        </span>
      )}
    </Link>
  );
}

function DepotPing({ name, online, ops }: { name: string; online: boolean; ops: number }) {
  return (
    <div className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-md bg-white/5 text-[12px]">
      <span
        className={online ? "nx-live-dot" : "w-1.5 h-1.5 rounded-full bg-gray-500"}
      />
      <span className="text-white/85 font-medium flex-1 truncate">{name}</span>
      <span className="text-white/50 text-[11px]">{ops} op.</span>
    </div>
  );
}
