import React from "react";

export const metadata = {
  title: "Finanzas · TOPS NEXUS",
  description: "Módulo financiero nativo de planificación, caja y rentabilidad de Logística TOPS.",
};

export default function FinanzasLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-bg-page text-fg-primary transition-colors duration-200">
      {children}
    </div>
  );
}
