// src/app/(app)/compras/conciliacion/[poId]/ScoreBadge.tsx

interface Props { score: number; size?: "sm" | "md" | "lg" }

export function ScoreBadge({ score, size = "md" }: Props) {
  const color =
    score === 100 ? "text-[var(--status-success)]"
    : score >= 90  ? "text-[var(--status-warning)]"
    : "text-[var(--status-danger)]";

  const dim = size === "lg" ? 80 : size === "md" ? 56 : 40;
  const r = dim / 2 - 6;
  const circ = 2 * Math.PI * r;
  const dash = (score / 100) * circ;

  return (
    <div className="flex flex-col items-center gap-1">
      <svg width={dim} height={dim} viewBox={`0 0 ${dim} ${dim}`} className="rotate-[-90deg]">
        <circle
          cx={dim / 2} cy={dim / 2} r={r}
          fill="none" stroke="var(--stroke-soft)" strokeWidth={5}
        />
        <circle
          cx={dim / 2} cy={dim / 2} r={r}
          fill="none"
          stroke={score === 100 ? "var(--status-success)" : score >= 90 ? "var(--status-warning)" : "var(--status-danger)"}
          strokeWidth={5}
          strokeDasharray={`${dash} ${circ - dash}`}
          strokeLinecap="round"
          className="transition-all duration-500"
        />
      </svg>
      <span className={`text-sm font-bold tabular ${color}`}>{score}%</span>
    </div>
  );
}
