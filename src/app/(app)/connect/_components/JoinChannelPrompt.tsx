"use client";

// F4.1D · F-1: rama "Unirme" para la ruta de conversación /connect/c/[id] (la del sidebar y
// las notificaciones). Hasta F3 el botón solo existía en /connect/canales/[slug]: un no-miembro
// no-admin que llegaba por acá a un canal PÚBLICO veía el hilo vacío y el envío fallaba.
// Reusa joinChannelAction → connect_join_channel (0150; desde 0163 rechaza archivados).
// NO abre permisos: canales privados/grupos siguen fail-closed (RLS/RPC intactos).

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";
import { joinChannelAction } from "@/lib/connect/adapters/driving/channel-actions";

export function JoinChannelPrompt({
  conversationId,
  title,
}: {
  conversationId: string;
  title: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function join() {
    setBusy(true);
    setErr(null);
    const r = await joinChannelAction({ conversationId });
    setBusy(false);
    if (!r.ok) {
      setErr(r.message ?? "No se pudo unir al canal.");
      return;
    }
    router.refresh();
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
      <Icon name="chat" size={26} className="text-fg-muted" />
      <div>
        <p className="text-sm font-bold text-fg-primary">{title}</p>
        <p className="mt-1 text-xs text-fg-muted">
          Es un canal público. Unite para ver los mensajes y participar.
        </p>
      </div>
      <button type="button" onClick={() => void join()} disabled={busy} className="btn btn-primary btn-sm">
        <Icon name="plus" size={14} /> {busy ? "Uniéndote…" : "Unirme a este canal"}
      </button>
      {err && <p className="text-xs text-tops-red">{err}</p>}
    </div>
  );
}
