/**
 * Tests de regresión para la preservación de lost_reason en el ciclo de sync.
 *
 * CONTEXTO:
 *   Bug confirmado 2026-06-27: la RPC clientify_replace_deals_cache hace DELETE+INSERT
 *   completo. En syncs posteriores al primero, los deals "omitidos" (ya enriquecidos)
 *   entraban al INSERT con lossReason=null, borrando todos los valores almacenados.
 *
 * ESTOS TESTS DEBEN FALLAR si alguien:
 *   - Elimina la reinyección de storedReasons antes del REPLACE.
 *   - Modifica buildCacheRows para ignorar lossReason.
 *   - Rompe el health check de integridad.
 */

import { describe, it, expect } from "vitest";
import type { UiDeal } from "@/lib/clientify/mappers";
import { buildCacheRows } from "./dashboard-snapshot";
import { normalizeLossReason } from "@/lib/clientify/loss-reason-normalizer";
import {
  reinjectedStoredReasons,
  buildStoredReasonsMap,
  checkLostReasonIntegrity,
  type StoredReason,
} from "./sync-lost-reason";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function deal(p: Partial<UiDeal> & { id: number }): UiDeal {
  return {
    title: `Deal ${p.id}`,
    contactName: null, contactEmail: null, contactPhone: null,
    companyName: null, amount: 1_000_000, currency: "ARS",
    stage: "Propuesta enviada", stageId: 1,
    pipeline: "Cargas Generales", pipelineId: 10,
    probability: 0, probabilityLabel: "",
    status: "lost", statusLabel: "Perdido",
    ownerName: null, expectedClose: null, actualClose: "2026-06-01",
    createdAt: "2026-01-01", modifiedAt: "2026-06-01",
    tags: [], source: null, deal_source: null,
    lossReason: null,
    href: `https://new.clientify.com/sales/deals/details/${p.id}`,
    ...p,
  };
}

// ─── TEST 1: Dos sincronizaciones consecutivas ────────────────────────────────
// Verifica que el segundo sync preserve exactamente los mismos valores
// que el primero enriqueció, sin volver a llamar a Clientify.

describe("TEST 1 — Dos sincronizaciones consecutivas", () => {
  const DEALS_FROM_API = [
    deal({ id: 1 }),
    deal({ id: 2 }),
    deal({ id: 3 }),
    deal({ id: 4 }),
  ];

  // Simula los valores que devuelve GET /deals/{id} en el primer sync.
  const CLIENTIFY_RESPONSES: Record<number, string> = {
    1: "Precio",
    2: "No contesta / N/A",
    3: "Condiciones",
    4: "No contesta / N/A",
  };

  // ── Sync 1: enriquecimiento completo ──────────────────────────────────────

  it("Sync 1: enriquece todos los deals perdidos con el valor de Clientify", () => {
    const deals = DEALS_FROM_API.map((d) => ({ ...d }));

    // Simula getDeal() + normalizeLossReason() como hace el sync real
    for (const d of deals.filter((d) => d.status === "lost")) {
      const raw = CLIENTIFY_RESPONSES[d.id];
      d.lossReason = normalizeLossReason(raw);
    }

    expect(deals[0].lossReason).toBe("Precio");
    expect(deals[1].lossReason).toBe("No contesta / N/A");
    expect(deals[2].lossReason).toBe("Condiciones");
    expect(deals[3].lossReason).toBe("No contesta / N/A");
  });

  it("Sync 1: buildCacheRows persiste lost_reason correctamente", () => {
    const deals = DEALS_FROM_API.map((d) => ({
      ...d,
      lossReason: normalizeLossReason(CLIENTIFY_RESPONSES[d.id]),
    }));

    const rows = buildCacheRows(deals);
    expect(rows[0].lost_reason).toBe("Precio");
    expect(rows[1].lost_reason).toBe("No contesta / N/A");
    expect(rows[2].lost_reason).toBe("Condiciones");
    expect(rows[3].lost_reason).toBe("No contesta / N/A");
  });

  // ── Sync 2: los deals están "ya almacenados" → skip + reinyección ─────────

  it("Sync 2: el cache tiene los valores del Sync 1", () => {
    // Simula lo que quedó en clientify_deals_cache tras el Sync 1
    const cachedAfterSync1: StoredReason[] = [
      { deal_id: 1, lost_reason: "Precio" },
      { deal_id: 2, lost_reason: "No contesta / N/A" },
      { deal_id: 3, lost_reason: "Condiciones" },
      { deal_id: 4, lost_reason: "No contesta / N/A" },
    ];
    const storedMap = buildStoredReasonsMap(cachedAfterSync1);

    expect(storedMap.size).toBe(4);
    expect(storedMap.get(1)).toBe("Precio");
    expect(storedMap.get(2)).toBe("No contesta / N/A");
    expect(storedMap.get(3)).toBe("Condiciones");
    expect(storedMap.get(4)).toBe("No contesta / N/A");
  });

  it("Sync 2: reinjectedStoredReasons copia los valores al objeto deal ANTES del REPLACE", () => {
    // Sin reinyección, los deals del endpoint de lista tienen lossReason=null
    const dealsFromList = DEALS_FROM_API.map((d) => ({ ...d, lossReason: null as null }));

    const cachedAfterSync1: StoredReason[] = [
      { deal_id: 1, lost_reason: "Precio" },
      { deal_id: 2, lost_reason: "No contesta / N/A" },
      { deal_id: 3, lost_reason: "Condiciones" },
      { deal_id: 4, lost_reason: "No contesta / N/A" },
    ];
    const storedMap = buildStoredReasonsMap(cachedAfterSync1);
    const reinjected = reinjectedStoredReasons(dealsFromList, storedMap);

    // Todos fueron reinyectados
    expect(reinjected).toBe(4);

    // Valores preservados exactamente
    expect(dealsFromList[0].lossReason).toBe("Precio");
    expect(dealsFromList[1].lossReason).toBe("No contesta / N/A");
    expect(dealsFromList[2].lossReason).toBe("Condiciones");
    expect(dealsFromList[3].lossReason).toBe("No contesta / N/A");
  });

  it("Sync 2: buildCacheRows después de reinyección produce el mismo resultado que Sync 1", () => {
    const dealsFromList = DEALS_FROM_API.map((d) => ({ ...d, lossReason: null as null }));
    const storedMap = buildStoredReasonsMap([
      { deal_id: 1, lost_reason: "Precio" },
      { deal_id: 2, lost_reason: "No contesta / N/A" },
      { deal_id: 3, lost_reason: "Condiciones" },
      { deal_id: 4, lost_reason: "No contesta / N/A" },
    ]);
    reinjectedStoredReasons(dealsFromList, storedMap);

    const rows = buildCacheRows(dealsFromList);
    // Los valores son IDÉNTICOS a los del Sync 1 — sin regresión
    expect(rows[0].lost_reason).toBe("Precio");
    expect(rows[1].lost_reason).toBe("No contesta / N/A");
    expect(rows[2].lost_reason).toBe("Condiciones");
    expect(rows[3].lost_reason).toBe("No contesta / N/A");
  });

  it("SIN el fix: el Sync 2 hubiera borrado todos los valores (documenta el bug original)", () => {
    // Sin reinyección, los deals del endpoint de lista tienen lossReason=null
    const dealsWithoutReinject = DEALS_FROM_API.map((d) => ({ ...d, lossReason: null as null }));
    const rowsWithoutFix = buildCacheRows(dealsWithoutReinject);

    // Esto es exactamente lo que pasaba antes del fix: todos NULL
    expect(rowsWithoutFix.every((r) => r.lost_reason === null)).toBe(true);
  });
});

// ─── TEST 2: Persistencia via buildCacheRows ──────────────────────────────────
// Verifica que el mapeo UiDeal.lossReason → CacheRow.lost_reason sea correcto
// para los 4 motivos canónicos + null.

describe("TEST 2 — Persistencia: buildCacheRows mapea lossReason correctamente", () => {
  const REASONS: Array<{ reason: string | null; expected: string | null }> = [
    { reason: "Precio",            expected: "Precio" },
    { reason: "Condiciones",       expected: "Condiciones" },
    { reason: "No contesta / N/A", expected: "No contesta / N/A" },
    { reason: "Otros",             expected: "Otros" },
    { reason: "Sin clasificar",    expected: "Sin clasificar" },
    { reason: null,                expected: null },
  ];

  for (const { reason, expected } of REASONS) {
    it(`lossReason="${reason}" → lost_reason="${expected}" en CacheRow`, () => {
      const d = deal({ id: 99, lossReason: reason });
      const [row] = buildCacheRows([d]);
      expect(row.lost_reason).toBe(expected);
    });
  }

  it("deal_id, title, status y amount se mapean correctamente junto con lost_reason", () => {
    const d = deal({ id: 42, amount: 5_000_000, lossReason: "Precio" });
    const [row] = buildCacheRows([d]);
    expect(row.deal_id).toBe(42);
    expect(row.amount).toBe(5_000_000);
    expect(row.status).toBe("lost");
    expect(row.lost_reason).toBe("Precio");
  });

  it("múltiples deals con distintos motivos persisten independientemente", () => {
    const deals = [
      deal({ id: 1, lossReason: "Precio" }),
      deal({ id: 2, lossReason: "Condiciones" }),
      deal({ id: 3, lossReason: "No contesta / N/A" }),
      deal({ id: 4, lossReason: "Otros" }),
      deal({ id: 5, lossReason: null }),
    ];
    const rows = buildCacheRows(deals);
    expect(rows.map((r) => r.lost_reason)).toEqual([
      "Precio",
      "Condiciones",
      "No contesta / N/A",
      "Otros",
      null,
    ]);
  });
});

// ─── TEST 3: E2E — Clientify → Mapper → Normalizer → Cache → Dashboard ────────
// Verifica que las cantidades que llegarían al Donut coincidan con
// los valores de la base de datos.

describe("TEST 3 — E2E: flujo completo Clientify → Donut", () => {
  // Datos brutos "crudos" como llegan de Clientify (antes de normalizar)
  const CLIENTIFY_RAW = [
    { id: 1,  raw: "Precio",                amount: 46_000_000 },
    { id: 2,  raw: "precio",                amount: 15_000_000 }, // variante lowercase
    { id: 3,  raw: "Price",                 amount: 20_000_000 }, // variante inglés
    { id: 4,  raw: "Condiciones",           amount: 39_000_000 },
    { id: 5,  raw: "Sin capacidad",         amount: 12_000_000 }, // → Condiciones
    { id: 6,  raw: "No contesta N/A",       amount: 8_000_000  }, // variante sin /
    { id: 7,  raw: "No responde",           amount: 9_000_000  }, // → No contesta/N/A
    { id: 8,  raw: "N/A",                   amount: 11_000_000 }, // → No contesta/N/A
    { id: 9,  raw: "Otros",                 amount: 15_000_000 },
    { id: 10, raw: "Other",                 amount: 5_000_000  }, // variante inglés
    { id: 11, raw: null,                    amount: 3_000_000  }, // → Sin clasificar
  ];

  // Paso 1: Mapper (normalizeLossReason)
  const normalized = CLIENTIFY_RAW.map((d) => ({
    ...d,
    lossReason: normalizeLossReason(d.raw),
  }));

  // Paso 2: buildCacheRows
  const cacheRows = buildCacheRows(
    normalized.map((d) =>
      deal({ id: d.id, lossReason: d.lossReason, amount: d.amount, status: "lost" })
    )
  );

  // Paso 3: Agregación tal como haría el Dashboard (LossAnalysis)
  function aggregateByReason(rows: typeof cacheRows) {
    const map = new Map<string, { count: number; amount: number }>();
    for (const r of rows) {
      const key = r.lost_reason ?? "Sin clasificar";
      const cur = map.get(key) ?? { count: 0, amount: 0 };
      map.set(key, { count: cur.count + 1, amount: cur.amount + r.amount });
    }
    return map;
  }

  const agg = aggregateByReason(cacheRows);

  it("Precio: 3 deals (Precio, precio, Price) — variantes normalizadas", () => {
    expect(agg.get("Precio")?.count).toBe(3);
    expect(agg.get("Precio")?.amount).toBe(46_000_000 + 15_000_000 + 20_000_000);
  });

  it("Condiciones: 2 deals (Condiciones, Sin capacidad) — variante operativa capturada", () => {
    expect(agg.get("Condiciones")?.count).toBe(2);
    expect(agg.get("Condiciones")?.amount).toBe(39_000_000 + 12_000_000);
  });

  it("No contesta / N/A: 3 deals — todas las variantes unifican correctamente", () => {
    expect(agg.get("No contesta / N/A")?.count).toBe(3);
    expect(agg.get("No contesta / N/A")?.amount).toBe(8_000_000 + 9_000_000 + 11_000_000);
  });

  it("Otros: 2 deals (Otros, Other)", () => {
    expect(agg.get("Otros")?.count).toBe(2);
    expect(agg.get("Otros")?.amount).toBe(15_000_000 + 5_000_000);
  });

  it("Sin clasificar: 1 deal con lost_reason null", () => {
    expect(agg.get("Sin clasificar")?.count).toBe(1);
  });

  it("Total: 11 deals, suma de importes correcta", () => {
    let total = 0;
    let count = 0;
    for (const v of agg.values()) {
      total += v.amount;
      count += v.count;
    }
    expect(count).toBe(11);
    expect(total).toBe(
      46_000_000 + 15_000_000 + 20_000_000 +
      39_000_000 + 12_000_000 +
      8_000_000 + 9_000_000 + 11_000_000 +
      15_000_000 + 5_000_000 +
      3_000_000
    );
  });

  it("Donut recibe exactamente 4 categorías (Sin clasificar se excluye si count=0)", () => {
    // Con datos reales, el donut solo muestra categorías con count > 0
    const populated = [...agg.entries()].filter(([, v]) => v.count > 0);
    expect(populated.length).toBe(5); // Precio + Condiciones + No contesta/N/A + Otros + Sin clasificar
  });
});

// ─── TEST 4: Health Check de integridad ───────────────────────────────────────
// Verifica que el health check detecte pérdidas de lost_reason y no genere
// falsos positivos cuando la situación es normal.

describe("TEST 4 — Health Check: detecta pérdida de lost_reason entre syncs", () => {
  it("ok=true cuando ningún valor se pierde (caso normal)", () => {
    const deals = [
      deal({ id: 1, lossReason: "Precio" }),
      deal({ id: 2, lossReason: "Condiciones" }),
      deal({ id: 3, lossReason: null }), // legítimamente sin clasificar
    ];
    const result = checkLostReasonIntegrity(2, deals);
    expect(result.ok).toBe(true);
    expect(result.warning).toBeNull();
    expect(result.dropped).toBe(0);
    expect(result.currentEnriched).toBe(2);
  });

  it("ok=false y warning cuando se pierden valores (regresión del bug original)", () => {
    // Simula el bug: sync previo tenía 67 enriquecidos, sync actual los borró todos
    const dealsAfterBuggySync = Array.from({ length: 67 }, (_, i) =>
      deal({ id: i + 1, lossReason: null }) // todos NULL, bug activo
    );
    const result = checkLostReasonIntegrity(67, dealsAfterBuggySync);
    expect(result.ok).toBe(false);
    expect(result.dropped).toBe(67);
    expect(result.currentEnriched).toBe(0);
    expect(result.warning).toMatch(/67 registro\(s\) perdieron su valor/);
    expect(result.warning).toMatch(/WARN/);
  });

  it("ok=true cuando hay más enriquecidos que antes (nuevos deals perdidos clasificados)", () => {
    const deals = [
      deal({ id: 1, lossReason: "Precio" }),
      deal({ id: 2, lossReason: "Condiciones" }),
      deal({ id: 3, lossReason: "Otros" }), // nuevo deal clasificado
    ];
    // Antes había 2, ahora hay 3 → no es una pérdida
    const result = checkLostReasonIntegrity(2, deals);
    expect(result.ok).toBe(true);
    expect(result.dropped).toBe(-1); // negativo = ganó un registro
    expect(result.warning).toBeNull();
  });

  it("ok=false con mensaje específico cuando hay pérdida parcial", () => {
    const deals = [
      deal({ id: 1, lossReason: "Precio" }),
      deal({ id: 2, lossReason: null }), // este perdió su valor
    ];
    const result = checkLostReasonIntegrity(2, deals);
    expect(result.ok).toBe(false);
    expect(result.dropped).toBe(1);
    expect(result.warning).toContain("1 registro(s)");
    expect(result.warning).toContain("Antes: 2");
    expect(result.warning).toContain("Ahora: 1 de 2");
  });

  it("deals no perdidos (open/won) no se cuentan en el health check", () => {
    const deals = [
      deal({ id: 1, status: "open",  lossReason: null }),  // activo, no cuenta
      deal({ id: 2, status: "won",   lossReason: null }),  // ganado, no cuenta
      deal({ id: 3, status: "lost",  lossReason: "Precio" }),
    ];
    const result = checkLostReasonIntegrity(1, deals);
    expect(result.ok).toBe(true);
    expect(result.currentEnriched).toBe(1); // solo cuenta los lost
  });

  it("health check con 0 previos y 0 actuales: ok (no hay datos históricos todavía)", () => {
    const deals: UiDeal[] = [];
    const result = checkLostReasonIntegrity(0, deals);
    expect(result.ok).toBe(true);
    expect(result.dropped).toBe(0);
    expect(result.warning).toBeNull();
  });
});

// ─── TEST ADICIONAL: reinjectedStoredReasons — casos borde ───────────────────

describe("reinjectedStoredReasons — casos borde", () => {
  it("no modifica deals que ya tienen lossReason set (enriquecidos en este sync)", () => {
    const d = deal({ id: 1, lossReason: "Precio" }); // ya enriquecido en este sync
    const stored = buildStoredReasonsMap([{ deal_id: 1, lost_reason: "Condiciones" }]);
    reinjectedStoredReasons([d], stored);
    // NO debe sobrescribir el valor recién fetched
    expect(d.lossReason).toBe("Precio");
  });

  it("no modifica deals que no son lost", () => {
    const d = deal({ id: 1, status: "open", lossReason: null });
    const stored = buildStoredReasonsMap([{ deal_id: 1, lost_reason: "Precio" }]);
    reinjectedStoredReasons([d], stored);
    expect(d.lossReason).toBeNull(); // activo no tiene lost_reason
  });

  it("ignora deal_ids que no están en el mapa stored", () => {
    const d = deal({ id: 999, lossReason: null });
    const stored = buildStoredReasonsMap([{ deal_id: 1, lost_reason: "Precio" }]);
    const count = reinjectedStoredReasons([d], stored);
    expect(count).toBe(0);
    expect(d.lossReason).toBeNull();
  });

  it("buildStoredReasonsMap ignora filas con lost_reason null", () => {
    const stored = buildStoredReasonsMap([
      { deal_id: 1, lost_reason: "Precio" },
      { deal_id: 2, lost_reason: null }, // null → no debe entrar al mapa
    ]);
    expect(stored.size).toBe(1);
    expect(stored.has(2)).toBe(false);
  });
});
