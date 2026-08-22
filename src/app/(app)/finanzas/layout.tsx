import React from "react";
import { notFound } from "next/navigation";
import { getBootContext } from "@/lib/rbac/boot-permissions";

export const metadata = {
  title: "Finanzas · TOPS NEXUS",
  description: "Módulo financiero nativo de planificación, caja y rentabilidad de Logística TOPS.",
};

export default async function FinanzasLayout({ children }: { children: React.ReactNode }) {
  const { perms } = await getBootContext();
  if (!perms.finanzas) {
    notFound();
  }

  return (
    <div className="min-h-screen bg-bg-page text-fg-primary transition-colors duration-200">
      {children}
    </div>
  );
}
