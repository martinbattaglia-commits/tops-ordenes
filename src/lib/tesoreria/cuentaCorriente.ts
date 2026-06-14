/**
 * Motor puro de Cuenta Corriente — Tesorería V3 · Fase 1.
 *
 * Clasifica los renglones de `*_open_items` en secciones (Pendientes / Notas de
 * Crédito / Sobrepagos / Saldadas), agrupa por entidad (cliente o proveedor) y
 * calcula subtotales y Saldo Neto.
 *
 * GARANTÍA DE RECONCILIACIÓN (por construcción): toda la aritmética se hace en
 * CENTAVOS ENTEROS y el Saldo Neto se DEFINE como
 *
 *     SaldoNeto = PendienteBruto − NotasCrédito − Sobrepagos
 *
 * derivado de los MISMOS subtotales exhibidos (no de una segunda fuente, p.ej.
 * `current_account`). De ahí:
 *
 *     Σ subtotales de todas las secciones (con signo) === SaldoNeto   (Δ = 0 exacto)
 *
 * Es una función PURA: sin I/O, sin imports de Next/React/Supabase. La comparten
 * Cobranzas y Pagos (Alcance V3 · Fase 1 — sin Anticipos).
 */

export type Bucket = "pendiente" | "nota_credito" | "sobrepago" | "saldada";

/** Renglón normalizado de cuenta corriente (cliente o proveedor). */
export interface CuentaRow {
  invoiceId: string;
  partyId: string | null;
  partyName: string | null;
  factura: string;
  emision: string | null;
  vencimiento: string | null;
  estado: string;
  /** Saldo CON SIGNO, tal cual lo entrega la vista open_items (D1/D5). */
  saldo: number;
  tipoComprobante: string | null;
}

export interface CuentaGrupo {
  partyId: string | null;
  partyName: string | null;
  items: CuentaRow[];
  /** Σ de los saldos del grupo, en centavos enteros (con signo). */
  subtotalCents: number;
}

export interface CuentaSeccion {
  bucket: Bucket;
  grupos: CuentaGrupo[];
  /** Σ de subtotales de la sección, en centavos enteros (con signo). */
  totalCents: number;
  /** Cantidad de comprobantes en la sección. */
  count: number;
}

export interface CuentaResumen {
  /** Σ pendientes (≥ 0). */
  pendienteBrutoCents: number;
  /** Magnitud de las NC (≥ 0); se muestra como "(−)". */
  totalNcCents: number;
  /** Magnitud de los sobrepagos (≥ 0); se muestra como "(−)". */
  totalSobrepagoCents: number;
  /** = PendienteBruto − NC − Sobrepagos. */
  saldoNetoCents: number;
}

export interface CuentaCorriente {
  pendientes: CuentaSeccion;
  notasCredito: CuentaSeccion;
  sobrepagos: CuentaSeccion;
  saldadas: CuentaSeccion;
  resumen: CuentaResumen;
}

/** Pesos → centavos enteros (redondeo a 2 decimales). Evita drift de punto flotante. */
export function toCents(n: number): number {
  return Math.round((Number(n) || 0) * 100);
}

/** Centavos enteros → pesos (para formateo en pantalla). */
export function toPesos(cents: number): number {
  return cents / 100;
}

/** Una NC se identifica por `tipo_comprobante` (convención fiscal: NOTA_CREDITO_*). */
export function esNotaCredito(tipoComprobante: string | null | undefined): boolean {
  return (tipoComprobante ?? "").toUpperCase().startsWith("NOTA_CREDITO");
}

/** Partición exclusiva y exhaustiva: NC por tipo; el resto, por signo del saldo. */
function bucketDe(row: CuentaRow): Bucket {
  if (esNotaCredito(row.tipoComprobante)) return "nota_credito";
  const c = toCents(row.saldo);
  if (c > 0) return "pendiente";
  if (c < 0) return "sobrepago";
  return "saldada";
}

function agrupar(rows: CuentaRow[], bucket: Bucket): CuentaSeccion {
  const map = new Map<string, CuentaGrupo>();
  for (const row of rows) {
    const key = row.partyId ?? `__sin__${row.partyName ?? ""}`;
    let g = map.get(key);
    if (!g) {
      g = { partyId: row.partyId, partyName: row.partyName, items: [], subtotalCents: 0 };
      map.set(key, g);
    }
    g.items.push(row);
    g.subtotalCents += toCents(row.saldo);
  }
  const grupos = Array.from(map.values());
  const totalCents = grupos.reduce((s, g) => s + g.subtotalCents, 0);
  const count = grupos.reduce((s, g) => s + g.items.length, 0);
  return { bucket, grupos, totalCents, count };
}

/**
 * Clasifica + agrupa + reconcilia. Las cuatro secciones particionan TODOS los
 * renglones de entrada (exclusiva y exhaustivamente), por lo que el Saldo Neto
 * es la suma con signo de todos los saldos, en centavos enteros.
 */
export function clasificarCuentaCorriente(rows: CuentaRow[]): CuentaCorriente {
  const porBucket: Record<Bucket, CuentaRow[]> = {
    pendiente: [],
    nota_credito: [],
    sobrepago: [],
    saldada: [],
  };
  for (const row of rows) porBucket[bucketDe(row)].push(row);

  const pendientes = agrupar(porBucket.pendiente, "pendiente");
  const notasCredito = agrupar(porBucket.nota_credito, "nota_credito");
  const sobrepagos = agrupar(porBucket.sobrepago, "sobrepago");
  const saldadas = agrupar(porBucket.saldada, "saldada");

  const pendienteBrutoCents = pendientes.totalCents; // ≥ 0
  const totalNcCents = -notasCredito.totalCents || 0; // magnitud ≥ 0 (normaliza −0)
  const totalSobrepagoCents = -sobrepagos.totalCents || 0; // magnitud ≥ 0 (normaliza −0)
  const saldoNetoCents = pendienteBrutoCents - totalNcCents - totalSobrepagoCents;

  return {
    pendientes,
    notasCredito,
    sobrepagos,
    saldadas,
    resumen: { pendienteBrutoCents, totalNcCents, totalSobrepagoCents, saldoNetoCents },
  };
}

/**
 * Invariante de reconciliación: la suma con signo de los subtotales de TODAS las
 * secciones menos el Saldo Neto. **Debe ser 0** en centavos (tolerancia 0,00).
 * Útil como aserción de control en dev/tests.
 */
export function deltaReconciliacionCents(cc: CuentaCorriente): number {
  const sumaSecciones =
    cc.pendientes.totalCents +
    cc.notasCredito.totalCents +
    cc.sobrepagos.totalCents +
    cc.saldadas.totalCents;
  return sumaSecciones - cc.resumen.saldoNetoCents;
}
