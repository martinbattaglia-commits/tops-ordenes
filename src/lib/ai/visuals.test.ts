// Estándar visual 2026-07-07 · Adaptadores DETERMINÍSTICOS tool→tablero ejecutivo.
// Los KPIs/tablas/charts salen de las filas de la tool (SQL/código), nunca del modelo.

import { describe, expect, it } from "vitest";
import { TOOL_VISUALS } from "./visuals";

const CAT_ROWS = [
  { categoria: "ANMAT", monto: "100187092.50", porcentaje: "79.4", cantidad: 9, total_periodo: "126229317.50", periodo: "ultimo_mes", desde: "2026-06-12", hasta: "2026-06-25", detalle: "x" },
  { categoria: "Sin clasificar", monto: "21668075.00", porcentaje: "17.2", cantidad: 7, total_periodo: "126229317.50", periodo: "ultimo_mes", detalle: "x" },
  { categoria: "Cargas Generales", monto: "4374150.00", porcentaje: "3.5", cantidad: 2, total_periodo: "126229317.50", periodo: "ultimo_mes", detalle: "x" },
];

describe("visual · revenue_by_category_report → reporte con KPIs+tabla+donut", () => {
  it("estructura completa: título, período, KPIs, tabla, chart, insight y warning de brecha", () => {
    const v = TOOL_VISUALS.revenue_by_category_report!(CAT_ROWS, {});
    expect(v).not.toBeNull();
    expect(v!.kind).toBe("report");
    expect(v!.title.toLowerCase()).toContain("ingresos");
    expect(v!.period).toBeTruthy();
    expect(v!.kpis!.length).toBeGreaterThanOrEqual(2); // total + líder
    expect(v!.kpis![0].value).toContain("126,229,317.50"); // números EXACTOS
    expect(v!.table!.columns).toContain("Categoría");
    expect(v!.table!.rows.length).toBe(3);
    expect(v!.chart!.type).toBe("donut");
    expect(v!.chart!.labels).toEqual(["ANMAT", "Sin clasificar", "Cargas Generales"]);
    expect(v!.chart!.values[0]).toBeCloseTo(100187092.5);
    expect(v!.insights!.join(" ")).toContain("79.4");
    // 'Sin clasificar' = WARNING visible, nunca se esconde.
    expect(v!.warnings!.join(" ").toLowerCase()).toContain("sin clasificar");
  });
});

describe("visual · customer_revenue_overview → kpi compacto (top-1) o ranking (barras)", () => {
  const ROW = { cliente: "Cliente Demo SA", total: "85000000.00", cantidad: 12, periodo: "todo", detalle: "x" };
  it("una fila (singular) → kind kpi, sin chart, respuesta compacta", () => {
    const v = TOOL_VISUALS.customer_revenue_overview!([ROW], {});
    expect(v!.kind).toBe("kpi");
    expect(v!.chart).toBeFalsy();
    expect(v!.kpis!.some((k) => k.value.includes("85,000,000.00"))).toBe(true);
  });
  it("varias filas (ranking) → tabla + barras", () => {
    const v = TOOL_VISUALS.customer_revenue_overview!(
      [ROW, { cliente: "Otro SA", total: "41000000.00", cantidad: 6, periodo: "todo", detalle: "x" }],
      {}
    );
    expect(v!.kind).toBe("ranking");
    expect(v!.chart!.type).toBe("bar");
    expect(v!.table!.rows.length).toBe(2);
  });
});

describe("visual · bank_balances_overview → KPIs por banco + total", () => {
  it("saldos como tarjetas y composición", () => {
    const v = TOOL_VISUALS.bank_balances_overview!(
      [
        { bank_name: "Banco Santander", account_name: "CC", balance: "56751532.00", moneda: "ARS", detalle: "x" },
        { bank_name: "Banco Galicia", account_name: "CC", balance: "17144682.00", moneda: "ARS", detalle: "x" },
      ],
      {}
    );
    expect(v!.kind).toBe("kpi");
    expect(v!.kpis![0].label.toLowerCase()).toContain("total");
    expect(v!.kpis![0].value).toContain("73,896,214.00"); // suma determinística
    expect(v!.kpis!.some((k) => k.label.includes("Santander"))).toBe(true);
  });
});

describe("visual · docs_browse → principal + relacionados (UX documental)", () => {
  it("primera coincidencia como principal; resto separado como relacionados", () => {
    const rows = [
      { entity_type: "compliance_documento", title: "Plancheta habilitación Luján 3159", entity_date: "2026-01-01", excerpt: "x" },
      { entity_type: "compliance_documento", title: "Plano Luján", entity_date: null, excerpt: "x" },
      { entity_type: "compliance_documento", title: "Otro doc Luján", entity_date: null, excerpt: "x" },
    ];
    const v = TOOL_VISUALS.docs_browse!(rows, { query: "lujan" });
    expect(v!.kind).toBe("document");
    expect(v!.kpis![0].value).toContain("Plancheta"); // principal única
    expect(v!.table!.rows.length).toBe(2); // relacionados separados
    expect(v!.warnings!.join(" ").toLowerCase()).toContain("relacionado");
  });
  it("sin filas → null (no inventa documento)", () => {
    expect(TOOL_VISUALS.docs_browse!([], { query: "zzz" })).toBeNull();
  });
});

describe("visual · vacancy_overview → tablero de capacidad con KPIs+progress+categorías", () => {
  const ROWS = [
    { alcance: "Corporativo", capacidad_m2: "10049", ocupado_m2: "6279", disponible_m2: "3770", vacancia_pct: "37.5", cubiculos_total: 26, cubiculos_disponibles: 9, detalle: "x" },
    { alcance: "ANMAT", capacidad_m2: "5200", ocupado_m2: "4000", disponible_m2: "1200", vacancia_pct: "23.1", detalle: "x" },
    { alcance: "Cargas Generales", capacidad_m2: "3800", ocupado_m2: "1700", disponible_m2: "2100", vacancia_pct: "55.3", detalle: "x" },
  ];
  it("KPIs con progress (pct), tabla por categoría y cubículos alquilados calculados", () => {
    const v = TOOL_VISUALS.vacancy_overview!(ROWS, {});
    expect(v!.kind).toBe("report");
    expect(v!.title.toLowerCase()).toContain("capacidad");
    const vac = v!.kpis!.find((k) => k.label.toLowerCase().includes("vacancia"));
    expect(vac).toBeDefined();
    expect(vac!.value).toContain("37.5");
    expect(vac!.pct).toBeCloseTo(37.5); // progress-ready
    // cubículos alquilados = total − disponibles (determinístico)
    const cub = v!.kpis!.find((k) => k.label.toLowerCase().includes("cubículos"));
    expect(cub!.value).toContain("17");
    expect(v!.table!.rows.length).toBe(2); // categorías (sin la fila corporativa)
    expect(v!.chart!.type).toBe("bar");
  });
});

describe("intención puntual · 'cuántos cubículos' → KPI PRINCIPAL primero, no dashboard genérico", () => {
  const ROWS = [
    { alcance: "Corporativo", capacidad_m2: "10049", ocupado_m2: "6279", disponible_m2: "3770", vacancia_pct: "37.5", cubiculos_total: 26, cubiculos_disponibles: 9, cubiculos_alquilados: 17, detalle: "x" },
    { alcance: "ANMAT", capacidad_m2: "5200", ocupado_m2: "4000", disponible_m2: "1200", vacancia_pct: "23.1", detalle: "x" },
    { alcance: "Cargas Generales", capacidad_m2: "3800", ocupado_m2: "1700", disponible_m2: "2100", vacancia_pct: "55.3", detalle: "x" },
  ];
  it("focus=cubiculos → primer KPI es 'Cubículos ANMAT alquilados' con el número", () => {
    const v = TOOL_VISUALS.vacancy_overview!(ROWS, { focus: "cubiculos" });
    expect(v!.kpis![0].label.toLowerCase()).toContain("cubículos anmat alquilados");
    expect(v!.kpis![0].value).toContain("17");
    expect(v!.kpis![1].label.toLowerCase()).toMatch(/total|disponibles/);
  });
  it("focus=vacancia → primer KPI es el porcentaje con progress", () => {
    const v = TOOL_VISUALS.vacancy_overview!(ROWS, { focus: "vacancia" });
    expect(v!.kpis![0].label.toLowerCase()).toContain("vacancia");
    expect(v!.kpis![0].value).toContain("37.5");
    expect(v!.kpis![0].pct).toBeCloseTo(37.5);
  });
  it("focus=disponible + categoria=general → primer KPI son los m² de Cargas Generales", () => {
    const v = TOOL_VISUALS.vacancy_overview!(ROWS, { focus: "disponible", categoria: "general" });
    expect(v!.kpis![0].label.toLowerCase()).toContain("cargas generales");
    expect(v!.kpis![0].value).toContain("2,100");
  });
});

describe("contratos · adaptadores ejecutivos con fuentes INLINE", () => {
  const VENCER = [
    { public_id: "CTR-1", razon_social: "Cliente A", tipo: "ANMAT", estado: "vigente", fecha_fin: "2026-07-20", dias_para_vencer: 13, detalle: "x" },
    { public_id: "CTR-2", razon_social: "Cliente B", tipo: "Cargas Generales", estado: "vigente", fecha_fin: "2026-08-30", dias_para_vencer: 54, detalle: "x" },
  ];
  it("por_vencer → KPI de ALERTA con cantidad + tabla con días restantes + link por fila", () => {
    const v = TOOL_VISUALS.contracts_overview!(VENCER, { mode: "por_vencer" });
    expect(v!.kpis![0].label.toLowerCase()).toContain("por vencer");
    expect(v!.kpis![0].value).toContain("2");
    // warn si no hay urgentes; danger si alguno vence en ≤30 días (semáforo real).
    expect(["warn", "danger"]).toContain(v!.kpis![0].tone);
    expect(v!.table!.columns.join(" ").toLowerCase()).toContain("días");
    // fuente INLINE: cada fila tiene su link (no solo chips abajo)
    expect(v!.table!.rowLinks!.length).toBe(2);
    expect(v!.table!.rowLinks![0]!.url).toBe("/comercial/contratos");
  });
  it("firmados_recientes + periodo=ultimo_mes → KPI 'firmados último mes' calculado por fecha", () => {
    const hoy = new Date();
    const mesPasado = new Date(hoy.getFullYear(), hoy.getMonth() - 1, 15).toISOString().slice(0, 10);
    const viejo = "2024-01-10";
    const rows = [
      { public_id: "C1", razon_social: "X SA", tipo: "ANMAT", estado: "vigente", fecha_firma: mesPasado, fecha_fin: null, detalle: "x" },
      { public_id: "C2", razon_social: "Y SA", tipo: "ANMAT", estado: "vigente", fecha_firma: viejo, fecha_fin: null, detalle: "x" },
    ];
    const v = TOOL_VISUALS.contracts_overview!(rows, { mode: "firmados_recientes", periodo: "ultimo_mes" });
    expect(v!.kpis![0].label.toLowerCase()).toContain("último mes");
    expect(v!.kpis![0].value).toContain("1"); // solo el del mes calendario anterior
    expect(v!.table!.rowLinks![0]).toBeTruthy();
  });

  it("firmados_recientes SIN período pedido → NO muestra 'Firmados último mes: 0' (smoke: el usuario no acotó al mes)", () => {
    const rows = [
      { public_id: "C1", razon_social: "X SA", tipo: "ANMAT", estado: "vigente", fecha_firma: "2026-05-21", fecha_fin: null, detalle: "x" },
      { public_id: "C2", razon_social: "Y SA", tipo: "ANMAT", estado: "vigente", fecha_firma: "2024-01-10", fecha_fin: null, detalle: "x" },
    ];
    const v = TOOL_VISUALS.contracts_overview!(rows, { mode: "firmados_recientes" });
    expect(v!.kpis![0].label.toLowerCase()).not.toContain("último mes");
    expect(v!.kpis![0].value).toContain("2"); // listados, ordenados por firma desc
  });
});

describe("documentos · acción 'Abrir documento' con URL real de Drive (enrichment)", () => {
  it("principal con source_url → kpi.url = Drive; sin url → fallback metadata explícito", () => {
    const conUrl = TOOL_VISUALS.docs_browse!(
      [{ entity_type: "compliance_documento", title: "Plancheta Luján", entity_date: "2026-01-01", excerpt: "x", source_url: "https://drive.google.com/file/d/abc/view" }],
      { query: "lujan" }
    );
    expect(conUrl!.kpis![0].url).toContain("drive.google.com");
    expect(conUrl!.kpis![0].actionLabel!.toLowerCase()).toContain("abrir documento");
    const sinUrl = TOOL_VISUALS.docs_browse!(
      [{ entity_type: "compliance_documento", title: "Doc X", entity_date: null, excerpt: "x" }],
      { query: "x" }
    );
    expect(sinUrl!.kpis![0].url).toBe("/anmat");
    expect(sinUrl!.kpis![0].actionLabel!.toLowerCase()).toContain("metadata");
  });
});

describe("contratos · DASHBOARD contractual + escalera de links documentales", () => {
  const VIGENTES = [
    { public_id: "C1", razon_social: "Alfa SA", tipo: "ANMAT", estado: "vigente", fecha_firma: "2026-01-10", fecha_fin: "2026-08-01", dias_para_vencer: 25, detalle: "x", file_url: "https://drive.google.com/file/d/f1/view" },
    { public_id: "C2", razon_social: "Beta SA", tipo: "ANMAT", estado: "vigente", fecha_firma: "2025-11-02", fecha_fin: "2027-03-01", dias_para_vencer: 237, detalle: "x", folder_url: "https://drive.google.com/drive/folders/abc" },
    { public_id: "C3", razon_social: "Gamma SRL", tipo: "Cargas Generales", estado: "vigente", fecha_firma: "2025-05-20", fecha_fin: null, dias_para_vencer: null, detalle: "x" },
  ];

  it("'vigentes/todos' → dashboard: KPI total + KPIs por tipo + por-vencer + donut por tipo", () => {
    const v = TOOL_VISUALS.contracts_overview!(VIGENTES, { mode: "vigentes" });
    expect(v!.kind).toBe("report");
    expect(v!.kpis![0].label.toLowerCase()).toContain("contratos");
    expect(v!.kpis![0].value).toContain("3");
    expect(v!.kpis!.length).toBeGreaterThanOrEqual(3); // total + tipos + vencimientos
    expect(v!.kpis!.some((k) => k.label.includes("ANMAT") && k.value.includes("2"))).toBe(true);
    expect(v!.chart!.type).toBe("donut");
    expect(v!.chart!.labels).toContain("ANMAT");
    expect(v!.insights!.length).toBeGreaterThan(0);
  });

  it("orden inteligente: el contrato más próximo a vencer va PRIMERO en la tabla", () => {
    const v = TOOL_VISUALS.contracts_overview!(VIGENTES, { mode: "vigentes" });
    expect(v!.table!.rows[0][0]).toBe("Alfa SA"); // 25 días
    expect(v!.table!.columns.join(" ").toLowerCase()).toContain("días");
  });

  it("escalera de links HONESTA: archivo → 'Abrir contrato'; carpeta → Drive; sin nada → 'Sin PDF vinculado' (kind fallback, NUNCA vendido como fuente)", () => {
    const v = TOOL_VISUALS.contracts_overview!(VIGENTES, { mode: "vigentes" });
    const links = v!.table!.rowLinks!;
    // fila 0 = Alfa (file_url) — orden inteligente la puso primera
    expect(links[0]!.url).toContain("drive.google.com/file");
    expect(links[0]!.label.toLowerCase()).toContain("abrir contrato");
    expect(links[0]!.kind).toBe("drive");
    const beta = v!.table!.rows.findIndex((r) => r[0] === "Beta SA");
    expect(links[beta]!.url).toContain("drive.google.com/drive/folders");
    expect(links[beta]!.label.toLowerCase()).toContain("drive");
    expect(links[beta]!.kind).toBe("folder");
    const gamma = v!.table!.rows.findIndex((r) => r[0] === "Gamma SRL");
    expect(links[gamma]!.url).toBe("/comercial/contratos");
    // Etiquetado honesto: dice explícitamente que NO hay PDF; jamás "Abrir
    // contrato" ni un "Ir a contratos" ambiguo presentado como fuente documental.
    expect(links[gamma]!.label.toLowerCase()).toContain("sin pdf");
    expect(links[gamma]!.label.toLowerCase()).not.toContain("abrir contrato");
    expect(links[gamma]!.kind).toBe("fallback");
  });

  it("por_vencer y firmados_recientes también usan la escalera de links reales", () => {
    const v = TOOL_VISUALS.contracts_overview!(
      [{ public_id: "C1", razon_social: "Alfa SA", tipo: "ANMAT", estado: "vigente", fecha_fin: "2026-07-20", dias_para_vencer: 13, detalle: "x", file_url: "https://drive.google.com/file/d/f1/view" }],
      { mode: "por_vencer" }
    );
    expect(v!.table!.rowLinks![0]!.url).toContain("drive.google.com/file");
  });
});

describe("contrato SINGULAR · 'el último contrato firmado' = UNA card, no sábana (smoke 2026-07-07)", () => {
  const ROW_CON_DRIVE = {
    public_id: "CTR-2026-0001", razon_social: "DEO Distribuidora SA", tipo: "ANMAT",
    estado: "Vigente", fecha_firma: "2026-05-21", fecha_fin: "2028-05-31",
    dias_para_vencer: 694, detalle: "x",
    file_url: "https://drive.google.com/file/d/abc123/view",
  };
  const ROW_SIN_DRIVE = {
    public_id: "CTR-2026-0034", razon_social: "Nicolás Cooperate SAS", tipo: "ANMAT",
    estado: "Vigente", fecha_firma: "2026-05-21", fecha_fin: "2027-05-31",
    dias_para_vencer: 328, detalle: "x",
  };

  it("limit=1 → kind document, card única con cliente/tipo/firma/vencimiento/estado, SIN tabla", () => {
    const v = TOOL_VISUALS.contracts_overview!([ROW_CON_DRIVE], { mode: "firmados_recientes", limit: 1 });
    expect(v!.kind).toBe("document");
    expect(v!.title.toLowerCase()).toContain("último contrato");
    expect(v!.table).toBeFalsy(); // UNA entidad principal, no lista
    const labels = v!.kpis!.map((k) => k.label.toLowerCase()).join(" ");
    expect(v!.kpis![0].value).toContain("DEO"); // cliente primero, jerarquía mayor
    expect(labels).toContain("tipo");
    expect(labels).toContain("firma");
    expect(labels).toMatch(/vence|vencimiento/);
    expect(labels).toContain("estado");
    // jamás el KPI de mes calendario en una pregunta singular
    expect(labels).not.toContain("último mes");
  });

  it("limit=1 con archivo Drive → acción 'Abrir contrato' con URL real", () => {
    const v = TOOL_VISUALS.contracts_overview!([ROW_CON_DRIVE], { mode: "firmados_recientes", limit: 1 });
    expect(v!.kpis![0].url).toContain("drive.google.com/file");
    expect(v!.kpis![0].actionLabel!.toLowerCase()).toContain("abrir contrato");
    expect(v!.warnings ?? []).toHaveLength(0);
  });

  it("limit=1 SIN archivo Drive → warning explícito + fallback etiquetado 'Ver ficha CRM' (nunca 'Abrir contrato')", () => {
    const v = TOOL_VISUALS.contracts_overview!([ROW_SIN_DRIVE], { mode: "firmados_recientes", limit: 1 });
    expect(v!.kpis![0].actionLabel!.toLowerCase()).not.toContain("abrir contrato");
    expect(v!.kpis![0].actionLabel!.toLowerCase()).toContain("ficha");
    expect(v!.warnings!.join(" ").toLowerCase()).toMatch(/sin archivo|no tiene archivo/);
  });
});

describe("dashboard contractual · calidad documental + charts múltiples + tabla acotada (FASE 4-6)", () => {
  const base = (i: number, extra: Record<string, unknown> = {}) => ({
    public_id: `C${i}`, razon_social: `Cliente ${i} SA`, tipo: i % 3 === 0 ? "Cargas Generales" : "ANMAT",
    estado: "Vigente", fecha_firma: "2026-01-10", fecha_fin: "2027-06-30",
    dias_para_vencer: 100 + i, detalle: "x", ...extra,
  });
  const MIX = [
    base(1, { file_url: "https://drive.google.com/file/d/f1/view" }),
    base(2, { folder_url: "https://drive.google.com/drive/folders/k2" }),
    base(3),
    base(4),
  ];

  it("KPIs de calidad documental: con archivo Drive / sin vínculo — la brecha es VISIBLE", () => {
    const v = TOOL_VISUALS.contracts_overview!(MIX, { mode: "vigentes" });
    const drive = v!.kpis!.find((k) => k.label.toLowerCase().includes("drive"));
    expect(drive).toBeDefined();
    expect(drive!.value).toContain("1");
    const sinVinculo = v!.kpis!.find((k) => k.label.toLowerCase().includes("sin vínculo"));
    expect(sinVinculo).toBeDefined();
    expect(sinVinculo!.value).toContain("2");
    expect(sinVinculo!.tone).toBe("danger");
    expect(v!.warnings!.join(" ").toLowerCase()).toMatch(/sin (archivo|vínculo)/);
  });

  it("charts múltiples: donut por tipo + barras por estado + donut de disponibilidad documental", () => {
    const v = TOOL_VISUALS.contracts_overview!(MIX, { mode: "vigentes" });
    expect(v!.chart!.type).toBe("donut"); // por tipo (compat)
    expect(v!.charts!.length).toBeGreaterThanOrEqual(2);
    const estados = v!.charts!.find((c) => (c.title ?? "").toLowerCase().includes("estado"));
    expect(estados!.type).toBe("bar");
    const docs = v!.charts!.find((c) => (c.title ?? "").toLowerCase().includes("document"));
    expect(docs!.labels.join(" ").toLowerCase()).toContain("sin vínculo");
    expect(docs!.values).toEqual([1, 1, 2]); // archivo / carpeta / sin vínculo
  });

  it("columna 'Documento' con badge honesto por fila (Drive / Carpeta / Sin PDF)", () => {
    const v = TOOL_VISUALS.contracts_overview!(MIX, { mode: "vigentes" });
    expect(v!.table!.columns).toContain("Documento");
    const flat = v!.table!.rows.map((r) => r.join(" ")).join(" | ").toLowerCase();
    expect(flat).toContain("sin pdf");
  });

  it("tabla acotada: con 14 filas muestra las 12 más críticas + aviso del resto (no sábana)", () => {
    const muchos = Array.from({ length: 14 }, (_, i) => base(i + 1));
    const v = TOOL_VISUALS.contracts_overview!(muchos, { mode: "vigentes" });
    expect(v!.table!.rows.length).toBeLessThanOrEqual(12);
    expect(v!.kpis![0].value).toContain("14"); // el KPI dice el total listado
    expect((v!.insights ?? []).concat(v!.warnings ?? []).join(" ")).toMatch(/12|resto|más/);
  });

  it("cap de la tool visible: si las filas llegan al límite, el dashboard avisa que la cartera sigue en el módulo", () => {
    const tope = Array.from({ length: 50 }, (_, i) => base(i + 1));
    const v = TOOL_VISUALS.contracts_overview!(tope, { mode: "vigentes", limit: 50 });
    expect(v!.warnings!.join(" ").toLowerCase()).toMatch(/cartera completa|módulo/);
  });
});

describe("visuals · sin adaptador = sin tablero (respuestas simples quedan compactas)", () => {
  it("organization_overview y nexus_sections_overview NO tienen adaptador", () => {
    expect(TOOL_VISUALS.organization_overview).toBeUndefined();
    expect(TOOL_VISUALS.nexus_sections_overview).toBeUndefined();
  });
});
