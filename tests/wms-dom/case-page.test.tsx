/**
 * WMS UI/E2E · DOM REAL de la pantalla `/wms/custody/[id]` completa.
 *
 * La página es un Server Component asíncrono: se ejecuta, se obtiene el árbol y
 * se monta en jsdom. Se afirma sobre el DOM resultante —textos, roles, enlaces,
 * ausencia de datos internos—, no sobre el archivo fuente.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { byText, render } from "./_render";
import type { CustodyCaseView } from "@/lib/custody/case-presentation";
import type { CustodyTimeline } from "@/lib/custody/types";

const CASE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SHIPMENT = "11111111-1111-4111-8111-111111111111";
const SHA = "b".repeat(64);

const loadMock = vi.fn();
vi.mock("@/app/(app)/wms/custody/actions", () => ({
  loadCustodyCaseAction: (...a: unknown[]) => loadMock(...a),
  registerHumanInspectionAction: vi.fn(async () => ({ ok: true, data: { evidence_id: "e", event_public_id: "p" } })),
  decideCustodyCaseAction: vi.fn(async () => ({ ok: true })),
  evidenceSignedUrlAction: vi.fn(async () => ({ ok: true, data: { url: "http://x" } })),
  redactEvidenceAction: vi.fn(async () => ({ ok: true })),
  podPdfSignedUrlAction: vi.fn(async () => ({ ok: true, data: { url: "http://x" } })),
  regeneratePodPdfAction: vi.fn(async () => ({ ok: true })),
}));

const timelineMock = vi.fn();
const tokenMock = vi.fn();
vi.mock("@/lib/custody/custody", () => ({
  getCustodyTimeline: (...a: unknown[]) => timelineMock(...a),
  getShipmentToken: (...a: unknown[]) => tokenMock(...a),
}));

vi.mock("@/lib/custody/qr", () => ({
  custodyQrDataUrl: async () => "data:image/png;base64,QRSINTETICO",
  custodyTokenUrl: (t: string) => `/c/${t}`,
}));

import CustodyCasePage from "@/app/(app)/wms/custody/[id]/page";

function view(over: Partial<CustodyCaseView> = {}): CustodyCaseView {
  return {
    caseId: CASE_ID,
    state: "REVIEW_REQUIRED",
    stateLabel: "Revisión humana",
    tone: "review",
    version: 3,
    scope: "shipment",
    entityId: SHIPMENT,
    // Regla de borrado (I3): la etiqueta ya no nombra el umbral. Decía «No hay
    // umbral calibrado aprobado» y se pintaba al operario bajo «Retenciones».
    holdLabels: ["El criterio automático no está configurado: revisión humana completa"],
    ai: {
      executed: true,
      verdictLabel: "Coincide con el ingreso",
      confidencePercent: 87,
      informativeOnly: true,
      note: "La IA informa y alerta. La decisión es humana.",
      failureLabel: null,
    },
    identity: {
      clientLabel: "Laboratorio Fénix S.A.",
      clientFromReception: false,
      casePublicId: "CINT-2026-000451",
      unitPublicId: "CPU-2026-000123",
      sku: "MUEBLE-DEMO-01",
      quantity: 1,
      lotNumber: null,
      receptionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      receptionPublicId: "REC-2026-0088",
    },
    release: { enabled: false, blockers: ["Falta la foto de inspección humana"] },
    quarantine: { enabled: true, blockers: [] },
    reevaluation: { analysis: "current", inFlight: false, enabled: true, required: false, blockers: [], reason: null },
    inspection: { enabled: true, blockers: [], eligible: 1 },
    podPdfReady: false,
    podBlocked: true,
    podBlockedReason: "POD y despacho bloqueados hasta registrar la decisión humana",
    decision: null,
    createdAt: "2026-08-08T10:15:00.000Z",
    updatedAt: "2026-08-10T09:42:00.000Z",
    ...over,
  };
}

const TIMELINE: CustodyTimeline = {
  scope: "shipment",
  entity_id: SHIPMENT,
  nodes: [
    {
      type: "event", event_id: "e1", public_id: "CUST-2026-0001", stage: "packing",
      event_type: "foto_packing", actor_id: null, occurred_at: "2026-08-08T10:15:00.000Z",
      geo: null, notes: "Recepción",
      evidences: [{ evidence_id: "ev-1", kind: "foto", bucket: "custody-evidence", sha256: SHA, redacted: false }],
    },
    {
      type: "event", event_id: "e2", public_id: "CUST-2026-0002", stage: "despacho",
      event_type: "cargado", actor_id: null, occurred_at: "2026-08-08T14:05:00.000Z",
      geo: null, notes: "Rack B-03-02", evidences: [],
    },
    {
      type: "event", event_id: "e3", public_id: "CUST-2026-0003", stage: "entrega",
      event_type: "foto_entrega", actor_id: null, occurred_at: "2026-08-10T09:42:00.000Z",
      geo: null, notes: "Egreso",
      evidences: [{ evidence_id: "ev-2", kind: "foto", bucket: "custody-evidence", sha256: SHA, redacted: false }],
    },
  ],
};

beforeEach(() => {
  loadMock.mockReset().mockResolvedValue({ ok: true, data: view() });
  timelineMock.mockReset().mockResolvedValue(TIMELINE);
  tokenMock.mockReset().mockResolvedValue("tok-sintetico");
});

async function renderPage() {
  const el = await CustodyCasePage({ params: { id: CASE_ID } });
  return render(el);
}

describe("la pantalla del caso se renderiza completa", () => {
  it("muestra las tres columnas del flujo: ingreso, custodia y egreso", async () => {
    const { container, unmount } = await renderPage();
    expect(byText(container, /^Ingreso · recepción$/)).not.toBeNull();
    expect(byText(container, /^Custodia · movimientos$/)).not.toBeNull();
    expect(byText(container, /^Preparación de egreso$/)).not.toBeNull();
    await unmount();
  });

  it("muestra el estado del caso con rol accesible", async () => {
    const { container, unmount } = await renderPage();
    const badge = container.querySelector('[role="status"]');
    expect(badge?.textContent).toBe("Revisión humana");
    expect(badge?.getAttribute("aria-label")).toMatch(/Estado del caso/);
    await unmount();
  });

  it("la foto de ingreso aparece con su confirmación de hash verificado", async () => {
    const { container, unmount } = await renderPage();
    expect(byText(container, /Foto vinculada · hash verificado/)).not.toBeNull();
    await unmount();
  });

  it("el QR y el botón de imprimir etiqueta están presentes", async () => {
    const { container, unmount } = await renderPage();
    const qr = container.querySelector('img[src^="data:image/png;base64,"]');
    expect(qr).not.toBeNull();
    const imprimir = [...container.querySelectorAll("button")].find((b) =>
      /Imprimir etiqueta/.test(b.textContent ?? ""),
    );
    expect(imprimir).toBeDefined();
    await unmount();
  });

  it("el timeline lista los movimientos, incluido el rack", async () => {
    const { container, unmount } = await renderPage();
    expect(byText(container, /Rack B-03-02/)).not.toBeNull();
    expect(byText(container, /Recepción/)).not.toBeNull();
    await unmount();
  });

  it("el egreso muestra la fotografía nueva obligatoria", async () => {
    const { container, unmount } = await renderPage();
    expect(byText(container, /Fotografía nueva obligatoria/)).not.toBeNull();
    await unmount();
  });

  it("sin foto de egreso lo dice explícitamente", async () => {
    timelineMock.mockResolvedValue({ ...TIMELINE, nodes: [TIMELINE.nodes[0]] });
    const { container, unmount } = await renderPage();
    // §7.5 · el texto ya no manda al operario a otro panel («registrala en
    // "Fotografías de la unidad"»): el slot de captura está en la pantalla.
    expect(byText(container, /Esperando la fotografía de egreso/)).not.toBeNull();
    await unmount();
  });
});

describe("panel de IA: informa, no decide", () => {
  it("muestra la confianza informada y la leyenda de revisión humana", async () => {
    const { container, unmount } = await renderPage();
    // El porcentaje convive con un <span> hermano, así que se afirma sobre el
    // texto renderizado del panel, no sobre un nodo hoja.
    expect(container.textContent).toMatch(/87\s*%/);
    expect(byText(container, /confianza informada/)).not.toBeNull();
    // §7.6 fija la leyenda exacta del panel: «La IA informa y alerta. La
    // decisión es humana.». Es el mismo mensaje, en las palabras normativas.
    expect(byText(container, /La IA informa y alerta\. La decisión es humana\./)).not.toBeNull();
    await unmount();
  });

  it("el panel de IA NO contiene ningún control accionable", async () => {
    const { container, unmount } = await renderPage();
    const panel = [...container.querySelectorAll("section")].find(
      (s) => s.getAttribute("aria-labelledby") === "ia-title",
    );
    expect(panel).toBeDefined();
    expect(panel!.querySelectorAll("button, a, input, select")).toHaveLength(0);
    await unmount();
  });

  it("sin umbral servido por el servidor, el 90% NO aparece en pantalla", async () => {
    const { container, unmount } = await renderPage();
    expect(container.textContent).not.toMatch(/90\s*%/);
    expect(byText(container, /Referencia operativa/)).toBeNull();
    await unmount();
  });

  // I3 · el bloque «Referencia operativa» SE BORRÓ. No es que el servidor no
  // lo pueble: no existe la superficie. Poblarlo habría impreso «Referencia
  // operativa 90 %», que es exactamente la cadena que la regla de borrado
  // manda eliminar.
  it("la superficie del umbral no existe ni siquiera con un análisis completo", async () => {
    const { container, unmount } = await renderPage();
    const texto = container.textContent ?? "";
    expect(texto).not.toMatch(/Referencia operativa/i);
    expect(texto).not.toMatch(/umbral/i);
    expect(texto).not.toMatch(/≥/);
    await unmount();
  });
});

describe("POD y decisión", () => {
  it("POD bloqueado antes de decidir, con su motivo", async () => {
    const { container, unmount } = await renderPage();
    expect(byText(container, /POD y despacho bloqueados hasta registrar la decisión humana/)).not.toBeNull();
    await unmount();
  });

  it("en cuarentena el POD sigue bloqueado", async () => {
    loadMock.mockResolvedValue({
      ok: true,
      data: view({
        state: "QUARANTINED", stateLabel: "En cuarentena", tone: "quarantined",
        podBlocked: true, podBlockedReason: "La unidad está en cuarentena: el POD no se emite",
        decision: { kind: "quarantine", label: "Enviado a cuarentena", decidedAt: "2026-08-10T12:00:00.000Z", actorRole: "operaciones", reason: "diferencias visibles" },
      }),
    });
    const { container, unmount } = await renderPage();
    expect(byText(container, /en cuarentena: el POD no se emite/)).not.toBeNull();
    expect(byText(container, /Enviado a cuarentena/)).not.toBeNull();
    await unmount();
  });

  it("liberado ⇒ el POD deja de estar bloqueado", async () => {
    loadMock.mockResolvedValue({
      ok: true,
      data: view({
        state: "RELEASED", stateLabel: "Liberado", tone: "released",
        podBlocked: false, podBlockedReason: null,
        decision: { kind: "release", label: "Liberado para despacho", decidedAt: "2026-08-10T12:00:00.000Z", actorRole: "admin", reason: "inspección conforme" },
      }),
    });
    const { container, unmount } = await renderPage();
    expect(byText(container, /bloqueados hasta registrar/)).toBeNull();
    expect(byText(container, /Liberado para despacho/)).not.toBeNull();
    await unmount();
  });
});

describe("seguridad visual y errores", () => {
  it("el DOM no expone bucket, digest, token, signed URL ni sesión", async () => {
    const { container, unmount } = await renderPage();
    const html = container.innerHTML;
    expect(html).not.toContain(SHA);
    expect(html).not.toContain("custody-evidence");
    expect(html).not.toMatch(/storage\/v1|token=|eyJ[A-Za-z0-9_-]{6,}\./);
    await unmount();
  });

  it("un error del servidor se muestra sanitizado y con role=alert", async () => {
    loadMock.mockResolvedValue({ ok: false, error: "El caso no existe o no es accesible" });
    const { container, unmount } = await renderPage();
    const alerta = container.querySelector('[role="alert"]');
    expect(alerta?.textContent).toBe("El caso no existe o no es accesible");
    expect(container.querySelector('a[href="/wms/custody"]')).not.toBeNull();
    await unmount();
  });

  it("hay navegación de vuelta al listado", async () => {
    const { container, unmount } = await renderPage();
    const volver = container.querySelector('a[href="/wms/custody"]');
    expect(volver).not.toBeNull();
    expect(volver?.getAttribute("aria-label")).toMatch(/Volver a Custodia/);
    await unmount();
  });
});

describe("la pantalla ofrece el camino COMPLETO hasta el POD", () => {
  it("en revisión humana están los tres paneles: inspección, análisis y decisión", async () => {
    loadMock.mockResolvedValue({ ok: true, data: view() });
    const { container, unmount } = await render(await CustodyCasePage({ params: { id: CASE_ID } }));

    expect(container.querySelector("#inspeccion-title")).not.toBeNull();
    expect(container.querySelector("#reeval-title")).not.toBeNull();
    expect(container.querySelector("#decision-title")).not.toBeNull();
    // Y el campo para sacar la foto existe de verdad, no es un cartel.
    expect(container.querySelector("#inspeccion-foto")).not.toBeNull();
    await unmount();
  });

  it("la página pide el caso SIN aportar evidencias de inspección", async () => {
    loadMock.mockResolvedValue({ ok: true, data: view() });
    const { unmount } = await render(await CustodyCasePage({ params: { id: CASE_ID } }));

    expect(loadMock).toHaveBeenCalledTimes(1);
    // Un solo argumento: el id. Si alguien volviera a pasar una lista desde
    // la pantalla, esto se rompe.
    expect(loadMock.mock.calls[0]).toEqual([CASE_ID]);
    await unmount();
  });

  it("sin liberar, el POD está bloqueado y no hay botón de descarga", async () => {
    loadMock.mockResolvedValue({ ok: true, data: view() });
    const { container, unmount } = await render(await CustodyCasePage({ params: { id: CASE_ID } }));
    expect(byText(container, /POD y despacho bloqueados/)).not.toBeNull();
    const botones = [...container.querySelectorAll("button")].map((b) => b.textContent ?? "");
    expect(botones.some((t) => /Descargar|Generar/i.test(t))).toBe(false);
    await unmount();
  });

  it("liberado, el POD se habilita y desaparecen los paneles de acción", async () => {
    loadMock.mockResolvedValue({
      ok: true,
      data: view({
        state: "RELEASED",
        stateLabel: "Liberado",
        tone: "released",
        podBlocked: false,
        podBlockedReason: null,
        podPdfReady: true,
        decision: {
          kind: "release",
          label: "Liberado para despacho",
          decidedAt: "2026-08-10T12:00:00.000Z",
          actorRole: "admin",
          reason: "inspección física conforme",
        },
      }),
    });
    const { container, unmount } = await render(await CustodyCasePage({ params: { id: CASE_ID } }));

    expect(byText(container, /POD y despacho bloqueados/)).toBeNull();
    expect(byText(container, /Liberado para despacho/)).not.toBeNull();
    // Decidido: ni inspección ni re-evaluación siguen ofreciéndose.
    expect(container.querySelector("#inspeccion-foto")).toBeNull();
    expect(container.querySelector("#reeval-title")).toBeNull();
    await unmount();
  });

  it("en cuarentena el POD no se emite y se dice por qué", async () => {
    loadMock.mockResolvedValue({
      ok: true,
      data: view({
        state: "QUARANTINED",
        stateLabel: "En cuarentena",
        tone: "quarantined",
        podBlocked: true,
        podBlockedReason: "La unidad está en cuarentena: el POD no se emite",
        decision: {
          kind: "quarantine",
          label: "Enviado a cuarentena",
          decidedAt: "2026-08-10T12:00:00.000Z",
          actorRole: "supervisor",
          reason: "diferencias visibles",
        },
      }),
    });
    const { container, unmount } = await render(await CustodyCasePage({ params: { id: CASE_ID } }));
    expect(byText(container, /en cuarentena: el POD no se emite/)).not.toBeNull();
    await unmount();
  });
});
