// Nexus Link · chips de estado/severidad del Centro de Incidentes (F4.2).
// Server-safe (sin "use client"). Colores por paleta literal (los tokens var()
// no soportan /opacity — gotcha dark mode conocido).

import {
  INCIDENT_SEVERITY_LABELS, INCIDENT_STATUS_LABELS,
  type IncidentSeverity, type IncidentStatus,
} from "@/lib/connect/types";

const SEVERITY_CLASS: Record<IncidentSeverity, string> = {
  critica: "bg-red-500/15 text-red-400",
  alta: "bg-orange-400/15 text-orange-400",
  media: "bg-amber-400/15 text-amber-500",
  baja: "bg-slate-400/15 text-fg-muted",
};

const STATUS_CLASS: Record<IncidentStatus, string> = {
  abierto: "bg-red-400/10 text-red-400",
  en_progreso: "bg-blue-400/15 text-blue-400",
  en_espera: "bg-amber-400/15 text-amber-500",
  resuelto: "bg-emerald-400/15 text-emerald-400",
  cerrado: "bg-slate-400/15 text-fg-muted",
};

export function SeverityChip({ severidad }: { severidad: IncidentSeverity }) {
  return (
    <span className={`chip text-[10px] ${SEVERITY_CLASS[severidad]}`}>
      {INCIDENT_SEVERITY_LABELS[severidad]}
    </span>
  );
}

export function StatusChip({ estado }: { estado: IncidentStatus }) {
  return (
    <span className={`chip text-[10px] ${STATUS_CLASS[estado]}`}>
      {INCIDENT_STATUS_LABELS[estado]}
    </span>
  );
}
