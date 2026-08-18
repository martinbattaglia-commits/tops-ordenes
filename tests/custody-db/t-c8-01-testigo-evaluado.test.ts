/**
 * T-C8-01 · EL TESTIGO DE LA PUNTA EVALUADA (0258) · CAPA 3 + E2E (R-19).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * EL DEFECTO, EJECUTADO
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `complete_custody_integrity_evaluation_v2` escribe el head evaluado en
 * `chain_head` y `decide_custody_integrity_v2` (0251:248) lo SOBRESCRIBE con
 * el head vivo al decidir — que incluye la foto de inspección. El predicado
 * `is_custody_inspection_evidence_v2` resolvía el eslabón evaluado contra
 * `c.chain_head`, así que POST-decisión la condición
 * `ev.chain_seq > eval_ev.chain_seq` se volvía imposible para la evidencia que
 * la propia decisión validó: toda re-derivación canónica daba vacío.
 *
 * 0258 agrega el testigo `chain_head_at_evaluation` —escrito por complete_v2
 * en el MISMO punto, jamás tocado por decide_v2— y el predicado resuelve
 * contra `coalesce(testigo, chain_head)`.
 *
 * El ROJO se exhibe acá mismo: anular el testigo como dueño del esquema deja
 * la fila EXACTAMENTE como quedaba antes de 0258 (el coalesce cae a
 * `chain_head`, que es lo que el predicado viejo leía), y la re-derivación da
 * vacío. Con el testigo, devuelve exactamente el conjunto que la decisión
 * registró.
 *
 * El E2E ejecuta el MISMO código puro que usa la Server Action
 * (`buildIntegrityCase`, `buildDocumentChain`, `evaluateCertificateEligibility`)
 * sobre lecturas reales de la base, con la RPC de lectura de 0258 corriendo
 * bajo el rol real de PostgREST. `resolveCustodyDocument` no se importa porque
 * vive tras `server-only`; sus dos derivaciones (`kind` ⇔ blockers vacíos,
 * `missingPersistedRow` ⇔ certificado sin fila) se afirman por separado.
 */
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { createHash } from "node:crypto";
import { Client } from "pg";
import {
  actAs,
  actAsServer,
  actAsWithSession,
  baseScenario,
  createActor,
  createClient as createErpClient,
  expectFailure,
  uid,
  type Scenario,
} from "./harness/fixtures";
import {
  buildIntegrityCase,
  type CustodyQueryPort,
  type RawCaseRow,
  type RawDecisionRow,
  type RawEvidenceRow,
} from "../../src/lib/custody/integrity-adapters";
import { buildDocumentChain } from "../../src/lib/custody/integrity/certificate-document";
import { evaluateCertificateEligibility } from "../../src/lib/custody/integrity/certificate-policy";
import type { CertificateContext } from "../../src/lib/custody/integrity/certificate-policy";

let db: Client;
let s: Scenario;

beforeAll(async () => {
  db = new Client({ connectionString: inject("custodyDbUrl") });
  await db.connect();
  s = await baseScenario(db);
});

afterAll(async () => {
  await db.end();
});

const sha = (t: string) => createHash("sha256").update(t).digest("hex");

/** Rol REAL de PostgREST, patrón de t-c7-04. */
async function asDbRole<T>(role: string, fn: () => Promise<T>): Promise<T> {
  await db.query(`set role ${role}`);
  try {
    return await fn();
  } finally {
    await db.query(`reset role`);
  }
}

/** Ítem recibido ⇒ 0250a materializa unidad física y caso. Patrón de t-c7-04. */
async function unidadFisica(): Promise<{ unitId: string; caseId: string }> {
  await actAsServer(db);
  const { rows: inv } = await db.query<{ id: string }>(
    `insert into public.inventory_items (sku, description, client_name, client_id, stock_available)
     values ($1, 'Bien de prueba', 'DEPOSITANTE', $2, 3) returning id`,
    [uid("SKU"), s.clientId],
  );
  const { rows: rec } = await db.query<{ id: string }>(
    `insert into public.receptions (public_id, client_name, client_id, status, received_at)
     values ($1, 'DEPOSITANTE', $2, 'recibida', now()) returning id`,
    [uid("REC"), s.clientId],
  );
  const { rows: it } = await db.query<{ id: string }>(
    `insert into public.reception_items
       (reception_id, business_unit, sku, description, lot_number, expiration_date,
        quantity, status, inventory_item_id)
     values ($1, 'GENERAL', $2, 'Bien de prueba', 'LOT-C8', '2027-08-31', 3, 'recibido', $3)
     returning id`,
    [rec[0].id, uid("SKU"), inv[0].id],
  );
  const { rows: pu } = await db.query<{ id: string }>(
    `select id from public.custody_physical_units where reception_item_id = $1`,
    [it[0].id],
  );
  const { rows: c } = await db.query<{ id: string }>(
    `select id from public.custody_integrity_cases where physical_unit_id = $1`,
    [pu[0].id],
  );
  return { unitId: pu[0].id, caseId: c[0].id };
}

async function adjuntar(
  unitId: string,
  stage: "recepcion" | "despacho",
  eventType: "foto_ingreso" | "foto_egreso" | "inspeccion_humana",
  contenido: string,
): Promise<{ evidenceId: string; sha256: string }> {
  const digest = sha(contenido);
  const path = `physical_unit/${unitId}/${stage}/${uid("obj")}.png`;

  await actAsServer(db);
  const { rows: att } = await db.query<{ id: string }>(
    `select public.attest_custody_physical_content(
       'custody-evidence', $1, $2, $3, 'image/png', $4::uuid, $5::uuid, $6::uuid,
       $7::public.custody_stage_t, $8::public.custody_event_type_t, 900) as id`,
    [path, digest, contenido.length, s.staff.userId, s.staff.sessionId, unitId, stage, eventType],
  );

  await actAsWithSession(db, s.staff, s.staff.sessionId);
  const { rows: at } = await db.query<{ r: { evidence_id: string } }>(
    `select public.attach_custody_physical_evidence(
       $1::uuid, $2::public.custody_stage_t, $3::public.custody_event_type_t,
       $4, $5::uuid, 'foto.png', null, null, null) as r`,
    [unitId, stage, eventType, path, att[0].id],
  );
  return { evidenceId: at[0].r.evidence_id, sha256: digest };
}

async function versionDelCaso(caseId: string): Promise<number> {
  const { rows } = await db.query<{ version: number }>(
    `select version from public.custody_integrity_cases where id = $1`,
    [caseId],
  );
  return rows[0].version;
}

interface CasoPerfecto {
  unitId: string;
  caseId: string;
  inspEvidenceId: string;
  headEvaluado: string;
}

/** El caso PERFECTO decidido, por el camino que escribe el certificado. */
async function casoPerfectoDecidido(etiqueta: string): Promise<CasoPerfecto> {
  const { unitId, caseId } = await unidadFisica();
  const ing = await adjuntar(unitId, "recepcion", "foto_ingreso", `INGRESO-${etiqueta}`);
  const egr = await adjuntar(unitId, "despacho", "foto_egreso", `EGRESO-${etiqueta}`);

  await actAsWithSession(db, s.staff, s.staff.sessionId);
  const { rows: beg } = await db.query<{ attempt_id: string; case_version: number }>(
    `select attempt_id, case_version from public.begin_custody_integrity_evaluation_v2($1, $2)`,
    [caseId, await versionDelCaso(caseId)],
  );

  await actAsServer(db);
  await db.query(
    `select public.complete_custody_integrity_evaluation_v2(
       $1::uuid, $2::uuid, $3, $4, $5,
       '{"identity":98,"packaging":97,"quantity":98,"condition":97}'::jsonb,
       0.95, 'coincide', false, false, false,
       $6, 'gpt-5.4-mini-2026-03-17', $7, $8, $9, '{}'::jsonb)`,
    [
      beg[0].attempt_id, caseId, beg[0].case_version, ing.sha256, egr.sha256,
      `resp-${etiqueta}`, `fp-${etiqueta}`, sha(`req-${etiqueta}`), sha(`res-${etiqueta}`),
    ],
  );

  // ⚖ decide_v2 CONSERVA comportamiento: recién evaluado, testigo ≡ chain_head.
  const { rows: post } = await db.query<{ chain_head: string; chain_head_at_evaluation: string }>(
    `select chain_head, chain_head_at_evaluation
       from public.custody_integrity_cases where id = $1`,
    [caseId],
  );
  expect(post[0].chain_head_at_evaluation).toBe(post[0].chain_head);
  const headEvaluado = post[0].chain_head_at_evaluation;

  const insp = await adjuntar(unitId, "despacho", "inspeccion_humana", `INSPECCION-${etiqueta}`);

  await actAsWithSession(db, s.decider, s.decider.sessionId);
  await db.query(
    `select public.decide_custody_integrity_v2(
       $1::uuid, $2, 'release',
       'Inspección física completa: la mercadería coincide con la foto de ingreso.',
       null, array[$3::uuid])`,
    [caseId, await versionDelCaso(caseId), insp.evidenceId],
  );
  return { unitId, caseId, inspEvidenceId: insp.evidenceId, headEvaluado };
}

/** Re-derivación canónica como dueño del esquema (el predicado es el mismo). */
async function rederivar(unitId: string, caseId: string): Promise<string[]> {
  const { rows } = await db.query<{ id: string }>(
    `select e.id from public.custody_evidence e
      join public.custody_events ev on ev.id = e.event_id
     where ev.physical_unit_id = $1
       and public.is_custody_inspection_evidence_v2(e.id, $2)`,
    [unitId, caseId],
  );
  return rows.map((r) => r.id);
}

describe("T-C8-01 · capa 3 · el testigo sobrevive a la decisión", () => {
  it("VERDE · post-decisión, la re-derivación devuelve EXACTAMENTE el conjunto registrado — y ROJO · sin testigo (estado pre-0258), da vacío", async () => {
    const caso = await casoPerfectoDecidido("C8-CAPA3");
    await actAsServer(db);

    // El testigo NO fue sobrescrito por decide_v2 y difiere del head decidido.
    const { rows: c } = await db.query<{
      chain_head: string; chain_head_at_evaluation: string; decision_id: string;
    }>(
      `select chain_head, chain_head_at_evaluation, decision_id
         from public.custody_integrity_cases where id = $1`,
      [caso.caseId],
    );
    expect(c[0].chain_head_at_evaluation).toBe(caso.headEvaluado);
    expect(c[0].chain_head).not.toBe(caso.headEvaluado);

    // Lo que la decisión registró (0251:243-244).
    const { rows: reg } = await db.query<{ evidence_id: string }>(
      `select evidence_id from public.custody_integrity_inspection_evidence
        where decision_id = $1`,
      [c[0].decision_id],
    );
    expect(reg.map((r) => r.evidence_id)).toEqual([caso.inspEvidenceId]);

    // VERDE: la re-derivación coincide con lo registrado.
    expect(await rederivar(caso.unitId, caso.caseId)).toEqual([caso.inspEvidenceId]);

    // ROJO, exhibido: sin testigo la fila queda EXACTAMENTE como antes de 0258
    // (el coalesce cae a chain_head, que es lo que el predicado viejo leía) y
    // la re-derivación da vacío: el defecto que re-bloqueaba el documento.
    await db.query(
      `update public.custody_integrity_cases set chain_head_at_evaluation = null where id = $1`,
      [caso.caseId],
    );
    expect(await rederivar(caso.unitId, caso.caseId)).toEqual([]);

    // Se restaura el testigo para no dejar el escenario mutado.
    await db.query(
      `update public.custody_integrity_cases set chain_head_at_evaluation = $2 where id = $1`,
      [caso.caseId, caso.headEvaluado],
    );
    expect(await rederivar(caso.unitId, caso.caseId)).toEqual([caso.inspEvidenceId]);
  });
});

describe("T-C8-01 · la RPC de lectura 0258 y su compuerta (rol→permiso MEDIDO)", () => {
  it("supervisor —sin wms.edit ni wms.custody.decide— obtiene atestación viva y canónico", async () => {
    const caso = await casoPerfectoDecidido("C8-SUP");
    const otroCliente = await createErpClient(db);
    const supervisor = await createActor(db, "supervisor", otroCliente);

    const doc = await asDbRole("authenticated", async () => {
      await actAs(db, supervisor);
      const { rows } = await db.query<{ d: { attestation: { status: string; verified_event_ids: string[] }; canonical_inspection_evidence_ids: string[] } }>(
        `select public.custody_certificate_document_v2($1) as d`,
        [caso.caseId],
      );
      return rows[0].d;
    });
    expect(doc.attestation.status).toBe("verified");
    expect(doc.attestation.verified_event_ids.length).toBeGreaterThan(0);
    expect(doc.canonical_inspection_evidence_ids).toEqual([caso.inspEvidenceId]);
  });

  it("el cliente DUEÑO lee su contexto documental", async () => {
    const caso = await casoPerfectoDecidido("C8-CLI");
    const propio = await createActor(db, "cliente", s.clientId);
    const doc = await asDbRole("authenticated", async () => {
      await actAs(db, propio);
      const { rows } = await db.query<{ d: { attestation: { status: string } } }>(
        `select public.custody_certificate_document_v2($1) as d`,
        [caso.caseId],
      );
      return rows[0].d;
    });
    expect(doc.attestation.status).toBe("verified");
  });

  it("⚠ un cliente AJENO no lee nada: insufficient_privilege", async () => {
    const caso = await casoPerfectoDecidido("C8-AJENO");
    const otroCliente = await createErpClient(db);
    const ajeno = await createActor(db, "cliente", otroCliente);
    const msg = await asDbRole("authenticated", async () => {
      await actAs(db, ajeno);
      return expectFailure(() =>
        db.query(`select public.custody_certificate_document_v2($1)`, [caso.caseId]),
      );
    });
    expect(msg).toContain("documento fuera de alcance");
  });

  it("sin sesión tampoco", async () => {
    const caso = await casoPerfectoDecidido("C8-ANON");
    const msg = await asDbRole("authenticated", async () => {
      await actAs(db, null);
      return expectFailure(() =>
        db.query(`select public.custody_certificate_document_v2($1)`, [caso.caseId]),
      );
    });
    expect(msg.length).toBeGreaterThan(0);
  });
});

// ─── E2E · el MISMO código puro de la Server Action, sobre lecturas reales ──

function pgPort(caseRow: RawCaseRow): CustodyQueryPort {
  return {
    selectCase: async () => caseRow,
    async selectDecision(decisionId: string) {
      const { rows } = await db.query<{ j: RawDecisionRow }>(
        `select row_to_json(d)::jsonb as j from public.custody_integrity_decisions d where d.id = $1`,
        [decisionId],
      );
      return rows[0]?.j ?? null;
    },
    async selectEvidence(ids: readonly string[]) {
      if (ids.length === 0) return [];
      const { rows } = await db.query<{ j: RawEvidenceRow }>(
        `select jsonb_build_object(
            'id', e.id, 'event_id', e.event_id, 'kind', e.kind, 'sha256', e.sha256,
            'redacted', e.redacted, 'captured_at', to_jsonb(e.captured_at) #>> '{}',
            'event', jsonb_build_object(
              'physical_unit_id', ev.physical_unit_id, 'packing_unit_id', ev.packing_unit_id,
              'shipment_id', ev.shipment_id, 'stage', ev.stage, 'event_type', ev.event_type,
              'occurred_at', to_jsonb(ev.occurred_at) #>> '{}')) as j
           from public.custody_evidence e
           join public.custody_events ev on ev.id = e.event_id
          where e.id = any($1::uuid[])`,
        [[...ids]],
      );
      return rows.map((r) => r.j);
    },
    async verifyChainHead(_scope, entityId) {
      const { rows } = await db.query<{ row_hash: string | null }>(
        `select row_hash from public.custody_events where physical_unit_id = $1
          order by chain_seq desc limit 1`,
        [entityId],
      );
      return rows[0]?.row_hash ?? null;
    },
    selectProfile: async () => null,
    selectPermissions: async () => [],
    decide: async () => {
      throw new Error("no se decide en el E2E de lectura");
    },
    beginEvaluation: async () => {
      throw new Error("no se evalúa en el E2E de lectura");
    },
    selectInspectionCandidates: async () => [],
    selectActiveAttempt: async () => null,
    async selectDecisionInspectionEvidence(decisionId: string) {
      const { rows } = await db.query<{ evidence_id: string }>(
        `select evidence_id from public.custody_integrity_inspection_evidence
          where decision_id = $1`,
        [decisionId],
      );
      return rows.map((r) => r.evidence_id);
    },
  };
}

async function leerCaso(caseId: string): Promise<RawCaseRow> {
  const { rows } = await db.query<{ j: RawCaseRow }>(
    `select (row_to_json(c)::jsonb
             || jsonb_build_object(
                  'created_at', to_jsonb(c.created_at) #>> '{}',
                  'updated_at', to_jsonb(c.updated_at) #>> '{}',
                  'chain_attested_at', to_jsonb(c.chain_attested_at) #>> '{}')) as j
       from public.custody_integrity_cases c where c.id = $1`,
    [caseId],
  );
  return rows[0].j;
}

async function contextoDocumental(actorClientId: string, caseId: string, requesterClientId: string): Promise<{
  ctx: CertificateContext;
  persistida: boolean;
}> {
  const caseRow = await leerCaso(caseId);
  const found = await buildIntegrityCase(pgPort(caseRow), caseRow);

  const cliente = await createActor(db, "cliente", actorClientId);
  const raw = await asDbRole("authenticated", async () => {
    await actAs(db, cliente);
    const { rows } = await db.query<{ d: {
      attestation: {
        status: string; chain_head: string | null; events_checked: number | null;
        attested_at: string | null; verified_event_ids: string[] | null;
      };
      canonical_inspection_evidence_ids: string[] | null;
    } }>(
      `select public.custody_certificate_document_v2($1) as d`,
      [caseId],
    );
    return rows[0].d;
  });

  const live = {
    status: raw.attestation.status,
    chainHead: raw.attestation.chain_head,
    verifiedEventIds: raw.attestation.verified_event_ids ?? [],
  };
  const documentChain = buildDocumentChain(found.chain, live);
  const currentChainHead =
    live.status === "verified" && typeof live.chainHead === "string" && live.chainHead.length > 0
      ? live.chainHead
      : await pgPort(caseRow).verifyChainHead(found.entity.scope, found.entity.entityId);

  const evidenceEventIds = [found.evidence.ingress?.eventId, found.evidence.egress?.eventId]
    .filter((v): v is string => typeof v === "string" && v.length > 0);

  const { rows: pers } = await db.query(
    `select id from public.custody_release_certificates where case_id = $1`,
    [caseId],
  );

  return {
    ctx: {
      state: found.state,
      caseClientId: found.entity.clientId,
      requesterClientId,
      evidenceOk:
        found.evidence.ingress !== null &&
        found.evidence.egress !== null &&
        !found.holdReasons.some((r) => r.startsWith("EVIDENCE_")),
      evidenceEventIds,
      chain: documentChain,
      assessment: found.assessment,
      decision: found.decision,
      canonicalInspectionEvidenceIds: raw.canonical_inspection_evidence_ids ?? [],
      currentChainHead,
      issuedAt: new Date().toISOString(),
    },
    persistida: pers.length === 1,
  };
}

describe("T-C8-01 · E2E · certificado y acta", () => {
  it("ROJO (el árbol previo, reproducido literal) · caso perfecto ⇒ acta", async () => {
    const caso = await casoPerfectoDecidido("C8-E2E-ROJO");
    await actAsServer(db);
    const caseRow = await leerCaso(caso.caseId);
    const found = await buildIntegrityCase(pgPort(caseRow), caseRow);
    if (!found.decision) throw new Error("decisión ausente");

    // Pre-V4: mapDecision fijaba [], mapChain fijaba verifiedEventIds [] y el
    // canónico era un alias del declarado. Ese armado, ejecutado hoy:
    const declaradoPreV4: readonly string[] = [];
    const ctxViejo: CertificateContext = {
      state: found.state,
      caseClientId: found.entity.clientId,
      requesterClientId: found.entity.clientId,
      evidenceOk: true,
      evidenceEventIds: [found.evidence.ingress?.eventId ?? "", found.evidence.egress?.eventId ?? ""].filter(Boolean),
      chain: found.chain,
      assessment: found.assessment,
      decision: { ...found.decision, inspectionEvidenceIds: [...declaradoPreV4] },
      canonicalInspectionEvidenceIds: declaradoPreV4,
      currentChainHead: await pgPort(caseRow).verifyChainHead("physical_unit", caso.unitId),
      issuedAt: new Date().toISOString(),
    };
    const rojo = evaluateCertificateEligibility(ctxViejo);
    expect(rojo.document).toBe("acta_inspeccion");
    expect(rojo.blockers).toContain("EVIDENCE_NOT_LINKED");
    expect(rojo.blockers).toContain("NO_INSPECTION_EVIDENCE");
  });

  it("VERDE TERMINAL · caso perfecto ⇒ certificate, blockers [], fila persistida presente", async () => {
    const caso = await casoPerfectoDecidido("C8-E2E-VERDE");
    await actAsServer(db);
    const { ctx, persistida } = await contextoDocumental(s.clientId, caso.caseId, s.clientId);

    expect(ctx.decision?.inspectionEvidenceIds).toEqual([caso.inspEvidenceId]);
    expect(ctx.canonicalInspectionEvidenceIds).toEqual([caso.inspEvidenceId]);

    const verde = evaluateCertificateEligibility(ctx);
    expect(verde.blockers).toEqual([]);
    expect(verde.document).toBe("certificate");
    // resolveCustodyDocument: kind certificate + persisted ⇒ missingPersistedRow false.
    expect(persistida).toBe(true);
  });

  it("⚠ DIRECCIÓN DEL FAIL-CLOSED · NUNCA certificado donde correspondía acta", async () => {
    const caso = await casoPerfectoDecidido("C8-E2E-FC");
    await actAsServer(db);

    // (a) solicitante de otro tenant ⇒ acta (CLIENT_MISMATCH).
    const otro = await createErpClient(db);
    const a = await contextoDocumental(s.clientId, caso.caseId, otro);
    expect(evaluateCertificateEligibility(a.ctx).document).toBe("acta_inspeccion");

    // (b) el canónico re-derivado se pierde (estado pre-0258 simulado) ⇒ acta,
    // aunque la decisión declare sus ids.
    await db.query(
      `update public.custody_integrity_cases set chain_head_at_evaluation = null where id = $1`,
      [caso.caseId],
    );
    const b = await contextoDocumental(s.clientId, caso.caseId, s.clientId);
    expect(b.ctx.decision?.inspectionEvidenceIds).toEqual([caso.inspEvidenceId]);
    expect(b.ctx.canonicalInspectionEvidenceIds).toEqual([]);
    const rb = evaluateCertificateEligibility(b.ctx);
    expect(rb.document).toBe("acta_inspeccion");
    expect(rb.blockers).toContain("INSPECTION_SET_NOT_CANONICAL");
    await db.query(
      `update public.custody_integrity_cases set chain_head_at_evaluation = $2 where id = $1`,
      [caso.caseId, caso.headEvaluado],
    );

    // (c) la cadena avanza DESPUÉS de la liberación ⇒ acta por diseño
    // (límite 3 del expediente: la vigencia post-liberación es política
    // firmada). La RPC productiva rechaza adjuntar a un caso terminal —la
    // puerta de egreso de 0253, correcta—, así que el eslabón posterior se
    // inserta directo como dueño del esquema: el trigger de 0036 igual encadena
    // el hash y la cadena REALMENTE avanza.
    await db.query(
      `insert into public.custody_events
         (public_id, physical_unit_id, stage, event_type, row_hash)
       values ($1, $2, 'despacho'::public.custody_stage_t,
               'foto_egreso'::public.custody_event_type_t, 'PENDIENTE')`,
      [uid("EVT"), caso.unitId],
    );
    const c = await contextoDocumental(s.clientId, caso.caseId, s.clientId);
    const rc = evaluateCertificateEligibility(c.ctx);
    expect(rc.document).toBe("acta_inspeccion");
    expect(rc.blockers).toContain("DECISION_CHAIN_HEAD_MISMATCH");
  });
});
