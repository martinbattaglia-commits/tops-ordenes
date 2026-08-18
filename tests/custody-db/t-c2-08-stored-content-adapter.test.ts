/**
 * T-C2-08 · W22-TER-C1/M2 — FRONTERA DE CONFIANZA Y COMPENSACIÓN SEGURA.
 *
 * ─── CLASIFICACIÓN HONESTA DEL ALCANCE ────────────────────────────────────
 *
 * Prueba la ORQUESTACIÓN con puertos inyectados: de dónde salen actor y sesión,
 * que el objeto se relee antes de adjuntar, que el digest persistido es el de
 * los bytes releídos, y qué se compensa —y qué NO— ante cada modo de fallo.
 *
 * NO prueba que Supabase Storage devuelva los bytes reales: no hay stack local
 * y el remoto está prohibido. Esa verificación sigue declarada como NO
 * VERIFICADA localmente, y M2 sigue fail-closed por eso.
 *
 * ─── POR QUÉ LA AMBIGÜEDAD SE TRATA DISTINTO ──────────────────────────────
 *
 * Un rechazo de PostgREST trae código: el servidor decidió, no se escribió
 * nada, y compensar es seguro. Un timeout no trae código: la transacción pudo
 * haberse confirmado, y borrar el objeto destruiría la evidencia de una
 * inspección real. Por eso ese caso no se toca y se devuelve para reconciliar.
 */
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import {
  noRetryTransport,
  NonIdempotentRetryBlockedError,
} from "@/lib/supabase/server";
import type { AttachResult, CustodyStage } from "@/lib/custody/types";
import {
  buildCustodyStoragePath,
  parseAttachResult,
  parseCanonicalUuid,
  parseCustodyEventPublicId,
  parseCustodyStagePair,
  parseCustodyStoragePath,
} from "@/lib/custody/canonical-contract";
import {
  captureCustodyEvidence,
  classifyRpcError,
  CustodyPreflightError,
  DETERMINISTIC_RPC_CODES,
  isCanonicalUuid,
  isCompleteAttachResult,
  isDeterministicFailure,
  CustodyStorageError,
  resolveTrustedActor,
  StoredContentMismatchError,
  requireCustodyClient,
  supabaseStoragePort,
  verifyStoredContent,
  type AttestContentInput,
  type CaptureEvidenceInput,
  type CustodyCapturePorts,
  type CustodyStoragePort,
  type SessionAuthLike,
} from "@/lib/custody/custody";

const REPO_ROOT = resolve(__dirname, "..", "..");
const readRepo = (rel: string): string => readFileSync(join(REPO_ROOT, rel), "utf8");
const sha = (s: string): string => createHash("sha256").update(Buffer.from(s, "utf8")).digest("hex");

const BUCKET = "custody-evidence";
/**
 * W22-TER-C4 · O-1 · los fixtures dejan de usar identificadores de juguete.
 *
 * `entityId: "e1"` y una clave escrita a mano ya no son representables: el
 * orquestador exige la forma canónica real (UUID de `uuid_out` y clave
 * construida con partes validadas). Un fixture que no puede existir en
 * producción no prueba producción.
 */
const ENTITY_UUID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const OBJECT_UUID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const pathFor = (
  stage: CustodyStage = "despacho",
  scope: "packing_unit" | "shipment" = "packing_unit",
  entityId: string = ENTITY_UUID,
): string => `${scope}/${entityId}/${stage}/${OBJECT_UUID}.jpg`;
const PATH = pathFor();
const KEY = `${BUCKET}/${PATH}`;
const keyFor = (stage: CustodyStage): string => `${BUCKET}/${pathFor(stage)}`;
const ACTOR = { actorId: "11111111-1111-1111-1111-111111111111", sessionId: "22222222-2222-2222-2222-222222222222" };

interface SpyStorage extends CustodyStoragePort {
  uploaded: string[];
  removed: string[];
  downloads: number;
}

/** Doble de Storage: devuelve lo que REALMENTE quedó guardado. */
function storageSpy(opts: {
  stored?: Record<string, string | null>;
  uploadFails?: boolean;
  removeFails?: boolean;
} = {}): SpyStorage {
  const stored = opts.stored ?? {};
  const uploaded: string[] = [];
  const removed: string[] = [];
  const spy: SpyStorage = {
    uploaded,
    removed,
    downloads: 0,
    async upload(bucket, path, bytes) {
      if (opts.uploadFails) throw new CustodyStorageError("no se pudo almacenar el archivo");
      uploaded.push(`${bucket}/${path}`);
      if (stored[`${bucket}/${path}`] === undefined) {
        stored[`${bucket}/${path}`] = Buffer.from(bytes).toString("utf8");
      }
    },
    async download(bucket, path) {
      spy.downloads += 1;
      const v = stored[`${bucket}/${path}`];
      if (v === undefined || v === null) return null;
      return new Uint8Array(Buffer.from(v, "utf8"));
    },
    async remove(bucket, path) {
      if (opts.removeFails) throw new CustodyStorageError("no se pudo eliminar el objeto");
      removed.push(`${bucket}/${path}`);
      delete stored[`${bucket}/${path}`];
    },
  };
  return spy;
}

interface Spies {
  ports: CustodyCapturePorts;
  storage: SpyStorage;
  attests: AttestContentInput[];
  attaches: unknown[];
  revokes: string[];
}

const EVENT_PUBLIC_ID = "CUST-2026-0001";
const ATT_UUID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const EVENT_UUID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const EVIDENCE_UUID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function portsWith(opts: {
  storage?: SpyStorage;
  attestError?: unknown;
  attachError?: unknown;
  attestResult?: unknown;
  attachResult?: unknown;
  revokeFails?: boolean;
  revokeError?: unknown;
} = {}): Spies {
  const storage = opts.storage ?? storageSpy();
  const attests: AttestContentInput[] = [];
  const attaches: unknown[] = [];
  const revokes: string[] = [];
  return {
    storage,
    attests,
    attaches,
    revokes,
    ports: {
      storage,
      async attest(input) {
        attests.push(input);
        if (opts.attestError) throw opts.attestError;
        return (opts.attestResult === undefined ? ATT_UUID : opts.attestResult) as string;
      },
      async attach(input) {
        attaches.push(input);
        if (opts.attachError) throw opts.attachError;
        return (opts.attachResult === undefined
          ? { event_id: EVENT_UUID, event_public_id: EVENT_PUBLIC_ID, evidence_id: EVIDENCE_UUID }
          : opts.attachResult) as AttachResult;
      },
      async revokeAttestation(id) {
        revokes.push(id);
        if (opts.revokeError) throw opts.revokeError;
        if (opts.revokeFails) throw new Error("revoke falló");
      },
    },
  };
}

const CONTENT = "bytes-de-la-foto";

function input(over: Partial<CaptureEvidenceInput> = {}): CaptureEvidenceInput {
  const stage = over.stage ?? "despacho";
  const scope = over.scope ?? "packing_unit";
  const entityId = over.entityId ?? ENTITY_UUID;
  return {
    bucket: BUCKET,
    // La clave acompaña al par: el orquestador exige que el objeto viva bajo el
    // prefijo de SU alcance, SU entidad y SU etapa.
    storagePath: pathFor(stage, scope, entityId),
    contentType: "image/jpeg",
    bytes: new Uint8Array(Buffer.from(CONTENT, "utf8")),
    declaredSha256: sha(CONTENT),
    declaredSizeBytes: Buffer.byteLength(CONTENT, "utf8"),
    scope: "packing_unit",
    entityId: ENTITY_UUID,
    stage: "despacho",
    eventType: "inspeccion_humana",
    kind: "foto",
    fileName: "foto.jpg",
    notes: null,
    actor: ACTOR,
    ...over,
  };
}

/**
 * Error de PostgREST: trae código ⇒ veredicto DETERMINISTA del servidor.
 *
 * DECLARACIÓN DE ALCANCE (V5 · deuda 3): este `42501` es un objeto FABRICADO
 * que se inyecta al clasificador; acá no se afirma una denegación de GRANT ni
 * una policy de RLS contra la base —este archivo no usa `actAs` ni el harness
 * de DB—. Lo que se prueba es que ANTE ese código el orquestador compensa de
 * forma determinista. No lo "arregles" agregando `set role`: la cobertura de
 * grants reales vive en los tests del harness que sí cambian de rol.
 */
const rpcDeterministic = () =>
  classifyRpcError({ code: "42501", message: "insufficient_privilege" }, "rechazado");
/** Fallo de red: sin código ⇒ AMBIGUO. */
const rpcAmbiguous = () => classifyRpcError(new TypeError("fetch failed"), "sin confirmar");

// ===========================================================================
// 1–5 · Identidad y sesión
// ===========================================================================

function authClient(over: Partial<{ userId: string | null; sub: string | null; sessionId: string | null; userError: unknown; claimsError: unknown }> = {}): SessionAuthLike & { getUserCalls: number } {
  const state = {
    userId: over.userId === undefined ? ACTOR.actorId : over.userId,
    sub: over.sub === undefined ? ACTOR.actorId : over.sub,
    sessionId: over.sessionId === undefined ? ACTOR.sessionId : over.sessionId,
  };
  const c = {
    getUserCalls: 0,
    auth: {
      async getUser() {
        c.getUserCalls += 1;
        if (over.userError) return { data: null, error: over.userError };
        return { data: { user: state.userId ? { id: state.userId } : null }, error: null };
      },
      async getClaims() {
        if (over.claimsError) return { data: null, error: over.claimsError };
        const claims: Record<string, unknown> = {};
        if (state.sub) claims.sub = state.sub;
        if (state.sessionId) claims.session_id = state.sessionId;
        return { data: { claims }, error: null };
      },
    },
  };
  return c;
}

describe("T-C2-08 · C1 · identidad y sesión confiables", () => {
  it("5 · actor y sesión salen del contexto autenticado verificado", async () => {
    const c = authClient();
    const actor = await resolveTrustedActor(c);
    expect(actor).toEqual(ACTOR);
    expect(c.getUserCalls).toBe(1);
  });

  it("4 · `getUser` con error ⇒ no hay identidad", async () => {
    await expect(resolveTrustedActor(authClient({ userError: new Error("x") }))).rejects.toThrow(
      /sesión no autenticada/i,
    );
  });

  it("4.b · usuario nulo ⇒ no hay identidad", async () => {
    await expect(resolveTrustedActor(authClient({ userId: null }))).rejects.toThrow(
      /sesión no autenticada/i,
    );
  });

  it("4.c · claims no verificables ⇒ no hay identidad", async () => {
    await expect(resolveTrustedActor(authClient({ claimsError: new Error("x") }))).rejects.toThrow(
      /no se pudo verificar la sesión/i,
    );
  });

  it("sin `session_id` en los claims verificados ⇒ no hay identidad", async () => {
    await expect(resolveTrustedActor(authClient({ sessionId: null }))).rejects.toThrow(
      /no acredita sujeto ni sesión/i,
    );
  });

  it("`sub` que no coincide con el usuario validado ⇒ rechazado", async () => {
    await expect(
      resolveTrustedActor(authClient({ sub: "33333333-3333-3333-3333-333333333333" })),
    ).rejects.toThrow(/no corresponde al usuario/i);
  });

  it("1 · un `session_id` del FormData no llega a la atestación", async () => {
    // La acción no lee `session_id` del formulario: el valor atestado es el de
    // la sesión verificada, pase lo que pase por el request.
    const s = portsWith();
    await captureCustodyEvidence(s.ports, input());
    expect(s.attests).toHaveLength(1);
    expect(s.attests[0].sessionId).toBe(ACTOR.sessionId);
    expect(s.attests[0].actorId).toBe(ACTOR.actorId);

    const actions = readRepo("src/app/(app)/wms/custody/actions.ts");
    expect(actions).not.toMatch(/form\.get\(\s*["']session_id["']\s*\)/);
    expect(actions).not.toMatch(/form\.get\(\s*["'](actor_id|user_id|client_id|role|token|claims)["']\s*\)/);
  });

  it("2 · `admin.auth.getUser()` nunca se invoca", () => {
    const actions = readRepo("src/app/(app)/wms/custody/actions.ts");
    expect(actions).not.toMatch(/admin\.auth\.getUser/);
    expect(actions).toMatch(/resolveTrustedActor\(\s*sessionClient\s*\)/);
  });

  it("3 · sin cliente admin no hay upload, atestación ni attach", () => {
    const actions = readRepo("src/app/(app)/wms/custody/actions.ts");
    // Nada de mezclar privilegios: el fallback `?? createClient()` desaparece.
    expect(actions).not.toMatch(/createAdminClient\(\)\s*\?\?\s*createClient\(\)/);
    const iAdmin = actions.indexOf("const admin = createAdminClient()");
    const iCapture = actions.indexOf("captureCustodyEvidence(");
    expect(iAdmin).toBeGreaterThanOrEqual(0);
    expect(iAdmin).toBeLessThan(iCapture);
    expect(actions).toMatch(/if \(!admin\) return \{ ok: false/);
    expect(actions).toMatch(/if \(!sessionClient\) return \{ ok: false/);
  });
});

// ===========================================================================
// 6–12 · Fases y compensación
// ===========================================================================

describe("T-C2-08 · C1 · el digest sale de los bytes ALMACENADOS", () => {
  it("devuelve el hash del objeto guardado, no el declarado", async () => {
    const st = storageSpy({ stored: { [KEY]: "bytes-realmente-guardados" } });
    const v = await verifyStoredContent(st, BUCKET, PATH, { sha256: null, sizeBytes: null });
    expect(v.sha256).toBe(sha("bytes-realmente-guardados"));
  });

  it("lo almacenado que difiere del declarado ⇒ falla cerrado", async () => {
    const st = storageSpy({ stored: { [KEY]: "otra-cosa" } });
    await expect(
      verifyStoredContent(st, BUCKET, PATH, { sha256: sha(CONTENT), sizeBytes: null }),
    ).rejects.toBeInstanceOf(StoredContentMismatchError);
  });

  it("objeto ilegible o vacío ⇒ falla cerrado", async () => {
    for (const stored of [{ [KEY]: null }, { [KEY]: "" }]) {
      const st = storageSpy({ stored });
      await expect(verifyStoredContent(st, BUCKET, PATH, {})).rejects.toThrow(/no se pudo releer/i);
    }
  });
});

describe("T-C2-08 · C1 · compensación por fase", () => {
  it("12 · camino válido: una fase de cada una y CERO compensación", async () => {
    const s = portsWith();
    const out = await captureCustodyEvidence(s.ports, input());
    expect(out.status).toBe("ok");
    expect(s.storage.uploaded).toHaveLength(1);
    expect(s.storage.downloads).toBe(1);
    expect(s.attests).toHaveLength(1);
    expect(s.attaches).toHaveLength(1);
    expect(s.storage.removed).toHaveLength(0);
    expect(s.revokes).toHaveLength(0);
    // El digest que viaja al attach es el VERIFICADO.
    expect((s.attaches[0] as { sha256: string }).sha256).toBe(sha(CONTENT));
  });

  it("upload fallido ⇒ nada que compensar", async () => {
    const s = portsWith({ storage: storageSpy({ uploadFails: true }) });
    const out = await captureCustodyEvidence(s.ports, input());
    expect(out.status).toBe("failed");
    expect(s.storage.removed).toHaveLength(0);
    expect(s.attests).toHaveLength(0);
    expect(s.attaches).toHaveLength(0);
  });

  it("6 · upload OK + verificación fallida ⇒ remove exactamente una vez", async () => {
    // Lo almacenado no es lo que se subió: el objeto ya existía con otros bytes.
    const s = portsWith({ storage: storageSpy({ stored: { [KEY]: "contenido-ajeno" } }) });
    const out = await captureCustodyEvidence(s.ports, input());
    expect(out.status).toBe("failed");
    expect(s.storage.removed).toEqual([KEY]);
    expect(s.storage.removed).toHaveLength(1);
    expect(s.attests).toHaveLength(0);
    expect(s.attaches).toHaveLength(0);
  });

  it("7 · si `storage.remove` devuelve error ⇒ `cleanup_required`, nunca falso éxito", async () => {
    const s = portsWith({
      storage: storageSpy({ stored: { [KEY]: "contenido-ajeno" }, removeFails: true }),
    });
    const out = await captureCustodyEvidence(s.ports, input());
    expect(out.status).toBe("cleanup_required");
    expect(s.storage.removed).toHaveLength(0);
  });

  it("8 · atestación fallida ⇒ cleanup y CERO attach", async () => {
    const s = portsWith({ attestError: rpcDeterministic() });
    const out = await captureCustodyEvidence(s.ports, input());
    expect(out.status).toBe("failed");
    expect(s.storage.removed).toEqual([KEY]);
    expect(s.attaches).toHaveLength(0);
  });

  it("9 · attach rechazado DETERMINÍSTICAMENTE ⇒ revoke + remove", async () => {
    const s = portsWith({ attachError: rpcDeterministic() });
    const out = await captureCustodyEvidence(s.ports, input());
    expect(out.status).toBe("failed");
    expect(s.revokes).toEqual([ATT_UUID]);
    expect(s.storage.removed).toEqual([KEY]);
  });

  it("10 · attach AMBIGUO ⇒ ni remove, ni revoke, ni retry: `reconciliation_required`", async () => {
    const s = portsWith({ attachError: rpcAmbiguous() });
    const out = await captureCustodyEvidence(s.ports, input());
    expect(out.status).toBe("reconciliation_required");
    // Lo decisivo: la evidencia pudo haberse creado. No se destruye nada.
    expect(s.storage.removed).toHaveLength(0);
    expect(s.revokes).toHaveLength(0);
    expect(s.attaches).toHaveLength(1); // exactamente un intento, sin reintento
  });

  it("11 · si el revoke falla, se informa `cleanup_required`", async () => {
    const s = portsWith({ attachError: rpcDeterministic(), revokeFails: true });
    const out = await captureCustodyEvidence(s.ports, input());
    expect(out.status).toBe("cleanup_required");
  });

  it("11.b · si fallan revoke Y remove, sigue siendo `cleanup_required`", async () => {
    const s = portsWith({
      storage: storageSpy({ removeFails: true }),
      attachError: rpcDeterministic(),
      revokeFails: true,
    });
    const out = await captureCustodyEvidence(s.ports, input());
    expect(out.status).toBe("cleanup_required");
  });

  it("un par NO-inspección no pide atestación ni la revoca", async () => {
    const s = portsWith({ attachError: rpcDeterministic() });
    const out = await captureCustodyEvidence(
      s.ports,
      input({ stage: "packing", eventType: "foto_packing" }),
    );
    expect(out.status).toBe("failed");
    expect(s.attests).toHaveLength(0);
    expect(s.revokes).toHaveLength(0);
    expect(s.storage.removed).toEqual([keyFor("packing")]);
  });
});

// ===========================================================================
// 13 · Nada de lo que sale expone contenido ni PII
// ===========================================================================

describe("T-C2-08 · C1 · las salidas no filtran nada", () => {
  const SENSIBLE = [BUCKET, PATH, sha(CONTENT), "foto.jpg", CONTENT, ACTOR.sessionId, ACTOR.actorId];

  it("13 · ningún estado de fallo lleva bucket, path, digest, nombre ni sesión", async () => {
    const casos = [
      portsWith({ storage: storageSpy({ stored: { [KEY]: "ajeno" } }) }),
      portsWith({ storage: storageSpy({ stored: { [KEY]: "ajeno" }, removeFails: true }) }),
      portsWith({ attestError: rpcDeterministic() }),
      portsWith({ attachError: rpcDeterministic() }),
      portsWith({ attachError: rpcAmbiguous() }),
      portsWith({ storage: storageSpy({ uploadFails: true }) }),
    ];
    for (const s of casos) {
      const out = await captureCustodyEvidence(s.ports, input());
      const serialized = JSON.stringify(out);
      for (const token of SENSIBLE) {
        expect(serialized, `${out.status} no debe contener el dato`).not.toContain(token);
      }
    }
  });

  it("13.b · los errores de Storage no nombran el objeto", () => {
    const e = new CustodyStorageError("no se pudo eliminar el objeto");
    expect(e.message).not.toContain(PATH);
    expect(e.message).not.toContain(BUCKET);
  });

  it("13.c · la acción devuelve etiquetas, no diagnósticos con datos", () => {
    const actions = readRepo("src/app/(app)/wms/custody/actions.ts");
    expect(actions).toMatch(/error: "reconciliation_required"/);
    expect(actions).toMatch(/error: "cleanup_required"/);
    // Y no vuelca el path ni el digest en la respuesta.
    expect(actions).not.toMatch(/error:.*storagePath/);
    expect(actions).not.toMatch(/error:.*declaredSha256/);
  });
});

describe("T-C2-08 · C1 · el puerto real sobre Supabase no ignora `{ error }`", () => {
  /** Doble del cliente admin de Supabase, con la forma exacta que usa el puerto. */
  function fakeAdmin(behaviour: { uploadError?: boolean; removeError?: boolean }) {
    const calls: string[] = [];
    return {
      calls,
      storage: {
        from(_bucket: string) {
          return {
            async upload() {
              calls.push("upload");
              return { error: behaviour.uploadError ? { message: "boom" } : null };
            },
            async download() {
              calls.push("download");
              return { data: null, error: null };
            },
            async remove() {
              calls.push("remove");
              return { error: behaviour.removeError ? { message: "boom" } : null };
            },
          };
        },
      },
    };
  }

  it("4 · `remove` que devuelve error LANZA en vez de fingir que limpió", async () => {
    const admin = fakeAdmin({ removeError: true });
    const port = supabaseStoragePort(admin);
    await expect(port.remove(BUCKET, PATH)).rejects.toBeInstanceOf(CustodyStorageError);
    expect(admin.calls).toEqual(["remove"]);
  });

  it("`remove` sin error resuelve normalmente", async () => {
    const admin = fakeAdmin({});
    await expect(supabaseStoragePort(admin).remove(BUCKET, PATH)).resolves.toBeUndefined();
  });

  it("`upload` que devuelve error también lanza", async () => {
    const admin = fakeAdmin({ uploadError: true });
    await expect(
      supabaseStoragePort(admin).upload(BUCKET, PATH, new Uint8Array([1]), "image/jpeg"),
    ).rejects.toBeInstanceOf(CustodyStorageError);
  });
});

describe("T-C2-08 · C1 · clasificación determinista vs ambigua", () => {
  it("un error de PostgREST con código es determinista", () => {
    expect(rpcDeterministic().deterministic).toBe(true);
    expect(rpcDeterministic().code).toBe("42501");
  });

  it("un fallo de red sin código es ambiguo", () => {
    expect(rpcAmbiguous().deterministic).toBe(false);
    expect(rpcAmbiguous().code).toBeNull();
  });
});

// ===========================================================================
// W22-TER-C2 · UNA SOLA INVOCACIÓN Y CLASIFICACIÓN FAIL-CLOSED
// ===========================================================================

/** `fetch` grabador: registra cada invocación real del transporte. */
function recordingFetch(responder: (url: string, init: RequestInit | undefined, n: number) => Promise<Response>) {
  const calls: { method: string; url: string }[] = [];
  const fn: typeof globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = (init?.method ?? "GET").toUpperCase();
    calls.push({ method, url });
    return responder(url, init as RequestInit | undefined, calls.length);
  };
  return { fn, calls };
}

const REST_URL = "https://example.invalid";

describe("T-C2-08 · C2 · el RPC mutante se invoca EXACTAMENTE una vez", () => {
  it.each([
    ["503", 503],
    ["504", 504],
    ["408", 408],
    ["520", 520],
  ])("2 · %s sobre `.rpc()` ⇒ una sola invocación del transporte", async (_label, status) => {
    const rec = recordingFetch(async () => new Response("{}", { status }));
    const transport = noRetryTransport(rec.fn);
    const client = createSupabaseClient(REST_URL, "anon-key-de-prueba", {
      global: { fetch: transport.fetch },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    await client.rpc("attach_custody_evidence", { p_bucket: "x" });

    const posts = rec.calls.filter((c) => c.method === "POST");
    expect(posts).toHaveLength(1);
    expect(transport.total()).toBe(1);
  });

  it("2.b · error de red sobre `.rpc()` ⇒ una sola invocación", async () => {
    const rec = recordingFetch(async () => {
      throw new TypeError("fetch failed");
    });
    const transport = noRetryTransport(rec.fn);
    const client = createSupabaseClient(REST_URL, "anon-key-de-prueba", {
      global: { fetch: transport.fetch },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    await client.rpc("attach_custody_evidence", {}).then(
      () => undefined,
      () => undefined,
    );
    expect(rec.calls.filter((c) => c.method === "POST")).toHaveLength(1);
  });

  it("1 · un segundo POST a la misma URL queda BLOQUEADO por el transporte", async () => {
    // Si una versión futura de postgrest-js ampliara RETRYABLE_METHODS, el
    // reintento no llegaría al servidor: el guard lo aborta.
    const rec = recordingFetch(async () => new Response("{}", { status: 503 }));
    const transport = noRetryTransport(rec.fn);
    const url = `${REST_URL}/rest/v1/rpc/attach_custody_evidence`;

    await transport.fetch(url, { method: "POST", body: "{}" });
    await expect(transport.fetch(url, { method: "POST", body: "{}" })).rejects.toBeInstanceOf(
      NonIdempotentRetryBlockedError,
    );
    // El segundo intento NO llegó al transporte real.
    expect(rec.calls).toHaveLength(1);
    expect(transport.attempts("POST", url)).toBe(2);
  });

  it("1.b · un GET repetido NO se bloquea: el guard sólo cubre mutaciones", async () => {
    const rec = recordingFetch(async () => new Response("[]", { status: 200 }));
    const transport = noRetryTransport(rec.fn);
    const url = `${REST_URL}/rest/v1/custody_events`;
    await transport.fetch(url, { method: "GET" });
    await expect(transport.fetch(url, { method: "GET" })).resolves.toBeInstanceOf(Response);
    expect(rec.calls).toHaveLength(2);
  });
});

describe("T-C2-08 · C2 · clasificación por allowlist, ambigua por defecto", () => {
  const ambiguos: [string, unknown][] = [
    ["sin código", new TypeError("fetch failed")],
    ["código vacío", { code: "" }],
    ["PGRST000", { code: "PGRST000" }],
    ["PGRST001", { code: "PGRST001" }],
    ["PGRST002", { code: "PGRST002" }],
    ["PGRST003", { code: "PGRST003" }],
    ["PGRSTX00", { code: "PGRSTX00" }],
    ["08006 connection_failure", { code: "08006" }],
    ["08003", { code: "08003" }],
    ["53300 too_many_connections", { code: "53300" }],
    ["57014 query_canceled", { code: "57014" }],
    ["57P01 admin_shutdown", { code: "57P01" }],
    ["58000 system_error", { code: "58000" }],
    ["XX000 internal_error", { code: "XX000" }],
    ["40003 statement_completion_unknown", { code: "40003" }],
    ["código futuro 99Z99", { code: "99Z99" }],
    ["abort", { name: "AbortError", message: "aborted" }],
  ];

  it.each(ambiguos)("3–6 · %s ⇒ AMBIGUO", (_label, err) => {
    expect(classifyRpcError(err, "x").deterministic).toBe(false);
  });

  it("7 · sólo los rechazos inequívocos de la allowlist son deterministas", () => {
    for (const code of DETERMINISTIC_RPC_CODES) {
      expect(classifyRpcError({ code }, "x").deterministic, code).toBe(true);
    }
    // Y la allowlist es EXACTA: ninguna familia abierta.
    expect(DETERMINISTIC_RPC_CODES).not.toContain("40003");
    expect(DETERMINISTIC_RPC_CODES.some((c) => c.startsWith("08"))).toBe(false);
    expect(DETERMINISTIC_RPC_CODES.some((c) => c.startsWith("53"))).toBe(false);
    expect(DETERMINISTIC_RPC_CODES.some((c) => c.startsWith("57"))).toBe(false);
    expect(DETERMINISTIC_RPC_CODES.some((c) => c.startsWith("58"))).toBe(false);
    expect(DETERMINISTIC_RPC_CODES.some((c) => c.startsWith("XX"))).toBe(false);
  });

  it("9 · un `23505` observado tras MÁS DE UN intento degrada a AMBIGUO", () => {
    // El eco de un primer intento que sí confirmó no puede autorizar un borrado.
    expect(classifyRpcError({ code: "23505" }, "x", 1).deterministic).toBe(true);
    expect(classifyRpcError({ code: "23505" }, "x", 2).deterministic).toBe(false);
    expect(classifyRpcError({ code: "42501" }, "x", 2).deterministic).toBe(false);
  });
});

describe("T-C2-08 · C2 · compensación bajo la nueva clasificación", () => {
  it("8 · primer intento confirmado + respuesta perdida ⇒ CERO compensación", async () => {
    // La respuesta se pierde: el error no trae código. Ambiguo ⇒ no se toca nada.
    const s = portsWith({ attachError: classifyRpcError(new TypeError("socket hang up"), "perdida") });
    const out = await captureCustodyEvidence(s.ports, input());
    expect(out.status).toBe("reconciliation_required");
    expect(s.storage.removed).toHaveLength(0);
    expect(s.revokes).toHaveLength(0);
  });

  it("9.b · `23505` con dos intentos observados ⇒ NO se borra", async () => {
    const s = portsWith({ attachError: classifyRpcError({ code: "23505" }, "duplicada", 2) });
    const out = await captureCustodyEvidence(s.ports, input());
    expect(out.status).toBe("reconciliation_required");
    expect(s.storage.removed).toHaveLength(0);
    expect(s.revokes).toHaveLength(0);
  });

  it.each(["08006", "53300", "57014", "58000", "XX000", "PGRST002"])(
    "11 · attach con %s ⇒ ninguna compensación",
    async (code) => {
      const s = portsWith({ attachError: classifyRpcError({ code }, "x") });
      const out = await captureCustodyEvidence(s.ports, input());
      expect(out.status).toBe("reconciliation_required");
      expect(s.storage.removed).toHaveLength(0);
      expect(s.revokes).toHaveLength(0);
    },
  );

  it("10 · attach con un rechazo inequívoco ⇒ revoke + remove", async () => {
    const s = portsWith({ attachError: classifyRpcError({ code: "42501" }, "denegado") });
    const out = await captureCustodyEvidence(s.ports, input());
    expect(out.status).toBe("failed");
    expect(s.revokes).toEqual([ATT_UUID]);
    expect(s.storage.removed).toEqual([KEY]);
  });

  it("13 · ninguna salida de la nueva clasificación filtra datos", async () => {
    for (const code of ["08006", "23505", "PGRST001"]) {
      const s = portsWith({ attachError: classifyRpcError({ code }, "x") });
      const out = await captureCustodyEvidence(s.ports, input());
      const serialized = JSON.stringify(out);
      for (const token of [BUCKET, PATH, sha(CONTENT), "foto.jpg", ACTOR.sessionId]) {
        expect(serialized).not.toContain(token);
      }
    }
  });
});

describe("T-C2-08 · C2 · las RPC mutantes usan el cliente acotado", () => {
  it("las tres RPC no idempotentes pasan por `createCustody*MutationClient`", () => {
    const src = readRepo("src/lib/custody/custody.ts");
    for (const fn of [
      "attachCustodyEvidence",
      "attestCustodyContent",
      "revokeCustodyContentAttestation",
    ]) {
      const i = src.indexOf(`export async function ${fn}`);
      const body = src.slice(i, src.indexOf("\n}", i));
      expect(body, fn).toMatch(/noRetryTransport\(\)/);
      expect(body, fn).toMatch(/createCustody(Admin)?MutationClient\(transport\)/);
      // W22-TER-C4 · O-3 · el conteo que alimenta la clasificación es el de LA
      // RPC, no el total del transporte. `total()` incluía tráfico ajeno —un
      // refresh de token bastaba— y degradaba un rechazo inequívoco a ambiguo,
      // dejando un huérfano por una llamada que no tenía nada que ver.
      expect(body, fn).toMatch(/transport\.rpcAttempts\("[a-z_]+"\)/);
      expect(body, fn).not.toMatch(/transport\.total\(\)/);
    }
  });

  it("12 · el cliente global de Nexus NO cambió de comportamiento", () => {
    const server = readRepo("src/lib/supabase/server.ts");
    // `createClient()` y `createAdminClient()` siguen sin `global.fetch` propio.
    const base = server.slice(0, server.indexOf("W22-TER-C2"));
    expect(base).not.toMatch(/global:\s*\{\s*fetch/);
    expect(server).toContain("export function createCustodyMutationClient");
    expect(server).toContain("export function createCustodyAdminMutationClient");
  });
});

// ===========================================================================
// W22-TER-C3 · COMPENSACIÓN SEGURA Y RESPUESTAS AMBIGUAS
// ===========================================================================

describe("T-C2-08 · C3 · F1 · una atestación AMBIGUA no borra nada", () => {
  const ambiguas: [string, unknown][] = [
    ["sin código", new TypeError("fetch failed")],
    ["timeout", classifyRpcError({ name: "AbortError" }, "timeout")],
    ["08006", classifyRpcError({ code: "08006" }, "conn")],
    ["40003", classifyRpcError({ code: "40003" }, "unknown-completion")],
    ["PGRST001", classifyRpcError({ code: "PGRST001" }, "pgrst")],
    ["PGRST002", classifyRpcError({ code: "PGRST002" }, "pgrst")],
    ["error genérico", new Error("algo raro")],
  ];

  it.each(ambiguas)("1 · atestación con %s ⇒ reconciliación sin efectos", async (_l, err) => {
    const s = portsWith({ attestError: err });
    const out = await captureCustodyEvidence(s.ports, input());
    expect(out.status).toBe("reconciliation_required");
    expect(s.storage.removed).toHaveLength(0);
    expect(s.revokes).toHaveLength(0);
    expect(s.attaches).toHaveLength(0);
    expect(s.attests).toHaveLength(1); // sin retry
  });

  it("2 · atestación con SQLSTATE allowlisted ⇒ rechazo determinista y UN remove", async () => {
    const s = portsWith({ attestError: classifyRpcError({ code: "23505" }, "duplicada") });
    const out = await captureCustodyEvidence(s.ports, input());
    expect(out.status).toBe("failed");
    expect(s.storage.removed).toEqual([KEY]);
    expect(s.storage.removed).toHaveLength(1);
    expect(s.revokes).toHaveLength(0); // no había atestación que revocar
    expect(s.attaches).toHaveLength(0);
  });

  it("2.b · un preflight explícito también es determinista: la llamada nunca salió", async () => {
    const s = portsWith({ attestError: new CustodyPreflightError("falta el rol de servidor") });
    const out = await captureCustodyEvidence(s.ports, input());
    expect(out.status).toBe("failed");
    expect(s.storage.removed).toEqual([KEY]);
  });

  it.each([
    ["null", null],
    ["cadena vacía", ""],
    ["no UUID", "att-1"],
    ["UUID truncado", "aaaaaaaa-aaaa-4aaa-8aaa"],
    ["objeto", { id: ATT_UUID }],
  ])("3 · atestación OK con resultado %s ⇒ reconciliación, objeto preservado", async (_l, res) => {
    const s = portsWith({ attestResult: res });
    const out = await captureCustodyEvidence(s.ports, input());
    expect(out.status).toBe("reconciliation_required");
    expect(s.storage.removed).toHaveLength(0);
    expect(s.revokes).toHaveLength(0);
    expect(s.attaches).toHaveLength(0);
  });
});

describe("T-C2-08 · C3 · F2 · sólo una revocación confirmada habilita borrar", () => {
  it("5 · attach determinista + revoke confirmada ⇒ revoke una vez, luego remove una vez", async () => {
    const s = portsWith({ attachError: classifyRpcError({ code: "42501" }, "denegado") });
    const out = await captureCustodyEvidence(s.ports, input());
    expect(out.status).toBe("failed");
    expect(s.revokes).toEqual([ATT_UUID]);
    expect(s.storage.removed).toEqual([KEY]);
  });

  it.each([
    ["determinista", classifyRpcError({ code: "42501" }, "rechazada")],
    ["ambigua", classifyRpcError({ code: "08006" }, "conn")],
    ["timeout", new TypeError("fetch failed")],
    ["genérica", new Error("algo raro")],
    ["preflight", new CustodyPreflightError("falta el rol de servidor")],
  ])("6–7 · revoke %s ⇒ `cleanup_required` y CERO remove", async (_l, err) => {
    const s = portsWith({
      attachError: classifyRpcError({ code: "42501" }, "denegado"),
      revokeError: err,
    });
    const out = await captureCustodyEvidence(s.ports, input());
    expect(out.status).toBe("cleanup_required");
    // El objeto se PRESERVA: una atestación quizá viva no puede quedar
    // apuntando a un objeto borrado.
    expect(s.storage.removed).toHaveLength(0);
    expect(s.revokes).toEqual([ATT_UUID]);
  });

  it("8 · revoke confirmada + remove fallido ⇒ `cleanup_required`", async () => {
    const s = portsWith({
      storage: storageSpy({ removeFails: true }),
      attachError: classifyRpcError({ code: "42501" }, "denegado"),
    });
    const out = await captureCustodyEvidence(s.ports, input());
    expect(out.status).toBe("cleanup_required");
    expect(s.revokes).toEqual([ATT_UUID]);
    expect(s.storage.removed).toHaveLength(0);
  });
});

describe("T-C2-08 · C3 · F3 · respuestas RPC malformadas", () => {
  it.each([
    ["null", null],
    ["objeto vacío", {}],
    ["sin evidence_id", { event_id: EVENT_UUID, event_public_id: EVENT_PUBLIC_ID }],
    ["sin event_public_id", { event_id: EVENT_UUID, evidence_id: EVIDENCE_UUID }],
    ["public_id vacío", { event_id: EVENT_UUID, event_public_id: "  ", evidence_id: EVIDENCE_UUID }],
    ["ids no canónicos", { event_id: "ev-1", event_public_id: EVENT_PUBLIC_ID, evidence_id: "evi-1" }],
  ])("4 · attach OK con resultado %s ⇒ reconciliación sin compensar", async (_l, res) => {
    const s = portsWith({ attachResult: res });
    const out = await captureCustodyEvidence(s.ports, input());
    expect(out.status).toBe("reconciliation_required");
    expect(s.storage.removed).toHaveLength(0);
    expect(s.revokes).toHaveLength(0);
  });

  it("nunca se devuelve `ok` con IDs indefinidos", async () => {
    const s = portsWith({ attachResult: { event_id: EVENT_UUID, evidence_id: undefined } });
    const out = await captureCustodyEvidence(s.ports, input());
    expect(out.status).not.toBe("ok");
    expect(JSON.stringify(out)).not.toContain("undefined");
  });

  it("los validadores canónicos distinguen lo completo de lo que no", () => {
    expect(isCanonicalUuid(ATT_UUID)).toBe(true);
    for (const v of [null, undefined, "", "att-1", 42, {}, `${ATT_UUID}x`]) {
      expect(isCanonicalUuid(v), String(v)).toBe(false);
    }
    expect(
      isCompleteAttachResult({
        event_id: EVENT_UUID,
        event_public_id: EVENT_PUBLIC_ID,
        evidence_id: EVIDENCE_UUID,
      }),
    ).toBe(true);
    expect(isCompleteAttachResult({ event_id: EVENT_UUID })).toBe(false);
  });

  it("un error genérico NO es determinista: sólo los tipos explícitos lo son", () => {
    expect(isDeterministicFailure(new Error("x"))).toBe(false);
    expect(isDeterministicFailure(new TypeError("x"))).toBe(false);
    expect(isDeterministicFailure(undefined)).toBe(false);
    expect(isDeterministicFailure(new CustodyPreflightError("x"))).toBe(true);
    expect(isDeterministicFailure(classifyRpcError({ code: "23505" }, "x"))).toBe(true);
    expect(isDeterministicFailure(classifyRpcError({ code: "08006" }, "x"))).toBe(false);
  });
});

describe("T-C2-08 · C3 · camino válido y no filtración", () => {
  it("9 · upload → reread → attest → attach, cero compensaciones", async () => {
    const s = portsWith();
    const out = await captureCustodyEvidence(s.ports, input());
    expect(out).toEqual({ status: "ok", evidenceId: EVIDENCE_UUID, eventPublicId: EVENT_PUBLIC_ID });
    expect(s.storage.uploaded).toHaveLength(1);
    expect(s.storage.downloads).toBe(1);
    expect(s.attests).toHaveLength(1);
    expect(s.attaches).toHaveLength(1);
    expect(s.storage.removed).toHaveLength(0);
    expect(s.revokes).toHaveLength(0);
  });

  it("10 · ningún estado nuevo filtra objeto, actor, sesión ni contenido", async () => {
    const SENSIBLE = [BUCKET, PATH, sha(CONTENT), "foto.jpg", CONTENT, ACTOR.sessionId, ACTOR.actorId, ATT_UUID];
    const casos = [
      portsWith({ attestError: new Error("x") }),
      portsWith({ attestResult: null }),
      portsWith({ attachResult: {} }),
      portsWith({ attachError: classifyRpcError({ code: "42501" }, "d"), revokeError: new Error("x") }),
      portsWith({ attachError: classifyRpcError({ code: "08006" }, "a") }),
    ];
    for (const s of casos) {
      const out = await captureCustodyEvidence(s.ports, input());
      const serialized = JSON.stringify(out);
      for (const token of SENSIBLE) {
        expect(serialized, out.status).not.toContain(token);
      }
    }
  });

  it("11 · cada RPC mutante se invoca a lo sumo una vez por captura", async () => {
    for (const s of [
      portsWith(),
      portsWith({ attestError: new Error("x") }),
      portsWith({ attachError: classifyRpcError({ code: "08006" }, "a") }),
      portsWith({ attachError: classifyRpcError({ code: "42501" }, "d") }),
    ]) {
      await captureCustodyEvidence(s.ports, input());
      expect(s.attests.length).toBeLessThanOrEqual(1);
      expect(s.attaches.length).toBeLessThanOrEqual(1);
      expect(s.revokes.length).toBeLessThanOrEqual(1);
    }
  });
});

// ===========================================================================
// W22-TER-C4 · REMEDIACIÓN CONSOLIDADA
//
// Cada bloque de acá abajo se escribió ROJO contra el código anterior:
//
//   · MAJOR-1 · `isCanonicalUuid` hacía `UUID_RE.test(value.trim())` y
//     `captureCustodyEvidence` devolvía `result.evidence_id` CRUDO, así que
//     `"\t<uuid>\n"` se acreditaba como `ok` y salía sin canonizar;
//   · O-1 · `entity_id`/`stage` del `FormData` llegaban a la clave de Storage;
//   · O-2 · `createAdminClient() ?? createClient()` sustituía el cliente en
//     silencio;
//   · O-3 · la clasificación usaba `transport.total()`, así que una llamada
//     colateral degradaba un rechazo inequívoco a ambiguo;
//   · O-4 · un cliente ausente se lanzaba como `Error` genérico y se
//     clasificaba como resultado remoto ambiguo.
//
// No comprueban nombres ni regex: ejercitan el comportamiento observable.
// ===========================================================================

/** UUID válido que sólo difiere del canónico en el envoltorio. */
const CANON = EVIDENCE_UUID;

describe("W22-TER-C4 · 1-3 · el parser de UUID no normaliza nada", () => {
  it("1 · espacio inicial o final ⇒ rechazado (antes pasaba por `trim()`)", () => {
    for (const v of [` ${CANON}`, `${CANON} `, `  ${CANON}  `]) {
      expect(parseCanonicalUuid(v), JSON.stringify(v)).toBeNull();
      expect(isCanonicalUuid(v), JSON.stringify(v)).toBe(false);
    }
  });

  it("2 · tab, newline, retorno y whitespace Unicode ⇒ rechazado", () => {
    // `/^…$/` casa igual con un `\n` final aunque no esté el flag `m`: por eso
    // el parser comprueba longitud y no confía sólo en el ancla.
    for (const v of [
      `\t${CANON}`, `${CANON}\n`, `${CANON}\r\n`, `\n${CANON}\n`,
      ` ${CANON}`, `${CANON} `, `${CANON} `, `　${CANON}`,
      `${CANON}​`, `${CANON} `,
    ]) {
      expect(parseCanonicalUuid(v), JSON.stringify(v)).toBeNull();
    }
  });

  it("3 · carácter extra, truncado, mayúsculas, llaves o sin guiones ⇒ rechazado", () => {
    for (const v of [
      `${CANON}x`,                              // sufijo
      `x${CANON}`,                              // prefijo
      CANON.slice(0, 35),                       // truncado
      `${CANON}-`,                              // guión de más
      CANON.toUpperCase(),                      // `uuid_out` jamás emite mayúsculas
      `{${CANON}}`,                             // forma con llaves: entrada válida, salida nunca
      CANON.replace(/-/g, ""),                  // sin guiones: idem
      CANON.replace("c", "g"),                  // fuera del alfabeto hex
      "cccccccc-cccc-4ccc-8ccc-cccccccccccс", // confusable cirílico
      "", " ", null, undefined, 42, {}, [], [CANON],
    ]) {
      expect(parseCanonicalUuid(v as unknown), JSON.stringify(String(v))).toBeNull();
    }
    expect(parseCanonicalUuid(CANON)).toBe(CANON);
  });
});

describe("W22-TER-C4 · 4 · `event_public_id` con la forma del productor real", () => {
  it("acepta EXACTAMENTE lo que emite `set_custody_event_public_id()` (0036)", () => {
    // 'CUST-' || to_char(created_at,'YYYY') || '-' || lpad(short_id::text,4,'0')
    expect(parseCustodyEventPublicId("CUST-2026-0001")).toBe("CUST-2026-0001");
    expect(parseCustodyEventPublicId("CUST-2026-12345")).toBe("CUST-2026-12345");
  });

  it("rechaza vacío, espacios, traversal, slash, confusables y formatos ajenos", () => {
    for (const v of [
      "", "   ", "\t", "\n",
      " CUST-2026-0001", "CUST-2026-0001 ", "CUST-2026-0001\n",
      "CUST-2026-0001/../otro", "../../etc/passwd", "CUST/2026/0001",
      "СUST-2026-0001",            // C cirílica
      "CUST‑2026‑0001",       // guión no-ASCII
      "CUST-2026-001",                  // lpad a 4 mínimo
      "CUST-26-0001",                   // año de dos dígitos
      "cust-2026-0001",                 // minúsculas
      "POD-2026-0001",                  // otro productor
      "CUST-1", "CUST-2026-", "CUST--0001",
      `CUST-2026-${"0".repeat(40)}`,    // longitud absurda
      null, undefined, 7, {}, [],
    ]) {
      expect(parseCustodyEventPublicId(v as unknown), JSON.stringify(String(v))).toBeNull();
    }
  });
});

describe("W22-TER-C4 · 5-6 · respuestas de attach parciales o no canónicas", () => {
  const parcial: unknown[] = [
    { event_id: EVENT_UUID, evidence_id: EVIDENCE_UUID },                       // sin public_id
    { event_id: EVENT_UUID, event_public_id: EVENT_PUBLIC_ID },                 // sin evidence_id
    { evidence_id: EVIDENCE_UUID, event_public_id: EVENT_PUBLIC_ID },           // sin event_id
    { event_id: EVENT_UUID, evidence_id: EVENT_UUID, event_public_id: EVENT_PUBLIC_ID }, // ids cruzados
    [EVENT_UUID, EVIDENCE_UUID, EVENT_PUBLIC_ID],                               // array
    "ok", 1, true, null, undefined,
  ];

  it("5 · un resultado parcialmente válido NO es un resultado", () => {
    for (const r of parcial) {
      expect(parseAttachResult(r), JSON.stringify(r)).toBeNull();
    }
  });

  it("6 · IDs con whitespace o forma no canónica ⇒ reconciliación, cero compensación", async () => {
    const sospechosos: unknown[] = [
      { event_id: ` ${EVENT_UUID} `, evidence_id: EVIDENCE_UUID, event_public_id: EVENT_PUBLIC_ID },
      { event_id: EVENT_UUID, evidence_id: `\t${EVIDENCE_UUID}\n`, event_public_id: EVENT_PUBLIC_ID },
      { event_id: EVENT_UUID, evidence_id: EVIDENCE_UUID, event_public_id: `  ${EVENT_PUBLIC_ID}  ` },
      { event_id: EVENT_UUID, evidence_id: EVIDENCE_UUID, event_public_id: "../../etc/passwd" },
      { event_id: EVENT_UUID.toUpperCase(), evidence_id: EVIDENCE_UUID, event_public_id: EVENT_PUBLIC_ID },
      {
        event_id: EVENT_UUID,
        evidence_id: EVIDENCE_UUID,
        event_public_id: EVENT_PUBLIC_ID,
        // campos engañosos de más: no convierten en válido lo que ya lo es,
        // pero tampoco deben poder sustituir a los canónicos.
        evidence_id_real: "otro",
      },
    ];
    for (const [i, attachResult] of sospechosos.entries()) {
      const s = portsWith({ attachResult });
      const out = await captureCustodyEvidence(s.ports, input());
      if (i === sospechosos.length - 1) {
        // El último ES canónico: los campos de más se ignoran, no contaminan.
        expect(out).toEqual({ status: "ok", evidenceId: EVIDENCE_UUID, eventPublicId: EVENT_PUBLIC_ID });
        continue;
      }
      expect(out.status, JSON.stringify(attachResult)).toBe("reconciliation_required");
      expect(s.storage.removed, JSON.stringify(attachResult)).toHaveLength(0);
      expect(s.revokes, JSON.stringify(attachResult)).toHaveLength(0);
    }
  });

  it("6.b · una atestación con id no canónico tampoco se acredita ni se revoca", async () => {
    for (const attestResult of [` ${ATT_UUID}`, `${ATT_UUID}\n`, ATT_UUID.toUpperCase(), "", null, {}]) {
      const s = portsWith({ attestResult });
      const out = await captureCustodyEvidence(s.ports, input());
      expect(out.status, JSON.stringify(attestResult)).toBe("reconciliation_required");
      expect(s.revokes).toHaveLength(0);
      expect(s.storage.removed).toHaveLength(0);
      expect(s.attaches).toHaveLength(0);
    }
  });
});

describe("W22-TER-C4 · 7 y 14 · nunca salen IDs crudos", () => {
  it("14 · el camino válido devuelve los IDs canónicos EXACTOS", async () => {
    const s = portsWith();
    const out = await captureCustodyEvidence(s.ports, input());
    expect(out).toEqual({ status: "ok", evidenceId: EVIDENCE_UUID, eventPublicId: EVENT_PUBLIC_ID });
  });

  it("7 · ningún estado devuelve un identificador que no haya pasado por el parser", async () => {
    const crudos = [
      `\t${EVIDENCE_UUID}\n`,
      ` ${EVENT_UUID} `,
      `  ${EVENT_PUBLIC_ID}  `,
      EVIDENCE_UUID.toUpperCase(),
    ];
    const s = portsWith({
      attachResult: {
        event_id: ` ${EVENT_UUID} `,
        evidence_id: `\t${EVIDENCE_UUID}\n`,
        event_public_id: `  ${EVENT_PUBLIC_ID}  `,
      },
    });
    const out = await captureCustodyEvidence(s.ports, input());
    expect(out.status).toBe("reconciliation_required");
    const serialized = JSON.stringify(out);
    for (const raw of crudos) {
      expect(serialized).not.toContain(raw);
    }
    // Y tampoco se filtra el identificador "limpio" por la ventana de atrás.
    expect(serialized).not.toContain(EVIDENCE_UUID);
    expect(serialized).not.toContain(EVENT_PUBLIC_ID);
  });
});

describe("W22-TER-C4 · 8 y 10 · configuración ausente = preflight, no ambigüedad", () => {
  it("8 · `requireCustodyClient` sin cliente ⇒ CustodyPreflightError DETERMINISTA", () => {
    for (const missing of [null, undefined]) {
      expect(() => requireCustodyClient(missing, "atestación")).toThrow(CustodyPreflightError);
    }
    let thrown: unknown;
    try {
      requireCustodyClient(null, "registro de evidencia");
    } catch (e) {
      thrown = e;
    }
    expect(isDeterministicFailure(thrown)).toBe(true);
    // No se disfraza de resultado remoto: no es un CustodyRpcError ni tiene code.
    expect(thrown).toBeInstanceOf(CustodyPreflightError);
    expect((thrown as Error).message).not.toMatch(/uuid|bucket|path|sha256/i);
  });

  it("8.b · ninguna mutación vuelve a lanzar el `Error` genérico de configuración", () => {
    const custody = readRepo("src/lib/custody/custody.ts");
    expect(custody).not.toMatch(/throw new Error\("Supabase no configurado"\)/);
    // Todas las RPC resuelven su cliente por el mismo camino declarado.
    for (const fn of [
      "attest_custody_content",
      "revoke_custody_content_attestation",
      "attach_custody_evidence",
    ]) {
      const i = custody.indexOf(`.rpc("${fn}"`);
      expect(i, fn).toBeGreaterThan(0);
      const before = custody.slice(0, i);
      expect(before.lastIndexOf("requireCustodyClient("), fn).toBeGreaterThan(
        before.lastIndexOf("export async function"),
      );
    }
  });

  it("8.c · un preflight en la atestación compensa seguro: cero attach, cero RPC de más", async () => {
    const s = portsWith({ attestError: new CustodyPreflightError("atestación no disponible") });
    const out = await captureCustodyEvidence(s.ports, input());
    expect(out.status).toBe("failed");
    expect(s.attaches).toHaveLength(0);
    expect(s.revokes).toHaveLength(0);
    expect(s.storage.removed).toEqual([KEY]);
  });

  it("10 · el cliente requerido no se sustituye en silencio (O-2)", () => {
    const custody = readRepo("src/lib/custody/custody.ts");
    // El fallback admin→sesión desaparece: firmar exige el cliente admin.
    expect(custody).not.toMatch(/createAdminClient\(\)\s*\?\?\s*createClient\(\)/);
    const i = custody.indexOf("export async function getEvidenceSignedUrl");
    const body = custody.slice(i, custody.indexOf("\n}", i));
    expect(body).toMatch(/requireCustodyClient\(\s*createAdminClient\(\)/);
    expect(body).not.toMatch(/createClient\(\)/);
  });
});

describe("W22-TER-C4 · 9 · lo no canónico no llega al bucket (O-1)", () => {
  const invalidos: Array<[string, Partial<CaptureEvidenceInput>]> = [
    ["entity_id que no es UUID", { entityId: "e1" }],
    ["entity_id con whitespace", { entityId: ` ${ENTITY_UUID} ` }],
    ["entity_id con traversal", { entityId: "../../otro-cliente" }],
    ["par (stage, event_type) inexistente", { stage: "packing", eventType: "cargado" }],
    ["etapa fuera del enum", { stage: "auditoria" as CustodyStage }],
    ["scope inventado", { scope: "cliente" as "shipment" }],
    ["bucket ajeno", { bucket: "public-assets" }],
    ["digest declarado no hexadecimal", { declaredSha256: "no-es-un-digest" }],
    ["tamaño declarado no positivo", { declaredSizeBytes: 0 }],
    ["actor que no es UUID", { actor: { actorId: "yo", sessionId: ACTOR.sessionId } }],
    ["sesión que no es UUID", { actor: { actorId: ACTOR.actorId, sessionId: "s" } }],
  ];

  it.each(invalidos)("%s ⇒ CERO upload, cero atestación, cero attach", async (_l, over) => {
    const s = portsWith();
    const out = await captureCustodyEvidence(s.ports, input(over));
    expect(out.status).toBe("failed");
    expect(s.storage.uploaded).toHaveLength(0);
    expect(s.storage.removed).toHaveLength(0);
    expect(s.attests).toHaveLength(0);
    expect(s.attaches).toHaveLength(0);
    expect(s.revokes).toHaveLength(0);
  });

  it("una clave que apunta al prefijo de OTRA entidad se rechaza antes de subir", async () => {
    const ajena = pathFor("despacho", "packing_unit", "ffffffff-ffff-4fff-8fff-ffffffffffff");
    const s = portsWith();
    const out = await captureCustodyEvidence(s.ports, input({ storagePath: ajena }));
    expect(out.status).toBe("failed");
    expect(s.storage.uploaded).toHaveLength(0);
  });

  it("la clave se CONSTRUYE con partes validadas y no admite travesía", () => {
    const ok = buildCustodyStoragePath({
      scope: "shipment",
      entityId: ENTITY_UUID,
      stage: "despacho",
      objectId: OBJECT_UUID,
      extension: "jpg",
    });
    expect(ok).toBe(`shipment/${ENTITY_UUID}/despacho/${OBJECT_UUID}.jpg`);
    expect(parseCustodyStoragePath(ok)).toBe(ok);

    for (const bad of [
      { scope: "shipment" as const, entityId: "../x", stage: "despacho" as CustodyStage, objectId: OBJECT_UUID, extension: "jpg" },
      { scope: "shipment" as const, entityId: ENTITY_UUID, stage: "despacho" as CustodyStage, objectId: OBJECT_UUID, extension: "jp g" },
      { scope: "shipment" as const, entityId: ENTITY_UUID, stage: "../pod" as CustodyStage, objectId: OBJECT_UUID, extension: "jpg" },
      { scope: "carpeta" as "shipment", entityId: ENTITY_UUID, stage: "despacho" as CustodyStage, objectId: OBJECT_UUID, extension: "jpg" },
    ]) {
      expect(buildCustodyStoragePath(bad), JSON.stringify(bad)).toBeNull();
    }
    for (const bad of [
      "packing_unit/e1/despacho/x.jpg",
      `packing_unit/${ENTITY_UUID}/despacho/../../otro.jpg`,
      `packing_unit/${ENTITY_UUID}/despacho/${OBJECT_UUID}.jpg\n`,
      `PACKING_UNIT/${ENTITY_UUID}/despacho/${OBJECT_UUID}.jpg`,
    ]) {
      expect(parseCustodyStoragePath(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it("la acción valida el contrato ANTES de leer el archivo y de construir la clave", () => {
    const actions = readRepo("src/app/(app)/wms/custody/actions.ts");
    const iParse = actions.indexOf("parseCanonicalUuid(form.get(\"entity_id\"))");
    const iBuild = actions.indexOf("buildCustodyStoragePath(");
    const iCapture = actions.indexOf("captureCustodyEvidence(");
    expect(iParse).toBeGreaterThan(0);
    expect(iParse).toBeLessThan(iBuild);
    expect(iBuild).toBeLessThan(iCapture);
    // La clave ya no se ensambla a mano con datos del formulario.
    expect(actions).not.toMatch(/`\$\{scope\}\/\$\{entityId\}\/\$\{stage\}\//);
  });
});

describe("W22-TER-C4 · 11 · la clasificación mira el intento RELEVANTE (O-3)", () => {
  const RPC_URL = "https://proyecto.supabase.co/rest/v1/rpc/attach_custody_evidence";
  const TOKEN_URL = "https://proyecto.supabase.co/auth/v1/token?grant_type=refresh_token";

  const okFetch = (async () => new Response("{}", { status: 200 })) as typeof globalThis.fetch;

  it("una llamada colateral NO degrada un rechazo inequívoco a ambiguo", async () => {
    const t = noRetryTransport(okFetch);
    await t.fetch(TOKEN_URL, { method: "POST" });   // refresh de sesión, ajeno
    await t.fetch(RPC_URL, { method: "POST" });     // el intento relevante
    await t.fetch(`${RPC_URL}?columns=x`, { method: "GET" }); // lectura colateral

    expect(t.total()).toBe(3);
    expect(t.rpcAttempts("attach_custody_evidence")).toBe(1);
    // Con `total()` esto habría dado ambiguo y habría dejado un huérfano.
    expect(
      classifyRpcError({ code: "42501" }, "denegado", t.rpcAttempts("attach_custody_evidence"))
        .deterministic,
    ).toBe(true);
  });

  it("un segundo intento sobre la MISMA RPC sí degrada a ambiguo", async () => {
    const t = noRetryTransport(okFetch);
    await t.fetch(RPC_URL, { method: "POST" });
    await expect(t.fetch(RPC_URL, { method: "POST" })).rejects.toBeInstanceOf(
      NonIdempotentRetryBlockedError,
    );
    expect(t.rpcAttempts("attach_custody_evidence")).toBe(2);
    expect(
      classifyRpcError({ code: "23505" }, "duplicada", t.rpcAttempts("attach_custody_evidence"))
        .deterministic,
    ).toBe(false);
  });

  it("los intentos de OTRA RPC no se mezclan", async () => {
    const t = noRetryTransport(okFetch);
    await t.fetch("https://p.supabase.co/rest/v1/rpc/attest_custody_content", { method: "POST" });
    expect(t.rpcAttempts("attach_custody_evidence")).toBe(0);
    expect(t.rpcAttempts("attest_custody_content")).toBe(1);
  });

  it("la clasificación de custodia ya no se alimenta de `total()`", () => {
    const custody = readRepo("src/lib/custody/custody.ts");
    expect(custody).not.toMatch(/classifyRpcError\([^)]*transport\.total\(\)/s);
    expect(custody).toMatch(/transport\.rpcAttempts\("attach_custody_evidence"\)/);
    expect(custody).toMatch(/transport\.rpcAttempts\("attest_custody_content"\)/);
    expect(custody).toMatch(/transport\.rpcAttempts\("revoke_custody_content_attestation"\)/);
    // La allowlist NO se amplió por esto.
    expect(DETERMINISTIC_RPC_CODES).toHaveLength(18);
    expect(DETERMINISTIC_RPC_CODES).not.toContain("40003");
  });
});

describe("W22-TER-C4 · 12-13 · los invariantes TER-C1/C2/C3 siguen en pie", () => {
  it("13 · todo camino ambiguo preserva el objeto Y la atestación", async () => {
    const ambiguos = [
      portsWith({ attestError: classifyRpcError({ code: "08006" }, "conn") }),
      portsWith({ attestError: classifyRpcError({ code: "40003" }, "unknown") }),
      portsWith({ attestError: new Error("boom") }),
      portsWith({ attachError: classifyRpcError({ code: "PGRST002" }, "pgrst") }),
      portsWith({ attachError: classifyRpcError({ name: "AbortError" }, "timeout") }),
      portsWith({ attachResult: {} }),
      portsWith({ attestResult: null }),
    ];
    for (const s of ambiguos) {
      const out = await captureCustodyEvidence(s.ports, input());
      expect(out.status).toBe("reconciliation_required");
      expect(s.storage.removed).toHaveLength(0);
      expect(s.revokes).toHaveLength(0);
    }
  });

  it("12 · revoke confirmado precede al remove, y un revoke fallido conserva el objeto", async () => {
    const orden: string[] = [];
    const storage = storageSpy();
    const okRemove = storage.remove.bind(storage);
    storage.remove = async (b, p) => { orden.push("remove"); return okRemove(b, p); };
    const s = portsWith({ storage, attachError: classifyRpcError({ code: "42501" }, "denegado") });
    const origRevoke = s.ports.revokeAttestation;
    s.ports.revokeAttestation = async (id) => { orden.push("revoke"); return origRevoke(id); };
    const out = await captureCustodyEvidence(s.ports, input());
    expect(out.status).toBe("failed");
    expect(orden).toEqual(["revoke", "remove"]);

    const s2 = portsWith({
      attachError: classifyRpcError({ code: "42501" }, "denegado"),
      revokeError: new Error("revoke sin confirmar"),
    });
    const out2 = await captureCustodyEvidence(s2.ports, input());
    expect(out2.status).toBe("cleanup_required");
    expect(s2.storage.removed).toHaveLength(0);
  });

  it("12.b · release automático imposible: la CAPTURA nunca decide ni libera", () => {
    // La capa de datos de captura sigue sin conocer la decisión: adjuntar una
    // foto no puede liberar nada.
    const custody = readRepo("src/lib/custody/custody.ts");
    expect(custody).not.toMatch(/decide_custody_integrity|release_custody/i);

    // La acción de captura tampoco: el `attachEvidenceAction` no decide.
    const actions = readRepo("src/app/(app)/wms/custody/actions.ts");
    const attach = actions.slice(
      actions.indexOf("export async function attachEvidenceAction"),
      actions.indexOf("export async function registerEventAction"),
    );
    expect(attach).not.toMatch(/decide|release|liberar/i);

    // La decisión SÍ existe, pero entra por el caso de uso del dominio —que
    // aplica la política de liberación— y nunca por una llamada directa a la
    // RPC desde la acción.
    expect(actions).toMatch(/decideIntegrityCase\(/);
    const adapters = readRepo("src/lib/custody/integrity-adapters.ts");
    expect(adapters).toMatch(/query\.decide\(/);
    expect(actions).not.toMatch(/\.rpc\(\s*["\']decide_custody_integrity/);
  });

  it("12.c · la identidad sigue saliendo del contexto autenticado, nunca del par crudo", async () => {
    const s = portsWith();
    await captureCustodyEvidence(s.ports, input());
    expect(s.attests[0].actorId).toBe(ACTOR.actorId);
    expect(s.attests[0].sessionId).toBe(ACTOR.sessionId);
    // Y el par que se atesta es el PARSEADO, no el string del llamador.
    expect(parseCustodyStagePair(s.attests[0].stage, s.attests[0].eventType)).toEqual({
      stage: "despacho",
      eventType: "inspeccion_humana",
    });
  });
});

describe("W22-TER-C4 · 15 · ningún estado nuevo filtra nada", () => {
  it("los estados de la remediación no llevan objeto, actor, sesión ni contenido", async () => {
    const SENSIBLE = [
      BUCKET, PATH, sha(CONTENT), "foto.jpg", CONTENT,
      ACTOR.sessionId, ACTOR.actorId, ATT_UUID, ENTITY_UUID, OBJECT_UUID,
    ];
    const casos = [
      portsWith({ attachResult: { event_id: ` ${EVENT_UUID} `, evidence_id: EVIDENCE_UUID, event_public_id: EVENT_PUBLIC_ID } }),
      portsWith({ attachResult: { event_id: EVENT_UUID, evidence_id: EVIDENCE_UUID, event_public_id: "../../etc/passwd" } }),
      portsWith({ attestResult: `${ATT_UUID}\n` }),
      portsWith({ attestError: new CustodyPreflightError("atestación no disponible") }),
    ];
    for (const s of casos) {
      const out = await captureCustodyEvidence(s.ports, input());
      const serialized = JSON.stringify(out);
      for (const token of SENSIBLE) {
        expect(serialized, out.status).not.toContain(token);
      }
    }
    // Y el rechazo por contrato tampoco dice QUÉ campo ni con qué valor.
    const s = portsWith();
    const out = await captureCustodyEvidence(s.ports, input({ entityId: "../../otro" }));
    expect(JSON.stringify(out)).not.toContain("../../otro");
    expect(out).toEqual({ status: "failed", reason: "solicitud de captura no canónica" });
  });
});
