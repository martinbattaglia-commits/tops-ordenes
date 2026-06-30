"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";
import type { ConnectEntityType } from "@/lib/connect/types";
import { getOrCreateEntityConversationAction } from "@/lib/connect/adapters/driving/entity-conversation-actions";

/** CTA para crear la conversación contextual de una entidad que aún no la tiene (write-on-intent). */
export function StartEntityConversation({ entityType, entityId }: { entityType: ConnectEntityType; entityId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function start() {
    if (busy) return;
    setBusy(true); setErr(null);
    const isText = entityType === "compliance_items";
    const r = await getOrCreateEntityConversationAction(
      isText ? { entityType, entityIdText: entityId } : { entityType, entityId },
    );
    setBusy(false);
    if (!r.ok) setErr(r.message);
    else router.refresh();
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
      <div className="grid h-14 w-14 place-items-center rounded-full bg-bg-surface-alt">
        <Icon name="chat" size={24} className="text-fg-muted" />
      </div>
      <p className="max-w-sm text-sm text-fg-muted">
        Esta entidad todavía no tiene una conversación contextual. Iniciá una para coordinar y dejar
        traza vinculada a la entidad (aparece en su Entity360).
      </p>
      <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => void start()}>
        <Icon name="plus" size={14} /> Iniciar conversación
      </button>
      {err && <p className="text-xs text-tops-red">{err}</p>}
    </div>
  );
}
