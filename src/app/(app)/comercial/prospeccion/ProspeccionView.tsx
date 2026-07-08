"use client";

import { useState, useTransition, useCallback } from "react";
import { useRouter } from "next/navigation";
import { ImportWizard } from "./ImportWizard";
import { QualificationDashboard } from "./QualificationDashboard";
import { QualificationTable } from "./QualificationTable";
import { BulkActionsBar } from "./BulkActionsBar";
import { ExportModal } from "./ExportModal";
import type {
  ProspectWithScore,
  QualificationSummary,
} from "@/lib/prospeccion/read/qualification-data";
import { qualifyProspectsAction } from "@/lib/prospeccion/adapters/driving/qualify-actions";
import {
  approveProspectAction,
  bulkApproveAction,
  rejectProspectAction,
  approveAllGreenAction,
} from "@/lib/prospeccion/adapters/driving/approval-actions";
import { exportApprovedToClientifyAction } from "@/lib/prospeccion/adapters/driving/export-actions";

type Tab = "bandeja" | "dashboard";

interface ExportResults {
  prospect_id: string;
  ok: boolean;
  error: string | null;
}

export function ProspeccionView({
  items,
  summary,
  canCreate,
  canApprove,
  canExport,
}: {
  items: ProspectWithScore[];
  summary: QualificationSummary;
  canCreate: boolean;
  canApprove: boolean;
  canExport: boolean;
}) {
  const router = useRouter();

  // ---- UI state ----
  const [activeTab, setActiveTab] = useState<Tab>("bandeja");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [exportResults, setExportResults] = useState<ExportResults[] | undefined>(undefined);
  const [actionError, setActionError] = useState<string | null>(null);
  const [processingTimeMs, setProcessingTimeMs] = useState<number | undefined>(undefined);

  // ---- Transitions ----
  const [isQualifying, startQualify] = useTransition();
  const [isApproving, startApprove] = useTransition();
  const [isExporting, startExport] = useTransition();

  const isPending = isQualifying || isApproving || isExporting;

  // ---- Derived ----
  const totalGreen = items.filter(
    (p) => p.decision === "import" && p.status === "scoreado",
  ).length;

  // ---- Handlers ----

  const handleImportSuccess = useCallback(
    (_result: { inserted: number }) => {
      // Auto-califica después de import
      startQualify(async () => {
        const t0 = performance.now();
        const result = await qualifyProspectsAction();
        setProcessingTimeMs(performance.now() - t0);

        if (!result.ok) {
          setActionError(result.message);
        } else {
          setActionError(null);
          setActiveTab("dashboard");
        }
        router.refresh();
      });
    },
    [router],
  );

  const handleQualifyAll = useCallback(() => {
    setActionError(null);
    startQualify(async () => {
      const t0 = performance.now();
      const result = await qualifyProspectsAction();
      setProcessingTimeMs(performance.now() - t0);

      if (!result.ok) {
        setActionError(result.message);
      } else {
        setActionError(null);
      }
      router.refresh();
    });
  }, [router]);

  const handleApprove = useCallback(
    (id: string) => {
      setActionError(null);
      startApprove(async () => {
        const result = await approveProspectAction(id);
        if (!result.ok) setActionError(result.message);
        else router.refresh();
      });
    },
    [router],
  );

  const handleReject = useCallback(
    (id: string, reason: string) => {
      setActionError(null);
      startApprove(async () => {
        const result = await rejectProspectAction(id, reason);
        if (!result.ok) setActionError(result.message);
        else router.refresh();
      });
    },
    [router],
  );

  const handleExportSingle = useCallback(
    (id: string) => {
      setActionError(null);
      startExport(async () => {
        const result = await exportApprovedToClientifyAction([id]);
        if (!result.ok) {
          setActionError(result.message);
        } else {
          setExportResults(result.results);
          setExportModalOpen(true);
          router.refresh();
        }
      });
    },
    [router],
  );

  const handleApproveAll = useCallback(() => {
    setActionError(null);
    startApprove(async () => {
      const result = await approveAllGreenAction();
      if (!result.ok) setActionError(result.message);
      else router.refresh();
    });
  }, [router]);

  const handleApproveSelected = useCallback(() => {
    if (selectedIds.length === 0) return;
    setActionError(null);
    startApprove(async () => {
      const result = await bulkApproveAction(selectedIds);
      if (!result.ok) setActionError(result.message);
      else {
        setSelectedIds([]);
        router.refresh();
      }
    });
  }, [selectedIds, router]);

  const handleRejectSelected = useCallback(() => {
    if (selectedIds.length === 0) return;
    setActionError(null);
    startApprove(async () => {
      for (const id of selectedIds) {
        await rejectProspectAction(id, "Rechazado en bloque");
      }
      setSelectedIds([]);
      router.refresh();
    });
  }, [selectedIds, router]);

  const handleExportApproved = useCallback(() => {
    setExportResults(undefined);
    setExportModalOpen(true);
  }, []);

  const handleExportAll = useCallback(() => {
    setExportResults(undefined);
    setExportModalOpen(true);
  }, []);

  const handleExportConfirm = useCallback(() => {
    setActionError(null);
    startExport(async () => {
      const result = await exportApprovedToClientifyAction();
      if (!result.ok) {
        setActionError(result.message);
        setExportModalOpen(false);
      } else {
        setExportResults(result.results);
        router.refresh();
      }
    });
  }, [router]);

  const approvedCount = items.filter((p) => p.status === "aprobado").length;

  return (
    <div className="space-y-6 p-4 md:p-7 lg:p-8 max-w-[1400px] mx-auto">
      {/* Header */}
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-fg-primary">
            Prospección Inteligente
          </h1>
          <p className="mt-1 text-sm text-fg-secondary">
            LinkedIn / CSV → Nexus → aprobación humana → CRM Clientify.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center rounded-full bg-bg-surface-alt px-3 py-1 text-xs font-medium text-fg-secondary">
            {items.length} prospecto{items.length !== 1 ? "s" : ""}
          </span>
          {summary.totalScoreado > 0 && (
            <span className="inline-flex items-center rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-400">
              {summary.totalScoreado} calificado{summary.totalScoreado !== 1 ? "s" : ""}
            </span>
          )}
        </div>
      </header>

      {/* Error banner */}
      {actionError && (
        <div className="flex items-start gap-3 rounded-lg bg-tops-red/10 p-3 text-sm text-red-400">
          <svg className="mt-0.5 h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <span>{actionError}</span>
          <button
            onClick={() => setActionError(null)}
            className="ml-auto text-red-400/70 transition-colors hover:text-red-400"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* Import wizard */}
      {canCreate && (
        <ImportWizard onImportSuccess={handleImportSuccess} />
      )}

      {/* Tabs */}
      <div className="border-b border-stroke-soft">
        <nav className="-mb-px flex gap-6">
          {(["bandeja", "dashboard"] as Tab[]).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`pb-3 text-sm font-medium transition-colors ${
                activeTab === tab
                  ? "border-b-2 border-tops-blue-700 text-fg-link"
                  : "text-fg-muted hover:text-fg-secondary"
              }`}
            >
              {tab === "bandeja" ? "Bandeja" : "Dashboard"}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab: Bandeja */}
      {activeTab === "bandeja" && (
        <div className="space-y-4">
          {(canApprove || canExport) && (
            <BulkActionsBar
              selectedIds={selectedIds}
              totalGreen={totalGreen}
              onApproveAll={handleApproveAll}
              onApproveSelected={handleApproveSelected}
              onRejectSelected={handleRejectSelected}
              onExportApproved={handleExportApproved}
              onExportAll={handleExportAll}
              isPending={isPending}
            />
          )}
          <QualificationTable
            items={items}
            onApprove={canApprove ? handleApprove : () => {}}
            onReject={canApprove ? handleReject : () => {}}
            onExport={canExport ? handleExportSingle : () => {}}
            onSelectionChange={setSelectedIds}
            isPending={isPending}
          />
        </div>
      )}

      {/* Tab: Dashboard */}
      {activeTab === "dashboard" && (
        <QualificationDashboard
          summary={summary}
          onQualifyAll={canCreate ? handleQualifyAll : undefined}
          isQualifying={isQualifying}
          processingTimeMs={processingTimeMs}
        />
      )}

      {/* Export modal */}
      {canExport && (
        <ExportModal
          isOpen={exportModalOpen}
          onClose={() => {
            setExportModalOpen(false);
            setExportResults(undefined);
          }}
          onConfirm={handleExportConfirm}
          approvedCount={approvedCount}
          isPending={isExporting}
          results={exportResults}
        />
      )}
    </div>
  );
}
