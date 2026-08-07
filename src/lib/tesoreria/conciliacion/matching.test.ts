/**
 * Suite del motor de conciliación + guardas de E2 (TREAS-RECON-001).
 *
 * Cobertura exigida por Dirección: matching exacto, aproximado, sistémicos,
 * N:M, rechazo por ambigüedad, idempotencia, diferencias/ajustes, preservación
 * de los ajustes blindados, y ausencia de conciliación automática sin
 * confirmación humana. Todo PURO: sin red, sin Supabase.
 */
import { describe, it, expect } from "vitest";
import { conciliar, type MovimientoNexus } from "./matching";
import type { NormalizedLine } from "./types";
import { procesarExtracto } from "./ingest";
import { excluirMovimientos } from "./exclusions";
import { validarCoherenciaCuenta, normalizarBanco, bancoDeLaCuenta, type CuentaParaIngesta } from "./account-guard";

// ── Helpers ───────────────────────────────────────────────────────────
const linea = (o: Partial<NormalizedLine> & { fecha: string; importe: number }): NormalizedLine => ({
  fecha: o.fecha,
  importe: o.importe, // centavos, ABSOLUTO
  tipo: o.tipo ?? "debito",
  descripcion: o.descripcion ?? "Movimiento",
  contraparte: o.contraparte ?? null,
  referencia: o.referencia ?? null,
  saldo: o.saldo ?? 0,
  categoria: o.categoria ?? "operativo",
  subtipo: o.subtipo ?? null,
  codigoConcepto: o.codigoConcepto ?? null,
});

const mov = (o: Partial<MovimientoNexus> & { id: string; fecha: string; importe: number }): MovimientoNexus => ({
  id: o.id,
  fecha: o.fecha,
  importe: o.importe,
  tipo: o.tipo ?? "debito",
  descripcion: o.descripcion ?? "Pago",
  contraparte: o.contraparte ?? null,
  cuit: o.cuit ?? null,
});

// IDs reales de los ajustes blindados (T0-R1 · Piloto F6).
const BLINDADO_SANTANDER = "11111111-1111-1111-1111-000000000018";
const BLINDADO_GALICIA = "11111111-1111-1111-1111-000000000017";

// ── Capa 2 · EXACTO ───────────────────────────────────────────────────
describe("matching · capa exacta", () => {
  it("concilia importe y fecha idénticos con score 100", () => {
    const r = conciliar([linea({ fecha: "2026-07-10", importe: 150_000 })], [mov({ id: "m1", fecha: "2026-07-10", importe: 150_000 })]);
    expect(r.matches[0].metodo).toBe("exacto");
    expect(r.matches[0].score).toBe(100);
    expect(r.matches[0].movimientoIds).toEqual(["m1"]);
  });

  it("no cruza direcciones opuestas (débito de extracto vs ingreso interno)", () => {
    const r = conciliar([linea({ fecha: "2026-07-10", importe: 150_000, tipo: "debito" })], [mov({ id: "m1", fecha: "2026-07-10", importe: 150_000, tipo: "credito" })]);
    expect(r.matches[0].estado).toBe("no_conciliado");
  });
});

// ── Capa 3 · APROXIMADO ───────────────────────────────────────────────
describe("matching · capa aproximada", () => {
  it("concilia con desfase de fecha dentro de la ventana y baja el score", () => {
    const r = conciliar([linea({ fecha: "2026-07-10", importe: 90_000 })], [mov({ id: "m1", fecha: "2026-07-12", importe: 90_000 })]);
    expect(r.matches[0].metodo).toBe("aproximado");
    expect(r.matches[0].score).toBeLessThan(100);
    expect(r.matches[0].score).toBeGreaterThanOrEqual(70);
  });

  it("no concilia fuera de la ventana de días", () => {
    const r = conciliar([linea({ fecha: "2026-07-01", importe: 90_000 })], [mov({ id: "m1", fecha: "2026-07-20", importe: 90_000 })]);
    expect(r.matches[0].estado).toBe("no_conciliado");
  });
});

// ── Capa 1 · SISTÉMICOS ───────────────────────────────────────────────
describe("matching · sistémicos", () => {
  it("resuelve por regla determinística, sin consumir movimientos internos", () => {
    const r = conciliar(
      [linea({ fecha: "2026-07-05", importe: 3_450, categoria: "sistemico", subtipo: "ley_25413_debito", descripcion: "Impuesto Ley 25413" })],
      [mov({ id: "m1", fecha: "2026-07-05", importe: 3_450 })]
    );
    expect(r.matches[0].estado).toBe("sistemico");
    expect(r.matches[0].movimientoIds).toEqual([]);
    expect(r.resumen.movimientosUsados).toBe(0);
  });
});

// ── Capa 5 · N:M ──────────────────────────────────────────────────────
describe("matching · N:M", () => {
  it("agrupa varios movimientos cuya suma iguala la línea", () => {
    const r = conciliar(
      [linea({ fecha: "2026-07-08", importe: 300_000 })],
      [mov({ id: "a", fecha: "2026-07-08", importe: 100_000 }), mov({ id: "b", fecha: "2026-07-08", importe: 200_000 })]
    );
    expect(r.matches[0].metodo).toBe("n_m");
    expect(r.matches[0].movimientoIds.sort()).toEqual(["a", "b"]);
  });
});

// ── OB5 · Ambigüedad ──────────────────────────────────────────────────
describe("matching · rechazo por ambigüedad (OB5)", () => {
  it("con dos candidatos idénticos no auto-asigna: queda 'posible'", () => {
    const r = conciliar(
      [linea({ fecha: "2026-07-10", importe: 50_000 })],
      [mov({ id: "m1", fecha: "2026-07-10", importe: 50_000 }), mov({ id: "m2", fecha: "2026-07-10", importe: 50_000 })]
    );
    expect(r.matches[0].estado).toBe("posible");
  });

  it("con CUIT distinto no auto-asigna: queda 'posible' con el candidato listado para decisión humana (OB6)", () => {
    const r = conciliar(
      [linea({ fecha: "2026-07-10", importe: 50_000, referencia: "30712345674" })],
      [mov({ id: "m1", fecha: "2026-07-10", importe: 50_000, cuit: "30555555556" })]
    );
    expect(r.matches[0].estado).toBe("posible");
    expect(r.matches[0].estado).not.toBe("conciliado");
    // El movimiento se expone como sugerencia (requiere click humano), NO se
    // enlaza automáticamente; el motivo explicita el conflicto de entidad.
    expect(r.matches[0].movimientoIds).toEqual(["m1"]);
    expect(r.matches[0].motivo).toMatch(/CUIT|ambiguo/i);
  });
});

// ── Un movimiento se usa una sola vez ─────────────────────────────────
describe("matching · asignación 1:1", () => {
  it("no reutiliza el mismo movimiento en dos líneas", () => {
    const r = conciliar(
      [linea({ fecha: "2026-07-10", importe: 70_000 }), linea({ fecha: "2026-07-10", importe: 70_000, descripcion: "Segunda línea" })],
      [mov({ id: "unico", fecha: "2026-07-10", importe: 70_000 })]
    );
    const usados = r.matches.flatMap((m) => m.movimientoIds);
    expect(usados.filter((id) => id === "unico")).toHaveLength(1);
  });
});

// ── Exclusiones gobernadas (0212) ─────────────────────────────────────
describe("exclusiones gobernadas", () => {
  const candidatos = [
    mov({ id: BLINDADO_SANTANDER, fecha: "2026-07-22", importe: 5_544_191_843, descripcion: "Reinicio oficial del Piloto F6 — T0-R1" }),
    mov({ id: "operativo", fecha: "2026-07-22", importe: 5_544_191_843, descripcion: "Pago real" }),
  ];

  it("el movimiento excluido desaparece del universo de candidatos", () => {
    const filtrados = excluirMovimientos(candidatos, new Set([BLINDADO_SANTANDER]));
    expect(filtrados.map((m) => m.id)).toEqual(["operativo"]);
  });

  it("un blindado nunca se concilia: sin él, el motor no lo puede elegir en capa exacta", () => {
    const filtrados = excluirMovimientos(candidatos, new Set([BLINDADO_SANTANDER, BLINDADO_GALICIA]));
    const r = conciliar([linea({ fecha: "2026-07-22", importe: 5_544_191_843 })], filtrados);
    expect(r.matches[0].movimientoIds).toEqual(["operativo"]);
    expect(r.matches[0].movimientoIds).not.toContain(BLINDADO_SANTANDER);
  });

  it("la exclusión también aplica en N:M (no puede formar parte de una combinación)", () => {
    const conBlindado = [
      mov({ id: BLINDADO_GALICIA, fecha: "2026-07-08", importe: 100_000 }),
      mov({ id: "b", fecha: "2026-07-08", importe: 200_000 }),
    ];
    const filtrados = excluirMovimientos(conBlindado, new Set([BLINDADO_GALICIA]));
    const r = conciliar([linea({ fecha: "2026-07-08", importe: 300_000 })], filtrados);
    expect(r.matches[0].movimientoIds).not.toContain(BLINDADO_GALICIA);
    expect(r.matches[0].estado).toBe("no_conciliado"); // 200.000 ≠ 300.000
  });

  it("si el blindado NO se excluye, el motor lo tomaría (justifica la exclusión gobernada)", () => {
    const r = conciliar([linea({ fecha: "2026-07-22", importe: 5_544_191_843 })], [candidatos[0]]);
    expect(r.matches[0].movimientoIds).toEqual([BLINDADO_SANTANDER]);
  });

  it("sin exclusiones activas el universo queda intacto", () => {
    expect(excluirMovimientos(candidatos, new Set()).length).toBe(2);
  });
});

// ── Coherencia banco↔cuenta (hallazgo E1) ─────────────────────────────
describe("coherencia banco↔cuenta", () => {
  const caja: CuentaParaIngesta = { id: "c", bank_name: "Caja", account_name: "Caja Efectivo", account_type: "caja", currency: "ARS", active: true };
  const santander: CuentaParaIngesta = { id: "s", bank_name: "Banco Santander", account_name: "VEROTIN S.A. — Santander", account_type: "cuenta_corriente", currency: "ARS", active: true };
  const galicia: CuentaParaIngesta = { id: "g", bank_name: "Banco Galicia", account_name: "VEROTIN S.A. — Galicia", account_type: "cuenta_corriente", currency: "ARS", active: true };

  it("Santander + cuenta Caja → RECHAZO (el defecto del piloto)", () => {
    expect(validarCoherenciaCuenta("santander", caja)).toMatch(/caja/i);
  });

  it("Santander + cuenta Santander → PERMITIDO", () => {
    expect(validarCoherenciaCuenta("santander", santander)).toBeNull();
  });

  it("Santander + cuenta Galicia → RECHAZO por banco incompatible", () => {
    expect(validarCoherenciaCuenta("santander", galicia)).toMatch(/pertenece a/i);
  });

  it("Galicia + cuenta Galicia → PERMITIDO", () => {
    expect(validarCoherenciaCuenta("galicia", galicia)).toBeNull();
  });

  it("cuenta inactiva → RECHAZO", () => {
    expect(validarCoherenciaCuenta("santander", { ...santander, active: false })).toMatch(/inactiva/i);
  });

  it("moneda no ARS → RECHAZO", () => {
    expect(validarCoherenciaCuenta("santander", { ...santander, currency: "USD" })).toMatch(/ARS/);
  });

  it("cuenta inexistente → RECHAZO", () => {
    expect(validarCoherenciaCuenta("santander", null)).toMatch(/no existe/i);
  });

  // B4 · dominio cerrado (la versión previa dejaba pasar "" y "banco").
  it("banco VACÍO → RECHAZO (antes eludía el guard por position('' in x)=1)", () => {
    expect(validarCoherenciaCuenta("", santander)).toMatch(/Indicá el banco/i);
  });

  it("banco GENÉRICO 'banco' → RECHAZO", () => {
    expect(validarCoherenciaCuenta("banco", santander)).toMatch(/no soportado/i);
  });

  it("banco NO SOPORTADO ('nación') → RECHAZO", () => {
    expect(validarCoherenciaCuenta("nación", santander)).toMatch(/no soportado/i);
  });

  it("normalizarBanco acepta variantes de formato y rechaza el resto", () => {
    expect(normalizarBanco("  SANTANDER  ")).toBe("santander");
    expect(normalizarBanco("Galicia")).toBe("galicia");
    expect(normalizarBanco("")).toBeNull();
    expect(normalizarBanco("   ")).toBeNull();
    expect(normalizarBanco("banco")).toBeNull();
    expect(normalizarBanco("santander rio")).toBeNull();
    expect(normalizarBanco(null)).toBeNull();
  });

  it("bancoDeLaCuenta resuelve por mapa explícito, no por substring ambiguo", () => {
    expect(bancoDeLaCuenta("Banco Santander")).toBe("santander");
    expect(bancoDeLaCuenta("Banco Galicia")).toBe("galicia");
    expect(bancoDeLaCuenta("Caja")).toBeNull();
    expect(bancoDeLaCuenta("Banco Nación")).toBeNull();
  });
});

// ── Nada se concilia solo · idempotencia del payload ──────────────────
describe("ingesta · nada se registra sin confirmación humana", () => {
  const CSV = [
    "Fecha;Descripcion;Importe;Saldo",
    "01/07/2026;Pago a proveedores recibido - ACME;100000,00;100000,00",
    "02/07/2026;Impuesto Ley 25413 debito;-600,00;99400,00",
  ].join("\n");

  it("todas las líneas con match quedan 'posible' (sugerencia), nunca 'conciliado'", () => {
    const res = procesarExtracto({
      contenido: CSV,
      banco: "santander",
      sourceKind: "csv",
      candidatos: [mov({ id: "m1", fecha: "2026-07-01", importe: 10_000_000, tipo: "credito" })],
    });
    for (const l of res.payload.lines) {
      expect(["posible", "no_conciliado", "sistemico"]).toContain(l.match_status);
      expect(l.match_status).not.toBe("conciliado");
    }
    for (const m of res.payload.matches) {
      expect(m.status).toBe("sugerido");
    }
  });

  it("es determinista: mismo contenido ⇒ mismo hash de idempotencia y mismo payload", () => {
    const a = procesarExtracto({ contenido: CSV, banco: "santander", sourceKind: "csv", candidatos: [] });
    const b = procesarExtracto({ contenido: CSV, banco: "santander", sourceKind: "csv", candidatos: [] });
    expect(a.payload.statement.hash).toBe(b.payload.statement.hash);
    expect(JSON.stringify(a.payload)).toBe(JSON.stringify(b.payload));
  });

  it("contenido distinto ⇒ hash distinto (no bloquea una re-ingesta legítima)", () => {
    const otro = CSV.replace("100000,00", "100001,00");
    const a = procesarExtracto({ contenido: CSV, banco: "santander", sourceKind: "csv", candidatos: [] });
    const b = procesarExtracto({ contenido: otro, banco: "santander", sourceKind: "csv", candidatos: [] });
    expect(a.payload.statement.hash).not.toBe(b.payload.statement.hash);
  });
});
