import {
  INVENTORY_LINES,
  INVENTORY_SORTS,
  INVENTORY_STATUSES,
  type InventoryLine,
  type InventoryQuery,
  type InventorySort,
  type InventoryStatus,
} from "./contract";
import { invalidInput } from "./errors";

const ALLOWED_PARAMETERS = new Set([
  "search",
  "line",
  "status",
  "category",
  "page",
  "pageSize",
  "sort",
]);

const parsePositiveInteger = (raw: string | null, fallback: number): number => {
  if (raw === null) return fallback;
  if (!/^[1-9]\d*$/.test(raw)) throw invalidInput();
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) throw invalidInput();
  return value;
};

const parseEnum = <T extends string>(
  raw: string | null,
  values: readonly T[],
): T | undefined => {
  if (raw === null) return undefined;
  if (!values.some((value) => value === raw)) throw invalidInput();
  return raw as T;
};

export function parseInventoryQuery(searchParams: URLSearchParams): InventoryQuery {
  for (const name of searchParams.keys()) {
    if (!ALLOWED_PARAMETERS.has(name)) throw invalidInput();
  }

  for (const name of ALLOWED_PARAMETERS) {
    if (searchParams.getAll(name).length > 1) throw invalidInput();
  }

  if (searchParams.has("category")) throw invalidInput();

  const rawSearch = searchParams.get("search");
  const search = rawSearch?.normalize("NFKC").trim();
  if (search && search.length > 120) throw invalidInput();

  const page = parsePositiveInteger(searchParams.get("page"), 1);
  const pageSize = parsePositiveInteger(searchParams.get("pageSize"), 50);
  if (pageSize > 100) throw invalidInput();

  const line = parseEnum<InventoryLine>(searchParams.get("line"), INVENTORY_LINES);
  const status = parseEnum<InventoryStatus>(
    searchParams.get("status"),
    INVENTORY_STATUSES,
  );

  return {
    ...(search ? { search } : {}),
    ...(line !== undefined ? { line } : {}),
    ...(status !== undefined ? { status } : {}),
    page,
    pageSize,
    sort:
      parseEnum<InventorySort>(searchParams.get("sort"), INVENTORY_SORTS) ?? "sku:asc",
  };
}
