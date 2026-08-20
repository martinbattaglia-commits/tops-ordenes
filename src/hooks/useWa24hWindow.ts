"use client";

import { useState, useEffect, useCallback } from "react";
import {
  calculateWa24hWindow,
  draftManager,
  type WaWindowInfo,
} from "@/lib/whatsapp/window24h";

export function useWa24hWindow(
  conversationId: string,
  lastCustomerMessageAt?: string | Date | null
) {
  const [windowInfo, setWindowInfo] = useState<WaWindowInfo>(() =>
    calculateWa24hWindow(lastCustomerMessageAt)
  );

  const [draftText, setDraftTextState] = useState<string>(() =>
    draftManager.getDraft(conversationId)
  );

  // Recalcular la ventana de 24h en tiempo real (reloj cada 30s)
  useEffect(() => {
    function update() {
      setWindowInfo(calculateWa24hWindow(lastCustomerMessageAt));
    }
    update();
    const interval = setInterval(update, 30_000);
    return () => clearInterval(interval);
  }, [lastCustomerMessageAt]);

  // Sincronizar el borrador con draftManager en memoria (Cero pérdida de texto)
  const setDraftText = useCallback(
    (text: string) => {
      setDraftTextState(text);
      draftManager.setDraft(conversationId, text);
    },
    [conversationId]
  );

  const clearDraft = useCallback(() => {
    setDraftTextState("");
    draftManager.clearDraft(conversationId);
  }, [conversationId]);

  return {
    windowInfo,
    draftText,
    setDraftText,
    clearDraft,
  };
}
