"use client";

// Nexus Link · COMPONENTE ESTÁNDAR (D-RC1.3-4): única forma oficial de acceder a la conversación
// contextual de una entidad del ERP. Mismo icono, comportamiento, ubicación relativa y UX en TODO el
// ERP. Los módulos lo embeben como `<EntityConversationButton entityType="orders" entityId={id} />`.
// Vive en components/connect (compartido) para que cualquier módulo lo importe sin acoplar a connect.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";
import { cn } from "@/lib/utils";
import type { ConnectEntityType } from "@/lib/connect/types";
import { contextualConversationHref } from "@/lib/connect/domain/entity-conversation";
import { getOrCreateEntityConversationAction } from "@/lib/connect/adapters/driving/entity-conversation-actions";

export function EntityConversationButton({
  entityType,
  entityId,
  label = "Conversación",
  size = "sm",
  className,
}: {
  entityType: ConnectEntityType;
  /** id de la entidad (uuid; para compliance_items, el id text). */
  entityId: string;
  label?: string;
  size?: "sm" | "md";
  className?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function open() {
    if (busy) return;
    setBusy(true);
    // Asociación automática (D-RC1.3): asegura la conversación 'erp' principal antes de navegar.
    const isText = entityType === "compliance_items";
    await getOrCreateEntityConversationAction(
      isText ? { entityType, entityIdText: entityId } : { entityType, entityId },
    );
    setBusy(false);
    router.push(contextualConversationHref(entityType, entityId));
  }

  return (
    <button
      type="button"
      onClick={() => void open()}
      disabled={busy}
      className={cn("btn btn-ghost", size === "sm" ? "btn-sm" : "", className)}
      title="Abrir la conversación contextual de esta entidad en Nexus Link"
    >
      <Icon name="chat" size={size === "sm" ? 14 : 16} />
      <span>{label}</span>
    </button>
  );
}
