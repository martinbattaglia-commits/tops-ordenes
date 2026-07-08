"use client";

export function ScoreBadge({ score }: { score: number }) {
  const colorClass =
    score >= 75
      ? "bg-emerald-500/10 text-emerald-400"
      : score >= 50
        ? "bg-amber-500/10 text-amber-400"
        : "bg-red-500/10 text-red-400";

  return (
    <span
      className={`inline-flex min-w-[2.25rem] items-center justify-center rounded-full px-2.5 py-0.5 text-sm font-bold tabular-nums ${colorClass}`}
    >
      {score}
    </span>
  );
}
