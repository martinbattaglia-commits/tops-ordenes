import React from "react";
import { PresupuestoClient } from "./PresupuestoClient";
import {
  listFinanceVersions,
  getActiveFinanceVersion,
  listFinanceCategories,
  getConsolidatedAccountPositions,
} from "@/lib/finanzas/data";

export const dynamic = "force-dynamic";

export default async function PresupuestoPage() {
  const [versions, activeVersion, categories, positions] = await Promise.all([
    listFinanceVersions(),
    getActiveFinanceVersion(),
    listFinanceCategories(),
    getConsolidatedAccountPositions(),
  ]);

  return (
    <PresupuestoClient
      initialVersions={versions}
      initialActiveVersion={activeVersion}
      initialCategories={categories}
      accountPositions={positions}
    />
  );
}
