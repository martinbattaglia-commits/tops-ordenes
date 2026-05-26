"use client";

import { useRouter } from "next/navigation";
import { useCallback } from "react";
import { useRealtimeTable } from "@/lib/supabase/realtime";

/**
 * Componente invisible: escucha cambios en `orders` y refresca la página
 * (re-fetch del Server Component). Se monta en /dashboard y /orders.
 */
export function RealtimeRefresher({ table = "orders" as const }: { table?: "orders" }) {
  const router = useRouter();
  const refresh = useCallback(() => {
    router.refresh();
  }, [router]);

  useRealtimeTable(table, refresh);
  return null;
}
