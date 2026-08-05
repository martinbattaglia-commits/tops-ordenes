import { createHash } from "node:crypto";
import {
  BUSINESS_UNITS,
  INVENTORY_STATUSES,
  INVENTORY_WARNING_CODES,
  businessUnitToLine,
  lineToBusinessUnit,
  type BusinessUnit,
  type InventoryDataDto,
  type InventoryItemDto,
  type InventoryQuery,
  type InventoryRepositoryPage,
  type InventoryRepositoryRow,
  type InventoryRepositoryLocation,
  type InventoryScope,
  type InventoryWarning,
} from "./contract";
import {
  forbidden,
  nexusBadResponse,
  nexusDataIntegrityError,
  nexusUnavailable,
} from "./errors";
import type { InventoryRepository } from "./ports";

export interface InventoryServiceResult {
  data: InventoryDataDto;
  rowsEvaluated: number;
  rowsReturned: number;
}

type ResolvedInventoryRepositoryRow = Omit<
  InventoryRepositoryRow,
  "businessUnit" | "location"
> & {
  businessUnit: BusinessUnit;
  location: InventoryRepositoryLocation;
};

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isSafeCount = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 0;

const isFiniteQuantity = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;

const isBusinessUnit = (value: unknown): value is BusinessUnit =>
  BUSINESS_UNITS.some((candidate) => candidate === value);

const isIsoDate = (value: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};

const isIsoInstant = (value: string): boolean => {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
};

const nonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const assertValidScope = (scope: InventoryScope): void => {
  if (!nonEmptyString(scope.clientId) || scope.businessUnits.length === 0) {
    throw forbidden();
  }
  if (
    scope.businessUnits.some((unit) => !isBusinessUnit(unit)) ||
    new Set(scope.businessUnits).size !== scope.businessUnits.length
  ) {
    throw forbidden();
  }
};

const assertValidRow = (row: unknown): ResolvedInventoryRepositoryRow => {
  if (!isPlainRecord(row)) throw nexusBadResponse();
  const candidate = row as unknown as InventoryRepositoryRow;
  if (
    !nonEmptyString(candidate.clientId) ||
    !nonEmptyString(candidate.sku) ||
    !nonEmptyString(candidate.description) ||
    !nonEmptyString(candidate.lotNumber) ||
    typeof candidate.date !== "string" ||
    !isIsoDate(candidate.date) ||
    !isFiniteQuantity(candidate.availableQuantity) ||
    !isFiniteQuantity(candidate.reservedQuantity) ||
    !Number.isFinite(candidate.availableQuantity + candidate.reservedQuantity) ||
    !isPlainRecord(candidate.location) ||
    !(
      (candidate.location.kind === "external_label" &&
        nonEmptyString(candidate.location.value)) ||
      candidate.location.kind === "unavailable"
    ) ||
    !INVENTORY_STATUSES.some((status) => status === candidate.status)
  ) {
    throw nexusBadResponse();
  }

  if (
    candidate.businessUnit === null ||
    candidate.businessUnit === "CORPORATE" ||
    Array.isArray(candidate.businessUnit)
  ) {
    throw nexusDataIntegrityError();
  }
  if (!isBusinessUnit(candidate.businessUnit)) throw nexusBadResponse();
  return candidate as ResolvedInventoryRepositoryRow;
};

const publicIdFor = (row: ResolvedInventoryRepositoryRow): string =>
  createHash("sha256")
    .update(`${row.sku}\u0000${row.lotNumber}\u0000${row.date}\u0000${businessUnitToLine(row.businessUnit)}`)
    .digest("base64url")
    .slice(0, 24);

const toItem = (row: ResolvedInventoryRepositoryRow): InventoryItemDto => ({
  id: publicIdFor(row),
  sku: row.sku,
  description: row.description,
  category: null,
  line: businessUnitToLine(row.businessUnit),
  lotNumber: row.lotNumber,
  date: row.date,
  dateSemantics: row.businessUnit === "ANMAT" ? "expiration" : "warranty",
  totalQuantity: row.availableQuantity + row.reservedQuantity,
  availableQuantity: row.availableQuantity,
  reservedQuantity: row.reservedQuantity,
  unitOfMeasure: null,
  location: row.location.kind === "external_label" ? row.location.value : null,
  status: row.status,
});

const validateWarnings = (
  page: InventoryRepositoryPage,
  rows: readonly ResolvedInventoryRepositoryRow[],
): readonly InventoryWarning[] => {
  const warnings = page.warnings ?? [];
  const seen = new Set<string>();
  for (const warning of warnings) {
    if (
      !isPlainRecord(warning) ||
      !INVENTORY_WARNING_CODES.some((code) => code === warning.code) ||
      !isSafeCount(warning.count) ||
      warning.count === 0 ||
      seen.has(warning.code)
    ) {
      throw nexusBadResponse();
    }
    seen.add(warning.code);
  }

  const expected = new Map<string, number>([
    ["location_unavailable", rows.filter((row) => row.location.kind === "unavailable").length],
    ["updated_at_unavailable", page.updatedAt === null ? 1 : 0],
  ]);
  for (const [code, count] of expected) {
    const supplied = warnings.find((warning) => warning.code === code);
    if ((count === 0 && supplied) || (count > 0 && supplied?.count !== count)) {
      throw nexusBadResponse();
    }
  }
  return warnings.map((warning) => ({
    code: warning.code as InventoryWarning["code"],
    count: warning.count,
  }));
};

const validatePage = (
  value: unknown,
  scope: InventoryScope,
  query: InventoryQuery,
): { page: InventoryRepositoryPage; rows: readonly ResolvedInventoryRepositoryRow[] } => {
  if (!isPlainRecord(value)) throw nexusBadResponse();
  const page = value as unknown as InventoryRepositoryPage;
  if (
    !Array.isArray(page.rows) ||
    !isSafeCount(page.rowsEvaluated) ||
    !isSafeCount(page.total) ||
    !isPlainRecord(page.summary) ||
    !isSafeCount(page.summary.totalSkus) ||
    !isPlainRecord(page.summary.byBusinessUnit) ||
    !isSafeCount(page.summary.byBusinessUnit.ANMAT) ||
    !isSafeCount(page.summary.byBusinessUnit.GENERAL) ||
    !isSafeCount(page.summary.byBusinessUnit.CORPORATE) ||
    !isSafeCount(page.summary.byBusinessUnit.unresolved) ||
    !(page.warnings === undefined || Array.isArray(page.warnings)) ||
    !(page.updatedAt === null || (typeof page.updatedAt === "string" && isIsoInstant(page.updatedAt)))
  ) {
    throw nexusBadResponse();
  }

  const expectedRows = Math.min(
    query.pageSize,
    Math.max(page.total - (query.page - 1) * query.pageSize, 0),
  );
  if (
    page.rows.length !== expectedRows ||
    page.rowsEvaluated !== page.rows.length ||
    page.summary.totalSkus !== page.total ||
    page.summary.byBusinessUnit.ANMAT +
      page.summary.byBusinessUnit.GENERAL +
      page.summary.byBusinessUnit.CORPORATE +
      page.summary.byBusinessUnit.unresolved !==
      page.total ||
    page.summary.byBusinessUnit.CORPORATE !== 0 ||
    page.summary.byBusinessUnit.unresolved !== 0 ||
    BUSINESS_UNITS.some(
      (unit) => !scope.businessUnits.includes(unit) && page.summary.byBusinessUnit[unit] !== 0,
    )
  ) {
    throw nexusDataIntegrityError();
  }

  const rows = page.rows.map(assertValidRow);
  for (const row of rows) {
    if (
      row.clientId !== scope.clientId ||
      !scope.businessUnits.includes(row.businessUnit) ||
      (query.line && row.businessUnit !== lineToBusinessUnit(query.line)) ||
      (query.status && row.status !== query.status)
    ) {
      throw nexusDataIntegrityError();
    }
  }
  return { page, rows };
};

export async function executeInventoryQuery(input: {
  repository: InventoryRepository;
  scope: InventoryScope;
  query: InventoryQuery;
}): Promise<InventoryServiceResult> {
  assertValidScope(input.scope);
  if (input.query.line && !input.scope.businessUnits.includes(lineToBusinessUnit(input.query.line))) {
    throw forbidden();
  }

  let rawPage: InventoryRepositoryPage;
  try {
    rawPage = await input.repository.query({
      ...input.query,
      clientId: input.scope.clientId,
      businessUnits: [...input.scope.businessUnits],
    });
  } catch {
    throw nexusUnavailable();
  }

  const { page, rows } = validatePage(rawPage, input.scope, input.query);
  const warnings = validateWarnings(page, rows);
  const items = rows.map(toItem);
  return {
    data: {
      items,
      pagination: {
        page: input.query.page,
        pageSize: input.query.pageSize,
        total: page.total,
        totalPages: Math.ceil(page.total / input.query.pageSize),
      },
      summary: {
        totalSkus: page.summary.totalSkus,
        byLine: {
          CARGAS_GENERALES: page.summary.byBusinessUnit.GENERAL,
          REGULADO_ANMAT: page.summary.byBusinessUnit.ANMAT,
        },
      },
      updatedAt: page.updatedAt,
      sourceStatus: "live",
      warnings,
    },
    rowsEvaluated: page.rowsEvaluated,
    rowsReturned: items.length,
  };
}
