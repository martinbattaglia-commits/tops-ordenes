import { canAccess } from "@/lib/rbac/guard";
import { AccesoRestringido } from "@/components/shell/AccesoRestringido";
import { ModuleUnavailable } from "@/components/shell/ModuleUnavailable";
import { getKnowledgeAdminData } from "@/lib/knowledge/admin-data";
import { computeHealth } from "@/lib/knowledge/admin-health";
import type { KnowledgeAdminData } from "@/lib/knowledge/admin-types";
import LiveRefresh from "./LiveRefresh";
import {
  SystemHealthBanner,
  HealthUnavailable,
  KpiCard,
  WorkerPanel,
  QueuePanel,
  SourcesTable,
  DeadLetterTable,
} from "./panel-ui";

export const metadata = { title: "Knowledge · Panel administrativo" };
export const dynamic = "force-dynamic";

/**
 * F0.5.2 / E2.3 — Panel Administrativo del Knowledge Engine.
 *
 * Capa de OBSERVACIÓN (D-1): sólo lee KPIs vía RPC SECDEF read-only (0140); no muta nada.
 * Fail-closed por `knowledge.admin` (D-2). Orden Dirección-first (D-7): estado general →
 * health → KPIs → worker → cola → fuentes → dead-letter → técnico.
 */
export default async function KnowledgeAdminPage() {
  // Gate fail-closed (D-2): sin knowledge.admin → AccesoRestringido.
  if (!(await canAccess("knowledge.admin"))) {
    return <AccesoRestringido modulo="Conocimiento · Panel administrativo" />;
  }

  // Degradación grácil si 0140 no está aplicada o falla la lectura.
  let data: KnowledgeAdminData;
  try {
    data = await getKnowledgeAdminData();
  } catch (e) {
    return (
      <ModuleUnavailable
        title="Panel de Knowledge no disponible"
        migration="0140_knowledge_kpis_admin"
        detail={e instanceof Error ? e.message : String(e)}
      />
    );
  }

  const nowMs = Date.now();
  const assessment = data.health ? computeHealth(data.health) : null;
  const q = data.queue;

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      {/* Encabezado + monitoreo en vivo */}
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="eyebrow-tiny">Knowledge F0.5.2 · E2.3</div>
          <h1 className="page-title">Panel administrativo · Knowledge Engine</h1>
          <p className="page-subtitle">
            Observación operativa del pipeline (timeline, cola, worker, fuentes). Sólo lectura.
          </p>
        </div>
      </div>
      <div className="mb-5">
        <LiveRefresh />
      </div>

      {/* (1)(2) Estado general + Health Score */}
      {assessment ? <SystemHealthBanner assessment={assessment} /> : <HealthUnavailable />}

      {/* (3) KPIs principales */}
      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard label="Eventos totales" value={q?.total ?? "—"} icon="report" hint="en el timeline" />
        <KpiCard label="Procesados" value={q?.processed ?? "—"} icon="check-circle" tone="good" />
        <KpiCard
          label="En cola (due)"
          value={q?.dueNow ?? "—"}
          icon="package"
          tone={(q?.dueNow ?? 0) > 0 ? "warn" : "default"}
          hint="pending/failed listos"
        />
        <KpiCard
          label="Dead-letter"
          value={q?.dead ?? "—"}
          icon="bolt"
          tone={(q?.dead ?? 0) > 0 ? "bad" : "good"}
        />
      </div>

      {/* (4) Worker · (5) Cola */}
      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <WorkerPanel worker={data.worker} nowMs={nowMs} />
        <QueuePanel queue={data.queue} />
      </div>

      {/* (6) Fuentes */}
      <div className="mt-5">
        <SourcesTable sources={data.sources} />
      </div>

      {/* (7) Dead-letter */}
      <div className="mt-5">
        <DeadLetterTable rows={data.deadLetter} />
      </div>

      {/* (8) Info técnica */}
      <p className="mt-6 text-xs text-fg-muted">
        Datos vía RPC <code>knowledge_kpi_*</code> (migración <code>0140_knowledge_kpis_admin</code>),
        agregación <code>SECURITY DEFINER</code> read-only con gate <code>knowledge.admin</code>.
        El panel no modifica el pipeline (emisor / worker / adaptadores / timeline congelados).
      </p>
    </div>
  );
}
