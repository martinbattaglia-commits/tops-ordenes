import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  InventoryOperationalPorts,
  InventoryRuntimeConfiguration,
} from "./composition";
import type {
  InventoryRepositoryLocation,
  InventoryRepositoryPage,
  InventoryRepositoryQuery,
  InventoryRepositoryRow,
  InventorySourceBusinessUnit,
  InventoryStatus,
} from "./contract";
import type {
  InventoryAuditPort,
  InventoryRateLimitPort,
  InventoryRepository,
} from "./ports";

const AUDIT_ENTITY = "wms_inventory_api";

type RawRecord = Record<string, unknown>;

interface PositionNode extends RawRecord {
  code?: unknown;
  rack?: unknown;
}

const isRecord = (value: unknown): value is RawRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const one = (value: unknown): RawRecord | null => {
  if (Array.isArray(value)) return isRecord(value[0]) ? value[0] : null;
  return isRecord(value) ? value : null;
};

const nonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const quantity = (value: unknown): number | null => {
  if (!(typeof value === "number" || (typeof value === "string" && value.trim().length > 0))) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};

const isIsoDate = (value: unknown): value is string => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};

const withTimeout = async <T>(
  operation: PromiseLike<T>,
  timeoutMs: number,
  abort: () => void,
): Promise<T> => {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      abort();
      reject(new Error("inventory_port_timeout"));
    }, timeoutMs);
  });
  try {
    return await Promise.race([Promise.resolve(operation), expired]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
};

const codeFrom = (value: unknown): string | null =>
  isRecord(value) && nonEmptyString(value.code) ? value.code : null;

const locationFrom = (raw: unknown): InventoryRepositoryLocation => {
  const position = one(raw) as PositionNode | null;
  if (!position) return { kind: "unavailable" };
  const rack = one(position.rack);
  const zone = one(rack?.zone);
  const sector = one(zone?.sector);
  const floor = one(sector?.floor);
  const warehouse = one(floor?.warehouse);
  const parts = [
    codeFrom(warehouse),
    codeFrom(floor),
    codeFrom(sector),
    codeFrom(zone),
    codeFrom(rack),
    nonEmptyString(position.code) ? position.code : null,
  ].filter((part): part is string => part !== null);
  return parts.length > 0
    ? { kind: "external_label", value: parts.join("·") }
    : { kind: "unavailable" };
};

interface ResolvedLot {
  lotNumber: string;
  date: string;
  quantity: number;
}

/**
 * Comparador determinista por punto de código.
 *
 * 🔴 NO se usa `localeCompare`: su resultado depende del ICU disponible en el
 * runtime. Con la colación española «á» precede a «b»; por punto de código va
 * después. Aplicado a la selección FEFO eso significa que **dos despliegues del
 * mismo código podrían despachar lotes distintos** — un defecto silencioso e
 * irreproducible. La única propiedad que necesita el desempate es ser total y
 * estable, no ser lingüísticamente correcta.
 */
const compareText = (left: string, right: string): number =>
  left === right ? 0 : left < right ? -1 : 1;

const activeLotsFrom = (raw: unknown): ResolvedLot[] | null => {
  const source = Array.isArray(raw) ? raw : raw === null || raw === undefined ? [] : [raw];
  const lots: ResolvedLot[] = [];
  for (const value of source) {
    if (!isRecord(value) || typeof value.active !== "boolean") return null;
    if (!value.active) continue;
    const amount = quantity(value.quantity);
    if (!nonEmptyString(value.lot_number) || !isIsoDate(value.expiration_date) || amount === null) {
      return null;
    }
    lots.push({ lotNumber: value.lot_number, date: value.expiration_date, quantity: amount });
  }
  // FEFO: primero la fecha de vencimiento; el lote sólo desempata.
  return lots.sort(
    (left, right) =>
      compareText(left.date, right.date) || compareText(left.lotNumber, right.lotNumber),
  );
};

const sourceBusinessUnit = (value: unknown): InventorySourceBusinessUnit => {
  if (value === null || value === "ANMAT" || value === "GENERAL" || value === "CORPORATE") {
    return value;
  }
  if (
    Array.isArray(value) &&
    value.every((unit) => unit === "ANMAT" || unit === "GENERAL" || unit === "CORPORATE")
  ) {
    return value;
  }
  return value as InventorySourceBusinessUnit;
};

const statusFrom = (available: number, reserved: number): InventoryStatus => {
  if (available > 0) return "Disponible";
  if (reserved > 0) return "Reservado";
  return "Cuarentena";
};

const repositoryRowFrom = (value: unknown): InventoryRepositoryRow | null => {
  if (!isRecord(value)) return null;
  const available = quantity(value.stock_available);
  const reserved = quantity(value.stock_reserved);
  const lots = activeLotsFrom(value.lots);
  if (
    !nonEmptyString(value.client_id) ||
    !nonEmptyString(value.sku) ||
    !nonEmptyString(value.description) ||
    available === null ||
    reserved === null ||
    lots === null ||
    lots.length === 0
  ) {
    return null;
  }

  const lotQuantity = lots.reduce((total, lot) => total + lot.quantity, 0);
  if (Math.abs(lotQuantity - (available + reserved)) > 0.000_001) return null;
  const fefo = lots[0];
  return {
    clientId: value.client_id,
    businessUnit: sourceBusinessUnit(value.business_unit),
    sku: value.sku,
    description: value.description,
    lotNumber: fefo.lotNumber,
    date: fefo.date,
    availableQuantity: available,
    reservedQuantity: reserved,
    location: locationFrom(value.position),
    status: statusFrom(available, reserved),
  };
};

// Reutiliza el `compareText` único declarado junto a la selección FEFO: un
// segundo comparador podría divergir del primero sin que nada lo delatara.
const stableTieBreak = (left: InventoryRepositoryRow, right: InventoryRepositoryRow): number =>
  compareText(left.sku, right.sku) ||
  compareText(left.date, right.date) ||
  compareText(left.lotNumber, right.lotNumber);

const sortRows = (
  rows: readonly InventoryRepositoryRow[],
  sort: InventoryRepositoryQuery["sort"],
): InventoryRepositoryRow[] => {
  const sorted = [...rows];
  sorted.sort((left, right) => {
    switch (sort) {
      case "sku:asc":
        return compareText(left.sku, right.sku) || stableTieBreak(left, right);
      case "sku:desc":
        return compareText(right.sku, left.sku) || stableTieBreak(left, right);
      case "date:asc":
        return compareText(left.date, right.date) || stableTieBreak(left, right);
      case "date:desc":
        return compareText(right.date, left.date) || stableTieBreak(left, right);
      case "available:asc":
        return left.availableQuantity - right.availableQuantity || stableTieBreak(left, right);
      case "available:desc":
        return right.availableQuantity - left.availableQuantity || stableTieBreak(left, right);
    }
  });
  return sorted;
};

const matchesSearch = (row: InventoryRepositoryRow, search: string): boolean => {
  const needle = search.normalize("NFKC").toLocaleLowerCase("es");
  return [row.sku, row.description, row.lotNumber]
    .map((value) => value.normalize("NFKC").toLocaleLowerCase("es"))
    .some((value) => value.includes(needle));
};

export function createSupabaseInventoryRepository(
  client: SupabaseClient,
  configuration: Pick<InventoryRuntimeConfiguration, "timeoutMs" | "maxSourceRows">,
): InventoryRepository {
  return {
    async query(input): Promise<InventoryRepositoryPage> {
      const controller = new AbortController();
      const operation = client
        .from("inventory_items")
        .select(
          `client_id, business_unit, sku, description, stock_available, stock_reserved,
           lots:inventory_lots(lot_number, expiration_date, quantity, active),
           position:warehouse_positions(
             code,
             rack:warehouse_racks(code,
               zone:warehouse_zones(code,
                 sector:warehouse_sectors(code,
                   floor:warehouse_floors(code,
                     warehouse:warehouses(code)))))
           )`,
        )
        .eq("active", true)
        .eq("client_id", input.clientId)
        .in("business_unit", [...input.businessUnits])
        .limit(configuration.maxSourceRows + 1)
        .abortSignal(controller.signal);
      const { data, error } = await withTimeout(
        operation,
        configuration.timeoutMs,
        () => controller.abort(),
      );
      if (error || !Array.isArray(data) || data.length > configuration.maxSourceRows) {
        throw new Error("inventory_repository_unavailable");
      }

      const mapped = data.map(repositoryRowFrom);
      if (mapped.some((row) => row === null)) throw new Error("inventory_repository_invalid_row");
      let rows = mapped as InventoryRepositoryRow[];
      if (input.search) rows = rows.filter((row) => matchesSearch(row, input.search!));
      if (input.line) {
        const businessUnit = input.line === "REGULADO_ANMAT" ? "ANMAT" : "GENERAL";
        rows = rows.filter((row) => row.businessUnit === businessUnit);
      }
      if (input.status) rows = rows.filter((row) => row.status === input.status);
      rows = sortRows(rows, input.sort);

      const summary = {
        ANMAT: rows.filter((row) => row.businessUnit === "ANMAT").length,
        GENERAL: rows.filter((row) => row.businessUnit === "GENERAL").length,
        CORPORATE: rows.filter((row) => row.businessUnit === "CORPORATE").length,
        unresolved: rows.filter(
          (row) => row.businessUnit === null || Array.isArray(row.businessUnit),
        ).length,
      };
      const offset = (input.page - 1) * input.pageSize;
      const pageRows = rows.slice(offset, offset + input.pageSize);
      const warnings = [
        ...(pageRows.some((row) => row.location.kind === "unavailable")
          ? [
              {
                code: "location_unavailable",
                count: pageRows.filter((row) => row.location.kind === "unavailable").length,
              },
            ]
          : []),
        { code: "updated_at_unavailable", count: 1 },
      ];
      return {
        rows: pageRows,
        rowsEvaluated: pageRows.length,
        total: rows.length,
        summary: { totalSkus: rows.length, byBusinessUnit: summary },
        updatedAt: null,
        warnings,
      };
    },
  };
}

export function createSupabaseInventoryRateLimitPort(
  client: SupabaseClient,
  configuration: Pick<
    InventoryRuntimeConfiguration,
    "timeoutMs" | "rateLimit" | "rateWindowMs"
  >,
  now: () => Date = () => new Date(),
): InventoryRateLimitPort {
  return {
    async consume({ actorFingerprint, scopeFingerprint }) {
      const since = new Date(now().getTime() - configuration.rateWindowMs).toISOString();
      const controller = new AbortController();
      const operation = client
        .from("audit_log")
        .select("id", { count: "exact", head: true })
        .eq("entity", AUDIT_ENTITY)
        .gte("ts", since)
        .contains("payload", {
          actor_fingerprint: actorFingerprint,
          scope_fingerprint: scopeFingerprint,
        })
        .abortSignal(controller.signal);
      const { count, error } = await withTimeout(
        operation,
        configuration.timeoutMs,
        () => controller.abort(),
      );
      if (error || typeof count !== "number" || !Number.isSafeInteger(count) || count < 0) {
        throw new Error("inventory_rate_limit_unavailable");
      }
      return {
        allowed: count < configuration.rateLimit,
        retryAfterMs: count < configuration.rateLimit ? 0 : configuration.rateWindowMs,
      };
    },
  };
}

export function createSupabaseInventoryAuditPort(
  client: SupabaseClient,
  timeoutMs: number,
): InventoryAuditPort {
  return {
    async record(event) {
      const controller = new AbortController();
      const operation = client.from("audit_log").insert({
        entity: AUDIT_ENTITY,
        entity_id: null,
        action: event.outcome,
        payload: {
          correlation_id: event.correlationId,
          actor_fingerprint: event.actorFingerprint,
          ...(event.scopeFingerprint
            ? { scope_fingerprint: event.scopeFingerprint }
            : {}),
          status: event.status,
          rows_evaluated: event.rowsEvaluated,
          rows_returned: event.rowsReturned,
          integrity_result: event.integrityResult,
          occurred_at: event.occurredAt,
        },
      }).abortSignal(controller.signal);
      const { error } = await withTimeout(operation, timeoutMs, () => controller.abort());
      if (error) throw new Error("inventory_audit_unavailable");
    },
  };
}

export function createSupabaseInventoryPorts(
  client: SupabaseClient,
  configuration: InventoryRuntimeConfiguration,
): InventoryOperationalPorts {
  return {
    repository: createSupabaseInventoryRepository(client, configuration),
    rateLimit: createSupabaseInventoryRateLimitPort(client, configuration),
    audit: createSupabaseInventoryAuditPort(client, configuration.timeoutMs),
  };
}
