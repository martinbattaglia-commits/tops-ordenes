"use client";

// NEXUS-LINK-NOTIFICATIONS-MEDIA-001 · FASE A · campanita de tres colores.
//
// Antes: un único badge rojo que contaba las filas sin leer de las primeras 15
// notificaciones y tapaba cualquier cifra mayor que 9 con "9+". No distinguía
// WhatsApp del chat interno, y el agregado no podía superar 15 por construcción.
//
// Ahora: tres indicadores INDEPENDIENTES y simultáneos, alimentados por
// `v_link_notification_badges` (0234), que es la MISMA fuente de verdad que los
// badges por conversación de la bandeja. Ninguna categoría suprime a otra y
// cada una se apaga sólo cuando su propia cuenta llega a cero.

import { useCallback, useEffect, useId, useRef, useState, type MouseEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";
import { createClient } from "@/lib/supabase/client";
import { useRealtimeTable } from "@/lib/supabase/realtime";
import { hrefFor } from "@/lib/notifications/href";
import {
  CATEGORY_STYLE,
  EMPTY_BADGE_COUNTS,
  bellAriaLabel,
  categoryAriaLabel,
  formatBadgeCount,
  type BadgeCounts,
  type NotificationCategory,
} from "@/lib/notifications/categories";
import { mapNotifRpcError } from "@/lib/notifications/rpc-errors";
import { relTime } from "@/lib/utils";

interface Notification {
  id: string;
  kind: string;
  title: string;
  message: string;
  entity: string | null;
  entity_id: string | null;
  is_read: boolean;
  created_at: string;
}

/** Un indicador. No se renderiza si su categoría no tiene pendientes. */
function CategoryBadge({
  category,
  count,
}: {
  category: NotificationCategory;
  count: number;
}) {
  if (count <= 0) return null;
  const style = CATEGORY_STYLE[category];
  const etiqueta = categoryAriaLabel(category, count);
  return (
    <span
      // El total EXACTO viaja en aria-label y en title aunque el badge muestre 99+.
      role="status"
      aria-label={etiqueta}
      title={etiqueta}
      // C4 · M-1: el contenedor del cluster es `pointer-events-none` para no
      // robarle el clic al botón; cada badge lo reactiva para SÍ MISMO, o el
      // tooltip nativo (`title`) nunca llegaría a mostrarse.
      className={`pointer-events-auto inline-flex h-[15px] min-w-[15px] items-center gap-[2px] px-[3px] text-[9px] font-bold leading-none shadow-sm ${style.badgeClass}`}
    >
      <Icon name={style.icon} size={8} aria-hidden />
      <span>{formatBadgeCount(count)}</span>
    </span>
  );
}

export function NotificationsBell() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notification[]>([]);
  const [counts, setCounts] = useState<BadgeCounts>(EMPTY_BADGE_COUNTS);
  // HOTFIX-02: el fallo de la marcación masiva se muestra ANCLADO al panel que
  // lo produjo, nunca como éxito silencioso.
  const [errorMarcado, setErrorMarcado] = useState<string | null>(null);
  const [abriendoId, setAbriendoId] = useState<string | null>(null);
  const botonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  const load = useCallback(async () => {
    const supabase = createClient();
    if (!supabase) return;

    // (a) Los tres contadores, de la vista única de verdad.
    const { data: badges, error: badgesError } = await supabase
      .from("v_link_notification_badges")
      .select("red_system_count, green_whatsapp_count, yellow_internal_count")
      .maybeSingle();
    if (badgesError) {
      // Fail-safe: si 0234 todavía no está aplicada la campanita no rompe la
      // shell; muestra cero y el panel sigue funcionando.
      setCounts(EMPTY_BADGE_COUNTS);
    } else if (badges) {
      setCounts({
        red: Number(badges.red_system_count ?? 0),
        green: Number(badges.green_whatsapp_count ?? 0),
        yellow: Number(badges.yellow_internal_count ?? 0),
      });
    }

    // (b) La lista del panel, con la MISMA semántica que el contador: sale de
    //     `v_link_my_notifications` (0235), que aísla por destinatario dentro
    //     de la vista y resuelve `is_read` combinando el `read_at` de los
    //     avisos directos con la lectura PERSONAL de los broadcasts. Antes
    //     consultaba `notifications` sin filtro y delegaba en la RLS, cuya
    //     rama de auditoría le mostraba a un admin la bandeja de todos.
    //     El badge rojo NO sale de acá: sale de la vista de contadores, así
    //     que dejó de estar limitado por este `limit`.
    const { data, error } = await supabase
      .from("v_link_my_notifications")
      .select("id, kind, title, message, entity, entity_id, is_read, created_at")
      .eq("is_due", true)
      .order("created_at", { ascending: false })
      .limit(15);
    if (!error && data) setItems(data as Notification[]);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // C4 · M-8: con el relay de WhatsApp activo, cada INSERT dispararía una
  // recarga. Se agrupan las ráfagas en una sola lectura.
  const recargaPendiente = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadDebounced = useCallback(() => {
    if (recargaPendiente.current) clearTimeout(recargaPendiente.current);
    recargaPendiente.current = setTimeout(() => { void load(); }, 250);
  }, [load]);
  useEffect(() => () => {
    if (recargaPendiente.current) clearTimeout(recargaPendiente.current);
  }, []);

  // Realtime sobre las TRES fuentes que mueven los contadores:
  //  · notifications        → rojo
  //  · connect_messages     → verde y amarillo suben con cada entrante
  //  · connect_participants → verde y amarillo BAJAN al marcar leído, que es
  //                           donde escribe connect_mark_read (C4 · H-1).
  //  · notification_reads   → el rojo BAJA al marcar leído un BROADCAST, que
  //                           ya no toca `notifications` (C4 3/3 · MEDIUM-1).
  useRealtimeTable("notifications", loadDebounced);
  useRealtimeTable("connect_messages", loadDebounced);
  useRealtimeTable("connect_participants", loadDebounced);
  useRealtimeTable("notification_reads", loadDebounced);

  // Abrir la campanita NO marca nada como leído: sólo despliega el panel.
  //
  // C4 · H-3: marca TODAS mis notificaciones sin leer, no sólo las 15 que trae
  // el panel. Desde que el badge dejó de derivarse de esa lista, limitar la
  // acción a los ids cargados dejaba el rojo encendido sin explicación posible.
  // Con 0235 el alcance ya no deja nada afuera: los broadcasts se marcan como
  // lectura PERSONAL, así que el rojo puede llegar realmente a cero sin
  // silenciar el aviso para el resto del rol.
  const markAllRead = async () => {
    const supabase = createClient();
    if (!supabase) return;
    setErrorMarcado(null);
    // Una sola vía de escritura (RPC 0235): marca leídas TODAS mis pendientes
    // —directas y broadcasts— sin tope de página y sin tocar el estado de
    // terceros. El broadcast se registra como lectura PERSONAL.
    //
    // HOTFIX-02: la RPC devuelve `integer` con las filas realmente marcadas.
    // Antes se descartaban tanto ese recuento como el error, así que una
    // marcación que no escribía nada dejaba el rojo encendido sin explicación.
    const { data, error } = await supabase.rpc("connect_notif_mark_all_read");
    if (error) {
      // C4 1/2 · M-3: la causa la sabe PostgreSQL. Descartarla dejaba
      // "reintentá en unos segundos" ante una sesión vencida, donde reintentar
      // no puede funcionar nunca.
      setErrorMarcado(mapNotifRpcError(error.message));
      return;
    }
    if (typeof data !== "number" || data === 0) {
      setErrorMarcado("No se marcó ninguna notificación como leída. Recargá la página y reintentá.");
      return;
    }
    await load();
  };

  const cerrar = useCallback(() => {
    setOpen(false);
    setErrorMarcado(null);
    botonRef.current?.focus();
  }, []);

  const openNotification = useCallback(async (
    event: MouseEvent<HTMLAnchorElement>,
    notification: Notification,
    href: string,
  ) => {
    if (notification.is_read) {
      cerrar();
      return;
    }
    event.preventDefault();
    if (abriendoId) return;
    setErrorMarcado(null);
    setAbriendoId(notification.id);
    const supabase = createClient();
    if (!supabase) {
      setErrorMarcado("No se pudo registrar la lectura en este entorno.");
      setAbriendoId(null);
      return;
    }
    const { error } = await supabase.rpc("connect_notif_mark_read", {
      p_id: notification.id,
    });
    if (error) {
      setErrorMarcado(mapNotifRpcError(error.message));
      setAbriendoId(null);
      return;
    }
    await load();
    setAbriendoId(null);
    setOpen(false);
    router.push(href);
  }, [abriendoId, cerrar, load, router]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") cerrar();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, cerrar]);

  const hayPendientes = counts.red > 0 || counts.green > 0 || counts.yellow > 0;

  return (
    <div className="relative">
      <button
        ref={botonRef}
        type="button"
        aria-label={bellAriaLabel(counts)}
        title={bellAriaLabel(counts)}
        // C4 · M-2: NO se declara `aria-haspopup="menu"`. El panel es una lista
        // de enlaces, no un menú ARIA con `menuitem` y navegación por flechas;
        // anunciarlo como menú es un fallo de WCAG 4.1.2. Se declara el panel
        // que controla y su estado, que es lo que realmente hay.
        aria-controls={panelId}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="nx-icon-btn relative inline-flex h-10 w-10 items-center justify-center rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tops-red/50"
      >
        <Icon name="bell" size={17} />
        {hayPendientes && (
          // Los tres conviven: no hay color prioritario ni fusión en un cuarto.
          // El orden visual coincide con el del DOM y con el del aria-label
          // (rojo, verde, amarillo): sin `flex-row-reverse`, que los invertía.
          <span className="pointer-events-none absolute -right-1.5 -top-1 flex items-center gap-[2px]">
            <CategoryBadge category="red_system" count={counts.red} />
            <CategoryBadge category="green_whatsapp" count={counts.green} />
            <CategoryBadge category="yellow_internal" count={counts.yellow} />
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={cerrar} aria-hidden />
          <div
            id={panelId}
            role="region"
            aria-label="Panel de notificaciones"
            className="absolute right-0 z-50 mt-1.5 w-80 max-w-[calc(100vw-24px)] overflow-hidden rounded-lg border border-stroke-soft bg-bg-surface shadow-lg"
          >
            <div className="flex items-center justify-between border-b border-stroke-soft bg-neutral-50 px-3 py-2">
              <div className="text-sm font-bold text-fg-brand">Notificaciones</div>
              {counts.red > 0 && (
                <button
                  type="button"
                  onClick={markAllRead}
                  className="text-[11px] font-semibold text-fg-link hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tops-red/50"
                >
                  Marcar todas leídas
                </button>
              )}
            </div>

            {/* C4 1/2 · M-4: apagado el rojo, verde y amarillo pueden seguir
                encendidos. Son mensajes sin leer, no avisos: decirlo evita que
                el operador lea la campanita como "la marcación no funcionó". */}
            {counts.red === 0 && counts.green + counts.yellow > 0 && (
              <p className="border-b border-stroke-soft bg-neutral-50 px-3 py-2 text-[11px] text-fg-secondary">
                No quedan avisos pendientes. Los indicadores verde y amarillo son mensajes
                sin leer: se apagan al abrir cada conversación.
              </p>
            )}

            {errorMarcado && (
              <p
                role="alert"
                className="border-b border-stroke-soft bg-tops-red/5 px-3 py-2 text-[11px] text-tops-red"
              >
                {errorMarcado}
              </p>
            )}

            {/* Resumen por categoría: cada cifra es la exacta, sin recorte. */}
            <div className="flex items-stretch gap-1 border-b border-stroke-soft bg-neutral-50/60 px-2 py-1.5">
              <ResumenCategoria category="red_system" count={counts.red} href="/connect/notificaciones" onNavigate={cerrar} />
              <ResumenCategoria category="green_whatsapp" count={counts.green} href="/connect?filtro=whatsapp" onNavigate={cerrar} />
              <ResumenCategoria category="yellow_internal" count={counts.yellow} href="/connect" onNavigate={cerrar} />
            </div>

            <div className="max-h-96 overflow-y-auto">
              {items.length === 0 && (
                <div className="px-3 py-6 text-center text-sm text-fg-muted">
                  Sin notificaciones todavía.
                </div>
              )}
              {items.map((n) => (
                <NotificationRow
                  key={n.id}
                  n={n}
                  pending={abriendoId === n.id}
                  onOpen={openNotification}
                />
              ))}
            </div>
            <Link
              href="/connect/notificaciones"
              onClick={cerrar}
              className="block border-t border-stroke-soft bg-neutral-50 px-3 py-2 text-center text-[11px] font-semibold text-fg-link hover:underline"
            >
              Ver todo el centro de notificaciones
            </Link>
          </div>
        </>
      )}
    </div>
  );
}

/** Fila del resumen: icono + nombre + cantidad exacta, con destino propio. */
function ResumenCategoria({
  category,
  count,
  href,
  onNavigate,
}: {
  category: NotificationCategory;
  count: number;
  href: string;
  onNavigate: () => void;
}) {
  const style = CATEGORY_STYLE[category];
  const etiqueta = categoryAriaLabel(category, count);
  // C4 · M-3: el estado en cero NO se atenúa con opacidad —el compuesto caía a
  // 2.15:1 en rojo y 3.09:1 en amarillo, por debajo de AA— sino que usa un par
  // neutro de contraste conocido. El color pleno queda reservado a las
  // categorías que efectivamente tienen pendientes.
  const estilo = count === 0
    ? "rounded-[4px] bg-bg-surface-alt text-fg-secondary"
    : style.badgeClass;
  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-label={etiqueta}
      title={etiqueta}
      className={`flex flex-1 items-center justify-center gap-1 px-1 py-1 text-[10px] font-bold ${estilo} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fg-brand/40`}
    >
      <Icon name={style.icon} size={10} aria-hidden />
      <span>{formatBadgeCount(count)}</span>
    </Link>
  );
}

function NotificationRow({
  n,
  pending,
  onOpen,
}: {
  n: Notification;
  pending: boolean;
  onOpen: (
    event: MouseEvent<HTMLAnchorElement>,
    notification: Notification,
    href: string,
  ) => void;
}) {
  // F4.1B: ruteo unificado con el Centro (hrefFor) — una mención/DM navega al hilo,
  // no a "#" (hasta F3 solo orders tenía destino).
  const href = hrefFor(n.entity, n.entity_id);
  const isUnread = !n.is_read;
  return (
    <Link
      href={href}
      onClick={(event) => { void onOpen(event, n, href); }}
      aria-busy={pending}
      className={`flex gap-2 border-b border-stroke-soft px-3 py-2.5 last:border-b-0 hover:bg-neutral-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tops-red/40 ${
        isUnread ? "bg-tops-blue-700/5" : ""
      }`}
    >
      <div
        className={`mt-2 h-1.5 w-1.5 shrink-0 ${
          isUnread ? CATEGORY_STYLE.red_system.dotClass : "rounded-full bg-transparent"
        }`}
      />
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs font-semibold text-fg-primary">{n.title}</div>
        <div className="truncate text-[11px] text-fg-secondary">{n.message}</div>
        <div className="mt-0.5 text-[10px] text-fg-muted">{relTime(n.created_at)}</div>
      </div>
    </Link>
  );
}
