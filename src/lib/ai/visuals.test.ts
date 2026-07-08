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
    expect(conUrl!.kpis![0].actionLabel!.toLowerCase()).toContain("drive");
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

// ── Copiloto de gestión (paradigma 2026-07-07): tablero ejecutivo del brief ──

describe("visual · management_brief → dashboard ejecutivo multi-dominio", () => {
  const BRIEF_ROWS = [
    {
      kind: "seccion", seccion: "facturacion", titulo: "Facturación", estado: "ok",
      valor: "ARS 12,500,000.00", hint: "último mes cerrado · 9 facturas", pct: null,
      url: "/billing", detalle: "Facturación último mes ARS 12,500,000.00 · líder ANMAT 80%",
      chart_labels: ["ANMAT", "Cargas Generales", "Sin clasificar"],
      chart_values: [10000000, 1500000, 1000000],
    },
    {
      kind: "seccion", seccion: "tesoreria", titulo: "Tesorería", estado: "ok",
      valor: "ARS 57,000,000.00", hint: "2 cuentas", url: "/tesoreria/bancos",
      detalle: "Saldo total bancos ARS 57,000,000.00",
    },
    {
      kind: "seccion", seccion: "contratos", titulo: "Contratos", estado: "critico",
      valor: "2 por vencer", hint: "1 con ≤30 días", url: "/comercial/contratos",
      detalle: "2 contratos por vencer en 90 días",
    },
    {
      kind: "seccion", seccion: "vacancia", titulo: "Vacancia", estado: "atencion",
      valor: "37%", pct: 37, url: "/comercial/dashboard-vacancia",
      detalle: "Vacancia corporativa 37% · 3700 m² disponibles",
      chart_labels: ["ANMAT", "Cargas Generales"], chart_values: [1200, 2100],
    },
    {
      kind: "riesgo", area: "Contratos", titulo: "Contrato Logística Ejemplo SA vence en 12 días",
      impacto: "alto", urgencia: "alta", evidencia: "vence 2026-07-19",
      accion: "Iniciar renovación esta semana", url: "/comercial/contratos",
      detalle: "Riesgo alto/alta · contrato vence en 12 días",
    },
    {
      kind: "riesgo", area: "Operación", titulo: "1 workflow trabado hace 4 días",
      impacto: "medio", urgencia: "media", evidencia: "Alta de habilitación · paso 2",
      accion: "Destrabar el paso 2", url: "/connect/tareas",
      detalle: "Riesgo medio/media · workflow trabado",
    },
    {
      kind: "oportunidad", titulo: "3.700 m² disponibles para comercializar",
      evidencia: "vacancia corporativa 37%", accion: "Priorizar comercialización de Cargas Generales",
      url: "/comercial/dashboard-vacancia", detalle: "Oportunidad: 3700 m² disponibles",
    },
    {
      kind: "brecha", titulo: "Caja chica sin fuente conectada",
      detalle: "Brecha de cobertura: no encontré una fuente conectada para caja chica.",
    },
  ];

  it("kind report con KPIs por sección (tono semántico), tabla de riesgos y charts", () => {
    const v = TOOL_VISUALS.management_brief!(BRIEF_ROWS, {});
    expect(v).not.toBeNull();
    expect(v!.kind).toBe("report");
    expect(v!.title.toLowerCase()).toContain("ejecutivo");
    // KPI por sección, con tono derivado del estado (critico → danger).
    expect(v!.kpis!.length).toBeGreaterThanOrEqual(4);
    const contratosKpi = v!.kpis!.find((k) => k.label.includes("Contratos"));
    expect(contratosKpi?.tone).toBe("danger");
    expect(contratosKpi?.url).toBe("/comercial/contratos");
    // Tabla = top riesgos con acción recomendada y fuente por fila.
    expect(v!.table!.columns.join(" ")).toMatch(/Riesgo/);
    expect(v!.table!.columns.join(" ")).toMatch(/Acción|Accion/);
    expect(v!.table!.rows.length).toBe(2);
    expect(v!.table!.rowLinks?.[0]?.url).toBe("/comercial/contratos");
    // Charts desde los datos de sección (donut ingresos + barras m²).
    const charts = [...(v!.chart ? [v!.chart] : []), ...(v!.charts ?? [])];
    expect(charts.length).toBeGreaterThanOrEqual(2);
    expect(charts.some((c) => c.type === "donut")).toBe(true);
  });

  it("insights = oportunidades y recomendaciones accionables; warnings = brechas", () => {
    const v = TOOL_VISUALS.management_brief!(BRIEF_ROWS, {});
    const insights = (v!.insights ?? []).join(" ").toLowerCase();
    expect(insights).toContain("oportunidad");
    expect(insights).toMatch(/recomendaci/);
    expect(insights).toContain("renovación esta semana".toLowerCase());
    expect(v!.warnings!.join(" ").toLowerCase()).toContain("caja chica");
  });

  it("focus=riesgos → el tablero prioriza riesgos en el título", () => {
    const v = TOOL_VISUALS.management_brief!(BRIEF_ROWS, { focus: "riesgos" });
    expect(v!.title.toLowerCase()).toContain("riesgos");
  });

  it("sin filas → null (no se maquilla un vacío con dashboard)", () => {
    expect(TOOL_VISUALS.management_brief!([], {})).toBeNull();
  });
});

// ── Slice B (aceptación 2026-07-07): comparaciones + visuales de operación ──

describe("visual · billing_summary multi-mes → delta m/m (comparación)", () => {
  const MESES = [
    { periodo: "2026-06", total: "12500000.00", cantidad: 9, desde: "2026-06-01", hasta: "2026-06-30", detalle: "x" },
    { periodo: "2026-05", total: "9800000.00", cantidad: 7, desde: "2026-05-01", hasta: "2026-05-31", detalle: "x" },
  ];
  it("dos meses → KPIs de variación absoluta y porcentual con tono semántico", () => {
    const v = TOOL_VISUALS.billing_summary!(MESES, { mode: "ultimos_meses", meses: 2 });
    expect(v!.kind).toBe("report");
    const labels = v!.kpis!.map((k) => k.label.toLowerCase()).join(" | ");
    expect(labels).toContain("2026-06");
    expect(labels).toContain("2026-05");
    expect(labels).toMatch(/variaci/);
    // Variación: +2,700,000.00 = +27.6% (los números salen calculados, no narrados).
    const flat = v!.kpis!.map((k) => `${k.label} ${k.value}`).join(" | ");
    expect(flat).toContain("2,700,000.00");
    expect(flat).toContain("27.6");
    // Suba → tono ok en la card de variación.
    const varKpi = v!.kpis!.find((k) => /variaci/i.test(k.label));
    expect(varKpi?.tone).toBe("ok");
    expect(v!.insights!.join(" ")).toMatch(/subi|aument/i);
  });
  it("caída de facturación → tono danger e insight de baja", () => {
    const v = TOOL_VISUALS.billing_summary!(
      [MESES[1], { ...MESES[0], periodo: "2026-04", total: "15000000.00" }],
      { mode: "ultimos_meses", meses: 2 }
    );
    const varKpi = v!.kpis!.find((k) => /variaci/i.test(k.label));
    expect(varKpi?.tone).toBe("danger");
    expect(v!.insights!.join(" ")).toMatch(/baj|cay/i);
  });
  it("un solo mes con datos → sin delta y advertencia honesta (no se inventa el anterior)", () => {
    const v = TOOL_VISUALS.billing_summary!([MESES[0]], { mode: "ultimos_meses", meses: 2 });
    expect(v!.warnings!.join(" ").toLowerCase()).toMatch(/mes anterior|para comparar/);
  });
});

describe("visual · spend_comparison_report → tabla comparativa con deltas", () => {
  const GVC = [
    { kind: "comparacion", proveedor: "Mobiliarios Demo SA", gasto: 3400000, compromiso: 580000000, diferencia: 576600000, detalle: "x" },
    { kind: "comparacion", proveedor: "Insumos Demo SA", gasto: 1670000, compromiso: 1670000, diferencia: 0, detalle: "x" },
  ];
  it("gasto_vs_compromiso → columnas Gasto/Compromiso/Diferencia y KPI principal", () => {
    const v = TOOL_VISUALS.spend_comparison_report!(GVC, { mode: "gasto_vs_compromiso" });
    expect(v!.kind).toBe("report");
    const cols = v!.table!.columns.join(" ");
    expect(cols).toMatch(/Gasto/);
    expect(cols).toMatch(/Compromiso/);
    expect(cols).toMatch(/Diferencia|Pendiente/);
    expect(v!.kpis!.length).toBeGreaterThanOrEqual(2);
  });
  const MM = [
    { kind: "comparacion", proveedor: "Mobiliarios Demo SA", actual: 1900000, anterior: 1200000, variacion: 700000, variacion_pct: 58.3, estado: "suba", detalle: "x" },
    { kind: "comparacion", proveedor: "Logística Ejemplo SA", actual: 450000, anterior: 0, variacion: 450000, variacion_pct: null, estado: "nuevo", detalle: "x" },
    { kind: "comparacion", proveedor: "Insumos Demo SA", actual: 640000, anterior: 800000, variacion: -160000, variacion_pct: -20, estado: "baja", detalle: "x" },
  ];
  it("periodo_anterior → variaciones con signo, estado (suba/nuevo/baja) e insight de top suba", () => {
    const v = TOOL_VISUALS.spend_comparison_report!(MM, { mode: "periodo_anterior" });
    const flat = v!.table!.rows.map((r) => r.join(" ")).join(" | ");
    expect(flat).toMatch(/nuevo/i);
    expect(v!.insights!.join(" ")).toContain("Mobiliarios Demo SA");
  });
  it("sin filas → null", () => {
    expect(TOOL_VISUALS.spend_comparison_report!([], { mode: "gasto_vs_compromiso" })).toBeNull();
  });
});

describe("visual · adaptadores de operación (Slice B: datos sin sábana)", () => {
  it("workflows_stuck → KPI + tabla con días sin actividad y semáforo", () => {
    const v = TOOL_VISUALS.workflows_stuck!(
      [{ workflow: "Alta de habilitación", current_step: 2, step_titulo: "Presentación", task_public_id: "TSK-2026-0003", task_estado: "en_progreso", idle_days: 4, iniciado: "2026-06-25" }],
      {}
    );
    expect(v!.kpis![0].value).toBe("1");
    expect(v!.table!.columns.join(" ")).toMatch(/Workflow/);
    expect(v!.table!.rows[0].join(" ")).toContain("4");
  });
  it("tasks_overview scope=vencidas → tabla priorizada con vencimiento", () => {
    const v = TOOL_VISUALS.tasks_overview!(
      [
        { public_id: "TSK-1", titulo: "A", estado: "pendiente", prioridad: "urgente", due_at: "2026-07-02", asignado: "Ruth" },
        { public_id: "TSK-2", titulo: "B", estado: "en_progreso", prioridad: "alta", due_at: "2026-07-05", asignado: "Cynthia" },
      ],
      { scope: "vencidas" }
    );
    expect(v!.title.toLowerCase()).toContain("vencidas");
    expect(v!.table!.columns.join(" ")).toMatch(/Prioridad/);
    expect(v!.table!.rows.length).toBe(2);
  });
  it("incidents_overview → KPIs por severidad (críticos en danger)", () => {
    const v = TOOL_VISUALS.incidents_overview!(
      [
        { public_id: "INC-1", titulo: "Corte", severidad: "critica", estado: "abierto", sector: "Cámara 3", asignado: "X" },
        { public_id: "INC-2", titulo: "Stock", severidad: "media", estado: "en_progreso", sector: "PL", asignado: "Y" },
      ],
      {}
    );
    const crit = v!.kpis!.find((k) => /crític|critic/i.test(k.label));
    expect(crit?.value).toBe("1");
    expect(crit?.tone).toBe("danger");
    expect(v!.table!.rows.length).toBe(2);
  });
  it("purchase_orders_overview → tabla de OC con monto total listado", () => {
    const v = TOOL_VISUALS.purchase_orders_overview!(
      [{ public_id: "OC-2026-0371", proveedor: "Insumos Demo SA", total: "89000.00", fecha: "2026-07-06", estado: "firmada", detalle: "x" }],
      {}
    );
    expect(v!.table!.columns.join(" ")).toMatch(/OC|Orden/);
    expect(v!.kpis!.some((k) => k.value.includes("89,000.00"))).toBe(true);
  });
  it("supplier_invoices_overview → tabla con estado de aprobación", () => {
    const v = TOOL_VISUALS.supplier_invoices_overview!(
      [{ public_id: "FACTURA_A 00345", proveedor: "Insumos Demo SA", total: "12100.00", fecha: "2026-06-28", estado: "pendiente", detalle: "x" }],
      { mode: "pendientes_aprobacion" }
    );
    expect(v!.table!.rows.length).toBe(1);
    expect(v!.kpis![0].tone).toBe("warn");
  });
  it("ops_digest → timeline en tabla (evento/detalle/actor)", () => {
    const v = TOOL_VISUALS.ops_digest!(
      [{ event_type: "task.completed", entity_type: "connect_task", entity_id: "t", summary: "Se completó la recepción", actor_label: "Depósito", occurred_at: "2026-07-03T11:00:00Z" }],
      { hours: 24 }
    );
    expect(v!.table!.columns.join(" ")).toMatch(/Evento/);
    expect(v!.table!.rows[0].join(" ")).toContain("recepción");
  });
});

describe("visual · focoTop (singular con peso sobre el total listado)", () => {
  const ROWS = [
    { cliente: "Cliente Demo SA", total: "85000000.00", cantidad: 12, periodo: "todo", detalle: "x" },
    { cliente: "Distribuidora Ficticia SRL", total: "41000000.00", cantidad: 6, periodo: "todo", detalle: "x" },
    { cliente: "Otro SA", total: "14000000.00", cantidad: 2, periodo: "todo", detalle: "x" },
  ];
  it("focoTop=true → entidad principal PRIMERO + % del top listado con calificador honesto", () => {
    const v = TOOL_VISUALS.customer_revenue_overview!(ROWS, { focoTop: true, limit: 10 });
    expect(v!.kind).toBe("kpi");
    expect(v!.kpis![0].value).toContain("Cliente Demo SA");
    const pct = v!.kpis!.find((k) => k.value.includes("%"));
    expect(pct, "KPI de participación").toBeTruthy();
    // Honestidad: el % es sobre el top listado, no sobre el total global.
    expect(`${pct!.label} ${pct!.hint ?? ""}`.toLowerCase()).toMatch(/listad/);
    expect(pct!.value).toContain("60.7"); // 85M / 140M
  });
  it("sin focoTop → comportamiento actual intacto (ranking con barras)", () => {
    const v = TOOL_VISUALS.customer_revenue_overview!(ROWS, {});
    expect(v!.kind).toBe("ranking");
  });
});

// ── Post-review adversarial (Slice B): honestidad de comparaciones ───────────

describe("visual · billing m/m: mes EN CURSO parcial y meses no adyacentes (review)", () => {
  it("último mes = mes calendario EN CURSO → se declara '(en curso, parcial)' y warning", () => {
    const hoy = new Date();
    const mesActual = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, "0")}`;
    const v = TOOL_VISUALS.billing_summary!(
      [
        { periodo: mesActual, total: "1000000.00", cantidad: 1, detalle: "x" },
        { periodo: "2026-06", total: "12500000.00", cantidad: 9, detalle: "x" },
      ],
      { mode: "ultimos_meses", meses: 2 }
    );
    const flat = v!.kpis!.map((k) => `${k.label}`).join(" | ").toLowerCase();
    expect(flat).toMatch(/parcial|en curso/);
    expect(v!.warnings!.join(" ").toLowerCase()).toMatch(/parcial|en curso/);
    // La variación parcial-vs-completo NO puede presentarse como caída real.
    expect(v!.insights!.join(" ").toLowerCase()).toMatch(/parcial|en curso/);
  });
  it("meses NO adyacentes (hueco sin datos) → se declara, no se vende como 'mes anterior'", () => {
    const v = TOOL_VISUALS.billing_summary!(
      [
        { periodo: "2026-06", total: "12500000.00", cantidad: 9, detalle: "x" },
        { periodo: "2026-04", total: "9800000.00", cantidad: 7, detalle: "x" },
      ],
      { mode: "ultimos_meses", meses: 2 }
    );
    expect(
      `${v!.kpis!.map((k) => k.label).join(" ")} ${v!.warnings!.join(" ")}`.toLowerCase()
    ).toMatch(/con datos|hueco|sin datos entre/);
  });
});

describe("visual · spend_comparison: superlativos honestos (review)", () => {
  it("gasto_vs_compromiso: el insight señala el MAYOR pendiente real, no el mayor volumen", () => {
    const v = TOOL_VISUALS.spend_comparison_report!(
      [
        { kind: "comparacion", proveedor: "A Volumen SA", gasto: 10000000, compromiso: 10000000, diferencia: 0, pct_ejecutado: 100, detalle: "x" },
        { kind: "comparacion", proveedor: "B Pendiente SA", gasto: 0, compromiso: 8000000, diferencia: 8000000, pct_ejecutado: 0, detalle: "x" },
      ],
      { mode: "gasto_vs_compromiso" }
    );
    expect(v!.insights!.join(" ")).toContain("B Pendiente SA");
    expect(v!.insights!.join(" ")).not.toContain("A Volumen SA");
  });
  it("gasto_vs_compromiso: sin pendientes positivos → no se inventa un 'mayor pendiente'", () => {
    const v = TOOL_VISUALS.spend_comparison_report!(
      [{ kind: "comparacion", proveedor: "A SA", gasto: 500000, compromiso: 0, diferencia: -500000, pct_ejecutado: null, detalle: "x" }],
      { mode: "gasto_vs_compromiso" }
    );
    expect((v!.insights ?? []).join(" ").toLowerCase()).not.toMatch(/mayor pendiente de ejecuci/);
  });
  it("periodo_anterior: si TODO cayó, el KPI no dice 'Mayor suba' — dice caída", () => {
    const v = TOOL_VISUALS.spend_comparison_report!(
      [
        { kind: "comparacion", proveedor: "Insumos SA", actual: 640000, anterior: 800000, variacion: -160000, variacion_pct: -20, estado: "baja", detalle: "x" },
        { kind: "comparacion", proveedor: "Otro SA", actual: 0, anterior: 450000, variacion: -450000, variacion_pct: -100, estado: "sin_gasto", detalle: "x" },
      ],
      { mode: "periodo_anterior" }
    );
    const kpi0 = v!.kpis![0];
    expect(kpi0.label.toLowerCase()).not.toContain("mayor suba");
    expect(v!.insights!.join(" ").toLowerCase()).not.toMatch(/lidera las subas/);
    expect(v!.insights!.join(" ").toLowerCase()).toMatch(/cay|baja|no hubo subas/);
  });
});
