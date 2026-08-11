import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  projectWaMessage,
  projectionFromActionOutcome,
  mergeWaProjection,
  bubbleStatusFromProjection,
  isAuditedConfirmation,
  reduceMessageState,
  hydrateMessageState,
  initialMessageState,
  parseWaDirection,
  parseWaRealtimeStatus,
  WA_REALTIME_STATUSES,
  EMPTY_PROJECTION,
} from "./realtime-status";
import { CONVERSATION_KINDS } from "./composer-policy";
import { canTransition } from "@/lib/whatsapp/outbound-state";
import type { WaProjection, WaProviderState, WaStateSource } from "./types";

/**
 * LINK-WA WA-8R3 · Transiciones canónicas, hidratación e inbound.
 *
 * Cierra los tres HIGH del C4 de WA-8R2:
 *  ① la retícula propia sustituía a `canTransition`;
 *  ② la hidratación entraba sin pasar por la política y se pintaba confirmada;
 *  ③ los inbound podían recibir estado de egress.
 */

const WAMID = "wamid.OUT1";
const AT = "2026-08-10T12:00:00.000Z";
const AT_LATER = "2026-08-10T12:05:00.000Z";
const AT_EARLIER = "2026-08-10T11:55:00.000Z";

/**
 * GANADOR según el CONTRATO público (§4), derivado sólo de `canTransition`.
 *
 * Deliberadamente NO se importa `resolveWinner` del módulo: si el test usara la
 * implementación como oráculo, no probaría nada. Acá se reimplementa la regla
 * declarada en el mandato y se la contrasta contra el módulo.
 */
function winnerOf(estados: readonly WaProviderState[]): WaProviderState | null {
  const set = [...new Set(estados)];
  const ganadores = set.filter((w) => set.every((c) => c === w || canTransition(c, w)));
  return ganadores.length === 1 ? ganadores[0] : null;
}

/** Todas las permutaciones de un arreglo. */
function permutaciones<T>(xs: readonly T[]): T[][] {
  if (xs.length <= 1) return [[...xs]];
  return xs.flatMap((x, i) =>
    permutaciones([...xs.slice(0, i), ...xs.slice(i + 1)]).map((r) => [x, ...r]),
  );
}

const outbound = (
  status: WaProviderState | null,
  extra: { audited?: boolean; at?: string | null; source?: WaStateSource } = {},
): WaProjection => ({
  direction: "outbound",
  providerState: status,
  audited: extra.audited ?? false,
  stateAt: extra.at ?? null,
  candidates: status === null ? [] : [status],
  stateSource: extra.source ?? "server",
});

/** Hecho observado por Meta (otro dominio de reloj). */
const metaFact = (
  status: WaProviderState,
  extra: { audited?: boolean; at?: string | null } = {},
): WaProjection => outbound(status, { ...extra, source: "meta" });

/** Fila cruda outbound con auditoría completa. */
/**
 * Fila cruda outbound con auditoría completa. La procedencia por defecto es
 * `meta`: `sent`/`delivered`/`read` son estados que observa el proveedor, y el
 * marcador de auditoría lo preserva verbatim el proyector del webhook.
 */
const rowAuditada = (status = "delivered", at: string | null = AT, source = "meta") => ({
  meta: {
    wa: {
      direction: "outbound",
      status,
      status_source: source,
      ...(at ? { status_at: at } : {}),
      audit_sent: { wamid: WAMID, at: AT },
    },
  },
  externalMsgId: WAMID,
});

// ══ A · TRANSICIONES CANÓNICAS ═════════════════════════════════════════════
describe("A · la única autoridad de transición es canTransition", () => {
  it("el módulo importa el canon y no define su propio orden", () => {
    const raw = readFileSync(resolve(process.cwd(), "src/lib/connect/realtime-status.ts"), "utf8");
    // Sin comentarios: la prohibición es sobre el CÓDIGO. El encabezado
    // describe la retícula de WA-8R2 justamente para explicar por qué se fue.
    const src = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    expect(src).toMatch(/from "@\/lib\/whatsapp\/outbound-state"/);
    expect(src).toMatch(/canTransition\(/);
    // La retícula RANK/max de WA-8R2 ya no existe en el código.
    expect(src).not.toMatch(/\bRANK\b/);
    expect(src).not.toMatch(/audited_confirmed/);
    expect(src).not.toMatch(/mergeWaEvidence/);
  });

  /** 1 · `sent` auditado seguido de `failed` termina `failed`. */
  it("1 · sent auditado → failed termina en failed", () => {
    const current = outbound("sent", { audited: true, at: AT });
    const merged = mergeWaProjection(current, outbound("failed", { at: AT_LATER }));

    expect(merged?.providerState).toBe("failed");
    expect(bubbleStatusFromProjection(merged)).toBe("failed");
    // La auditoría ocurrió y no se borra, pero NO vuelve inmutable el estado.
    expect(merged?.audited).toBe(true);
    expect(isAuditedConfirmation(merged)).toBe(false);
  });

  /** 2-3 · `delivered`/`read` seguidos de `failed` conservan el estado. */
  it.each(["delivered", "read"] as WaProviderState[])(
    "2-3 · %s → failed conserva el estado anterior",
    (status) => {
      const current = outbound(status, { audited: true, at: AT });
      const merged = mergeWaProjection(current, outbound("failed", { at: AT_LATER }));

      expect(merged?.providerState).toBe(status);
      expect(bubbleStatusFromProjection(merged)).toBeUndefined();
    },
  );

  /** 4 · `failed → sent/delivered/read` progresa según el canon. */
  it.each(["sent", "delivered", "read"] as WaProviderState[])(
    "4 · failed → %s progresa",
    (status) => {
      const merged = mergeWaProjection(
        outbound("failed", { at: AT }),
        outbound(status, { audited: true, at: AT_LATER }),
      );
      expect(merged?.providerState).toBe(status);
      expect(canTransition("failed", status)).toBe(true);
    },
  );

  /** 5 · `reconciliation_required → sent/delivered/read` progresa. */
  it.each(["sent", "delivered", "read"] as WaProviderState[])(
    "5 · reconciliation_required → %s progresa",
    (status) => {
      const merged = mergeWaProjection(
        outbound("reconciliation_required", { at: AT }),
        outbound(status, { audited: true, at: AT_LATER }),
      );
      expect(merged?.providerState).toBe(status);
    },
  );

  /** 6 · `failed → reconciliation_required` sigue prohibido. */
  it("6 · failed → reconciliation_required NO progresa", () => {
    const merged = mergeWaProjection(
      outbound("failed", { at: AT }),
      outbound("reconciliation_required", { at: AT_LATER }),
    );
    expect(merged?.providerState).toBe("failed");
    expect(canTransition("failed", "reconciliation_required")).toBe(false);
  });

  /**
   * La matriz COMPLETA se compara contra el canon, par por par: cualquier
   * divergencia entre este módulo y `canTransition` rompe el test.
   */
  it("la matriz completa coincide con canTransition en los 49 pares", () => {
    let comparados = 0;
    for (const from of WA_REALTIME_STATUSES) {
      for (const to of WA_REALTIME_STATUSES) {
        const merged = mergeWaProjection(
          outbound(from, { at: AT }),
          outbound(to, { at: AT_LATER }),
        );
        const esperado = canTransition(from, to) ? to : from;
        expect(merged?.providerState).toBe(esperado);
        comparados++;
      }
    }
    expect(comparados).toBe(49);
  });

  it("un primer estado se adopta siempre (canTransition acepta desde null)", () => {
    for (const to of WA_REALTIME_STATUSES) {
      expect(mergeWaProjection(outbound(null), outbound(to, { at: AT }))?.providerState).toBe(to);
    }
  });

  /** Eventos repetidos, anteriores o malformados: no-op. */
  it("un evento repetido es no-op", () => {
    const current = outbound("delivered", { at: AT });
    expect(mergeWaProjection(current, outbound("delivered", { at: AT }))?.providerState)
      .toBe("delivered");
  });

  it("un evento ANTERIOR es no-op aunque su transición sea legal", () => {
    // `sent → failed` es legal, pero este `failed` es anterior al `sent` actual.
    const current = outbound("sent", { at: AT_LATER });
    const merged = mergeWaProjection(current, outbound("failed", { at: AT_EARLIER }));
    expect(merged?.providerState).toBe("sent");
    expect(merged?.stateAt).toBe(AT_LATER);
  });

  it("un evento sin instante no pisa un estado fechado", () => {
    const current = outbound("sent", { at: AT });
    expect(mergeWaProjection(current, outbound("failed", { at: null }))?.providerState).toBe("sent");
  });

  /**
   * WA-8R6 · §5 · dos proyecciones SIN fecha ya no se resuelven por orden de
   * llegada: acumulan candidatos y se resuelven por conjunto. `{sent, failed}`
   * es mutuamente alcanzable, así que el resultado honesto es la ambigüedad.
   * En WA-8R4 esto devolvía «el último», que era justo la dependencia del orden.
   */
  it("dos estados SIN instante se resuelven por conjunto, no por llegada", () => {
    const ab = mergeWaProjection(outbound("sent", { at: null }), outbound("failed", { at: null }));
    const ba = mergeWaProjection(outbound("failed", { at: null }), outbound("sent", { at: null }));
    expect(ab?.providerState).toBe(ba?.providerState);
    expect(ab?.providerState).toBe(winnerOf(["sent", "failed"]));
    expect(ab?.stateAt).toBeNull();
  });

  it("un evento sin estado no toca nada", () => {
    const current = outbound("delivered", { audited: true, at: AT });
    expect(mergeWaProjection(current, outbound(null))).toMatchObject({
      providerState: "delivered", audited: true,
    });
  });

  it("la auditoría es monótona: un evento posterior sin marcador no la borra", () => {
    const current = outbound("sent", { audited: true, at: AT });
    const merged = mergeWaProjection(current, outbound("delivered", { audited: false, at: AT_LATER }));
    expect(merged?.audited).toBe(true);
    expect(merged?.providerState).toBe("delivered");
  });
});

// ══ 7 · CONVERGENCIA ═══════════════════════════════════════════════════════
describe("7 · acción y realtime convergen en cualquier orden", () => {
  const casos: Array<[string, WaProjection, WaProjection]> = [
    ["acción sent + realtime delivered auditado",
      projectionFromActionOutcome({ status: "sent" }),
      projectWaMessage(rowAuditada("delivered"))],
    ["acción pending + realtime delivered auditado",
      projectionFromActionOutcome({ status: "pending" }),
      projectWaMessage(rowAuditada("delivered"))],
    ["acción failed + realtime delivered auditado",
      projectionFromActionOutcome({ status: "failed" }),
      projectWaMessage(rowAuditada("delivered"))],
    ["acción sent + realtime failed",
      projectionFromActionOutcome({ status: "sent" }),
      outbound("failed", { at: AT })],
    ["acción pending + realtime sent auditado",
      projectionFromActionOutcome({ status: "pending" }),
      projectWaMessage(rowAuditada("sent"))],
    ["acción failed + realtime read auditado",
      projectionFromActionOutcome({ status: "failed" }),
      projectWaMessage(rowAuditada("read"))],
  ];

  it.each(casos)("%s converge al mismo estado", (_l, accion, rt) => {
    const a = mergeWaProjection(mergeWaProjection(undefined, accion), rt);
    const b = mergeWaProjection(mergeWaProjection(undefined, rt), accion);

    expect(a?.providerState).toBe(b?.providerState);
    expect(a?.audited).toBe(b?.audited);
    expect(bubbleStatusFromProjection(a)).toBe(bubbleStatusFromProjection(b));
  });

  it("acción sent seguida de un failed fechado termina en failed en AMBOS órdenes", () => {
    const accion = projectionFromActionOutcome({ status: "sent" });
    const rt = outbound("failed", { at: AT });

    expect(mergeWaProjection(mergeWaProjection(undefined, accion), rt)?.providerState).toBe("failed");
    expect(mergeWaProjection(mergeWaProjection(undefined, rt), accion)?.providerState).toBe("failed");
  });

  it("las seis permutaciones de tres eventos dan UN solo resultado", () => {
    const pasos: Record<string, WaProjection> = {
      accion: projectionFromActionOutcome({ status: "pending" }),
      insert: outbound("sending", { at: AT_EARLIER }),
      update: projectWaMessage(rowAuditada("delivered", AT_LATER)),
    };
    const permutaciones = [
      ["accion", "insert", "update"], ["accion", "update", "insert"],
      ["insert", "accion", "update"], ["insert", "update", "accion"],
      ["update", "accion", "insert"], ["update", "insert", "accion"],
    ];
    const finales = new Set<string>();
    for (const orden of permutaciones) {
      let wa: WaProjection | undefined;
      for (const paso of orden) wa = mergeWaProjection(wa, pasos[paso]);
      finales.add(`${wa?.providerState}|${wa?.audited}|${bubbleStatusFromProjection(wa)}`);
    }
    expect(finales.size).toBe(1);
    expect([...finales]).toEqual(["delivered|true|undefined"]);
  });
});

// ══ B · HIDRATACIÓN ════════════════════════════════════════════════════════
describe("B · hidratación fail-closed", () => {
  /** 8 · reload de failed continúa failed. */
  it("8 · reload de un outbound failed CON procedencia sigue failed", () => {
    const wa = projectWaMessage({
      meta: { wa: { direction: "outbound", status: "failed", status_source: "server", status_at: AT } },
      externalMsgId: null,
    });
    expect(hydrateMessageState("whatsapp", wa).status).toBe("failed");
  });

  it("8b · WA-8R9 · el mismo failed SIN procedencia queda neutral, no failed", () => {
    // Sin `status_source` nadie puede acreditar quién escribió ese `failed`.
    // Afirmar el fallo sería tan inventado como afirmar el éxito: queda
    // `historical`, que no asegura ninguna de las dos cosas.
    const wa = projectWaMessage({
      meta: { wa: { direction: "outbound", status: "failed", status_at: AT } },
      externalMsgId: null,
    });
    expect(wa.stateSource).toBe("historical_unknown");
    expect(hydrateMessageState("whatsapp", wa).status).toBe("historical");
  });

  /** 9 · reload de reconciliation_required continúa bloqueado. */
  it("9 · reload de reconciliation_required sigue pendiente", () => {
    const wa = projectWaMessage({
      meta: {
        wa: {
          direction: "outbound", status: "reconciliation_required",
          status_source: "server", status_at: AT,
        },
      },
      externalMsgId: WAMID,
    });
    expect(hydrateMessageState("whatsapp", wa).status).toBe("pending");
  });

  /** 10 · reload sin evidencia válida NO muestra éxito. */
  it.each([
    ["sin meta", { meta: undefined, externalMsgId: null }],
    ["meta vacío", { meta: {}, externalMsgId: null }],
    ["sin wa", { meta: { otro: 1 }, externalMsgId: null }],
    ["outbound sin status", { meta: { wa: { direction: "outbound" } }, externalMsgId: null }],
    ["delivered sin wamid", { meta: { wa: { direction: "outbound", status: "delivered", audit_sent: { wamid: WAMID, at: AT } } }, externalMsgId: null }],
    ["delivered sin marcador", { meta: { wa: { direction: "outbound", status: "delivered" } }, externalMsgId: WAMID }],
    ["marcador de otro wamid", { meta: { wa: { direction: "outbound", status: "delivered", audit_sent: { wamid: "wamid.VIEJO", at: AT } } }, externalMsgId: WAMID }],
    ["marcador con at inválido", { meta: { wa: { direction: "outbound", status: "read", audit_sent: { wamid: WAMID, at: "x" } } }, externalMsgId: WAMID }],
    ["marcador con clave extra", { meta: { wa: { direction: "outbound", status: "sent", audit_sent: { wamid: WAMID, at: AT, extra: 1 } } }, externalMsgId: WAMID }],
    ["dirección desconocida", { meta: { wa: { status: "delivered" } }, externalMsgId: WAMID }],
    ["meta malformado", { meta: [1, 2, 3], externalMsgId: WAMID }],
  ])("10 · %s NO se muestra confirmado", (_l, row) => {
    const wa = projectWaMessage(row);
    const state = hydrateMessageState("whatsapp", wa);
    expect(state.status).not.toBeUndefined();
    expect(isAuditedConfirmation(wa)).toBe(false);
  });

  /** 11 · reload con marcador auditado válido confirma. */
  it.each(["sent", "delivered", "read"])("11 · reload auditado (%s) confirma", (status) => {
    const wa = projectWaMessage(rowAuditada(status));
    expect(hydrateMessageState("whatsapp", wa).status).toBeUndefined();
    expect(isAuditedConfirmation(wa)).toBe(true);
  });

  it("un mensaje SIN proyección es una burbuja optimista, no un hidratado", () => {
    expect(initialMessageState("whatsapp")).toEqual({ wa: undefined, status: "sending" });
    // Hidratar sin proyección usa la vacía y por lo tanto NO confirma.
    // WA-8R9 · hidratar sin proyección NO afirma nada: ni éxito ni intento en
    // curso. Antes decía `pending`, que anunciaba un envío por resolver sobre
    // una fila de la que no se sabe siquiera la dirección.
    expect(hydrateMessageState("whatsapp", undefined)).toEqual({
      wa: EMPTY_PROJECTION, status: "historical",
    });
  });

  it("`status === undefined` sólo ocurre con inbound o confirmación auditada", () => {
    const candidatos: WaProjection[] = [];
    for (const direction of ["inbound", "outbound", "unknown"] as const) {
      for (const providerState of [...WA_REALTIME_STATUSES, null]) {
        for (const audited of [true, false]) {
          candidatos.push({
            direction, providerState, audited, stateAt: null,
            candidates: providerState === null ? [] : [providerState],
            stateSource: "server",
          });
        }
      }
    }
    for (const wa of candidatos) {
      if (bubbleStatusFromProjection(wa) === undefined) {
        expect(wa.direction === "inbound" || isAuditedConfirmation(wa)).toBe(true);
      }
    }
    expect(candidatos.length).toBe(48);
  });

  /** 15 · cambio de conversación rehidrata igual. */
  it("15 · rehidratar dos veces da el mismo resultado", () => {
    const wa = projectWaMessage(rowAuditada("delivered"));
    expect(hydrateMessageState("whatsapp", wa)).toEqual(hydrateMessageState("whatsapp", wa));
  });
});

// ══ C · AISLAMIENTO INBOUND ════════════════════════════════════════════════
describe("C · inbound queda fuera del reducer outbound", () => {
  const inboundRow = { meta: { wa: { direction: "inbound" } }, externalMsgId: "wamid.IN1" };

  it("13 · un inbound nunca muestra `sending`", () => {
    const wa = projectWaMessage(inboundRow);
    expect(wa.direction).toBe("inbound");
    expect(bubbleStatusFromProjection(wa)).toBeUndefined();
    expect(hydrateMessageState("whatsapp", wa).status).toBeUndefined();
  });

  it("un inbound no adquiere estado de egress ni auditoría", () => {
    const wa = projectWaMessage({
      // Aun si la fila trajera status y marcador, el inbound los ignora.
      meta: { wa: { direction: "inbound", status: "sent", audit_sent: { wamid: WAMID, at: AT } } },
      externalMsgId: WAMID,
    });
    expect(wa).toEqual({
      direction: "inbound", providerState: null, audited: false, stateAt: null,
      candidates: [], stateSource: "unknown",
    });
    expect(isAuditedConfirmation(wa)).toBe(false);
  });

  it.each(["sent", "delivered", "read", "failed", "reconciliation_required", "sending", "queued"])(
    "un evento outbound %s posterior no contamina un inbound",
    (status) => {
      const merged = mergeWaProjection(
        projectWaMessage(inboundRow),
        outbound(status as WaProviderState, { audited: true, at: AT_LATER }),
      );
      expect(merged).toEqual({
        direction: "inbound", providerState: null, audited: false, stateAt: null,
        candidates: [], stateSource: "unknown",
      });
      expect(bubbleStatusFromProjection(merged)).toBeUndefined();
    },
  );

  it("y al revés: un inbound tardío tampoco hereda estado outbound", () => {
    const merged = mergeWaProjection(
      outbound("delivered", { audited: true, at: AT }),
      projectWaMessage(inboundRow),
    );
    expect(merged?.direction).toBe("inbound");
    expect(merged?.providerState).toBeNull();
  });

  it("dirección ausente o malformada queda fail-closed, nunca éxito implícito", () => {
    for (const meta of [
      { wa: {} }, { wa: { direction: null } }, { wa: { direction: "INBOUND" } },
      { wa: { direction: 7 } }, { wa: { direction: ["inbound"] } }, {},
    ]) {
      expect(parseWaDirection(meta)).toBe("unknown");
      const wa = projectWaMessage({ meta, externalMsgId: WAMID });
      expect(bubbleStatusFromProjection(wa)).not.toBeUndefined();
    }
  });
});

// ══ 12 · sanitización ══════════════════════════════════════════════════════
describe("12 · la proyección no contiene meta, wamid ni campos sensibles", () => {
  it("sólo seis claves cerradas", () => {
    const wa = projectWaMessage(rowAuditada());
    expect(Object.keys(wa).sort()).toEqual([
      "audited", "candidates", "direction", "providerState", "stateAt", "stateSource",
    ]);
    // Y los candidatos son estados canónicos, nada más.
    for (const c of wa.candidates) {
      expect(WA_REALTIME_STATUSES).toContain(c);
    }
  });

  it("ningún dato del proveedor sobrevive", () => {
    const PHONE = "+5491100000001";
    const TEXTO = "hola, soy el cliente";
    const wa = projectWaMessage({
      meta: {
        wa: {
          direction: "outbound", status: "delivered", status_at: AT, status_source: "meta",
          audit_sent: { wamid: WAMID, at: AT },
          error: "detalle-del-proveedor", phone: PHONE, text: TEXTO,
        },
        token: "Bearer <token-sintetico>",
      },
      externalMsgId: WAMID,
    });
    const dump = JSON.stringify(wa);
    for (const marca of [WAMID, PHONE, TEXTO, "Bearer", "detalle-del-proveedor", "audit_sent"]) {
      expect(dump).not.toContain(marca);
    }
    expect(wa.audited).toBe(true);
  });

  it("`mapMessage` adjunta la proyección y descarta meta/external_msg_id", () => {
    const src = readFileSync(resolve(process.cwd(), "src/lib/connect/read/inbox-data.ts"), "utf8");
    // Cuerpo real: desde la declaración hasta la llave de cierre en columna 0.
    const start = src.indexOf("function mapMessage");
    expect(start).toBeGreaterThan(-1);
    const body = src.slice(start, src.indexOf("\n}", start) + 2);
    expect(body.length).toBeGreaterThan(200);

    expect(body).toMatch(/wa:\s*projectWaMessage\(\{\s*meta:\s*r\.meta,\s*externalMsgId:\s*r\.external_msg_id\s*\}\)/);
    // El DTO no copia ninguna de las dos columnas crudas. Se descuenta la
    // llamada a `projectWaMessage`, que legítimamente las recibe como argumento.
    const dto = body.replace(/projectWaMessage\([\s\S]*?\}\)/g, "PROJECTION");
    expect(dto).not.toContain("r.meta");
    expect(dto).not.toContain("r.external_msg_id");
    expect(dto).toContain("PROJECTION");
    // Y `Message` no declara campos crudos del proveedor.
    const types = readFileSync(resolve(process.cwd(), "src/lib/connect/types.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    const msg = types.slice(types.indexOf("export interface Message {"), types.indexOf("\n}", types.indexOf("export interface Message {")));
    for (const prohibido of ["meta", "wamid", "external_msg_id", "phone", "token"]) {
      expect(msg).not.toContain(prohibido);
    }
    expect(msg).toContain("wa?: WaProjection");
  });
});

// ══ parsers ════════════════════════════════════════════════════════════════
describe("parsers fail-closed", () => {
  it.each(WA_REALTIME_STATUSES)("%s se reconoce", (status) => {
    expect(parseWaRealtimeStatus({ wa: { status } })).toEqual({ known: true, status });
  });

  it.each([
    undefined, null, 0, "", "SENT", "desconocido", true, [], {},
    { wa: null }, { wa: "sent" }, { wa: [] }, { wa: { status: 7 } }, [{ wa: { status: "sent" } }],
  ] as unknown[])("no arroja ante %s", (v) => {
    expect(() => parseWaRealtimeStatus(v)).not.toThrow();
    expect(() => parseWaDirection(v)).not.toThrow();
    expect(() => projectWaMessage({ meta: v, externalMsgId: v })).not.toThrow();
  });

  it("un `status_at` no canónico se descarta y no ordena", () => {
    for (const at of ["x", "2026-02-30T00:00:00.000Z", "2026-08-10T12:00:00+00:00", 7, null]) {
      const wa = projectWaMessage({
        meta: { wa: { direction: "outbound", status: "sent", status_at: at } },
        externalMsgId: null,
      });
      expect(wa.stateAt).toBeNull();
    }
  });
});

// ══ 16-17 · reducer y Connect ══════════════════════════════════════════════
describe("16-17 · reducer único", () => {
  it("16 · el optimista WhatsApp conserva su comportamiento", () => {
    expect(initialMessageState("whatsapp")).toEqual({ wa: undefined, status: "sending" });
    const trasAccion = reduceMessageState({
      kind: "whatsapp", source: "action",
      current: { wa: undefined, status: "sending" },
      incoming: projectionFromActionOutcome({ status: "pending" }),
    });
    expect(trasAccion.status).toBe("pending");
  });

  const CONNECT_KINDS = CONVERSATION_KINDS.filter((k) => k !== "whatsapp");

  it.each(CONNECT_KINDS)("17 · %s: el evento realtime limpia la marca optimista", (kind) => {
    expect(
      reduceMessageState({ kind, source: "realtime", current: { status: "sending" }, incoming: null }),
    ).toEqual({ wa: undefined, status: undefined });
  });

  it.each(CONNECT_KINDS)("17 · %s: la acción fallida marca fallo y la exitosa limpia", (kind) => {
    expect(
      reduceMessageState({
        kind, source: "action", current: { status: "sending" },
        incoming: projectionFromActionOutcome({ status: "failed" }),
      }),
    ).toEqual({ wa: undefined, status: "failed" });
    expect(
      reduceMessageState({
        kind, source: "action", current: { status: "sending" },
        incoming: projectionFromActionOutcome({ status: "sent" }),
      }),
    ).toEqual({ wa: undefined, status: undefined });
  });

  it("17 · Connect nunca acumula proyección WhatsApp", () => {
    expect(hydrateMessageState("dm", projectWaMessage(rowAuditada()))).toEqual({
      wa: undefined, status: undefined,
    });
    expect(initialMessageState("dm")).toEqual({ status: "sending" });
  });

  it("un kind desconocido usa la rama Connect", () => {
    expect(
      reduceMessageState({ kind: "sms", source: "realtime", current: { status: "pending" }, incoming: null }),
    ).toEqual({ wa: undefined, status: undefined });
  });
});

// ══ WA-8R4 · DIRECCIÓN DESCONOCIDA Y EMPATE TEMPORAL ═══════════════════════
/**
 * Dos defectos del C4 de WA-8R3:
 *  ① una fila con dirección ausente o malformada podía quedar CONFIRMADA si
 *    traía status auditable, marcador válido y wamid coincidente;
 *  ② `sent` y `failed` con el MISMO `status_at` (Meta entrega precisión de
 *    segundos) terminaban distinto según el orden de llegada.
 */
describe("WA-8R4 · 1-4 · sólo `outbound` puede acreditar auditoría", () => {
  const conEvidencia = (extra: Record<string, unknown>, status: string) => ({
    meta: {
      wa: {
        ...extra, status, status_at: AT, status_source: "meta",
        audit_sent: { wamid: WAMID, at: AT },
      },
    },
    externalMsgId: WAMID,
  });

  /** 1-2 · unknown + sent/delivered/read + marcador exacto + wamid ⇒ pending. */
  it.each(["sent", "delivered", "read"])(
    "1-2 · dirección ausente con %s y evidencia completa ⇒ neutral, nunca confirmado",
    (status) => {
      const wa = projectWaMessage(conEvidencia({}, status));
      expect(wa.direction).toBe("unknown");
      expect(wa.audited).toBe(false);
      expect(isAuditedConfirmation(wa)).toBe(false);
      // WA-8R9 · H-3 · neutral, no "pendiente": de una fila cuya dirección se
      // desconoce no se puede afirmar que haya un envío en curso.
      expect(bubbleStatusFromProjection(wa)).toBe("historical");
      expect(bubbleStatusFromProjection(wa)).not.toBeUndefined();
      expect(hydrateMessageState("whatsapp", wa).status).toBe("historical");
    },
  );

  /** 3 · toda dirección malformada, con evidencia válida, nunca confirma. */
  it.each([
    ["direction null", { direction: null }],
    ["direction en mayúsculas", { direction: "OUTBOUND" }],
    ["direction con espacios", { direction: " outbound " }],
    ["direction numérica", { direction: 1 }],
    ["direction arreglo", { direction: ["outbound"] }],
    ["direction objeto", { direction: { v: "outbound" } }],
    ["direction booleana", { direction: true }],
    ["direction vacía", { direction: "" }],
  ])("3 · %s con evidencia válida nunca confirma", (_l, extra) => {
    for (const status of ["sent", "delivered", "read"]) {
      const wa = projectWaMessage(conEvidencia(extra, status));
      expect(wa.direction).toBe("unknown");
      expect(wa.audited).toBe(false);
      expect(bubbleStatusFromProjection(wa)).not.toBeUndefined();
    }
  });

  /** 4 · `isAuditedConfirmation` acepta LITERALMENTE sólo outbound. */
  it("4 · isAuditedConfirmation exige dirección outbound", () => {
    const base = {
      providerState: "delivered" as WaProviderState, audited: true, stateAt: AT,
      candidates: ["delivered"] as WaProviderState[], stateSource: "meta" as WaStateSource,
    };
    expect(isAuditedConfirmation({ ...base, direction: "outbound" })).toBe(true);
    expect(isAuditedConfirmation({ ...base, direction: "unknown" })).toBe(false);
    expect(isAuditedConfirmation({ ...base, direction: "inbound" })).toBe(false);
    expect(isAuditedConfirmation(undefined)).toBe(false);
  });

  it("un outbound explícito con la misma evidencia SÍ confirma: el corte es la dirección", () => {
    const wa = projectWaMessage(conEvidencia({ direction: "outbound" }, "delivered"));
    expect(wa.audited).toBe(true);
    expect(isAuditedConfirmation(wa)).toBe(true);
    expect(bubbleStatusFromProjection(wa)).toBeUndefined();
  });

  it("una dirección desconocida jamás limpia el error de un pendiente", () => {
    const previa = outbound("reconciliation_required", { at: AT });
    const merged = mergeWaProjection(previa, projectWaMessage(conEvidencia({}, "delivered")));
    expect(isAuditedConfirmation(merged)).toBe(false);
    expect(bubbleStatusFromProjection(merged)).toBe("pending");
  });

  it("pero un outbound posterior sí resuelve esa misma fila", () => {
    const previa = outbound("reconciliation_required", { at: AT });
    const merged = mergeWaProjection(
      previa,
      projectWaMessage(conEvidencia({ direction: "outbound" }, "delivered")),
    );
    expect(isAuditedConfirmation(merged)).toBe(true);
  });
});

describe("WA-8R4 · 5-9 · empate temporal", () => {
  const ev = (status: WaProviderState, at: string) => outbound(status, { at });

  /** 5 · `sent`/`failed` con instante idéntico: mismo resultado fail-closed. */
  it("5 · sent y failed con el mismo status_at convergen a ambigüedad", () => {
    const a = mergeWaProjection(ev("sent", AT), ev("failed", AT));
    const b = mergeWaProjection(ev("failed", AT), ev("sent", AT));

    expect(a?.providerState).toBeNull();
    expect(b?.providerState).toBeNull();
    expect(a?.audited).toBe(false);
    expect(b?.audited).toBe(false);
    expect(a?.stateAt).toBe(AT);
    expect(b?.stateAt).toBe(AT);
    expect(bubbleStatusFromProjection(a)).toBe("pending");
    expect(bubbleStatusFromProjection(b)).toBe("pending");
  });

  it("5b · el empate borra una auditoría previa: mientras no se sepa, no se acredita", () => {
    const auditado = { ...outbound("sent", { at: AT }), audited: true };
    const merged = mergeWaProjection(auditado, ev("failed", AT));
    expect(merged?.providerState).toBeNull();
    expect(merged?.audited).toBe(false);
    expect(isAuditedConfirmation(merged)).toBe(false);
  });

  /**
   * 5c · TODO par mutuamente alcanzable empata igual, en los dos órdenes. No se
   * elige por rank, prioridad, orden alfabético ni llegada.
   */
  it("5c · todos los pares mutuamente alcanzables empatan en ambos órdenes", () => {
    let pares = 0;
    for (const x of WA_REALTIME_STATUSES) {
      for (const y of WA_REALTIME_STATUSES) {
        if (x === y) continue;
        if (!(canTransition(x, y) && canTransition(y, x))) continue;
        pares++;
        const ab = mergeWaProjection(ev(x, AT), ev(y, AT));
        const ba = mergeWaProjection(ev(y, AT), ev(x, AT));
        expect(ab?.providerState).toBeNull();
        expect(ba?.providerState).toBeNull();
        expect(ab?.stateAt).toBe(AT);
      }
    }
    expect(pares).toBeGreaterThan(0);
  });

  /** 6 · estado repetido con el mismo instante: no-op. */
  it.each(WA_REALTIME_STATUSES)("6 · %s repetido con el mismo instante es no-op", (status) => {
    const merged = mergeWaProjection(ev(status, AT), ev(status, AT));
    expect(merged?.providerState).toBe(status);
    expect(merged?.stateAt).toBe(AT);
  });

  /** 7 · un evento estrictamente posterior resuelve la ambigüedad. */
  it("7 · un instante estrictamente mayor resuelve el empate por canTransition", () => {
    const ambiguo = mergeWaProjection(ev("sent", AT), ev("failed", AT));
    expect(ambiguo?.providerState).toBeNull();

    const resuelto = mergeWaProjection(ambiguo, ev("delivered", AT_LATER));
    expect(resuelto?.providerState).toBe("delivered");
    expect(resuelto?.stateAt).toBe(AT_LATER);
  });

  /**
   * WA-8R5 · §7 · un evento del MISMO instante ya no se descarta: se agrega al
   * conjunto y se recalcula. Puede resolver la ambigüedad o no, según lo que
   * diga `canTransition` sobre el conjunto completo — nunca según el orden.
   */
  it("7b · un evento del mismo instante se acumula y se recalcula", () => {
    const ambiguo = mergeWaProjection(ev("sent", AT), ev("failed", AT));
    expect(ambiguo?.providerState).toBeNull();

    for (const status of WA_REALTIME_STATUSES) {
      const igual = mergeWaProjection(ambiguo, ev(status, AT));
      const esperado = winnerOf(["sent", "failed", status]);
      expect(igual?.providerState).toBe(esperado);
      expect(igual?.stateAt).toBe(AT);
    }
  });

  it("7c · ni un evento anterior", () => {
    const ambiguo = mergeWaProjection(ev("sent", AT), ev("failed", AT));
    const antes = mergeWaProjection(ambiguo, ev("delivered", AT_EARLIER));
    expect(antes?.providerState).toBeNull();
  });

  /**
   * 8 · pares donde sólo UNA dirección es canónica convergen al estado permitido,
   * incluso empatados. `delivered/read → failed` sigue prohibido.
   */
  it.each(["delivered", "read"] as WaProviderState[])(
    "8 · %s y failed empatados convergen a %s (failed no lo pisa)",
    (status) => {
      const ab = mergeWaProjection(ev(status, AT), ev("failed", AT));
      const ba = mergeWaProjection(ev("failed", AT), ev(status, AT));
      expect(ab?.providerState).toBe(status);
      expect(ba?.providerState).toBe(status);
      // Sin auditoría el estado se conserva pero no confirma: fail-closed.
      expect(bubbleStatusFromProjection(ab)).toBe("pending");

      // Con auditoría previa, el `failed` empatado tampoco la tumba.
      const auditado = { ...outbound(status, { at: AT }), audited: true };
      const conAuditoria = mergeWaProjection(auditado, ev("failed", AT));
      expect(conAuditoria?.providerState).toBe(status);
      expect(bubbleStatusFromProjection(conAuditoria)).toBeUndefined();
    },
  );

  it("8b · todo par con una sola dirección canónica converge al permitido", () => {
    let pares = 0;
    for (const x of WA_REALTIME_STATUSES) {
      for (const y of WA_REALTIME_STATUSES) {
        if (x === y) continue;
        const fw = canTransition(x, y);
        const bw = canTransition(y, x);
        if (fw === bw) continue; // sólo los asimétricos
        pares++;
        const permitido = fw ? y : x;
        expect(mergeWaProjection(ev(x, AT), ev(y, AT))?.providerState).toBe(permitido);
        expect(mergeWaProjection(ev(y, AT), ev(x, AT))?.providerState).toBe(permitido);
      }
    }
    expect(pares).toBeGreaterThan(0);
  });

  /**
   * WA-8R5 · §6 · un par SIN ninguna transición válida tiene cero ganadores y
   * por lo tanto es ambiguo. En WA-8R4 se conservaba «el actual», que era
   * justamente una decisión dependiente del orden.
   */
  it("8c · un par sin ninguna transición válida es AMBIGUO en ambos órdenes", () => {
    let pares = 0;
    for (const x of WA_REALTIME_STATUSES) {
      for (const y of WA_REALTIME_STATUSES) {
        if (x === y || canTransition(x, y) || canTransition(y, x)) continue;
        pares++;
        expect(mergeWaProjection(ev(x, AT), ev(y, AT))?.providerState).toBeNull();
        expect(mergeWaProjection(ev(y, AT), ev(x, AT))?.providerState).toBeNull();
      }
    }
    expect(pares).toBeGreaterThan(0);
  });

  /** 9 · con instantes DISTINTOS, la matriz de 49 pares sigue siendo el canon. */
  it("9 · la matriz de 49 pares con instantes distintos no cambió", () => {
    let comparados = 0;
    for (const from of WA_REALTIME_STATUSES) {
      for (const to of WA_REALTIME_STATUSES) {
        const merged = mergeWaProjection(ev(from, AT), ev(to, AT_LATER));
        expect(merged?.providerState).toBe(canTransition(from, to) ? to : from);
        comparados++;
      }
    }
    expect(comparados).toBe(49);
  });

  it("la ambigüedad no se confunde con «todavía sin estado»", () => {
    // Sin estado y sin instante: una fila nueva, no un empate.
    const nuevo = mergeWaProjection(undefined, outbound(null));
    expect(nuevo?.providerState).toBeNull();
    expect(nuevo?.stateAt).toBeNull();
    // Y un primer estado se adopta con normalidad.
    expect(mergeWaProjection(nuevo, ev("sent", AT))?.providerState).toBe("sent");
  });
});

// ══ WA-8R5 · CONVERGENCIA ASOCIATIVA MULTIEVENTO ═══════════════════════════
/**
 * Defecto del C4 de WA-8R4: la reducción no era asociativa con tres o más
 * estados en el mismo instante. `sent → failed → delivered` terminaba ambiguo y
 * `sent → delivered → failed` terminaba en `delivered`, con los mismos hechos.
 *
 * Causa: al detectar la ambigüedad se reemplazaba el estado por `null` y se
 * perdían los candidatos que la habían originado, de modo que un tercer evento
 * del mismo instante no podía participar.
 */
describe("WA-8R5 · reducción por conjunto de candidatos", () => {
  const AT_T = AT;
  const ev = (providerState: WaProviderState, at = AT_T): WaProjection =>
    outbound(providerState, { at });

  /** Reduce una secuencia de estados, todos en el mismo instante. */
  const reducir = (orden: readonly WaProviderState[], at = AT_T) =>
    orden.reduce<WaProjection | undefined>((acc, st) => mergeWaProjection(acc, ev(st, at)), undefined);

  /** Resultado (estado + visual) de una secuencia, como cadena comparable. */
  const huella = (orden: readonly WaProviderState[]) => {
    const r = reducir(orden);
    return `${r?.providerState}|${bubbleStatusFromProjection(r)}|${[...(r?.candidates ?? [])].join(",")}`;
  };

  // ── 1-3 · los casos nombrados por el mandato ────────────────────────────
  it("1-2 · las seis permutaciones de {sent,failed,delivered} terminan en delivered", () => {
    const perms = permutaciones<WaProviderState>(["sent", "failed", "delivered"]);
    expect(perms).toHaveLength(6);
    const huellas = new Set(perms.map(huella));
    expect(huellas.size).toBe(1);
    for (const orden of perms) expect(reducir(orden)?.providerState).toBe("delivered");
    // Y el contrato lo predice sin mirar la implementación.
    expect(winnerOf(["sent", "failed", "delivered"])).toBe("delivered");
  });

  it("3 · {sent,failed,read} termina en read en las seis permutaciones", () => {
    const perms = permutaciones<WaProviderState>(["sent", "failed", "read"]);
    expect(new Set(perms.map(huella)).size).toBe(1);
    for (const orden of perms) expect(reducir(orden)?.providerState).toBe("read");
    expect(winnerOf(["sent", "failed", "read"])).toBe("read");
  });

  it("4 · {sent,failed} queda ambiguo en ambos órdenes", () => {
    for (const orden of permutaciones<WaProviderState>(["sent", "failed"])) {
      const r = reducir(orden);
      expect(r?.providerState).toBeNull();
      expect(r?.audited).toBe(false);
      expect(r?.stateAt).toBe(AT_T);
      expect(bubbleStatusFromProjection(r)).toBe("pending");
      expect([...(r?.candidates ?? [])].sort()).toEqual(["failed", "sent"]);
    }
    expect(winnerOf(["sent", "failed"])).toBeNull();
  });

  it("5 · {sent,failed,reconciliation_required} da el mismo resultado en las seis", () => {
    const conjunto: WaProviderState[] = ["sent", "failed", "reconciliation_required"];
    expect(new Set(permutaciones(conjunto).map(huella)).size).toBe(1);
    expect(reducir(conjunto)?.providerState).toBe(winnerOf(conjunto));
  });

  it("6 · {queued,failed,reconciliation_required} da el mismo resultado en las seis", () => {
    const conjunto: WaProviderState[] = ["queued", "failed", "reconciliation_required"];
    expect(new Set(permutaciones(conjunto).map(huella)).size).toBe(1);
    expect(reducir(conjunto)?.providerState).toBe(winnerOf(conjunto));
  });

  // ── 7 · exhaustivo sobre TODOS los multiconjuntos de tres ───────────────
  it("7 · todos los multiconjuntos de tres estados convergen, en toda permutación", () => {
    let conjuntos = 0;
    for (const a of WA_REALTIME_STATUSES) {
      for (const b of WA_REALTIME_STATUSES) {
        for (const c of WA_REALTIME_STATUSES) {
          conjuntos++;
          const perms = permutaciones<WaProviderState>([a, b, c]);
          const huellas = new Set(perms.map(huella));
          expect(huellas.size).toBe(1);
          // El valor esperado sale del CONTRATO, no de la implementación.
          expect(reducir([a, b, c])?.providerState).toBe(winnerOf([a, b, c]));
        }
      }
    }
    expect(conjuntos).toBe(343);
  });

  // ── 8 · cuatro eventos con duplicados ───────────────────────────────────
  it("8 · conjuntos de cuatro eventos con duplicados también convergen", () => {
    const casos: WaProviderState[][] = [
      ["sent", "failed", "delivered", "sent"],
      ["sent", "sent", "failed", "delivered"],
      ["delivered", "failed", "sent", "failed"],
      ["queued", "sending", "sent", "sending"],
      ["read", "delivered", "sent", "failed"],
      ["reconciliation_required", "failed", "sent", "reconciliation_required"],
    ];
    for (const caso of casos) {
      const huellas = new Set(permutaciones(caso).map(huella));
      expect(huellas.size).toBe(1);
      expect(reducir(caso)?.providerState).toBe(winnerOf(caso));
    }
  });

  it("12 · un estado repetido es idempotente", () => {
    for (const st of WA_REALTIME_STATUSES) {
      const uno = reducir([st]);
      const tres = reducir([st, st, st]);
      expect(tres?.providerState).toBe(uno?.providerState);
      expect([...(tres?.candidates ?? [])]).toEqual([...(uno?.candidates ?? [])]);
    }
  });

  // ── 9-11 · eventos de otros instantes ───────────────────────────────────
  it("9 · un evento posterior alcanzable desde TODOS los candidatos resuelve", () => {
    const ambiguo = reducir(["sent", "failed"]);
    expect(ambiguo?.providerState).toBeNull();

    for (const st of WA_REALTIME_STATUSES) {
      const alcanzable = ["sent", "failed"].every(
        (c) => c === st || canTransition(c as WaProviderState, st),
      );
      const despues = mergeWaProjection(ambiguo, ev(st, AT_LATER));
      if (alcanzable) {
        expect(despues?.providerState).toBe(st);
        // §8 · los candidatos viejos se descartan.
        expect([...(despues?.candidates ?? [])]).toEqual([st]);
        expect(despues?.stateAt).toBe(AT_LATER);
      } else {
        expect(despues?.providerState).toBeNull();
      }
    }
  });

  it("9b · {sent,failed} + delivered posterior resuelve a delivered", () => {
    const r = mergeWaProjection(reducir(["sent", "failed"]), ev("delivered", AT_LATER));
    expect(r?.providerState).toBe("delivered");
  });

  it("10 · {sent,failed} + queued posterior NO resuelve ni regresa a queued", () => {
    const r = mergeWaProjection(reducir(["sent", "failed"]), ev("queued", AT_LATER));
    expect(r?.providerState).toBeNull();
    expect(r?.providerState).not.toBe("queued");
    expect([...(r?.candidates ?? [])].sort()).toEqual(["failed", "sent"]);
    expect(bubbleStatusFromProjection(r)).toBe("pending");
  });

  it("11 · un evento anterior es no-op y no toca los candidatos", () => {
    const ambiguo = reducir(["sent", "failed"]);
    const antes = mergeWaProjection(ambiguo, ev("delivered", AT_EARLIER));
    expect(antes?.providerState).toBeNull();
    expect([...(antes?.candidates ?? [])].sort()).toEqual(["failed", "sent"]);
    expect(antes?.stateAt).toBe(AT_T);
  });

  /**
   * §3 vs §8 · en el MISMO instante los hechos se acumulan aunque haya ganador
   * (hace falta el conjunto completo para recalcular si llega un tercero);
   * recién una resolución con instante POSTERIOR colapsa el conjunto.
   */
  it("mismo instante acumula candidatos; un instante posterior los colapsa", () => {
    const mismo = reducir(["sent", "delivered"]);
    expect(mismo?.providerState).toBe("delivered");
    expect([...(mismo?.candidates ?? [])]).toEqual(["sent", "delivered"]);

    const posterior = mergeWaProjection(mismo, ev("read", AT_LATER));
    expect(posterior?.providerState).toBe("read");
    expect([...(posterior?.candidates ?? [])]).toEqual(["read"]);
  });

  it("y el conjunto acumulado sigue gobernando a un tercero del mismo instante", () => {
    // {sent, delivered} ya tiene ganador `delivered`; agregar `failed` en T
    // debe recalcular desde los TRES, no desde el ganador.
    const conTercero = reducir(["sent", "delivered", "failed"]);
    expect(conTercero?.providerState).toBe(winnerOf(["sent", "delivered", "failed"]));
    expect([...(conTercero?.candidates ?? [])].sort()).toEqual(["delivered", "failed", "sent"]);
  });

  // ── 9 (contrato) · auditoría sólo con ganador único ─────────────────────
  it("la auditoría no confirma bajo ambigüedad, y vuelve al resolverse", () => {
    const auditado = { ...outbound("sent", { at: AT_T }), audited: true };
    const ambiguo = mergeWaProjection(auditado, ev("failed", AT_T));
    expect(ambiguo?.providerState).toBeNull();
    expect(ambiguo?.audited).toBe(false);
    expect(isAuditedConfirmation(ambiguo)).toBe(false);

    // Un delivered auditado posterior sí cierra.
    const resuelto = mergeWaProjection(ambiguo, {
      ...outbound("delivered", { at: AT_LATER }), audited: true,
    });
    expect(resuelto?.providerState).toBe("delivered");
    expect(isAuditedConfirmation(resuelto)).toBe(true);
  });

  // ── 13-16 · lo cerrado antes sigue cerrado ──────────────────────────────
  it("13 · dirección unknown con marcador válido sigue sin confirmar", () => {
    const wa = projectWaMessage({
      meta: { wa: { status: "delivered", status_at: AT_T, audit_sent: { wamid: WAMID, at: AT } } },
      externalMsgId: WAMID,
    });
    expect(wa.direction).toBe("unknown");
    expect(wa.audited).toBe(false);
    // Sigue sin confirmar, y además sin anunciar un envío pendiente.
    expect(bubbleStatusFromProjection(wa)).toBe("historical");
    expect(bubbleStatusFromProjection(wa)).not.toBeUndefined();
  });

  it("14 · inbound sigue sin estado de egress ni candidatos", () => {
    const wa = projectWaMessage({ meta: { wa: { direction: "inbound" } }, externalMsgId: "wamid.IN" });
    expect(wa.candidates).toEqual([]);
    expect(wa.providerState).toBeNull();
    expect(bubbleStatusFromProjection(wa)).toBeUndefined();

    const merged = mergeWaProjection(wa, ev("delivered", AT_LATER));
    expect(merged?.candidates).toEqual([]);
    expect(merged?.direction).toBe("inbound");
  });

  it("15 · los candidatos serializados son sólo estados canónicos", () => {
    const wa = mergeWaProjection(reducir(["sent", "failed"]), ev("queued", AT_T));
    const dump = JSON.stringify(wa);
    for (const c of wa?.candidates ?? []) expect(WA_REALTIME_STATUSES).toContain(c);
    for (const marca of [WAMID, "audit_sent", "Bearer", "meta"]) {
      expect(dump).not.toContain(marca);
    }
    // El DTO sigue siendo un arreglo plano de cadenas.
    expect(Array.isArray(wa?.candidates)).toBe(true);
    for (const c of wa?.candidates ?? []) expect(typeof c).toBe("string");
  });

  it("16 · Connect no-WhatsApp conserva su comportamiento", () => {
    expect(
      reduceMessageState({ kind: "dm", source: "realtime", current: { status: "sending" }, incoming: ev("delivered") }),
    ).toEqual({ wa: undefined, status: undefined });
    expect(hydrateMessageState("dm", ev("failed"))).toEqual({ wa: undefined, status: undefined });
  });
});

// ══ WA-8R6 · PROVISIONAL vs DURABLE ════════════════════════════════════════
/**
 * Defecto del re-C4 de WA-8R5: `projectionFromActionOutcome` produce evidencia
 * PROVISIONAL sin `stateAt`, y `resolveState` le exigía igualmente
 * alcanzabilidad canónica para dejarse reemplazar por un estado durable. Eso
 * conservaba la foto de la acción y el resultado dependía del orden:
 * `acción failed → realtime queued` terminaba `failed`, y al revés `queued`.
 */
describe("WA-8R6 · convergencia entre acción sin fecha y realtime durable", () => {
  const OUTCOMES = ["sent", "pending", "failed"] as const;
  type Outcome = (typeof OUTCOMES)[number];

  /** Estado que el CONTRATO asigna a cada resultado de acción. */
  const estadoDeOutcome = (o: Outcome): WaProviderState =>
    o === "sent" ? "sent" : o === "pending" ? "reconciliation_required" : "failed";

  const provisional = (o: Outcome) => projectionFromActionOutcome({ status: o });
  const durable = (st: WaProviderState, at = AT): WaProjection => outbound(st, { at });

  // ── §2 · lo durable reemplaza a lo provisional, venga como venga ────────
  it.each([
    ["failed", "queued"],
    ["sent", "reconciliation_required"],
    ["pending", "failed"],
    ["sent", "delivered"],
    ["sent", "read"],
  ] as Array<[Outcome, WaProviderState]>)(
    "acción %s + realtime %s converge al estado durable en ambos órdenes",
    (outcome, rt) => {
      const a = mergeWaProjection(provisional(outcome), durable(rt));
      const b = mergeWaProjection(durable(rt), provisional(outcome));

      expect(a?.providerState).toBe(b?.providerState);
      expect(a?.providerState).toBe(rt);
      expect(a?.stateAt).toBe(AT);
      expect([...(a?.candidates ?? [])]).toEqual([rt]);
    },
  );

  it("los 21 pares acción × estado realtime convergen al durable", () => {
    let pares = 0;
    for (const o of OUTCOMES) {
      for (const rt of WA_REALTIME_STATUSES) {
        pares++;
        const a = mergeWaProjection(provisional(o), durable(rt));
        const b = mergeWaProjection(durable(rt), provisional(o));
        expect(a?.providerState).toBe(b?.providerState);
        expect(a?.providerState).toBe(rt);
        expect(a?.stateAt).toBe(AT);
      }
    }
    expect(pares).toBe(21);
  });

  // ── §5 · varias provisionales: conjunto determinista ────────────────────
  it("dos resultados de acción sin fecha convergen por conjunto", () => {
    for (const x of OUTCOMES) {
      for (const y of OUTCOMES) {
        const a = mergeWaProjection(provisional(x), provisional(y));
        const b = mergeWaProjection(provisional(y), provisional(x));
        const esperado = winnerOf([estadoDeOutcome(x), estadoDeOutcome(y)]);
        expect(a?.providerState).toBe(b?.providerState);
        expect(a?.providerState).toBe(esperado);
        expect(a?.stateAt).toBeNull();
      }
    }
  });

  it("tres proyecciones sin fecha convergen en TODAS sus permutaciones", () => {
    for (const x of OUTCOMES) {
      for (const y of OUTCOMES) {
        for (const z of OUTCOMES) {
          const estados = [x, y, z].map(estadoDeOutcome);
          const huellas = new Set(
            permutaciones([x, y, z]).map((orden) => {
              const r = orden.reduce<WaProjection | undefined>(
                (acc, o) => mergeWaProjection(acc, provisional(o)),
                undefined,
              );
              return `${r?.providerState}|${[...(r?.candidates ?? [])].join(",")}`;
            }),
          );
          expect(huellas.size).toBe(1);
          const r = [x, y, z].reduce<WaProjection | undefined>(
            (acc, o) => mergeWaProjection(acc, provisional(o)),
            undefined,
          );
          expect(r?.providerState).toBe(winnerOf(estados));
        }
      }
    }
  });

  // ── §4 · lo provisional nunca pisa lo fechado ───────────────────────────
  it.each(WA_REALTIME_STATUSES)(
    "un evento sin fecha posterior a %s fechado es no-op",
    (rt) => {
      const base = durable(rt);
      for (const o of OUTCOMES) {
        const r = mergeWaProjection(base, provisional(o));
        expect(r?.providerState).toBe(rt);
        expect(r?.stateAt).toBe(AT);
        expect([...(r?.candidates ?? [])]).toEqual([rt]);
      }
    },
  );

  // ── §2 sobre un conjunto provisional ambiguo ────────────────────────────
  it("un evento fechado reemplaza incluso a un conjunto provisional AMBIGUO", () => {
    const ambiguoProvisional = mergeWaProjection(provisional("sent"), provisional("failed"));
    expect(ambiguoProvisional?.providerState).toBeNull();
    expect(ambiguoProvisional?.stateAt).toBeNull();

    for (const rt of WA_REALTIME_STATUSES) {
      const r = mergeWaProjection(ambiguoProvisional, durable(rt));
      expect(r?.providerState).toBe(rt);
      expect([...(r?.candidates ?? [])]).toEqual([rt]);
    }
  });

  it("y el orden inverso da lo mismo: lo provisional no puede pisarlo", () => {
    for (const rt of WA_REALTIME_STATUSES) {
      let r: WaProjection | undefined = durable(rt);
      r = mergeWaProjection(r, provisional("sent"));
      r = mergeWaProjection(r, provisional("failed"));
      expect(r?.providerState).toBe(rt);
    }
  });

  // ── §7 · fechas distintas: el contrato canónico no cambió ───────────────
  it("un evento fechado posterior sigue exigiendo alcanzabilidad canónica", () => {
    for (const from of WA_REALTIME_STATUSES) {
      for (const to of WA_REALTIME_STATUSES) {
        const r = mergeWaProjection(durable(from, AT), durable(to, AT_LATER));
        expect(r?.providerState).toBe(canTransition(from, to) || from === to ? to : from);
      }
    }
  });

  it("un evento fechado anterior sigue siendo no-op", () => {
    const r = mergeWaProjection(durable("delivered", AT_LATER), durable("failed", AT));
    expect(r?.providerState).toBe("delivered");
    expect(r?.stateAt).toBe(AT_LATER);
  });

  // ── idempotencia ────────────────────────────────────────────────────────
  it("repetir el mismo resultado de acción es idempotente", () => {
    for (const o of OUTCOMES) {
      const uno = mergeWaProjection(undefined, provisional(o));
      const tres = [o, o, o].reduce<WaProjection | undefined>(
        (acc, x) => mergeWaProjection(acc, provisional(x)),
        undefined,
      );
      expect(tres?.providerState).toBe(uno?.providerState);
      expect([...(tres?.candidates ?? [])]).toEqual([...(uno?.candidates ?? [])]);
    }
  });

  it("repetir el mismo evento durable es idempotente", () => {
    for (const rt of WA_REALTIME_STATUSES) {
      const r = [rt, rt, rt].reduce<WaProjection | undefined>(
        (acc, x) => mergeWaProjection(acc, durable(x)),
        undefined,
      );
      expect(r?.providerState).toBe(rt);
      expect([...(r?.candidates ?? [])]).toEqual([rt]);
    }
  });

  // ── §8 · lo cerrado antes sigue cerrado ─────────────────────────────────
  it("inbound sigue absorbente frente a provisional y durable", () => {
    const inbound = projectWaMessage({
      meta: { wa: { direction: "inbound" } }, externalMsgId: "wamid.IN",
    });
    for (const otra of [provisional("sent"), durable("delivered")]) {
      const r = mergeWaProjection(inbound, otra);
      expect(r?.direction).toBe("inbound");
      expect(r?.providerState).toBeNull();
      expect(r?.candidates).toEqual([]);
    }
  });

  it("la auditoría sigue exigiendo outbound y ganador único", () => {
    const auditado = { ...durable("delivered"), audited: true };
    expect(isAuditedConfirmation(auditado)).toBe(true);
    // Provisional posterior no la degrada…
    expect(isAuditedConfirmation(mergeWaProjection(auditado, provisional("pending")))).toBe(true);
    // `delivered` + `failed` NO es ambiguo: el canon prohíbe delivered→failed,
    // así que gana `delivered` y la confirmación se mantiene.
    const noAmbiguo = mergeWaProjection(auditado, durable("failed", AT));
    expect(noAmbiguo?.providerState).toBe("delivered");
    expect(isAuditedConfirmation(noAmbiguo)).toBe(true);

    // Un par realmente mutuamente alcanzable sí vuelve fail-closed.
    const auditadoSent = { ...durable("sent"), audited: true };
    expect(winnerOf(["sent", "failed"])).toBeNull();
    const empate = mergeWaProjection(auditadoSent, durable("failed", AT));
    expect(empate?.providerState).toBeNull();
    expect(empate?.audited).toBe(false);
    expect(isAuditedConfirmation(empate)).toBe(false);
  });

  it("la hidratación no cambió: sigue derivando de la proyección fechada", () => {
    expect(hydrateMessageState("whatsapp", durable("failed")).status).toBe("failed");
    expect(hydrateMessageState("whatsapp", { ...durable("delivered"), audited: true }).status)
      .toBeUndefined();
    expect(hydrateMessageState("dm", durable("delivered"))).toEqual({
      wa: undefined, status: undefined,
    });
  });
});

// ══ WA-8R7 · PROCEDENCIA Y DOMINIOS DE RELOJ ═══════════════════════════════
/**
 * HIGH del re-C4 de WA-8R6: `meta.wa.status_at` mezclaba el reloj del servidor
 * (milisegundos) con el de Meta (segundos enteros). Un `failed` real de Meta a
 * las `12:00:03.000Z` parecía anterior a un `sent` local de `12:00:03.500Z`, se
 * descartaba, y la burbuja seguía mostrando éxito auditado hasta el reload.
 *
 * Los instantes sólo se comparan DENTRO de un dominio; entre dominios manda la
 * procedencia. `canTransition` sigue gobernando las transiciones.
 */
describe("WA-8R7 · procedencia del estado", () => {
  const SRV_AT = "2026-08-10T12:00:03.500Z"; // reloj servidor
  const META_AT = "2026-08-10T12:00:03.000Z"; // reloj Meta, mismo segundo
  const META_LATER = "2026-08-10T12:00:09.000Z";

  const srv = (st: WaProviderState, at = SRV_AT, audited = false) =>
    outbound(st, { at, audited, source: "server" });
  const mt = (st: WaProviderState, at = META_AT, audited = false) =>
    outbound(st, { at, audited, source: "meta" });

  const SERVER_STATES: WaProviderState[] = [
    "queued", "sending", "sent", "failed", "reconciliation_required",
  ];
  const META_STATES: WaProviderState[] = ["sent", "delivered", "read", "failed"];

  // ── el ataque principal ─────────────────────────────────────────────────
  it("el ataque principal termina failed en ambos órdenes", () => {
    const a = mergeWaProjection(srv("sent", SRV_AT, true), mt("failed"));
    const b = mergeWaProjection(mt("failed"), srv("sent", SRV_AT, true));

    expect(a?.providerState).toBe("failed");
    expect(b?.providerState).toBe("failed");
    expect(bubbleStatusFromProjection(a)).toBe("failed");
    expect(bubbleStatusFromProjection(b)).toBe("failed");
    // Y el marcador anterior no puede disfrazarlo de éxito.
    expect(isAuditedConfirmation(a)).toBe(false);
    expect(isAuditedConfirmation(b)).toBe(false);
  });

  it("Meta nunca pierde contra server por diferencia de milisegundos", () => {
    // El instante de Meta es textualmente ANTERIOR en todos estos casos, y aun
    // así el hecho observado por el proveedor desplaza al estado local.
    for (const st of META_STATES) {
      for (const local of SERVER_STATES) {
        expect(mergeWaProjection(srv(local, SRV_AT), mt(st, META_AT))?.providerState).toBe(st);
      }
    }
  });

  /**
   * El único par donde el reemplazo cruzado se separa de `canTransition`.
   *
   * El canon prohíbe `reconciliation_required → failed` porque un `failed`
   * NUESTRO no puede pisar una reconciliación pendiente: no sabemos si el
   * mensaje salió. Un `failed` observado por META es exactamente la información
   * que resuelve esa incógnita, y bloquearlo dejaría la burbuja «pendiente»
   * para siempre además de volver el resultado dependiente del orden.
   */
  it("Meta failed resuelve una reconciliación pendiente del servidor", () => {
    expect(canTransition("reconciliation_required", "failed")).toBe(false);

    const a = mergeWaProjection(srv("reconciliation_required"), mt("failed"));
    const b = mergeWaProjection(mt("failed"), srv("reconciliation_required"));
    expect(a?.providerState).toBe("failed");
    expect(b?.providerState).toBe("failed");
    expect(bubbleStatusFromProjection(a)).toBe("failed");
  });

  it("pero DENTRO del dominio Meta el canon sigue prohibiendo delivered/read → failed", () => {
    for (const observado of ["delivered", "read"] as WaProviderState[]) {
      const r = mergeWaProjection(mt(observado), mt("failed", META_LATER));
      expect(r?.providerState).toBe(observado);
    }
    // Y dentro del dominio server, la reconciliación sigue protegida.
    const s2 = mergeWaProjection(
      srv("reconciliation_required"),
      srv("failed", "2026-08-10T12:00:09.500Z"),
    );
    expect(s2?.providerState).toBe("reconciliation_required");
  });

  it("un estado server NUNCA regresa un estado Meta ya observado", () => {
    for (const observado of META_STATES) {
      for (const local of SERVER_STATES) {
        for (const at of [SRV_AT, "2026-08-10T23:59:59.999Z"]) {
          const r = mergeWaProjection(mt(observado, META_AT), srv(local, at));
          expect(r?.providerState).toBe(observado);
          expect(r?.stateSource).toBe("meta");
        }
      }
    }
  });

  it("todos los pares válidos server × Meta convergen en ambos órdenes", () => {
    let pares = 0;
    for (const local of SERVER_STATES) {
      for (const observado of META_STATES) {
        pares++;
        const a = mergeWaProjection(srv(local), mt(observado));
        const b = mergeWaProjection(mt(observado), srv(local));
        expect(a?.providerState).toBe(b?.providerState);
      }
    }
    expect(pares).toBe(20);
  });

  // ── dentro de cada dominio, el reloj sí ordena ──────────────────────────
  it("pares, ternas y duplicados dentro del dominio Meta convergen", () => {
    for (const a of META_STATES) {
      for (const b of META_STATES) {
        for (const c of META_STATES) {
          const huellas = new Set(
            permutaciones([a, b, c]).map((orden) => {
              const r = orden.reduce<WaProjection | undefined>(
                (acc, st) => mergeWaProjection(acc, mt(st, META_AT)),
                undefined,
              );
              return `${r?.providerState}|${[...(r?.candidates ?? [])].join(",")}`;
            }),
          );
          expect(huellas.size).toBe(1);
          expect(
            [a, b, c].reduce<WaProjection | undefined>(
              (acc, st) => mergeWaProjection(acc, mt(st, META_AT)),
              undefined,
            )?.providerState,
          ).toBe(winnerOf([a, b, c]));
        }
      }
    }
  });

  it("mismo segundo Meta con estados contradictorios ⇒ ambigüedad", () => {
    const r = mergeWaProjection(mt("sent"), mt("failed"));
    expect(winnerOf(["sent", "failed"])).toBeNull();
    expect(r?.providerState).toBeNull();
    expect(r?.audited).toBe(false);
    expect(bubbleStatusFromProjection(r)).toBe("pending");
  });

  it("un evento Meta posterior resuelve sólo si el canon lo permite", () => {
    const ambiguo = mergeWaProjection(mt("sent"), mt("failed"));
    for (const st of META_STATES) {
      const alcanzable = ["sent", "failed"].every(
        (c) => c === st || canTransition(c as WaProviderState, st),
      );
      const r = mergeWaProjection(ambiguo, mt(st, META_LATER));
      expect(r?.providerState).toBe(alcanzable ? st : null);
    }
  });

  // ── unknown ─────────────────────────────────────────────────────────────
  it("unknown nunca confirma ni pisa una fuente conocida", () => {
    const desconocido = outbound("delivered", { at: META_AT, audited: true, source: "unknown" });
    expect(isAuditedConfirmation(desconocido)).toBe(false);

    for (const conocido of [srv("sent"), mt("delivered", META_AT, true)]) {
      const r = mergeWaProjection(conocido, desconocido);
      expect(r?.providerState).toBe(conocido.providerState);
      expect(r?.stateSource).toBe(conocido.stateSource);
    }
  });

  it("una fuente conocida sí desplaza a una desconocida", () => {
    const desconocido = outbound("delivered", { at: META_AT, source: "unknown" });
    const r = mergeWaProjection(desconocido, mt("read", META_LATER));
    expect(r?.providerState).toBe("read");
    expect(r?.stateSource).toBe("meta");
  });

  it.each([
    ["server con delivered", "server", "delivered"],
    ["server con read", "server", "read"],
    ["meta con queued", "meta", "queued"],
    ["meta con sending", "meta", "sending"],
    ["meta con reconciliation_required", "meta", "reconciliation_required"],
    ["fuente inventada", "otro", "sent"],
    ["fuente numérica", 7, "sent"],
    ["fuente ausente", undefined, "sent"],
  ])("par fuente/estado inválido (%s) queda sin acreditar", (_l, source, status) => {
    const wa = projectWaMessage({
      meta: {
        wa: {
          direction: "outbound", status, status_at: META_AT,
          ...(source === undefined ? {} : { status_source: source }),
          audit_sent: { wamid: WAMID, at: AT },
        },
      },
      externalMsgId: WAMID,
    });
    // WA-8R9 · hay estado registrado pero la procedencia no se puede acreditar:
    // es exactamente la definición de fila HISTÓRICA.
    expect(wa.stateSource).toBe("historical_unknown");
    expect(wa.audited).toBe(false);
    expect(bubbleStatusFromProjection(wa)).not.toBeUndefined();
    expect(bubbleStatusFromProjection(wa)).toBe("historical");
  });

  it.each([
    ["server", "queued"], ["server", "sending"], ["server", "sent"],
    ["server", "failed"], ["server", "reconciliation_required"],
    ["meta", "sent"], ["meta", "delivered"], ["meta", "read"], ["meta", "failed"],
  ])("par válido (%s/%s) se reconoce", (source, status) => {
    const wa = projectWaMessage({
      meta: { wa: { direction: "outbound", status, status_source: source, status_at: META_AT } },
      externalMsgId: WAMID,
    });
    expect(wa.stateSource).toBe(source);
  });

  // ── reload ≡ realtime ───────────────────────────────────────────────────
  it("reload y realtime producen exactamente el mismo estado", () => {
    const filas = [
      { meta: { wa: { direction: "outbound", status: "failed", status_source: "meta", status_at: META_AT } }, externalMsgId: WAMID },
      rowAuditada("delivered", META_AT),
      { meta: { wa: { direction: "outbound", status: "reconciliation_required", status_source: "server", status_at: SRV_AT } }, externalMsgId: null },
      { meta: { wa: { direction: "inbound" } }, externalMsgId: "wamid.IN" },
    ];
    for (const fila of filas) {
      const proyectada = projectWaMessage(fila);
      // Hidratación directa…
      const hidratado = hydrateMessageState("whatsapp", proyectada);
      // …y el mismo hecho llegando por realtime sobre una burbuja vacía.
      const porRealtime = reduceMessageState({
        kind: "whatsapp", source: "realtime",
        current: { wa: undefined, status: "sending" },
        incoming: proyectada,
      });
      expect(porRealtime.status).toBe(hidratado.status);
      expect(porRealtime.wa?.providerState).toBe(hidratado.wa?.providerState);
      expect(porRealtime.wa?.stateSource).toBe(hidratado.wa?.stateSource);
    }
  });

  it("inbound nunca muestra sending ni failed, venga de donde venga", () => {
    const inbound = projectWaMessage({
      meta: { wa: { direction: "inbound" } }, externalMsgId: "wamid.IN",
    });
    for (const otra of [srv("failed"), mt("failed"), mt("delivered", META_AT, true)]) {
      const r = mergeWaProjection(inbound, otra);
      expect(bubbleStatusFromProjection(r)).toBeUndefined();
      expect(r?.providerState).toBeNull();
      expect(r?.stateSource).toBe("unknown");
    }
  });

  it("la procedencia no filtra campos sensibles", () => {
    const wa = projectWaMessage(rowAuditada("delivered", META_AT));
    expect(["server", "meta", "unknown"]).toContain(wa.stateSource);
    const dump = JSON.stringify(wa);
    for (const marca of [WAMID, "audit_sent", "status_at", "Bearer"]) {
      expect(dump).not.toContain(marca);
    }
  });
});

// ══ WA-8R7 · TEST ESTRUCTURAL DE LOS WRITERS ═══════════════════════════════
describe("WA-8R7 · quién escribe la procedencia", () => {
  const leer = (ruta: string) =>
    readFileSync(resolve(process.cwd(), ruta), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");

  const REPLY = leer("src/lib/whatsapp/reply.supabase.ts");
  const PROJ = leer("src/lib/whatsapp/link-projection.supabase.ts");

  it("todo writer de estado del outbound declara procedencia `server`", () => {
    expect(REPLY).toMatch(/WA_STATUS_SOURCE_SERVER\s*=\s*"server"/);
    // Cada escritura de `status` estampa también `status_at` y la procedencia.
    // WA-8R8 · `stamp` valida el instante antes de escribir, así que usa la
    // variable `at` en vez de `clock.now()` inline: se cuenta por `status:`.
    // WA-8R9 · `stamp` y `markAudited` dejaron de armar UPDATEs: delegan en las
    // RPC transaccionales. Quedan DOS escritores en línea —`claimSending` y
    // `sealSent`— y ambos siguen estampando la procedencia junto al instante.
    const escrituras = REPLY.match(/status:\s*(patch\.status|"[a-z_]+")\s*,\n\s*status_at:/g) ?? [];
    const fuentes = REPLY.match(/status_source:\s*WA_STATUS_SOURCE_SERVER,/g) ?? [];
    expect(escrituras.length).toBe(2); // claimSending · sealSent
    expect(fuentes.length).toBe(escrituras.length);
    // Y `stamp` declara la suya como argumento de la RPC, nunca desde la entrada.
    expect(REPLY).toMatch(/p_source:\s*WA_STATUS_SOURCE_SERVER/);
  });

  it("el adaptador del webhook declara procedencia `meta`", () => {
    expect(PROJ).toMatch(/WA_STATUS_SOURCE_META\s*=\s*"meta"/);
    // WA-8R9 · el estado ya no se escribe con un UPDATE armado en el cliente:
    // se delega en `connect_wa_apply_status`, que decide bajo el lock de la
    // fila. La procedencia sigue siendo responsabilidad de ESTE adaptador —el
    // único que sabe que el hecho viene de un webhook— y viaja como argumento.
    expect(PROJ).toMatch(/connect_wa_apply_status/);
    const bloque = PROJ.slice(
      PROJ.indexOf("connect_wa_apply_status"),
      PROJ.indexOf("connect_wa_apply_status") + 400,
    );
    expect(bloque).toContain("p_source: WA_STATUS_SOURCE_META");
    expect(bloque).toContain("p_at: status.at");
    // Y ya no queda ningún UPDATE de estado armado a mano en este adaptador.
    expect(PROJ).not.toMatch(/status_source:\s*WA_STATUS_SOURCE_META/);
  });

  it("ninguna entrada pública permite elegir la fuente", () => {
    // Ni el sink de auditoría, ni el parser de entrada del composer, ni el
    // dispatcher admiten `status_source` como clave.
    for (const ruta of [
      "src/lib/whatsapp/reply-action-core.ts",
      "src/lib/connect/composer-dispatch.ts",
      "src/app/(app)/connect/_components/ThreadView.tsx",
    ]) {
      expect(leer(ruta)).not.toContain("status_source");
    }
    // En los writers, la fuente es SIEMPRE la constante local: nunca una
    // variable, un parámetro ni algo derivado de la entrada.
    for (const src of [REPLY, PROJ]) {
      // Las DOS claves que declaran procedencia de estado: la del UPDATE
      // directo (`status_source`) y la del argumento de la RPC (`p_source`).
      // Acotado a propósito: un `source:` suelto pertenece a otro campo —el
      // origen de la conversación— y no tiene nada que ver con esta regla.
      const usos = src.match(/(?:status_source|p_source):\s*([A-Za-z_.\[\]"']+)/g) ?? [];
      expect(usos.length).toBeGreaterThan(0);
      for (const uso of usos) {
        expect(uso).toMatch(/WA_STATUS_SOURCE_(SERVER|META)/);
      }
    }
  });
});

// ══ WA-8R8 · §5.13 · las filas HISTÓRICAS no se confirman sin evidencia ════
/**
 * Dos poblaciones anteriores a WA-8R7 conviven en la tabla y ninguna trae
 * procedencia:
 *
 *  a) filas del outbound escritas antes de que existiera `status_source`:
 *     tienen estado y sello, pero nada dice quién observó ese estado;
 *  b) filas del import histórico de conversaciones (`wa-import/ingest`): se
 *     insertan SIN `meta` y con un `external_msg_id` que es un sha256 nuestro,
 *     NO un wamid de Meta. Tener sello ahí no significa "salió por Meta".
 *
 * Ambas deben leerse como no confirmadas. El riesgo que se cierra es el
 * inverso al intuitivo: no es que se vean "pendientes de más", es que un
 * `delivered` sin procedencia se pintaría como hecho verificado del proveedor
 * cuando nadie puede acreditar que Meta lo dijo.
 *
 * Por eso el backfill es un trabajo de ventana DB y no de código: acá sólo se
 * fija que, sin evidencia, la UI no inventa una confirmación.
 */
describe("WA-8R8 · §5.13 · procedencia ausente ⇒ jamás confirmado", () => {
  const HIST_AT = "2026-01-15T10:00:00.000Z";
  // Reloj de Meta: segundos enteros, otro dominio que el del servidor.
  const EVID_AT = "2026-08-09T10:00:00.000Z";

  it.each(["sent", "delivered", "read", "failed"])(
    "fila histórica del outbound en %s no queda auditada ni con procedencia",
    (status) => {
      const wa = projectWaMessage({
        // Exactamente lo que dejaba el escritor anterior: sin `status_source`.
        meta: { wa: { direction: "outbound", status, status_at: HIST_AT } },
        externalMsgId: WAMID,
      });
      // WA-8R9 · el histórico tiene NOMBRE propio: hay estado registrado, pero
      // su procedencia no se puede acreditar.
      expect(wa.stateSource).toBe("historical_unknown");
      expect(wa.audited).toBe(false);
      // Y nunca se anuncia como envío en curso ni como entregado.
      expect(bubbleStatusFromProjection(wa)).toBe("historical");
      expect(bubbleStatusFromProjection(wa)).not.toBe("pending");
      expect(bubbleStatusFromProjection(wa)).not.toBeUndefined();
    },
  );

  it("una fila histórica CON marcador de auditoría tampoco se acredita", () => {
    // El marcador solo no alcanza: sin procedencia no se sabe qué observó Meta.
    const wa = projectWaMessage({
      meta: {
        wa: {
          direction: "outbound", status: "delivered", status_at: HIST_AT,
          audit_sent: { wamid: WAMID, at: HIST_AT },
        },
      },
      externalMsgId: WAMID,
    });
    expect(wa.stateSource).toBe("historical_unknown");
    expect(wa.audited).toBe(false);
    expect(bubbleStatusFromProjection(wa)).toBe("historical");
  });

  it("fila del import histórico: sin `meta` y con sello propio, no es un envío de Meta", () => {
    const wa = projectWaMessage({
      meta: {},
      // `externalMsgId` del import es un sha256, no un `wamid.` de Meta.
      externalMsgId: "3f2a9c1b4e5d6f708192a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f8",
    });
    expect(wa.stateSource).toBe("unknown");
    expect(wa.audited).toBe(false);
    expect(wa.providerState).toBeNull();
  });

  it("un hecho nuevo CON procedencia sí gana sobre la fila histórica", () => {
    // La remediación no congela las filas viejas: cierra la confirmación falsa.
    // En cuanto llega evidencia de Meta, la proyección la reconoce.
    const historica = projectWaMessage({
      meta: { wa: { direction: "outbound", status: "sent", status_at: HIST_AT } },
      externalMsgId: WAMID,
    });
    const conEvidencia = projectWaMessage({
      meta: {
        wa: {
          direction: "outbound", status: "delivered",
          status_source: "meta", status_at: EVID_AT,
        },
      },
      externalMsgId: WAMID,
    });
    const r = mergeWaProjection(historica, conEvidencia);
    expect(r?.stateSource).toBe("meta");
    expect(r?.providerState).toBe("delivered");
  });
});
