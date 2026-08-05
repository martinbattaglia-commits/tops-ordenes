export const INVENTORY_PERMISSION = "wms.inventory.read" as const;
export const INVENTORY_API_VERSION = "v1" as const;

export const BUSINESS_UNITS = ["ANMAT", "GENERAL"] as const;
export type BusinessUnit = (typeof BUSINESS_UNITS)[number];

export const INVENTORY_LINES = ["CARGAS_GENERALES", "REGULADO_ANMAT"] as const;
export type InventoryLine = (typeof INVENTORY_LINES)[number];

export const INVENTORY_STATUSES = ["Disponible", "Reservado", "Cuarentena"] as const;
export type InventoryStatus = (typeof INVENTORY_STATUSES)[number];

export const INVENTORY_SORTS = [
  "sku:asc",
  "sku:desc",
  "date:asc",
  "date:desc",
  "available:asc",
  "available:desc",
] as const;
export type InventorySort = (typeof INVENTORY_SORTS)[number];

export const INVENTORY_WARNING_CODES = [
  "location_unavailable",
  "updated_at_unavailable",
] as const;
export type InventoryWarningCode = (typeof INVENTORY_WARNING_CODES)[number];

export interface InventoryScope {
  clientId: string;
  businessUnits: readonly BusinessUnit[];
}

export interface InventoryQuery {
  search?: string;
  line?: InventoryLine;
  status?: InventoryStatus;
  page: number;
  pageSize: number;
  sort: InventorySort;
}

export interface InventoryRepositoryQuery extends InventoryQuery {
  clientId: string;
  businessUnits: readonly BusinessUnit[];
}

export type InventorySourceBusinessUnit =
  | BusinessUnit
  | "CORPORATE"
  | null
  | readonly (BusinessUnit | "CORPORATE")[];

export type InventoryRepositoryLocation =
  | { kind: "external_label"; value: string }
  | { kind: "unavailable" };

export interface InventoryRepositoryRow {
  clientId: string;
  businessUnit: InventorySourceBusinessUnit;
  sku: string;
  description: string;
  lotNumber: string;
  date: string;
  availableQuantity: number;
  reservedQuantity: number;
  location: InventoryRepositoryLocation;
  status: InventoryStatus;
}

export interface InventoryRepositorySummary {
  totalSkus: number;
  byBusinessUnit: Record<BusinessUnit | "CORPORATE" | "unresolved", number>;
}

export interface InventorySourceWarning {
  code: string;
  count: number;
}

export interface InventoryRepositoryPage {
  rows: readonly InventoryRepositoryRow[];
  rowsEvaluated: number;
  total: number;
  summary: InventoryRepositorySummary;
  updatedAt: string | null;
  warnings?: readonly InventorySourceWarning[];
}

export interface InventoryWarning {
  code: InventoryWarningCode;
  count: number;
}

export interface InventoryItemDto {
  id: string;
  sku: string;
  description: string;
  category: null;
  line: InventoryLine;
  lotNumber: string;
  date: string;
  dateSemantics: "expiration" | "warranty";
  totalQuantity: number;
  availableQuantity: number;
  reservedQuantity: number;
  unitOfMeasure: null;
  location: string | null;
  status: InventoryStatus;
}

export interface InventoryDataDto {
  items: readonly InventoryItemDto[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
  summary: {
    totalSkus: number;
    byLine: Record<InventoryLine, number>;
  };
  updatedAt: string | null;
  sourceStatus: "live";
  warnings: readonly InventoryWarning[];
}

export interface InventorySuccessEnvelope {
  data: InventoryDataDto;
  meta: {
    correlationId: string;
    apiVersion: typeof INVENTORY_API_VERSION;
  };
}

export const businessUnitToLine = (businessUnit: BusinessUnit): InventoryLine =>
  businessUnit === "ANMAT" ? "REGULADO_ANMAT" : "CARGAS_GENERALES";

export const lineToBusinessUnit = (line: InventoryLine): BusinessUnit =>
  line === "REGULADO_ANMAT" ? "ANMAT" : "GENERAL";
