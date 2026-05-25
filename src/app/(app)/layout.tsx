import type { ReactNode } from "react";
import Shell from "@/components/shell/Shell";
import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";

export default async function AppLayout({ children }: { children: ReactNode }) {
  // Datos de usuario para mostrar en el sidebar / topbar
  let userMeta = {
    name: "Ruth Cardozo",
    role: "Administración · Verotin S.A.",
    avatar: "RC",
  };

  if (!env.app.demoMode) {
    const supabase = createClient();
    if (supabase) {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const meta = user.user_metadata as Record<string, string | undefined>;
        const name = meta.full_name || meta.name || user.email?.split("@")[0] || "Usuario";
        const role = meta.role || "Operaciones";
        userMeta = {
          name,
          role,
          avatar: name
            .split(" ")
            .map((p) => p[0])
            .filter(Boolean)
            .slice(0, 2)
            .join("")
            .toUpperCase(),
        };
      }
    }
  }

  return <Shell user={userMeta}>{children}</Shell>;
}
