"use client";

import { useCallback, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";

// ─── Types ────────────────────────────────────────────────────────────────────

export type SortKey = "score" | "amount" | "forecast" | "probability" | "modified" | "days_stagnant";

export interface TableroFilters {
  pipeline: string;
  stage: string;
  source: string;
  score: "hot" | "warm" | "cold" | "all";
  status: "active" | "expired" | "won" | "lost" | "all";
  no_action: boolean;
  stagnant: boolean;
  overdue: boolean;
  closing_30: boolean;
  sort: SortKey;
}

// ─── Defaults ─────────────────────────────────────────────────────────────────

export const DEFAULT_FILTERS: TableroFilters = {
  pipeline: "",
  stage: "",
  source: "",
  score: "all",
  status: "active",
  no_action: false,
  stagnant: false,
  overdue: false,
  closing_30: false,
  sort: "score",
};

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useTableroFilters(): {
  filters: TableroFilters;
  setFilter: <K extends keyof TableroFilters>(key: K, value: TableroFilters[K]) => void;
  clearAll: () => void;
  applyFilter: (partial: Partial<TableroFilters>) => void;
  activeCount: number;
} {
  const searchParams = useSearchParams();
  const router = useRouter();

  // ── Parse URL → typed filters ──
  const filters = useMemo<TableroFilters>(() => {
    const get = (k: string) => searchParams.get(k) ?? "";

    const scoreRaw = get("score");
    const score: TableroFilters["score"] =
      scoreRaw === "hot" || scoreRaw === "warm" || scoreRaw === "cold" ? scoreRaw : "all";

    const statusRaw = get("status");
    const status: TableroFilters["status"] =
      statusRaw === "expired" || statusRaw === "won" || statusRaw === "lost" || statusRaw === "all"
        ? statusRaw
        : "active";

    const sortRaw = get("sort");
    const sort: SortKey =
      sortRaw === "amount" ||
      sortRaw === "forecast" ||
      sortRaw === "probability" ||
      sortRaw === "modified" ||
      sortRaw === "days_stagnant"
        ? sortRaw
        : "score";

    return {
      pipeline: get("pipeline"),
      stage: get("stage"),
      source: get("source"),
      score,
      status,
      no_action: searchParams.get("no_action") === "1",
      stagnant: searchParams.get("stagnant") === "1",
      overdue: searchParams.get("overdue") === "1",
      closing_30: searchParams.get("closing_30") === "1",
      sort,
    };
  }, [searchParams]);

  // ── Count non-default active filters ──
  const activeCount = useMemo(() => {
    let count = 0;
    if (filters.pipeline !== DEFAULT_FILTERS.pipeline) count++;
    if (filters.stage !== DEFAULT_FILTERS.stage) count++;
    if (filters.source !== DEFAULT_FILTERS.source) count++;
    if (filters.score !== DEFAULT_FILTERS.score) count++;
    if (filters.status !== DEFAULT_FILTERS.status) count++;
    if (filters.no_action) count++;
    if (filters.stagnant) count++;
    if (filters.overdue) count++;
    if (filters.closing_30) count++;
    if (filters.sort !== DEFAULT_FILTERS.sort) count++;
    return count;
  }, [filters]);

  // ── Build new URLSearchParams from a full filters object ──
  const buildParams = useCallback(
    (newFilters: TableroFilters): URLSearchParams => {
      const p = new URLSearchParams();
      if (newFilters.pipeline) p.set("pipeline", newFilters.pipeline);
      if (newFilters.stage) p.set("stage", newFilters.stage);
      if (newFilters.source) p.set("source", newFilters.source);
      if (newFilters.score !== "all") p.set("score", newFilters.score);
      if (newFilters.status !== "active") p.set("status", newFilters.status);
      if (newFilters.no_action) p.set("no_action", "1");
      if (newFilters.stagnant) p.set("stagnant", "1");
      if (newFilters.overdue) p.set("overdue", "1");
      if (newFilters.closing_30) p.set("closing_30", "1");
      if (newFilters.sort !== "score") p.set("sort", newFilters.sort);
      return p;
    },
    []
  );

  // ── Push new URL ──
  const pushUrl = useCallback(
    (newFilters: TableroFilters) => {
      const p = buildParams(newFilters);
      const qs = p.toString();
      router.replace(qs ? `?${qs}` : "?", { scroll: false });
    },
    [buildParams, router]
  );

  // ── setFilter: change a single key ──
  const setFilter = useCallback(
    <K extends keyof TableroFilters>(key: K, value: TableroFilters[K]) => {
      pushUrl({ ...filters, [key]: value });
    },
    [filters, pushUrl]
  );

  // ── applyFilter: merge a partial object (for deep-link clicks) ──
  const applyFilter = useCallback(
    (partial: Partial<TableroFilters>) => {
      pushUrl({ ...filters, ...partial });
    },
    [filters, pushUrl]
  );

  // ── clearAll: reset to defaults ──
  const clearAll = useCallback(() => {
    router.replace("?", { scroll: false });
  }, [router]);

  return { filters, setFilter, clearAll, applyFilter, activeCount };
}

// ─── Scroll utility ───────────────────────────────────────────────────────────

export function scrollToSection(id: string): void {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}
