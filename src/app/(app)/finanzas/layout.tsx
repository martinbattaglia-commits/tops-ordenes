import React from "react";

export const metadata = {
  title: "Finanzas · TOPS NEXUS",
  description: "Módulo financiero nativo de planificación, caja y rentabilidad de Logística TOPS.",
};

export default function FinanzasLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#F4F5F8]">
      {children}
    </div>
  );
}
