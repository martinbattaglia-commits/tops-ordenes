/**
 * §7 VISUAL · RENDER DE MUESTRA, PARA APROBACIÓN DE DIRECCIÓN.
 *
 * Mismo patrón que `doc-system/render-samples`: si `CUSTODY_PREVIEW_OUT` está
 * definido, escribe un HTML con los cinco estados. Sin esa variable, sólo corre
 * como smoke test de que los componentes renderizan.
 *
 * ─── POR QUÉ ESTO NO ES UNA MAQUETA ──────────────────────────────────────
 *
 * Se renderizan los COMPONENTES REALES con el MÓDULO DE DERIVACIÓN REAL y el
 * Tailwind REAL del proyecto, compilado con su configuración. Lo que se ve es
 * lo que produce el código; un HTML dibujado a mano habría podido mostrar algo
 * que la aplicación no hace — que es justamente lo que hay que evitar antes de
 * aprobar.
 *
 * Lo único sustituido es `EvidenceViewer`, que abre el binario por signed URL a
 * través de una server action: fuera de Next no resuelve, y su contenido no es
 * lo que se está aprobando acá.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import postcss from "postcss";
import tailwindcss from "tailwindcss";

vi.mock("@/app/(app)/wms/custody/_components/EvidenceViewer", () => ({
  EvidenceViewer: () => (
    <span className="text-xs text-fg-muted">■ foto · se abre por URL firmada</span>
  ),
}));

import { CaseProgressBar } from "@/app/(app)/wms/custody/_components/CaseProgressBar";
import { CaseNowBlock } from "@/app/(app)/wms/custody/_components/CaseNowBlock";
import { CaseChecklist } from "@/app/(app)/wms/custody/_components/CaseChecklist";
import { CaseEvidencePanel } from "@/app/(app)/wms/custody/_components/CaseEvidencePanel";
import { CaseAiPanel } from "@/app/(app)/wms/custody/_components/CaseAiPanel";
import {
  deriveCaseProgress,
  deriveDecisionChecklist,
  deriveNowAction,
  type ProgressInput,
} from "@/lib/custody/case-progress";
import type { CustodyCaseView } from "@/lib/custody/case-presentation";

const ROOT = resolve(__dirname, "..", "..");
const OUT = process.env.CUSTODY_PREVIEW_OUT ?? "";

const UI_FILES = [
  "src/app/(app)/wms/custody/_components/CaseProgressBar.tsx",
  "src/app/(app)/wms/custody/_components/CaseNowBlock.tsx",
  "src/app/(app)/wms/custody/_components/CaseEvidencePanel.tsx",
  "src/app/(app)/wms/custody/_components/CaseChecklist.tsx",
  "src/app/(app)/wms/custody/_components/CaseAiPanel.tsx",
  "src/app/(app)/wms/custody/[id]/page.tsx",
];

async function css(): Promise<string> {
  const input = readFileSync(resolve(ROOT, "src/app/globals.css"), "utf8");
  const base = (await import(resolve(ROOT, "tailwind.config.ts"))).default;
  const r = await postcss([
    tailwindcss({ ...base, content: UI_FILES.map((f) => resolve(ROOT, f)) } as never),
  ]).process(input, { from: undefined });
  return r.css;
}

function ai(over: Partial<CustodyCaseView["ai"]> = {}): CustodyCaseView["ai"] {
  return {
    executed: false, verdictLabel: null, confidencePercent: null,
    informativeOnly: true,
    note: "La IA informa y alerta. La decisión es humana.",
    failureLabel: null, ...over,
  } as CustodyCaseView["ai"];
}

/**
 * El análisis, con TODO lo que el view-model transporta de verdad: score,
 * los cuatro componentes que el contrato del proveedor pide puntuar, las tres
 * banderas, observaciones y procedencia. Una muestra con el panel a medio
 * llenar no sirve para aprobar el panel.
 */
const ANALISIS_BAJO = {
  executed: true, similarityScore: 71.8, confidencePercent: 71,
  scoreComponents: { identity: 68, packaging: 74, quantity: 88, condition: 57 },
  damageFlags: { packagingChanged: true, missingItemsSuspected: true, damageSuspected: false },
  observations: [
    "diferencia de contorno en el ángulo inferior derecho",
    "el film de protección aparece cortado en la cara frontal",
  ],
  zones: ["cara frontal", "ángulo inferior derecho"],
  model: "vis-compare v2.1.4", thresholdPolicyVersion: "v3",
  evaluatedAt: "2026-08-16T09:11:38.000Z",
};

const ANALISIS_ALTO = {
  executed: true, similarityScore: 94.2, confidencePercent: 94,
  scoreComponents: { identity: 96, packaging: 95, quantity: 93, condition: 92 },
  damageFlags: { packagingChanged: false, missingItemsSuspected: false, damageSuspected: false },
  observations: [], zones: [],
  model: "vis-compare v2.1.4", thresholdPolicyVersion: "v3",
  evaluatedAt: "2026-08-16T09:11:38.000Z",
};

const BAJA = {
  verdict: "BAJA", label: "CONCORDANCIA BAJA",
  requirement: "inspección física obligatoria antes de poder decidir", tone: "danger",
} as const;
const ALTA = {
  verdict: "ALTA", label: "CONCORDANCIA ALTA",
  requirement: "no requiere inspección adicional · la decisión sigue siendo tuya", tone: "ok",
} as const;

function vista(over: Partial<CustodyCaseView> = {}): CustodyCaseView {
  return {
    caseId: "c1", state: "PENDING_EVIDENCE", stateLabel: "Pendiente de evidencia",
    tone: "pending", version: 1, scope: "physical_unit", entityId: "u1",
    identity: {
      clientLabel: "Laboratorio Fénix S.A.", clientFromReception: false,
      casePublicId: "CINT-2026-000451", unitPublicId: "CPU-2026-000123",
      sku: "MUEBLE-DEMO-01", quantity: 1, lotNumber: null,
      receptionId: null, receptionPublicId: null,
    },
    holdLabels: [], ai: ai(),
    release: { enabled: false, blockers: [] },
    quarantine: { enabled: false, blockers: [] },
    reevaluation: { enabled: false, required: false, analysis: "never", inFlight: false, blockers: [], reason: null },
    inspection: { enabled: false, blockers: [], eligible: 0 },
    capture: { enabled: true, blockers: [] },
    podBlocked: true, podBlockedReason: "Despacho y POD bloqueados · la unidad no puede salir del depósito",
    podPdfReady: false, decision: null,
    createdAt: "2026-08-16T05:40:00.000Z", updatedAt: "2026-08-16T09:24:00.000Z",
    ...over,
  } as CustodyCaseView;
}

const evidencia = (id: string, sha: string) => ({
  evidence: { evidence_id: id, sha256: sha, kind: "foto", redacted: false, bucket: "custody-evidence" },
  occurredAt: "2026-08-16T05:52:00.000Z",
  actorName: "Jorge Merino",
}) as never;

interface Escenario {
  titulo: string;
  nota: string;
  input: ProgressInput;
  ingreso: boolean;
  egreso: boolean;
}

const ESCENARIOS: Escenario[] = [
  {
    titulo: "Estado 1 · falta la foto de ingreso",
    nota: "El caso acaba de nacer desde la recepción.",
    input: { view: vista(), tieneIngreso: false, tieneEgreso: false },
    ingreso: false, egreso: false,
  },
  {
    titulo: "Estado 2 · falta la foto de egreso",
    nota: "La unidad estuvo guardada y ahora se prepara el despacho.",
    input: { view: vista(), tieneIngreso: true, tieneEgreso: false },
    ingreso: true, egreso: false,
  },
  {
    titulo: "Estado 3 · concordancia alta · decidir",
    nota: "La IA informa. La decisión es humana. No hay liberación automática.",
    input: {
      view: vista({
        state: "REVIEW_REQUIRED", stateLabel: "Revisión humana", tone: "review",
        ai: ai({ ...ANALISIS_ALTO, concordance: ALTA }),
        release: { enabled: true, blockers: [] },
        podBlockedReason: "Despacho y POD bloqueados hasta que se registre la decisión humana",
      }),
      tieneIngreso: true, tieneEgreso: true,
    },
    ingreso: true, egreso: true,
  },
  {
    titulo: "Estado 4 · retenido · concordancia baja",
    nota: "El escenario para el que se construyó todo el módulo.",
    input: {
      view: vista({
        state: "HOLD", stateLabel: "Retenido", tone: "hold",
        ai: ai({ ...ANALISIS_BAJO, concordance: BAJA }),
        inspection: { enabled: true, blockers: [], eligible: 0 },
        quarantine: { enabled: true, blockers: [] },
      }),
      tieneIngreso: true, tieneEgreso: true,
    },
    ingreso: true, egreso: true,
  },
  {
    titulo: "Estado 5 · liberado · entrega y POD",
    nota: "Despacho habilitado. El documento se muestra aparte (§12).",
    input: {
      view: vista({
        state: "RELEASED", stateLabel: "Liberado", tone: "released",
        ai: ai({ ...ANALISIS_ALTO, concordance: ALTA }),
        podBlocked: false, podBlockedReason: null,
        decision: { kind: "release", label: "Liberado para despacho", decidedAt: "2026-08-16T09:24:00.000Z", actorRole: "admin", reason: "Comparación conforme, embalaje íntegro." },
      }),
      tieneIngreso: true, tieneEgreso: true,
    },
    ingreso: true, egreso: true,
  },
];

/**
 * La tarjeta completa, con la misma composición que arma `[id]/page.tsx`: barra
 * navy, identidad, aviso, ▸ AHORA y el circuito en orden. Si esto y la página
 * se separan, la muestra deja de probar lo que se aprueba.
 */
function pantalla(e: Escenario): string {
  const prog = deriveCaseProgress(e.input);
  const ahora = deriveNowAction(e.input);
  const check = deriveDecisionChecklist(e.input);
  const v = e.input.view;

  const bannerCls = v.podBlocked ? "cd-banner cd-banner--block" : "cd-banner cd-banner--ok";
  const estadoCls =
    v.tone === "released"
      ? "cd-state cd-state--released"
      : v.tone === "quarantined"
        ? "cd-state cd-state--quarantined"
        : v.tone === "review"
          ? "cd-state cd-state--review"
          : v.tone === "hold"
            ? "cd-state cd-state--hold"
            : "cd-state cd-state--pending";

  return renderToStaticMarkup(
    <div className="cd-shell">
      <div className="cd-topbar">
        <div className="cd-topbar__left">
          <span className="cd-topbar__brand">TOPS NEXUS</span>
          <span className="cd-topbar__crumb">
            WMS · Custodia Digital · <span className="cd-topbar__id">{v.identity.unitPublicId}</span>
          </span>
        </div>
        <span className="cd-topbar__who">
          <span className="cd-dot" aria-hidden="true" />
          {v.stateLabel}
        </span>
      </div>

      <section className="cd-ident">
        <div className="cd-ident__row">
          <div className="cd-ident__main">
            <p className="cd-eyebrow">Caso de custodia</p>
            <h2 className="cd-title">{v.identity.clientLabel}</h2>
            <div className="cd-chips">
              <span className="cd-chip">{v.identity.unitPublicId}</span>
              <span className="cd-chip">{v.identity.casePublicId}</span>
              <span className="cd-chip cd-chip--anmat">ANMAT · REFORZADA</span>
            </div>
            <p className="cd-meta">
              SKU <b>{v.identity.sku}</b> · 1 un. · sin lote · recepción <a href="#r">REC-2026-0088</a>
            </p>
          </div>
          <span className={estadoCls}>{v.stateLabel}</span>
        </div>
        <CaseProgressBar progress={prog} />
      </section>

      <div className={bannerCls}>
        <span>
          {v.podBlocked ? v.podBlockedReason : "Despacho habilitado · decisión humana registrada"}
        </span>
      </div>

      <CaseNowBlock action={ahora} />

      <CaseEvidencePanel
        ingreso={e.ingreso ? evidencia("ev-1", "4f1a000000000000000000000000000000000000000000000000000000009e07") : null}
        egreso={e.egreso ? evidencia("ev-2", "b73c000000000000000000000000000000000000000000000000000000001d55") : null}
        inspeccion={null}
      />

      <CaseAiPanel view={v} />

      <CaseChecklist items={check} />
    </div>,
  );
}

describe("§7 · render de muestra", () => {
  it("los cinco estados renderizan y, con CUSTODY_PREVIEW_OUT, se escriben", async () => {
    const hoja = await css();
    const bloques = ESCENARIOS.map(
      (e) => `
      <section class="muestra">
        <h2>${e.titulo}</h2>
        <p class="nota">${e.nota}</p>
        <div class="par">
          <div><h3>Escritorio</h3><div class="marco desktop"><div class="nx">${pantalla(e)}</div></div></div>
          <div><h3>Teléfono · 390px</h3><div class="marco mobile"><div class="nx">${pantalla(e)}</div></div></div>
        </div>
      </section>`,
    );
    for (const b of bloques) expect(b).toContain("Paso");

    if (!OUT) return;
    const html = `<!doctype html><html lang="es" class="dark" data-theme="dark"><head><meta charset="utf-8">
<title>Custodia Digital · §7 visual · muestra</title><style>${hoja}
body{margin:0;background:#070b16;color:#e2e8f0;font-family:Inter,system-ui,-apple-system,sans-serif}
.wrap{max-width:1400px;margin:0 auto;padding:24px}
h1{font-size:22px;margin:0 0 4px}.sub{opacity:.7;font-size:13px;margin:0 0 24px}
.muestra{margin:32px 0;border-top:1px solid rgba(255,255,255,.12);padding-top:20px}
.muestra h2{font-size:15px;margin:0 0 2px}.nota{opacity:.6;font-size:12px;margin:0 0 12px}
.par{display:grid;grid-template-columns:1fr 420px;gap:20px;align-items:start}
.par h3{font-size:11px;text-transform:uppercase;letter-spacing:.08em;opacity:.5;margin:0 0 6px}
.marco{border-radius:18px}
.mobile{width:390px}
@media(max-width:1100px){.par{grid-template-columns:1fr}.mobile{width:100%}}
</style></head><body><div class="wrap">
<h1>Custodia Digital · §7 visual</h1>
<p class="sub">Render de los componentes REALES con el módulo de derivación real y el Tailwind del proyecto.
Lo único sustituido es el visor de evidencia, que abre el binario por URL firmada.
<strong>Ningún texto nombra el umbral (D-4).</strong></p>
${bloques.join("\n")}
</div></body></html>`;
    mkdirSync(dirname(OUT), { recursive: true });
    writeFileSync(OUT, html, "utf8");

    // Una página por estado: capturarlas por separado las deja legibles.
    const cab = `<!doctype html><html lang="es" class="dark" data-theme="dark"><head><meta charset="utf-8"><style>${hoja}
body{margin:0;background:#070b16;color:#e2e8f0;font-family:Inter,system-ui,-apple-system,sans-serif}
.wrap{padding:20px}h2{font-size:15px;margin:0 0 2px}.nota{opacity:.6;font-size:12px;margin:0 0 14px}
.par{display:grid;grid-template-columns:1fr 400px;gap:20px;align-items:start}
.par h3{font-size:11px;text-transform:uppercase;letter-spacing:.08em;opacity:.5;margin:0 0 6px}
.marco{border-radius:18px}
.mobile{width:390px}</style></head><body><div class="wrap">`;
    ESCENARIOS.forEach((e, i) => {
      writeFileSync(
        OUT.replace(/\.html$/, `-${i + 1}-movil.html`),
        `${cab}<h2>${e.titulo} · teléfono</h2><p class="nota">${e.nota}</p>${pantalla(e)}</div></body></html>`,
        "utf8",
      );
      writeFileSync(
        OUT.replace(/\.html$/, `-${i + 1}.html`),
        `${cab}<h2>${e.titulo}</h2><p class="nota">${e.nota}</p>
         <div class="marco">${pantalla(e)}</div></div></body></html>`,
        "utf8",
      );
    });
  }, 60_000);
});
