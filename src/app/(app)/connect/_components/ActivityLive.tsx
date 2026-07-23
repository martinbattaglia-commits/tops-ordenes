"use client";

// Refresco realtime del Centro de Actividad (RC1.4). Monta una suscripción a
// knowledge_events y dispara router.refresh() ante cambios. En demo mode el hook
// no suscribe nada (no-op). No renderiza UI.

import { useRouter } from "next/navigation";
import { useRealtimeTable } from "@/lib/supabase/realtime";

export function ActivityLive() {
  const router = useRouter();
  useRealtimeTable("knowledge_events", () => router.refresh());
  return null;
}
