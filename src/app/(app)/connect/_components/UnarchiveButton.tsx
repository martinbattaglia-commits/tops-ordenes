"use client";

// Nexus Link · H1 (D3): reversa visible del archivado en hilos de ENTIDAD (tarea/incidente),
// cuyo header no tiene la superficie de administración de canal/grupo. La legitimidad la
// valida la RPC connect_unarchive_conversation (0206): owner/moderator/admin o entidad
// vinculada reactivada — acá sólo se muestra el error si la rechaza.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";
import { unarchiveConversationAction } from "@/lib/connect/adapters/driving/channel-actions";

export function UnarchiveButton({ conversationId }: { conversationId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function unarchive() {
    setBusy(true);
    setErr(null);
    const r = await unarchiveConversationAction({ conversationId });
    setBusy(false);
    if (!r.ok) {
      setErr(r.message);
      return;
    }
    router.refresh();
  }

  return (
    <span className="flex items-center gap-1.5">
      <button
        type="button"
        className="btn btn-ghost btn-sm text-xs"
        disabled={busy}
        onClick={() => void unarchive()}
      >
        <Icon name="folder" size={13} /> Desarchivar
      </button>
      {err && <span className="text-[10px] text-red-500">{err}</span>}
    </span>
  );
}
