import { Icon } from "@/components/Icon";
import type { Insight } from "@/lib/comercial/dashboard-insights";

interface Props {
  insights: Insight[];
}

const TONE_CONFIG: Record<
  Insight["tone"],
  { iconName: string; colorClass: string; bgClass: string }
> = {
  info: {
    iconName: "bell",
    colorClass: "text-status-info",
    bgClass: "bg-blue-50 dark:bg-blue-950/20",
  },
  success: {
    iconName: "check-circle",
    colorClass: "text-status-success",
    bgClass: "bg-green-50 dark:bg-green-950/20",
  },
  warning: {
    iconName: "eye",
    colorClass: "text-status-warning",
    bgClass: "bg-yellow-50 dark:bg-yellow-950/20",
  },
  danger: {
    iconName: "shield",
    colorClass: "text-status-danger",
    bgClass: "bg-red-50 dark:bg-red-950/20",
  },
};

export function AutoInsights({ insights }: Props) {
  return (
    <div className="card card-pad">
      <div className="text-xs font-semibold uppercase tracking-wider text-fg-muted mb-3">
        Insights automáticos
      </div>

      {insights.length === 0 ? (
        <p className="text-sm text-fg-muted">Sin insights disponibles por el momento.</p>
      ) : (
        <ul className="flex flex-col gap-2 nx-stagger">
          {insights.map((insight, i) => {
            const cfg = TONE_CONFIG[insight.tone];
            return (
              <li
                key={i}
                className={`flex items-start gap-3 rounded-md px-3 py-2.5 ${cfg.bgClass}`}
                style={{ animationDelay: String(i * 40) + "ms" }}
              >
                <span className={`mt-0.5 shrink-0 ${cfg.colorClass}`}>
                  <Icon name={cfg.iconName as Parameters<typeof Icon>[0]["name"]} size={16} />
                </span>
                <span className="text-sm text-fg-primary leading-snug">{insight.text}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
