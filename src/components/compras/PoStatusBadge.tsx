import { PO_STATUS_META, type PoStatus } from "@/lib/types-po";
import { cn } from "@/lib/utils";

export function PoStatusBadge({ status, className }: { status: PoStatus; className?: string }) {
  const meta = PO_STATUS_META[status];
  return (
    <span className={cn("badge", meta.cls, className)}>
      <span className="dot" />
      {meta.label}
    </span>
  );
}
