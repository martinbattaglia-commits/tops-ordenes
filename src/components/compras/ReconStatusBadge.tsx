// src/components/compras/ReconStatusBadge.tsx
import { RECON_STATUS_META } from "@/lib/recon/types";
import type { ReconStatus } from "@/lib/recon/types";

export function ReconStatusBadge({ status }: { status: ReconStatus }) {
  const meta = RECON_STATUS_META[status];
  return <span className={`badge ${meta.cls}`}>{meta.label}</span>;
}
