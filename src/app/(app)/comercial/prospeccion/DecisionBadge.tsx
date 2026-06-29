"use client";

// Badge de decisión (import/review/discard) o status (aprobado/rechazado/sincronizado/etc.)
export function DecisionBadge({ decision }: { decision: string }) {
  switch (decision) {
    case "import":
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-700">
          <span>🟢</span> Excelente
        </span>
      );
    case "review":
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-700">
          <span>🟡</span> Revisar
        </span>
      );
    case "discard":
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-700">
          <span>🔴</span> Descartar
        </span>
      );
    case "aprobado":
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-700">
          <span>✅</span> Aprobado
        </span>
      );
    case "rechazado":
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-700">
          <span>❌</span> Rechazado
        </span>
      );
    case "sincronizado":
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-700">
          <span>🔗</span> En CRM
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600">
          {decision}
        </span>
      );
  }
}
