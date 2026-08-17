/**
 * DB-1 · Fixtures del harness de custodia.
 *
 * Datos SINTÉTICOS. Ningún dato real, ninguna foto, ninguna llamada externa.
 *
 * La sesión se simula por GUC, igual que el stub vanilla: `auth.uid()` lee
 * `request.jwt.claim.sub` y `auth.jwt()` lee `request.jwt.claims`. Eso permite
 * ejercitar RLS y las RPC con distintos actores sin plataforma Supabase.
 */

import { createHash, randomUUID } from "node:crypto";
import type { Client } from "pg";

export type Role = "admin" | "operaciones" | "supervisor" | "cliente";

let seq = 0;
/**
 * Identificador único en TODA la corrida.
 *
 * El contador solo no alcanza: Vitest carga este módulo una vez POR ARCHIVO de
 * prueba, así que `seq` vuelve a 1 en cada archivo y los `public_id` chocaban
 * contra los índices únicos de `logistics_orders` y `packing_units`. El sufijo
 * aleatorio por módulo desambigua entre archivos; el contador, dentro de uno.
 */
const RUN = randomUUID().slice(0, 8);
export function uid(prefix: string): string {
  seq += 1;
  return `${prefix}-${RUN}-${seq.toString().padStart(5, "0")}`;
}

export interface Actor {
  userId: string;
  sessionId: string;
  role: Role;
  clientId: string | null;
}

export interface Scenario {
  clientId: string;
  orderId: string;
  packingUnitId: string;
  /** Rol 'operaciones': crea el caso, abre el intento y puede CUARENTENAR. */
  staff: Actor;
  /**
   * §5 · RELEASE ADMIN-ONLY. La liberación está reservada a 'admin' en la fase
   * inicial, así que el escenario base incluye un decisor admin explícito. No
   * se le amplían permisos a `staff` «para que los tests pasen»: eso sería
   * exactamente la ampliación por conveniencia que la política prohíbe.
   */
  decider: Actor;
}

/** Cliente ERP. */
/**
 * Cliente del escenario.
 *
 * `custodyLevel` por defecto **2** porque toda esta batería prueba el APARATO
 * de custodia reforzada —caso, IA, inspección, certificado, gate—, que 0252
 * condiciona al nivel contratado. Antes de 0252 la materialización era
 * incondicional y el parámetro no existía; dejarlo en 1 haría que estas pruebas
 * midieran un cliente sin custodia contratada, que no es lo que afirman.
 *
 * El nivel 1 tiene su propia batería en `t-c7-01-custody-levels`.
 */
export async function createClient(
  db: Client,
  razon = uid("CLI"),
  custodyLevel: 1 | 2 = 2,
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into public.clients (razon, cuit, custody_level) values ($1, $2, $3) returning id`,
    [razon, `30${Math.floor(Math.random() * 1e9).toString().padStart(9, "0")}`, custodyLevel],
  );
  return rows[0].id;
}

/** Contexto de sesión simulado, para poder devolverlo tal cual estaba. */
interface SessionContext {
  sub: string;
  role: string;
  claims: string;
}

async function captureSessionContext(db: Client): Promise<SessionContext> {
  const { rows } = await db.query<SessionContext>(
    `select coalesce(current_setting('request.jwt.claim.sub', true), '')  as sub,
            coalesce(current_setting('request.jwt.claim.role', true), '') as role,
            coalesce(current_setting('request.jwt.claims', true), '')     as claims`,
  );
  return rows[0];
}

async function restoreSessionContext(db: Client, ctx: SessionContext): Promise<void> {
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [ctx.sub]);
  await db.query(`select set_config('request.jwt.claim.role', $1, false)`, [ctx.role]);
  await db.query(`select set_config('request.jwt.claims', $1, false)`, [ctx.claims]);
}

/**
 * Usuario + perfil + sesión. `auth.sessions` la crea el bootstrap de custodia.
 * `clientId` sólo tiene sentido para el rol 'cliente'.
 */
export async function createActor(
  db: Client,
  role: Role,
  clientId: string | null = null,
): Promise<Actor> {
  const { rows: u } = await db.query<{ id: string }>(
    `insert into auth.users (email) values ($1) returning id`,
    [`${uid("user")}@test.local`],
  );
  const userId = u[0].id;
  // W22-BIS/B-1 · `handle_new_user()` ya creó el perfil al insertar en
  // `auth.users`, así que esto entra por la rama `do update` y despierta el
  // guard de autoridad de 0224 — correctamente: fijar el rol de un tercero es
  // una operación de autoridad. El aprovisionamiento de un actor de prueba es
  // fuera de banda, del lado del servidor, y NO debe heredar la sesión de
  // usuario final que dejó activa la prueba anterior. Se neutraliza el sujeto
  // durante el upsert y se restaura el contexto exacto que había.
  const prev = await captureSessionContext(db);
  await db.query(`select set_config('request.jwt.claim.sub', '', false)`);
  await db.query(`select set_config('request.jwt.claims', '', false)`);
  try {
    await db.query(
      `insert into public.profiles (id, role, client_id) values ($1, $2::public.user_role_t, $3)
       on conflict (id) do update set role = excluded.role, client_id = excluded.client_id`,
      [userId, role, clientId],
    );
  } finally {
    await restoreSessionContext(db, prev);
  }
  const { rows: s } = await db.query<{ id: string }>(
    `insert into auth.sessions (user_id) values ($1) returning id`,
    [userId],
  );
  return { userId, sessionId: s[0].id, role, clientId };
}

/** Concede un permiso RBAC al usuario, creando rol propio si hace falta. */
export async function grantPermission(db: Client, actor: Actor, slug: string): Promise<void> {
  const roleSlug = `test-role-${actor.userId}`;
  const { rows: r } = await db.query<{ id: string }>(
    `insert into public.roles (slug, name) values ($1, $1)
     on conflict (slug) do update set name = excluded.name returning id`,
    [roleSlug],
  );
  await db.query(
    `insert into public.role_permissions (role_id, permission_id)
     select $1, p.id from public.permissions p where p.slug = $2
     on conflict do nothing`,
    [r[0].id, slug],
  );
  await db.query(
    `insert into public.user_roles (user_id, role_id) values ($1, $2) on conflict do nothing`,
    [actor.userId, r[0].id],
  );
}

/** Activa la sesión del actor para las sentencias siguientes. */
export async function actAs(db: Client, actor: Actor | null): Promise<void> {
  if (actor === null) {
    await db.query(`select set_config('request.jwt.claim.sub', '', false)`);
    await db.query(`select set_config('request.jwt.claims', '', false)`);
    await db.query(`select set_config('request.jwt.claim.role', 'anon', false)`);
    return;
  }
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [actor.userId]);
  await db.query(`select set_config('request.jwt.claim.role', 'authenticated', false)`);
  await db.query(`select set_config('request.jwt.claims', $1, false)`, [
    JSON.stringify({ sub: actor.userId, role: "authenticated", session_id: actor.sessionId }),
  ]);
}

/**
 * Contexto del ROL INTERNO DE SERVIDOR: sin sujeto y con `role = 'service_role'`.
 *
 * Es el contexto en el que corre la finalización de una evaluación (§2): no hay
 * usuario final, la procedencia humana ya quedó fijada en el intento. Se
 * modela con el mismo mecanismo de GUCs que el resto, porque es exactamente lo
 * que PostgREST expone al ejecutar con la clave de servicio.
 */
export async function actAsServer(db: Client): Promise<void> {
  await db.query(`select set_config('request.jwt.claim.sub', '', false)`);
  await db.query(`select set_config('request.jwt.claim.role', 'service_role', false)`);
  await db.query(`select set_config('request.jwt.claims', $1, false)`, [
    JSON.stringify({ role: "service_role" }),
  ]);
}

/** Sesión con un `session_id` arbitrario (para probar sesiones no acreditadas). */
export async function actAsWithSession(
  db: Client,
  actor: Actor,
  sessionId: string | null,
): Promise<void> {
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [actor.userId]);
  await db.query(`select set_config('request.jwt.claim.role', 'authenticated', false)`);
  const claims: Record<string, unknown> = { sub: actor.userId, role: "authenticated" };
  if (sessionId !== null) claims.session_id = sessionId;
  await db.query(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify(claims)]);
}

/** Pedido logístico. `clientId` null reproduce el caso «SIN BACKFILL» de 0219. */
export async function createOrder(db: Client, clientId: string | null): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into public.logistics_orders (public_id, client_name, client_id)
     values ($1, $2, $3) returning id`,
    [uid("ORD"), "CLIENTE SINTETICO", clientId],
  );
  return rows[0].id;
}

/**
 * Bulto. `shipmentId` lo vincula al despacho (columna de 0035), que es la
 * relación sobre la que M-5 agrega las cadenas: sin ella, la cadena del bulto
 * no es «requerida» por ningún shipment.
 */
export async function createPackingUnit(
  db: Client,
  orderId: string,
  shipmentId: string | null = null,
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into public.packing_units (public_id, order_id, shipment_id)
     values ($1, $2, $3) returning id`,
    [uid("PU"), orderId, shipmentId],
  );
  return rows[0].id;
}

export async function createShipment(db: Client, orderId: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into public.shipments (public_id, order_id) values ($1, $2) returning id`,
    [uid("SHP"), orderId],
  );
  return rows[0].id;
}

export interface EventSpec {
  packingUnitId?: string;
  shipmentId?: string;
  stage: "packing" | "despacho" | "transporte" | "entrega" | "pod";
  eventType:
    | "foto_packing"
    | "cargado"
    | "en_transito"
    | "foto_entrega"
    | "firmado"
    | "pod"
    | "inspeccion_humana";
  evidenceSha256?: string;
}

/**
 * Evento de custodia. El trigger de 0036 calcula `prev_hash`/`row_hash`: por eso
 * insertar así produce una cadena REAL, no una simulada.
 */
export async function createEvent(db: Client, spec: EventSpec): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into public.custody_events
       (public_id, packing_unit_id, shipment_id, stage, event_type, evidence_sha256, row_hash)
     values ($1, $2, $3, $4::public.custody_stage_t, $5::public.custody_event_type_t, $6, 'PENDIENTE')
     returning id`,
    [
      uid("EVT"),
      spec.packingUnitId ?? null,
      spec.shipmentId ?? null,
      spec.stage,
      spec.eventType,
      spec.evidenceSha256 ?? null,
    ],
  );
  return rows[0].id;
}

/** Evidencia adjunta a un evento. */
export async function createEvidence(
  db: Client,
  eventId: string,
  kind: "foto" | "firma" | "documento" = "foto",
  sha256 = uid("sha"),
  redacted = false,
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into public.custody_evidence
       (event_id, kind, storage_bucket, storage_path, sha256, redacted)
     values ($1, $2::public.evidence_kind_t, 'custody-evidence', $3, $4, $5) returning id`,
    [eventId, kind, `${uid("path")}.jpg`, sha256, redacted],
  );
  return rows[0].id;
}

/**
 * Evento + evidencia por INSERT DIRECTO.
 *
 * ⚠️ ESTO NO ES EL CAMINO PRODUCTIVO. Se conserva EXCLUSIVAMENTE para preparar
 * casos NEGATIVOS: formas que la RPC productiva rechaza de plano (soporte
 * equivocado, evidencia redactada, evento sin actor) y que aun así deben ser
 * rechazadas otra vez en el momento de decidir. El camino positivo usa
 * `attachEvidence`, que es la RPC real.
 */
export async function createEventWithEvidence(
  db: Client,
  spec: EventSpec,
  kind: "foto" | "firma" | "documento" = "foto",
  redacted = false,
): Promise<{ eventId: string; evidenceId: string }> {
  const sha = uid("sha");
  const eventId = await createEvent(db, { ...spec, evidenceSha256: sha });
  const evidenceId = await createEvidence(db, eventId, kind, sha, redacted);
  return { eventId, evidenceId };
}

export interface AttachOptions {
  kind?: "foto" | "firma" | "documento";
  /** `occurred_at` propuesto por el CLIENTE. La variante de inspección lo ignora. */
  occurredAt?: Date | string | null;
  bucket?: "custody-evidence" | "custody-pii" | "custody-pod";
  /**
   * M2 · «bytes» sintéticos del archivo. Dos llamadas con el MISMO `content`
   * representan la MISMA fotografía, que es la variable que el anti-replay por
   * contenido gobierna. Por defecto, contenido único por llamada.
   */
  content?: string;
  /** Path dentro del bucket. Por defecto, único. */
  storagePath?: string;
  /**
   * M2 · digest que el CALLER declara a la RPC. Por defecto el real. Sirve para
   * el ataque «digest mentido»: el atestado sigue siendo el del servidor.
   */
  declaredSha256?: string;
  /** Tamaño declarado por el caller. Por defecto el real. */
  declaredSizeBytes?: number;
  /** Omite la atestación server-side: reproduce la RPC legacy sin M2. */
  skipAttestation?: boolean;
  /** TTL de la atestación, en segundos. */
  attestationTtlSeconds?: number;
}

/** SHA-256 hex de los «bytes» sintéticos: el digest REAL del contenido. */
export function sha256Hex(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

/** Contexto de sesión activo, leído de los GUCs que simula `actAs`. */
async function currentSessionContext(
  db: Client,
): Promise<{ actorId: string | null; sessionId: string | null }> {
  const { rows } = await db.query<{ sub: string | null; sid: string | null }>(
    `select nullif(current_setting('request.jwt.claim.sub', true), '') as sub,
            (nullif(current_setting('request.jwt.claims', true), ''))::jsonb ->> 'session_id' as sid`,
  );
  return { actorId: rows[0]?.sub ?? null, sessionId: rows[0]?.sid ?? null };
}

/**
 * M2 · Emite la atestación server-side del contenido almacenado.
 *
 * Representa lo que hace el adaptador de aplicación DESPUÉS de releer el objeto
 * de Storage: se ejecuta con el rol interno de servidor y aporta el digest y el
 * tamaño VERIFICADOS. El harness no tiene Storage: el digest se calcula sobre
 * los bytes sintéticos, que acá cumplen el papel del objeto almacenado. Lo que
 * esta función prueba es el CONTRATO de la base —quién puede atestar, contra
 * qué queda atada la atestación y cómo se consume—, no la lectura de Storage.
 */
export async function attestContent(
  db: Client,
  args: {
    bucket: string;
    storagePath: string;
    sha256: string;
    sizeBytes: number;
    actorId: string;
    sessionId: string;
    scope: "packing_unit" | "shipment";
    entityId: string;
    stage: string;
    eventType: string;
    ttlSeconds?: number;
  },
): Promise<string> {
  const prev = await captureSessionContext(db);
  await actAsServer(db);
  try {
    const { rows } = await db.query<{ id: string }>(
      `select public.attest_custody_content(
         $1, $2, $3, $4, $5::uuid, $6::uuid, $7,
         $8::uuid, $9::public.custody_stage_t, $10::public.custody_event_type_t, $11) as id`,
      [
        args.bucket,
        args.storagePath,
        args.sha256,
        args.sizeBytes,
        args.actorId,
        args.sessionId,
        args.scope,
        args.entityId,
        args.stage,
        args.eventType,
        args.ttlSeconds ?? 900,
      ],
    );
    return rows[0].id;
  } finally {
    await restoreSessionContext(db, prev);
  }
}

/**
 * §3 · CAMINO PRODUCTIVO: `attach_custody_evidence`.
 *
 * Crea el evento —con el sha del archivo plegado en la hash-chain— y su
 * evidencia, en una sola transacción y con actor, tenant e instante derivados
 * server-side. Requiere una sesión activa (`actAs`).
 */
export async function attachEvidence(
  db: Client,
  spec: EventSpec,
  opts: AttachOptions = {},
): Promise<{ eventId: string; evidenceId: string; sha256: string; storagePath: string }> {
  const content = opts.content ?? uid("bytes");
  const sha256 = sha256Hex(content);
  const sizeBytes = Buffer.byteLength(content, "utf8");
  const storagePath = opts.storagePath ?? `${uid("path")}.jpg`;
  const bucket = opts.bucket ?? "custody-evidence";
  const isInspection = spec.stage === "despacho" && spec.eventType === "inspeccion_humana";

  // M2 · la inspección humana exige atestación server-side del contenido.
  if (isInspection && !opts.skipAttestation) {
    const ctx = await currentSessionContext(db);
    if (ctx.actorId && ctx.sessionId) {
      await attestContent(db, {
        bucket,
        storagePath,
        sha256,
        sizeBytes,
        actorId: ctx.actorId,
        sessionId: ctx.sessionId,
        scope: spec.packingUnitId ? "packing_unit" : "shipment",
        entityId: (spec.packingUnitId ?? spec.shipmentId)!,
        stage: spec.stage,
        eventType: spec.eventType,
        ttlSeconds: opts.attestationTtlSeconds,
      });
    }
  }

  const { rows } = await db.query<{ r: { event_id: string; evidence_id: string } }>(
    `select public.attach_custody_evidence(
       $1, $2,
       $3::public.custody_stage_t,
       $4::public.custody_event_type_t,
       $5::public.evidence_kind_t,
       $6, $7, $8,
       p_size_bytes => $10::bigint,
       p_occurred_at => $9::timestamptz) as r`,
    [
      spec.packingUnitId ?? null,
      spec.shipmentId ?? null,
      spec.stage,
      spec.eventType,
      opts.kind ?? "foto",
      bucket,
      storagePath,
      opts.declaredSha256 ?? sha256,
      opts.occurredAt === undefined || opts.occurredAt === null
        ? null
        : new Date(opts.occurredAt).toISOString(),
      opts.declaredSizeBytes ?? sizeBytes,
    ],
  );
  return { eventId: rows[0].r.event_id, evidenceId: rows[0].r.evidence_id, sha256, storagePath };
}

/**
 * Escenario base: cliente, pedido, unidad de packing, un actor de operaciones
 * con `wms.edit` + `wms.custody.decide`, y un decisor admin.
 *
 * `staff` conserva `wms.custody.decide` a propósito: es lo que permite probar
 * que, aun TENIENDO el permiso, un rol distinto de admin no libera (§5), y que
 * la cuarentena sí le sigue estando permitida.
 */
export async function baseScenario(db: Client): Promise<Scenario> {
  const clientId = await createClient(db);
  const orderId = await createOrder(db, clientId);
  const packingUnitId = await createPackingUnit(db, orderId);
  const staff = await createActor(db, "operaciones");
  await grantPermission(db, staff, "wms.edit");
  await grantPermission(db, staff, "wms.custody.decide");
  const decider = await createActor(db, "admin");
  await grantPermission(db, decider, "wms.edit");
  await grantPermission(db, decider, "wms.custody.decide");
  return { clientId, orderId, packingUnitId, staff, decider };
}

/** Mensaje de error de PostgreSQL, para aserciones legibles. */
export function pgMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Ejecuta y devuelve el error esperado; falla si NO hubo error. */
export async function expectFailure(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
  } catch (e) {
    return pgMessage(e);
  }
  throw new Error("se esperaba un fallo y la operación fue aceptada");
}
