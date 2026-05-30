/**
 * Compliance Alert Engine — clasificador determinístico de credenciales,
 * auditorías y documentos contra umbrales regulatorios.
 *
 * Política de severidad:
 *   · crítico   → vencido o vence en ≤ 30 días, o auditoría con observaciones abiertas.
 *   · warning   → vence en 31-90 días.
 *   · ok        → vence en > 90 días, sin observaciones.
 *
 * Score regulatorio: 100 - (críticos * 20) - (warnings * 5), piso 0.
 *
 * En F2 este engine recibirá también el catálogo de archivos indexados desde
 * Google Drive ("Agencia Gubernamental de Control / Lujan + Magaldi") para
 * detectar documentos faltantes y vencimientos por nombre/metadata.
 */

import type { AnmatCredential, AnmatAudit } from "./data";

export type AlertSeverity = "critical" | "warning" | "ok";

export interface ComplianceAlert {
  id: string;
  severity: AlertSeverity;
  kind: "expiration" | "audit_observation" | "missing_doc" | "regulatory_update";
  title: string;
  detail: string;
  location?: string;
  dueAt?: string;
  daysLeft?: number;
  action?: { label: string; href: string };
}

export interface ComplianceSummary {
  alerts: ComplianceAlert[];
  byLevel: Record<AlertSeverity, number>;
  scoreRegulatorio: number;
  next90d: ComplianceAlert[];
}

export function classifyExpiration(daysLeft: number): AlertSeverity {
  if (daysLeft <= 30) return "critical";
  if (daysLeft <= 90) return "warning";
  return "ok";
}

export function buildComplianceSummary(
  credentials: AnmatCredential[],
  audits: AnmatAudit[]
): ComplianceSummary {
  const alerts: ComplianceAlert[] = [];

  // 1. Vencimientos de credenciales
  for (const c of credentials) {
    const sev =
      c.status === "vencido" ? "critical" : classifyExpiration(c.daysToExpiry);
    if (sev === "ok") continue;
    alerts.push({
      id: `exp-${c.id}`,
      severity: sev,
      kind: "expiration",
      title: c.number,
      detail: `${c.holder} · vence en ${c.daysToExpiry} días`,
      location: c.holder,
      dueAt: c.expiresAt,
      daysLeft: c.daysToExpiry,
      action: { label: "Ver documento", href: "/drive" },
    });
  }

  // 2. Observaciones de auditoría abiertas
  for (const a of audits) {
    if (a.observations <= 0) continue;
    alerts.push({
      id: `aud-${a.id}`,
      severity: "critical",
      kind: "audit_observation",
      title: `${a.observations} observación${a.observations === 1 ? "" : "es"} abierta${a.observations === 1 ? "" : "s"}`,
      detail: `${a.scope} · ${a.auditor}`,
      location: a.scope,
      dueAt: a.date,
      action: { label: "Ver auditoría", href: "/anmat" },
    });
  }

  // 3. Sort por severidad luego por daysLeft
  const order: Record<AlertSeverity, number> = { critical: 0, warning: 1, ok: 2 };
  alerts.sort((a, b) => {
    if (order[a.severity] !== order[b.severity]) return order[a.severity] - order[b.severity];
    return (a.daysLeft ?? 9999) - (b.daysLeft ?? 9999);
  });

  const byLevel: Record<AlertSeverity, number> = { critical: 0, warning: 0, ok: 0 };
  alerts.forEach((a) => (byLevel[a.severity] += 1));

  const scoreRegulatorio = Math.max(
    0,
    100 - byLevel.critical * 20 - byLevel.warning * 5
  );

  const next90d = alerts.filter(
    (a) => a.kind === "expiration" && (a.daysLeft ?? 9999) <= 90
  );

  return { alerts, byLevel, scoreRegulatorio, next90d };
}
