// Estado vacío reutilizable (RC1.4 pulido UX). Consistente en todos los centros de Nexus Link.

import type { ReactNode } from "react";
import { Icon, type IconName } from "@/components/Icon";

export function EmptyState({
  icon = "inbox", title, hint, action,
}: {
  icon?: IconName;
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
      <div className="grid h-14 w-14 place-items-center rounded-full bg-bg-surface-alt">
        <Icon name={icon} size={24} className="text-fg-muted" />
      </div>
      <div>
        <p className="text-sm font-bold text-fg-primary">{title}</p>
        {hint && <p className="mt-1 max-w-sm text-xs text-fg-muted">{hint}</p>}
      </div>
      {action}
    </div>
  );
}
