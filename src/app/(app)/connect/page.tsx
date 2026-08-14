import Link from "next/link";
import { Icon } from "@/components/Icon";
import { EmptyState } from "@/components/ui/EmptyState";
import { FavoriteStar } from "@/components/connect/FavoriteStar";
import { listInbox, listChannels } from "@/lib/connect/read/inbox-data";
import { listActivity } from "@/lib/connect/read/activity-data";
import { listNotificationCenter, readNotificationBadges } from "@/lib/notifications/data";
import { getMyProfile } from "@/lib/profile/data";
import { canAccessWaCommercialImport } from "@/lib/connect/wa-import/access";
import type { NotificationItem, NotificationPriority } from "@/lib/notifications/types";
import {
  CATEGORY_STYLE, categoryAriaLabel, categoryForConversationKind, formatBadgeCount,
  type NotificationCategory,
} from "@/lib/notifications/categories";
import { relTime } from "@/lib/utils";

export const metadata = { title: "Nexus Link · Inicio" };
export const dynamic = "force-dynamic";

const PRIORITY_DOT: Record<NotificationPriority, string> = {
  urgente: "bg-tops-red", importante: "bg-amber-400", normal: "bg-fg-muted",
};

/** Home de Nexus Link (D-RC1.4-6): punto de entrada diario. Reusa centros (notif/actividad/inbox). */
export default async function ConnectHomePage() {
  const [profile, notifs, activity, inbox, channels, badges] = await Promise.all([
    getMyProfile(), listNotificationCenter(), listActivity(6), listInbox(), listChannels(),
    readNotificationBadges(),
  ]);

  // FASE A · C4 H-2: la tarjeta "Notificaciones" es la categoría ROJA. Antes
  // fusionaba avisos del sistema con mensajes de WhatsApp y de chat interno en
  // un único pill rojo, que es exactamente la fusión que el mandato prohíbe:
  // los pendientes de conversación ya tienen su badge verde/amarillo en las
  // tarjetas de conversaciones y favoritos.
  const unread = notifs.filter((n) => !n.read && n.source === "notification");
  const favorites = inbox.filter((i) => i.isFavorite);
  const relevant = inbox.filter((i) => !i.isFavorite).slice(0, 5);
  const firstName = (profile?.fullName ?? "").split(" ")[0] || "equipo";

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <header className="border-b border-stroke-soft bg-bg-surface px-5 py-4">
        <div className="flex items-center gap-2">
          <Icon name="home" size={18} className="text-fg-link" />
          <h1 className="text-base font-bold text-fg-primary">Hola, {firstName}</h1>
        </div>
        <p className="mt-0.5 text-xs text-fg-muted">Tu día en Nexus Link: pendientes, actividad y conversaciones.</p>
        <form action="/connect/buscar" className="mt-3 flex max-w-xl items-center gap-2 rounded-lg border border-stroke-soft bg-bg-page px-3 py-2">
          <Icon name="search" size={15} className="text-fg-muted" />
          <input name="q" placeholder="Buscar conversaciones, contextos ERP, mensajes…" className="w-full bg-transparent text-sm outline-none placeholder:text-fg-muted" aria-label="Buscar en Nexus Link" />
        </form>
      </header>

      <div className="grid flex-1 gap-4 p-5 md:grid-cols-2 xl:grid-cols-3">
        {/* Notificaciones */}
        {/* C4 2/2 · M-1: la cifra sale de v_link_notification_badges, la misma
            fuente que la campanita. `unread` sólo alimenta la lista de abajo. */}
        <HomeCard title="Notificaciones" icon="bell" href="/connect/notificaciones" badge={badges.red}>
          {unread.length === 0 ? (
            <CardEmpty text="Sin pendientes." />
          ) : (
            <ul className="space-y-1.5">
              {unread.slice(0, 5).map((n) => <NotifRow key={n.id} n={n} />)}
            </ul>
          )}
        </HomeCard>

        {/* Actividad reciente */}
        <HomeCard title="Actividad reciente" icon="activity" href="/connect/actividad">
          {activity.length === 0 ? (
            <CardEmpty text="Sin eventos recientes." />
          ) : (
            <ol className="space-y-2.5 border-l border-stroke-soft pl-3">
              {activity.map((e) => (
                <li key={e.id} className="relative">
                  <span className="absolute -left-[15px] top-1 h-2 w-2 rounded-full bg-tops-red" />
                  <div className="text-xs font-medium leading-snug text-fg-primary">{e.summary ?? e.eventType}</div>
                  <div className="text-[10px] text-fg-muted">{e.actorLabel ?? "—"} · {relTime(e.occurredAt)}</div>
                </li>
              ))}
            </ol>
          )}
        </HomeCard>

        {/* Favoritos */}
        <HomeCard title="Favoritos" icon="star" href="/connect/favoritos">
          {favorites.length === 0 ? (
            <CardEmpty text="Marcá conversaciones con ⭐ para acceso rápido." />
          ) : (
            <ul className="space-y-1">{favorites.slice(0, 6).map((i) => <ConvRow key={i.conversationId} item={i} />)}</ul>
          )}
        </HomeCard>

        {/* Conversaciones relevantes */}
        <HomeCard title="Conversaciones relevantes" icon="chat" href="/connect">
          {relevant.length === 0 ? (
            <CardEmpty text="Sin conversaciones." />
          ) : (
            <ul className="space-y-1">{relevant.map((i) => <ConvRow key={i.conversationId} item={i} />)}</ul>
          )}
        </HomeCard>

        {/* WhatsApp Comercial: visible sólo para el mismo rol autorizado por ruta y actions. */}
        {canAccessWaCommercialImport(profile?.role) ? (
          <HomeCard
            title="WhatsApp Comercial"
            icon="whatsapp"
            href="/connect/wa-import"
            actionLabel="Importar"
          >
            <p className="text-xs leading-relaxed text-fg-muted">
              Previsualizá e importá un historial exportado de WhatsApp con confirmación de
              identidad y control de duplicados.
            </p>
          </HomeCard>
        ) : null}

        {/* Canales activos */}
        <HomeCard title="Canales activos" icon="users" href="/connect/canales">
          {channels.length === 0 ? (
            <CardEmpty text="No hay canales aún." />
          ) : (
            <ul className="space-y-1">
              {channels.slice(0, 6).map((c) => (
                <li key={c.id}>
                  <Link href={`/connect/canales/${c.slug ?? c.id}`} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-bg-surface-alt">
                    <Icon name="users" size={13} className="text-fg-muted" />
                    <span className="truncate text-fg-primary">{c.title ?? c.slug}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </HomeCard>
      </div>
    </div>
  );
}

function HomeCard({ title, icon, href, badge, badgeCategory = "red_system", actionLabel = "Ver todo", children }: {
  title: string; icon: Parameters<typeof Icon>[0]["name"]; href: string; badge?: number;
  badgeCategory?: NotificationCategory; actionLabel?: string; children: React.ReactNode;
}) {
  return (
    <section className="card flex flex-col gap-3 p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon name={icon} size={15} className="text-fg-link" />
          <h2 className="text-sm font-bold text-fg-primary">{title}</h2>
          {/* C4 · H-2: el recorte pasó de "9+" mudo a `formatBadgeCount`, con la
              cantidad EXACTA en aria-label y tooltip, y con el color de su
              categoría en vez de un rojo único para todo. */}
          {badge ? (
            <span
              aria-label={categoryAriaLabel(badgeCategory, badge)}
              title={categoryAriaLabel(badgeCategory, badge)}
              className={`grid h-4 min-w-[16px] place-items-center px-1 text-[10px] font-bold ${CATEGORY_STYLE[badgeCategory].badgeClass}`}
            >
              {formatBadgeCount(badge)}
            </span>
          ) : null}
        </div>
        <Link href={href} className="text-[11px] font-semibold text-fg-link hover:underline">{actionLabel}</Link>
      </div>
      <div className="min-h-[60px] flex-1">{children}</div>
    </section>
  );
}

function CardEmpty({ text }: { text: string }) {
  return <p className="py-3 text-center text-xs text-fg-muted">{text}</p>;
}

function NotifRow({ n }: { n: NotificationItem }) {
  return (
    <li>
      <Link href={n.href} className="flex items-start gap-2 rounded-md px-2 py-1.5 hover:bg-bg-surface-alt">
        <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${PRIORITY_DOT[n.priority]}`} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-medium text-fg-primary">{n.title}</span>
          {n.message && <span className="block truncate text-[11px] text-fg-muted">{n.message}</span>}
        </span>
      </Link>
    </li>
  );
}

function ConvRow({ item }: { item: import("@/lib/connect/types").InboxItem }) {
  return (
    <li className="flex items-center gap-1">
      <FavoriteStar conversationId={item.conversationId} initial={item.isFavorite} />
      <Link href={`/connect/c/${item.conversationId}`} className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 py-1.5 hover:bg-bg-surface-alt">
        <span className="truncate text-sm text-fg-primary">{item.title ?? item.slug ?? "Conversación"}</span>
        {item.unreadCount > 0 && (
          <span
            aria-label={categoryAriaLabel(categoryForConversationKind(item.kind), item.unreadCount)}
            title={categoryAriaLabel(categoryForConversationKind(item.kind), item.unreadCount)}
            className={`ml-auto grid h-4 min-w-[16px] place-items-center px-1 text-[10px] font-bold ${CATEGORY_STYLE[categoryForConversationKind(item.kind)].badgeClass}`}
          >
            {formatBadgeCount(item.unreadCount)}
          </span>
        )}
      </Link>
    </li>
  );
}
