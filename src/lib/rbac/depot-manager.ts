/**
 * Los dos encargados y su sede de pertenencia.
 *
 * `depot` y `siteLabel` son PROYECCIÓN: identifican al usuario y rotulan
 * documentos y pantallas. No acotan sobre qué nave puede operar. Magaldi y
 * Luján están a cincuenta metros, los encargados se cubren entre sí todos los
 * días y cargar recepciones, pedidos, reservas y despachos de la otra nave es
 * la operatoria normal. Por eso ya no hay `warehouseCode`: era el ancla del
 * aislamiento por sede, que Dirección retiró.
 *
 * Lo que sí sigue acotado es el MÓDULO: ver `depotManagerRouteAllowed`.
 */
export const DEPOT_MANAGER_EMAILS = {
  "despachos-lujan@logisticatops.com": {
    userId: "4cf9b607-36bb-4ed9-ab31-82823d625b8d",
    depot: "LUJAN",
    siteLabel: "Luján",
  },
  "despachos-magaldi@logisticatops.com": {
    userId: "3873f156-02de-4424-af48-3e590536cc1d",
    depot: "MAGALDI",
    siteLabel: "Agustín Magaldi 765",
  },
} as const;

export type DepotManagerEmail = keyof typeof DEPOT_MANAGER_EMAILS;
export type DepotManagerSite = (typeof DEPOT_MANAGER_EMAILS)[DepotManagerEmail];

const DEPOT_MANAGER_IDS = Object.fromEntries(
  Object.entries(DEPOT_MANAGER_EMAILS).map(([email, site]) => [site.userId, { email, ...site }]),
) as Record<string, DepotManagerSite & { email: string }>;

export function normalizeDepotManagerEmail(email: string | null | undefined): string {
  return (email ?? "").trim().toLowerCase();
}

export function depotManagerSiteForEmail(
  email: string | null | undefined,
): DepotManagerSite | null {
  const normalized = normalizeDepotManagerEmail(email);
  return (DEPOT_MANAGER_EMAILS as Record<string, DepotManagerSite>)[normalized] ?? null;
}

export function isDepotManagerEmail(email: string | null | undefined): boolean {
  return depotManagerSiteForEmail(email) !== null;
}

export interface DepotManagerIdentity {
  principal: boolean;
  exact: boolean;
  site: DepotManagerSite | null;
}

/**
 * La identidad queda fijada por el par UUID + email. Que cualquiera de los dos
 * coincida mantiene al sujeto dentro de la frontera restringida; sólo el par
 * exacto habilita el alcance operativo.
 */
export function depotManagerIdentity(
  userId: string | null | undefined,
  email: string | null | undefined,
): DepotManagerIdentity {
  const normalizedEmail = normalizeDepotManagerEmail(email);
  const byEmail = depotManagerSiteForEmail(normalizedEmail);
  const byId = userId ? DEPOT_MANAGER_IDS[userId] : undefined;
  if (!byEmail && !byId) return { principal: false, exact: false, site: null };
  const site = byEmail ?? byId ?? null;
  return {
    principal: true,
    exact: Boolean(site && byEmail && byId && byEmail.userId === userId && byId.email === normalizedEmail),
    site,
  };
}

const CONNECT_EXACT = new Set([
  "/connect",
  "/connect/buscar",
  "/connect/notificaciones",
  "/connect/favoritos",
]);

function operationalOrderPath(pathname: string): boolean {
  if (pathname === "/orders" || pathname === "/orders/new") return true;
  if (pathname === "/orders/tarifas" || pathname.startsWith("/orders/tarifas/")) return false;
  return /^\/orders\/[^/]+$/.test(pathname);
}

function operationalApiPath(pathname: string): boolean {
  if (/^\/api\/orders\/[^/]+\/pdf$/.test(pathname)) return true;
  return /^\/api\/wms\/(recepciones|despachos)\/[^/]+\/pdf$/.test(pathname);
}

/** Allowlist cerrada para las dos identidades de encargado. */
export function depotManagerRouteAllowed(pathname: string): boolean {
  if (pathname === "/api/auth/signout" || pathname === "/api/version") return true;
  if (pathname.startsWith("/api/")) return operationalApiPath(pathname);
  if (pathname.startsWith("/connect")) {
    return CONNECT_EXACT.has(pathname) || /^\/connect\/c\/[^/]+$/.test(pathname);
  }
  if (pathname === "/dashboard") return true;
  if (operationalOrderPath(pathname)) return true;
  return pathname === "/wms" || pathname.startsWith("/wms/");
}

export interface DepotManagerRpcRow {
  is_principal?: boolean | null;
  is_authorized?: boolean | null;
  depot?: string | null;
}

/**
 * La fila de `nexus_depot_manager_scope()` se valida por IDENTIDAD, no por
 * nave: principal, autorizada y con la sede que le corresponde al usuario. Ya
 * no se compara `warehouse_id` ni `warehouse_code`; con el aislamiento por
 * sede retirado, esas columnas no acotan nada.
 */
export function depotManagerRpcRowValid(
  row: DepotManagerRpcRow | null | undefined,
  expected: DepotManagerSite,
): boolean {
  return (
    row?.is_principal === true && row.is_authorized === true && row.depot === expected.depot
  );
}
