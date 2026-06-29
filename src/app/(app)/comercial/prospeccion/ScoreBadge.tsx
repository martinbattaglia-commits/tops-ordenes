"use client";

// Chip de score 0-100. Color según rango.
export function ScoreBadge({ score }: { score: number }) {
  const colorClass =
    score >= 75
      ? "bg-emerald-100 text-emerald-800 font-bold"
      : score >= 50
        ? "bg-amber-100 text-amber-800"
        : "bg-red-100 text-red-700";

  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs ${colorClass}`}
    >
      {score}
    </span>
  );
}
