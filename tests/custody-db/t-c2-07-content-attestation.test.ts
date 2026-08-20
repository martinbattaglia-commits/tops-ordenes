/**
 * T-C2-07 · W22-TER-C/M2 — ATESTACIÓN SERVER-SIDE Y ANTI-REPLAY POR CONTENIDO.
 *
 * El DB-C4 encontró que el digest que entra a la hash-chain lo declaraba el
 * llamador: el adaptador calculaba el SHA-256 sobre el buffer del `FormData` y
 * jamás releía el objeto almacenado. De ahí salían dos ataques distintos:
 * declarar un digest que no corresponde a los bytes guardados, y subir LA MISMA
 * fotografía a otro `path` para acreditar una segunda inspección.
 *
 * ─── QUÉ PRUEBA ESTE ARCHIVO Y QUÉ NO ─────────────────────────────────────
 *
 * Prueba el CONTRATO DE BASE, que es donde vive la autoridad: quién puede
 * emitir la atestación, contra qué queda atada, cómo se consume de forma
 * atómica, y que ningún camino acepta una inspección humana sin ella.
 *
 * NO prueba la lectura real de bytes desde Supabase Storage: este harness no
 * tiene Storage, y el mandato prohíbe expresamente sustituirlo por un fake y
 * declarar M2 cerrado. Los «bytes» de acá son sintéticos y cumplen el papel del
 * objeto almacenado para ejercitar el contrato. La verificación autoritativa
 * del objeto real queda fuera de alcance local y está declarada como tal.
 */
import { describe, expect, inject, it, beforeAll, afterAll } from "vitest";
import { Client } from "pg";
import {
  actAs,
  actAsServer,
  attachEvidence,
  attestContent,
  baseScenario,
  createActor,
  createClient as createErpClient,
  createOrder,
  createPackingUnit,
  expectFailure,
  sha256Hex,
  uid,
} from "./harness/fixtures";

let db: Client;

beforeAll(async () => {
  db = new Client({ connectionString: inject("custodyDbUrl") });
  await db.connect();
});

afterAll(async () => {
  await db.end();
});

const INSPECTION = { stage: "despacho", eventType: "inspeccion_humana" } as const;
const SIN_ATESTACION = /sin atestación server-side válida/i;
const YA_ACREDITO = /ya acreditó una inspección humana/i;

async function asRole<T>(role: string, fn: () => Promise<T>): Promise<T> {
  await db.query(`set role ${role}`);
  try {
    return await fn();
  } finally {
    await db.query(`reset role`);
  }
}

describe("T-C2-07 · M2 · el digest no lo declara el caller", () => {
  it("1 · `p_sha256` falso sobre un objeto real distinto ⇒ rechazado", async () => {
    const s = await baseScenario(db);
    await actAs(db, s.staff);
    const msg = await expectFailure(() =>
      attachEvidence(db, { packingUnitId: s.packingUnitId, ...INSPECTION }, {
        content: "bytes-reales",
        declaredSha256: sha256Hex("bytes-que-el-caller-inventa"),
      }),
    );
    expect(msg).toMatch(/digest declarado no coincide con el contenido atestado/i);
  });

  it("3 · mismo path, hash distinto ⇒ rechazado", async () => {
    const s = await baseScenario(db);
    await actAs(db, s.staff);
    const path = `${uid("path")}.jpg`;
    // La atestación fija (bucket, path) → digest. Declarar otro digest sobre
    // ese mismo objeto es exactamente el ataque.
    const msg = await expectFailure(() =>
      attachEvidence(db, { packingUnitId: s.packingUnitId, ...INSPECTION }, {
        content: "contenido-A",
        storagePath: path,
        declaredSha256: sha256Hex("contenido-B"),
      }),
    );
    expect(msg).toMatch(/digest declarado no coincide/i);
  });

  it("1.b · el tamaño declarado tampoco es autoridad", async () => {
    const s = await baseScenario(db);
    await actAs(db, s.staff);
    const msg = await expectFailure(() =>
      attachEvidence(db, { packingUnitId: s.packingUnitId, ...INSPECTION }, {
        content: "bytes-medidos",
        declaredSizeBytes: 999999,
      }),
    );
    expect(msg).toMatch(/tamaño declarado no coincide/i);
  });

  it("14 · camino válido: evento, evidencia y cadena llevan el digest SERVER-SIDE", async () => {
    const s = await baseScenario(db);
    await actAs(db, s.staff);
    const content = "foto-de-inspeccion-valida";
    const r = await attachEvidence(db, { packingUnitId: s.packingUnitId, ...INSPECTION }, { content });

    const { rows } = await db.query<{
      ev_sha: string; e_sha: string; size: string; claim: string; att_consumed: string | null;
    }>(
      `select ev.evidence_sha256 as ev_sha, e.sha256 as e_sha, e.size_bytes::text as size,
              (select c.sha256 from public.custody_inspection_content_claims c where c.evidence_id = e.id) as claim,
              (select a.consumed_at::text from public.custody_content_attestations a
                where a.consumed_by_evidence_id = e.id) as att_consumed
         from public.custody_evidence e
         join public.custody_events ev on ev.id = e.event_id
        where e.id = $1`,
      [r.evidenceId],
    );
    const real = sha256Hex(content);
    expect(rows[0].ev_sha).toBe(real);
    expect(rows[0].e_sha).toBe(real);
    expect(rows[0].size).toBe(String(Buffer.byteLength(content, "utf8")));
    expect(rows[0].claim).toBe(real);
    expect(rows[0].att_consumed).not.toBeNull();
  });
});

describe("T-C2-07 · M2 · anti-replay por contenido", () => {
  it("2 · la MISMA foto con otro path ⇒ rechazada", async () => {
    const s = await baseScenario(db);
    await actAs(db, s.staff);
    const content = "la-misma-foto-exacta";
    await attachEvidence(db, { packingUnitId: s.packingUnitId, ...INSPECTION }, { content });

    const msg = await expectFailure(() =>
      attachEvidence(db, { packingUnitId: s.packingUnitId, ...INSPECTION }, {
        content,
        storagePath: `${uid("otro")}.jpg`,
      }),
    );
    expect(msg).toMatch(YA_ACREDITO);
  });

  it("4 · mismos bytes con otro nombre, extensión o EXIF ⇒ rechazados", async () => {
    const s = await baseScenario(db);
    await actAs(db, s.staff);
    const content = "bytes-identicos-metadata-distinta";
    await attachEvidence(db, { packingUnitId: s.packingUnitId, ...INSPECTION }, { content });

    for (const path of [`${uid("x")}.png`, `${uid("y")}.jpeg`, `otra/carpeta/${uid("z")}.jpg`]) {
      const msg = await expectFailure(() =>
        attachEvidence(db, { packingUnitId: s.packingUnitId, ...INSPECTION }, {
          content,
          storagePath: path,
        }),
      );
      expect(msg, path).toMatch(YA_ACREDITO);
    }
  });

  it("2.b · tampoco sirve para OTRA entidad ni OTRO cliente", async () => {
    const s = await baseScenario(db);
    await actAs(db, s.staff);
    const content = "foto-que-quieren-reciclar";
    await attachEvidence(db, { packingUnitId: s.packingUnitId, ...INSPECTION }, { content });

    // Otra entidad del mismo cliente.
    const otherOrder = await createOrder(db, s.clientId);
    const otherPu = await createPackingUnit(db, otherOrder);
    const msg = await expectFailure(() =>
      attachEvidence(db, { packingUnitId: otherPu, ...INSPECTION }, { content }),
    );
    expect(msg).toMatch(YA_ACREDITO);

    // Y otro cliente entero.
    const c2 = await createErpClient(db);
    const o2 = await createOrder(db, c2);
    const pu2 = await createPackingUnit(db, o2);
    const staff2 = await createActor(db, "operaciones");
    await actAs(db, staff2);
    const msg2 = await expectFailure(() =>
      attachEvidence(db, { packingUnitId: pu2, ...INSPECTION }, { content }),
    );
    expect(msg2).toMatch(YA_ACREDITO);
    await actAs(db, s.staff);
  });

  it("6 · redactar la evidencia NO libera el contenido", async () => {
    const s = await baseScenario(db);
    await actAs(db, s.staff);
    const content = "foto-que-luego-se-redacta";
    const r = await attachEvidence(db, { packingUnitId: s.packingUnitId, ...INSPECTION }, { content });

    // Flip controlado de redacción (0036 lo permite sólo false→true).
    await db.query(
      `update public.custody_evidence set redacted = true, redacted_at = now() where id = $1`,
      [r.evidenceId],
    );

    const msg = await expectFailure(() =>
      attachEvidence(db, { packingUnitId: s.packingUnitId, ...INSPECTION }, {
        content,
        storagePath: `${uid("post-redaccion")}.jpg`,
      }),
    );
    expect(msg).toMatch(YA_ACREDITO);
  });

  it("13 · dos fotografías realmente distintas se aceptan", async () => {
    const s = await baseScenario(db);
    await actAs(db, s.staff);
    const a = await attachEvidence(db, { packingUnitId: s.packingUnitId, ...INSPECTION }, {
      content: "foto-uno",
    });
    const b = await attachEvidence(db, { packingUnitId: s.packingUnitId, ...INSPECTION }, {
      content: "foto-dos",
    });
    expect(a.sha256).not.toBe(b.sha256);
    expect(a.evidenceId).not.toBe(b.evidenceId);
  });

  it("5 · dos intentos CONCURRENTES con los mismos bytes: gana exactamente uno", async () => {
    const s = await baseScenario(db);
    await actAs(db, s.staff);
    const content = "bytes-en-carrera";
    const sha = sha256Hex(content);
    const size = Buffer.byteLength(content, "utf8");
    const pathA = `${uid("carrera-a")}.jpg`;
    const pathB = `${uid("carrera-b")}.jpg`;

    // Ambas atestaciones se emiten ANTES de que ninguna se consuma: el ledger
    // todavía está vacío, así que la carrera se decide en el claim atómico.
    await attestContent(db, {
      bucket: "custody-evidence", storagePath: pathA, sha256: sha, sizeBytes: size,
      actorId: s.staff.userId, sessionId: s.staff.sessionId,
      scope: "packing_unit", entityId: s.packingUnitId,
      stage: "despacho", eventType: "inspeccion_humana",
    });
    await attestContent(db, {
      bucket: "custody-evidence", storagePath: pathB, sha256: sha, sizeBytes: size,
      actorId: s.staff.userId, sessionId: s.staff.sessionId,
      scope: "packing_unit", entityId: s.packingUnitId,
      stage: "despacho", eventType: "inspeccion_humana",
    });

    const other = new Client({ connectionString: inject("custodyDbUrl") });
    await other.connect();
    try {
      await actAs(other, s.staff);
      const call = (c: Client, path: string) =>
        c.query(
          `select public.attach_custody_evidence(
             $1, null, 'despacho'::public.custody_stage_t,
             'inspeccion_humana'::public.custody_event_type_t,
             'foto'::public.evidence_kind_t, 'custody-evidence', $2, $3,
             p_size_bytes => $4::bigint) as r`,
          [s.packingUnitId, path, sha, size],
        );

      const results = await Promise.allSettled([call(db, pathA), call(other, pathB)]);
      const ok = results.filter((r) => r.status === "fulfilled");
      const ko = results.filter((r) => r.status === "rejected");
      expect(ok).toHaveLength(1);
      expect(ko).toHaveLength(1);
      expect(String((ko[0] as PromiseRejectedResult).reason)).toMatch(YA_ACREDITO);

      const { rows } = await db.query<{ n: string }>(
        `select count(*)::text as n from public.custody_inspection_content_claims where sha256 = $1`,
        [sha],
      );
      expect(rows[0].n).toBe("1");
    } finally {
      await other.end();
    }
  });
});

describe("T-C2-07 · M2 · ciclo de vida de la atestación", () => {
  it("8 · consumida ⇒ no vuelve a servir", async () => {
    const s = await baseScenario(db);
    await actAs(db, s.staff);
    const content = "foto-consumida";
    const path = `${uid("consumida")}.jpg`;
    await attachEvidence(db, { packingUnitId: s.packingUnitId, ...INSPECTION }, { content, storagePath: path });

    // Mismo objeto, misma atestación ya consumida: el segundo intento no puede
    // volver a consumirla.
    const msg = await expectFailure(() =>
      attachEvidence(db, { packingUnitId: s.packingUnitId, ...INSPECTION }, {
        content,
        storagePath: path,
        skipAttestation: true,
      }),
    );
    expect(msg).toMatch(SIN_ATESTACION);
  });

  it("8.b · vencida ⇒ rechazada", async () => {
    const s = await baseScenario(db);
    await actAs(db, s.staff);
    const content = "foto-vencida";
    const path = `${uid("vencida")}.jpg`;
    const sha = sha256Hex(content);
    await attestContent(db, {
      bucket: "custody-evidence", storagePath: path, sha256: sha,
      sizeBytes: Buffer.byteLength(content, "utf8"),
      actorId: s.staff.userId, sessionId: s.staff.sessionId,
      scope: "packing_unit", entityId: s.packingUnitId,
      stage: "despacho", eventType: "inspeccion_humana",
    });
    // Envejecimiento CONTROLADO: no se puede esperar 15 minutos en una prueba.
    await db.query(
      `update public.custody_content_attestations set expires_at = now() - interval '1 second'
        where bucket = 'custody-evidence' and storage_path = $1`,
      [path],
    );

    const msg = await expectFailure(() =>
      attachEvidence(db, { packingUnitId: s.packingUnitId, ...INSPECTION }, {
        content, storagePath: path, skipAttestation: true,
      }),
    );
    expect(msg).toMatch(SIN_ATESTACION);
  });

  it("8.c · revocada ⇒ rechazada", async () => {
    const s = await baseScenario(db);
    await actAs(db, s.staff);
    const content = "foto-revocada";
    const path = `${uid("revocada")}.jpg`;
    const attId = await attestContent(db, {
      bucket: "custody-evidence", storagePath: path, sha256: sha256Hex(content),
      sizeBytes: Buffer.byteLength(content, "utf8"),
      actorId: s.staff.userId, sessionId: s.staff.sessionId,
      scope: "packing_unit", entityId: s.packingUnitId,
      stage: "despacho", eventType: "inspeccion_humana",
    });
    await actAsServer(db);
    await db.query(`select public.revoke_custody_content_attestation($1)`, [attId]);
    await actAs(db, s.staff);

    const msg = await expectFailure(() =>
      attachEvidence(db, { packingUnitId: s.packingUnitId, ...INSPECTION }, {
        content, storagePath: path, skipAttestation: true,
      }),
    );
    expect(msg).toMatch(SIN_ATESTACION);
  });

  it("9 · atestación de OTRO actor, sesión o entidad ⇒ rechazada", async () => {
    const s = await baseScenario(db);
    const content = "foto-de-otro";
    const sha = sha256Hex(content);
    const size = Buffer.byteLength(content, "utf8");

    // Atada al decisor, usada por staff.
    const pathActor = `${uid("otro-actor")}.jpg`;
    await attestContent(db, {
      bucket: "custody-evidence", storagePath: pathActor, sha256: sha, sizeBytes: size,
      actorId: s.decider.userId, sessionId: s.decider.sessionId,
      scope: "packing_unit", entityId: s.packingUnitId,
      stage: "despacho", eventType: "inspeccion_humana",
    });
    await actAs(db, s.staff);
    expect(
      await expectFailure(() =>
        attachEvidence(db, { packingUnitId: s.packingUnitId, ...INSPECTION }, {
          content, storagePath: pathActor, skipAttestation: true,
        }),
      ),
    ).toMatch(SIN_ATESTACION);

    // Atada a otra ENTIDAD, usada en la del escenario.
    const otherOrder = await createOrder(db, s.clientId);
    const otherPu = await createPackingUnit(db, otherOrder);
    const pathEntity = `${uid("otra-entidad")}.jpg`;
    await attestContent(db, {
      bucket: "custody-evidence", storagePath: pathEntity, sha256: sha256Hex("otro-contenido"),
      sizeBytes: size, actorId: s.staff.userId, sessionId: s.staff.sessionId,
      scope: "packing_unit", entityId: otherPu,
      stage: "despacho", eventType: "inspeccion_humana",
    });
    expect(
      await expectFailure(() =>
        attachEvidence(db, { packingUnitId: s.packingUnitId, ...INSPECTION }, {
          content: "otro-contenido", storagePath: pathEntity, skipAttestation: true,
        }),
      ),
    ).toMatch(SIN_ATESTACION);
  });

  it("9.b · una sesión que no pertenece al actor no se puede atestar", async () => {
    const s = await baseScenario(db);
    const msg = await expectFailure(() =>
      attestContent(db, {
        bucket: "custody-evidence", storagePath: `${uid("sesion-ajena")}.jpg`,
        sha256: sha256Hex("x"), sizeBytes: 1,
        actorId: s.staff.userId, sessionId: s.decider.sessionId,
        scope: "packing_unit", entityId: s.packingUnitId,
        stage: "despacho", eventType: "inspeccion_humana",
      }),
    );
    expect(msg).toMatch(/sesión inválida para el actor/i);
    await actAs(db, s.staff);
  });
});

describe("T-C2-07 · M2 · superficie y fail-closed", () => {
  it("12 · inspección por la RPC legacy, con digest del caller y SIN atestación ⇒ rechazada", async () => {
    const s = await baseScenario(db);
    await actAs(db, s.staff);
    const msg = await expectFailure(() =>
      attachEvidence(db, { packingUnitId: s.packingUnitId, ...INSPECTION }, {
        content: "foto-sin-atestacion",
        skipAttestation: true,
      }),
    );
    expect(msg).toMatch(SIN_ATESTACION);

    // Y no quedó nada a medias.
    const { rows } = await db.query<{ n: string }>(
      `select count(*)::text as n from public.custody_events
        where packing_unit_id = $1 and event_type = 'inspeccion_humana'`,
      [s.packingUnitId],
    );
    expect(rows[0].n).toBe("0");
  });

  it("11 · `authenticated` no toca la atestación ni el ledger", async () => {
    for (const t of ["custody_content_attestations", "custody_inspection_content_claims"]) {
      for (const role of ["anon", "authenticated", "service_role"]) {
        const sel = await expectFailure(() =>
          asRole(role, () => db.query(`select count(*) from public.${t}`)),
        );
        expect(sel, `${role} select ${t}`).toMatch(/permission denied|permiso denegado/i);

        const ins = await expectFailure(() =>
          asRole(role, () => db.query(`insert into public.${t} default values`)),
        );
        expect(ins, `${role} insert ${t}`).toMatch(/permission denied|permiso denegado/i);
      }
    }
  });

  it("11.b · sólo el rol interno de servidor emite atestaciones", async () => {
    const s = await baseScenario(db);
    await actAs(db, s.staff); // authenticated
    const msg = await expectFailure(() =>
      db.query(
        `select public.attest_custody_content(
           'custody-evidence', $1, $2, 10, $3::uuid, $4::uuid, 'packing_unit', $5::uuid,
           'despacho'::public.custody_stage_t, 'inspeccion_humana'::public.custody_event_type_t, 900)`,
        [`${uid("intruso")}.jpg`, sha256Hex("x"), s.staff.userId, s.staff.sessionId, s.packingUnitId],
      ),
    );
    expect(msg).toMatch(/sólo la emite el rol interno de servidor/i);
  });

  it("11.c · la RPC de emisión no tiene EXECUTE para anon ni authenticated", async () => {
    const sig =
      "public.attest_custody_content(text,text,text,bigint,uuid,uuid,text,uuid,public.custody_stage_t,public.custody_event_type_t,int)";
    for (const [role, expected] of [
      ["anon", false],
      ["authenticated", false],
      ["service_role", true],
    ] as const) {
      const { rows } = await db.query<{ ok: boolean }>(
        `select has_function_privilege($1, $2, 'EXECUTE') as ok`,
        [role, sig],
      );
      expect(rows[0].ok, role).toBe(expected);
    }
  });

  it("10 · usuario cross-client rechazado, sin revelar existencia", async () => {
    const s = await baseScenario(db);
    await actAs(db, s.staff);
    const content = "foto-cross-client";
    const sha = sha256Hex(content);
    const path = `${uid("cross")}.jpg`;
    await attestContent(db, {
      bucket: "custody-evidence", storagePath: path, sha256: sha,
      sizeBytes: Buffer.byteLength(content, "utf8"),
      actorId: s.staff.userId, sessionId: s.staff.sessionId,
      scope: "packing_unit", entityId: s.packingUnitId,
      stage: "despacho", eventType: "inspeccion_humana",
    });

    const otherClientId = await createErpClient(db);
    const intruder = await createActor(db, "cliente", otherClientId);
    await actAs(db, intruder);
    const msg = await expectFailure(() =>
      attachEvidence(db, { packingUnitId: s.packingUnitId, ...INSPECTION }, {
        content, storagePath: path, skipAttestation: true,
      }),
    );
    // No filtra que la atestación existe, ni su digest, ni su path.
    expect(msg).not.toContain(sha);
    expect(msg).not.toContain(path);
    expect(msg).toMatch(/no autorizado|cliente ajeno/i);
    await actAs(db, s.staff);
  });

  it("16 · los demás pares históricos mantienen compatibilidad", async () => {
    const s = await baseScenario(db);
    await actAs(db, s.staff);
    const pares = [
      { stage: "packing", eventType: "foto_packing" },
      { stage: "despacho", eventType: "cargado" },
      { stage: "transporte", eventType: "en_transito" },
      { stage: "entrega", eventType: "foto_entrega" },
    ] as const;
    for (const p of pares) {
      const r = await attachEvidence(db, { packingUnitId: s.packingUnitId, ...p });
      expect(r.evidenceId, `${p.stage}/${p.eventType}`).toBeTruthy();
    }
    // Y comparten contenido sin problema: la regla es SÓLO para la inspección.
    const compartido = "mismo-documento-adjuntado-dos-veces";
    await attachEvidence(db, { packingUnitId: s.packingUnitId, stage: "entrega", eventType: "foto_entrega" }, {
      content: compartido,
    });
    const segunda = await attachEvidence(
      db,
      { packingUnitId: s.packingUnitId, stage: "entrega", eventType: "foto_entrega" },
      { content: compartido },
    );
    expect(segunda.evidenceId).toBeTruthy();
  });
});
