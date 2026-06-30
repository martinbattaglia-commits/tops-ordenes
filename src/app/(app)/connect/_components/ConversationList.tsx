"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "@/components/Icon";
import { cn } from "@/lib/utils";
import type { InboxItem, ConversationKind } from "@/lib/connect/types";
import { timeAgo } from "@/lib/connect/format";

const KIND_ICON: Record<ConversationKind, IconName> = {
  dm: "user", group: "users", channel: "megaphone", erp: "database",
  incident: "shield", whatsapp: "whatsapp", ai: "sparkle",
};

export function ConversationList({ items }: { items: InboxItem[] }) {
  const pathname = usePathname();

  return (
    <>
      <div className="flex items-center justify-between gap-2 border-b border-stroke-soft px-4 py-3">
        <div className="flex items-center gap-2">
          <Icon name="chat" size={18} className="text-tops-red" />
          <h1 className="text-sm font-bold text-fg-primary">Nexus Link</h1>
        </div>
        <span className="text-[11px] text-fg-muted">{items.length}</span>
      </div>

      <nav className="flex-1 overflow-y-auto">
        {items.length === 0 && (
          <p className="px-4 py-6 text-center text-xs text-fg-muted">Sin conversaciones todavía.</p>
        )}
        {items.map((it) => {
          const href = `/connect/c/${it.conversationId}`;
          const active = pathname === href;
          return (
            <Link
              key={it.conversationId}
              href={href}
              className={cn(
                "flex items-start gap-2.5 border-b border-stroke-soft/50 px-3 py-2.5 transition-colors",
                active ? "bg-bg-surface-alt" : "hover:bg-bg-surface-alt",
              )}
            >
              <div className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-bg-surface-alt">
                <Icon name={KIND_ICON[it.kind]} size={15} className="text-fg-secondary" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-[13px] font-semibold text-fg-primary">
                    {it.title ?? (it.slug ? `#${it.slug}` : "Conversación")}
                  </span>
                  <span className="shrink-0 text-[10px] text-fg-muted">{timeAgo(it.lastMessageAt)}</span>
                </div>
                <div className="mt-0.5 flex items-center justify-between gap-2">
                  <span className="truncate text-[11px] text-fg-muted">{it.topic ?? ""}</span>
                  {it.unreadCount > 0 && (
                    <span className="shrink-0 rounded-full bg-tops-red px-1.5 text-[10px] font-bold text-white">
                      {it.unreadCount}
                    </span>
                  )}
                </div>
              </div>
            </Link>
          );
        })}
      </nav>
    </>
  );
}
