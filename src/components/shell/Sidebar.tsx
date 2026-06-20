"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "@/components/Icon";
import { cn } from "@/lib/utils";
import { PRODUCT } from "@/lib/org";

/** Clave de persistencia del set de dominios abiertos del sidebar (Accordion Tree). */
const SIDEBAR_OPEN_KEY = "tops:sidebar:open:v1";
/** Evento para sincronizar el estado de apertura entre instancias del sidebar (desktop + drawer). */
const SIDEBAR_SYNC_EVENT = "tops:sidebar-open-changed";

interface NavItem {
  href: string;
  label: string;
  icon: IconName;
  count?: number;
  accent?: boolean;
  badge?: string;
  /** Ítem ejecutivo/financiero: sólo visible con permiso ejecutivo (cockpit.view). */
  exec?: boolean;
  /** Gate RBAC: "sistema" (requiere sistema.view) · "rrhhDocs" (requiere rrhh.documentacion.view). */
  gate?: "sistema" | "rrhhDocs";
}

interface Domain {
  id: string;
  label: string;
  items: NavItem[];
  /** Gate RBAC de todo el dominio (ej. "sistema"). */
  gate?: "sistema";
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
      // Cockpit único. Los ítems ejecutivos/financieros (`exec:true`) se ocultan a
      // los roles sin permiso ejecutivo (Comercial, Finanzas, encargados de depósito),
      // que ven sólo los accesos operativos (Vacancia, Google, CCTV, Tracking, Organigrama).
      { href: "/ejecutivo", label: "Cockpit ejecutivo", icon: "dashboard", exec: true },
      { href: "/comercial/dashboard-vacancia", label: "Vacancia Corporativa", icon: "trend-up", badge: "Premium" },
      { href: "/workspace", label: "Accesos Google", icon: "google" },
      { href: "/cctv", label: "Centro de monitoreo", icon: "eye", badge: "Hikvision" },
      { href: "/operaciones/tracking", label: "Tracking de flota", icon: "truck" },
      { href: "/organigrama", label: "Organigrama", icon: "building", gate: "sistema" },
      { href: "/analytics", label: "Analytics Ejecutivo", icon: "report", exec: true },
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
      { href: "/compras/libro-iva", label: "Libro IVA Compras", icon: "report" },
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
      { href: "/comercial/oportunidades", label: "Oportunidades", icon: "clients", badge: "360°" },
      { href: "/comercial/contratos", label: "Contratos", icon: "contract", badge: "Cartera" },
      { href: "/comercial/mapa-lujan", label: "Mapa Luján 3159", icon: "building", badge: "Premium" },
      { href: "/comercial/mapa-magaldi", label: "Mapa Magaldi 1765", icon: "building", badge: "Premium" },
      { href: "/comercial/herramientas", label: "Herramientas", icon: "bolt" },
      { href: "/comercial/herramientas/cotizador", label: "Cotizador", icon: "calculator" },
    ],
  },
  {
    id: "compliance",
    label: "Compliance",
    items: [
      { href: "/anmat", label: "Compliance Cockpit", icon: "shield" },
      { href: "/drive", label: "Drive TOPS", icon: "drive" },
    ],
  },
  {
    id: "analytics",
    label: "Facturación",
    items: [
      { href: "/reports", label: "Reportes", icon: "report" },
      { href: "/billing", label: "Facturación", icon: "bill" },
      { href: "/compras/drive", label: "Drive sync", icon: "drive" },
      { href: "/compras/email", label: "Plantilla email", icon: "mail" },
    ],
  },
  {
    id: "tesoreria",
    label: "Tesorería · Finanzas",
    items: [
      { href: "/tesoreria", label: "Resumen", icon: "wallet" },
      { href: "/tesoreria/bancos", label: "Bancos", icon: "building" },
      { href: "/tesoreria/movimientos", label: "Movimientos", icon: "refresh" },
      { href: "/tesoreria/cobranzas", label: "Cobranzas", icon: "download" },
      { href: "/tesoreria/pagos", label: "Pagos", icon: "cart" },
      { href: "/tesoreria/flujo-fondos", label: "Flujo de fondos", icon: "trend-up" },
      { href: "/tesoreria/conciliacion", label: "Conciliación", icon: "check-circle" },
    ],
  },
  {
    id: "contabilidad",
    label: "Contabilidad",
    items: [
      { href: "/contabilidad", label: "Resumen contable", icon: "dashboard" },
      { href: "/contabilidad/posicion-iva", label: "Posición de IVA", icon: "report" },
      { href: "/contabilidad/posicion-fiscal", label: "Posición fiscal", icon: "report" },
      { href: "/contabilidad/pagos-retenciones", label: "Pago con retención", icon: "cart", accent: true },
      { href: "/contabilidad/percepciones-ventas", label: "Percepciones de venta", icon: "report" },
      { href: "/contabilidad/percepciones-cargar", label: "Cargar percepción", icon: "plus" },
      { href: "/contabilidad/retenciones", label: "Retenciones practicadas", icon: "report" },
      { href: "/contabilidad/plan-cuentas", label: "Plan de cuentas", icon: "database" },
      { href: "/contabilidad/libro-diario", label: "Libro diario", icon: "report" },
      { href: "/contabilidad/mayor", label: "Mayor por cuenta", icon: "report" },
      { href: "/contabilidad/balance", label: "Sumas y saldos", icon: "calculator" },
      { href: "/contabilidad/comprobantes", label: "Pendientes de contabilizar", icon: "refresh" },
    ],
  },
  {
    id: "rrhh",
    label: "Recursos Humanos",
    items: [
      { href: "/rrhh", label: "Dashboard RRHH", icon: "dashboard" },
      { href: "/rrhh/empleados", label: "Empleados", icon: "clients" },
      { href: "/rrhh/solicitudes", label: "Solicitudes", icon: "calendar" },
      { href: "/rrhh/novedades", label: "Novedades", icon: "report" },
      { href: "/rrhh/documentos", label: "Documentación", icon: "lock", gate: "rrhhDocs" },
      { href: "/rrhh/mi-espacio", label: "Mi espacio", icon: "user" },
    ],
  },
  {
    id: "sistema",
    label: "Sistema",
    gate: "sistema",
    items: [
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
  /** ¿Mostrar ítems ejecutivos/financieros del Cockpit? (default: sí, para no sobre-ocultar). */
  canViewExecutive?: boolean;
  /** ¿Mostrar la sección Sistema (requiere sistema.view)? (default: sí). */
  canViewSistema?: boolean;
  /** ¿Mostrar RRHH → Documentación (requiere rrhh.documentacion.view)? (default: sí). */
  canViewRrhhDocs?: boolean;
  onNavigate?: () => void;
}

export default function Sidebar({
  user,
  canViewExecutive = true,
  canViewSistema = true,
  canViewRrhhDocs = true,
  onNavigate,
}: Props) {
  // Gate RBAC por ítem/dominio (Estrategia B): oculta lo no permitido.
  const gateAllowed = (gate?: "sistema" | "rrhhDocs") =>
    !gate || (gate === "sistema" ? canViewSistema : canViewRrhhDocs);
  const pathname = usePathname();

  const isActive = (href: string) => {
    // Rutas exactas (no usar prefix match — evita colisiones tipo /compras y /compras/ordenes)
    const exact = new Set([
      "/ejecutivo",
      "/analytics",
      "/dashboard",
      "/orders",
      "/compras",
      "/compras/ordenes",
      "/compras/facturas",
      "/compras/libro-iva",
      "/clients",
      "/reports",
      "/billing",
      "/anmat",
      "/cctv",
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
      "/comercial/contratos",
      "/comercial/herramientas",
      "/comercial/herramientas/cotizador",
      "/settings",
      "/settings/roles",
      "/settings/users",
      "/settings/centros-costo",
      "/settings/tracking",
      "/templates",
      "/rrhh",
      "/rrhh/empleados",
      "/rrhh/solicitudes",
      "/rrhh/novedades",
      "/rrhh/documentos",
      "/rrhh/mi-espacio",
    ]);
    if (exact.has(href)) return pathname === href;
    return pathname.startsWith(href);
  };

  // ── Accordion Tree: estado de dominios abiertos/cerrados ──────────────
  // El dominio que contiene la ruta activa se abre siempre (para no ocultar
  // dónde está parado el usuario). El resto arranca colapsado; las aperturas
  // manuales se recuerdan en localStorage entre sesiones.
  const activeDomainId = useMemo(() => {
    for (const d of DOMAINS) {
      if (d.items.some((it) => isActive(it.href))) return d.id;
    }
    return null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  // Estado inicial determinista (SSR-safe): sólo el dominio activo abierto.
  const [openDomains, setOpenDomains] = useState<Record<string, boolean>>(() =>
    activeDomainId ? { [activeDomainId]: true } : {},
  );

  // Tras montar, fusionamos el set persistido del usuario (evita mismatch SSR).
  useEffect(() => {
    try {
      const raw = localStorage.getItem(SIDEBAR_OPEN_KEY);
      if (raw) {
        const ids = JSON.parse(raw) as string[];
        if (Array.isArray(ids)) {
          setOpenDomains((prev) => {
            const next = { ...prev };
            for (const id of ids) next[id] = true;
            return next;
          });
        }
      }
    } catch {}
  }, []);

  // Al navegar, garantizamos que el dominio de la ruta activa quede abierto.
  useEffect(() => {
    if (!activeDomainId) return;
    setOpenDomains((prev) => (prev[activeDomainId] ? prev : { ...prev, [activeDomainId]: true }));
  }, [activeDomainId]);

  // Sincronización entre instancias (el shell monta Sidebar 2 veces: desktop +
  // drawer mobile). El evento `storage` no se dispara en el mismo documento,
  // así que usamos un CustomEvent para que ambas instancias reflejen el mismo
  // estado de apertura al instante.
  useEffect(() => {
    const onSync = (e: Event) => {
      const ids = (e as CustomEvent<string[]>).detail;
      if (!Array.isArray(ids)) return;
      setOpenDomains(Object.fromEntries(ids.map((id) => [id, true])));
    };
    window.addEventListener(SIDEBAR_SYNC_EVENT, onSync);
    return () => window.removeEventListener(SIDEBAR_SYNC_EVENT, onSync);
  }, []);

  const toggleDomain = (id: string) => {
    // En un handler de evento, `openDomains` es el estado committeado más
    // reciente, así que podemos derivar `next` sin efectos dentro del updater.
    const next = { ...openDomains, [id]: !openDomains[id] };
    setOpenDomains(next);
    const openIds = Object.keys(next).filter((k) => next[k]);
    try {
      localStorage.setItem(SIDEBAR_OPEN_KEY, JSON.stringify(openIds));
    } catch {}
    // Notificamos a la otra instancia del sidebar en el mismo documento.
    try {
      window.dispatchEvent(new CustomEvent(SIDEBAR_SYNC_EVENT, { detail: openIds }));
    } catch {}
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

      {/* Domain sections — Accordion Tree */}
      <div className="flex flex-col gap-0.5">
        {DOMAINS.map((domain) => {
          // Dominio gateado completo (ej. Sistema) sin permiso → no renderizar.
          if (!gateAllowed(domain.gate)) return null;
          const items = domain.items.filter(
            (item) => (canViewExecutive || !item.exec) && gateAllowed(item.gate),
          );
          // Sección sin ítems visibles → no renderizar el encabezado vacío.
          if (items.length === 0) return null;
          const hasActive = items.some((item) => isActive(item.href));
          return (
            <Section
              key={domain.id}
              label={domain.label}
              open={Boolean(openDomains[domain.id])}
              hasActive={hasActive}
              onToggle={() => toggleDomain(domain.id)}
            >
              {items.map((item) => (
                <NavLink
                  key={item.href}
                  item={item}
                  active={isActive(item.href)}
                  onNavigate={onNavigate}
                />
              ))}
            </Section>
          );
        })}
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
  open,
  hasActive,
  onToggle,
  children,
  className,
}: {
  label: string;
  open: boolean;
  hasActive: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col", className)}>
      {/* Encabezado del dominio: nodo expandible/colapsable */}
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="group w-full flex items-center gap-1.5 px-1.5 py-1.5 rounded-md hover:bg-white/5 transition-colors"
      >
        <Icon
          name="chevron-right"
          size={13}
          stroke={2.6}
          className={cn(
            "shrink-0 transition-transform duration-200 ease-out",
            open ? "rotate-90 text-white/85" : hasActive ? "text-tops-red" : "text-white/60",
            "group-hover:text-white/90",
          )}
        />
        {/* Nivel 1 — categoría madre: domina visualmente a sus ítems hijos
            (13px bold uppercase, alto contraste) > hijos (14px medium, white/75). */}
        <span
          className={cn(
            "flex-1 text-left text-sm font-bold uppercase tracking-[0.04em] leading-tight transition-colors",
            open || hasActive ? "text-white" : "text-white/90",
            "group-hover:text-white",
          )}
        >
          {label}
        </span>
        {/* Punto indicador: sección colapsada que contiene la ruta activa */}
        {hasActive && !open && <span className="w-1.5 h-1.5 rounded-full bg-tops-red shrink-0" />}
      </button>

      {/* Contenido colapsable — animación de altura 200ms vía grid-rows */}
      <div
        className={cn(
          "grid transition-[grid-template-rows] duration-200 ease-out",
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        )}
      >
        {/* inert cuando está colapsado: saca los links del orden de tabulación */}
        <div className="overflow-hidden" {...(open ? {} : ({ inert: "" } as object))}>
          <div className="ml-1.5 pl-2 border-l border-white/10 mt-0.5 mb-1">
            <nav className="flex flex-col gap-0.5">{children}</nav>
          </div>
        </div>
      </div>
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
