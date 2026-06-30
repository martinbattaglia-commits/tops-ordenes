"use client";

// Favoritos (RC1.4) — estrella toggle. Sirve para conversaciones, canales y contextos ERP (todo es
// conversación). Optimista con revert. Reusa connect_toggle_favorite (0144) vía favorite-actions.

import { useState, type MouseEvent } from "react";
import { Icon } from "@/components/Icon";
import { cn } from "@/lib/utils";
import { toggleFavoriteAction } from "@/lib/connect/adapters/driving/favorite-actions";

export function FavoriteStar({
  conversationId, initial, size = 14, className,
}: {
  conversationId: string;
  initial: boolean;
  size?: number;
  className?: string;
}) {
  const [on, setOn] = useState(initial);
  const [busy, setBusy] = useState(false);

  async function toggle(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (busy) return;
    const next = !on;
    setOn(next);
    setBusy(true);
    const r = await toggleFavoriteAction({ conversationId, on: next });
    setBusy(false);
    if (!r.ok) setOn(!next); // revert ante error
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={busy}
      aria-pressed={on}
      aria-label={on ? "Quitar de favoritos" : "Marcar como favorito"}
      title={on ? "Quitar de favoritos" : "Marcar como favorito"}
      className={cn("rounded p-1 transition-colors hover:bg-bg-surface-alt", className)}
    >
      <Icon
        name="star"
        size={size}
        fill={on ? "currentColor" : "none"}
        className={on ? "text-amber-400" : "text-fg-muted"}
      />
    </button>
  );
}
