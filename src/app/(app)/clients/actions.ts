"use server";

/**
 * Server actions del registro maestro de clientes.
 *
 * ─── AUTORIZACIÓN REAL ─────────────────────────────────────────────────────
 *
 * Cada acción exige sesión y permiso exacto ANTES de tocar la base mediante
 * una guarda fail-closed local al registro maestro.
 * La versión anterior no verificaba ninguno: `createClient` y
 * `updateClientFiscal` escribían con `service_role` para cualquiera que
 * alcanzara la ruta. Ocultar un botón no es autorización.
 *
 * ─── MUTACIÓN Y AUDITORÍA, UNA SOLA UNIDAD ATÓMICA ─────────────────────────
 *
 * Toda escritura de cliente pasa por las RPC de 0242 —`client_create`,
 * `client_update`, `client_set_active`— invocadas con la SESIÓN DEL USUARIO,
 * nunca con `service_role`.
 *
 * Es la corrección de D-1 y D-2 del dictamen C4. La versión anterior escribía
 * el cliente con `createAdminClient()` y después intentaba el evento de
 * auditoría por separado, también con `service_role`. Como 0241 le había
 * revocado el INSERT sobre `client_events`, cada evento moría con
 * `permission denied`, el error se tragaba en `console.error` y la UI
 * devolvía éxito: la auditoría quedaba vacía para siempre, en silencio. Y
 * `updated_by` no se sellaba nunca, porque el JWT de `service_role` no lleva
 * `sub` y `auth.uid()` era NULL.
 *
 * Ahora la mutación y su evento ocurren dentro de la misma transacción de la
 * RPC: si el evento falla, el cliente se revierte con él. Y el actor sale de
 * `auth.uid()`, así que `updated_by` queda con el UUID real de la persona.
 *
 * ─── CLIENTES 100 % NATIVOS ────────────────────────────────────────────────
 *
 * Por decisión expresa de Dirección, Clientify queda FUERA del registro
 * maestro. Ninguna acción de este archivo lo consulta, lo escribe ni informa
 * estado de sincronización: no hay reintentos, ni resincronización por CUIT,
 * ni avisos de «pendiente», ni estados parciales.
 *
 * Desapareció `refreshFromClientify`, que hacía `upsert(onConflict: "cuit")`
 * con service_role sobre la cartera entera y pisaba razón social, domicilio,
 * teléfono, contacto, email y tags locales con lo que devolviera el CRM. Y
 * desapareció también `previewClientifyDivergences`, que sólo comparaba.
 *
 * Una caída, un timeout o la ausencia de credenciales de Clientify no puede
 * impedir crear, editar, desactivar ni usar un cliente, porque el CRM no
 * participa de ninguno de esos caminos.
 *
 * La integración de Clientify que consumen otros módulos —comercial,
 * prospección, webhooks, dashboards— NO se toca: son consumidores ajenos
 * verificados, fuera de la clausura del registro maestro, y siguen
 * funcionando igual. Su cantidad no se afirma acá: la guarda estructural la
 * deriva mecánicamente y falla si esa integración desaparece.
 */

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient, createClient as createUserClient } from "@/lib/supabase/server";
import {
  duplicateCandidates,
  listClients,
  type DuplicateCandidate,
} from "@/lib/data/clients";
import { decidirAlta } from "@/lib/clients-duplicate-confirmation";
import { isValidCuit } from "@/lib/utils";
import type { Client } from "@/lib/types";

// ============================================================================
// Schemas
// ============================================================================

const NewClientSchema = z.object({
  razon: z.string().min(2, "Razón social muy corta").max(200),
  cuit: z
    .string()
    .min(11, "CUIT incompleto")
    .max(15)
    .refine((v) => isValidCuit(v), "CUIT inválido (dígito verificador)"),
  nombre_comercial: z.string().max(200).optional().default(""),
  codigo: z.string().max(30).optional().default(""),
  contacto: z.string().max(120).optional().default(""),
  email: z.string().email("Email inválido").or(z.literal("")).optional().default(""),
  telefono: z.string().max(40).optional().default(""),
  domicilio: z.string().max(300).optional().default(""),
  localidad: z.string().max(120).optional().default(""),
  tags: z.array(z.string()).max(20).optional().default([]),
  depot: z.enum(["MAGALDI", "LUJAN", ""]).optional().default(""),
  observ: z.string().max(2000).optional().default(""),
  condicion_iva: z
    .enum([
      "RESPONSABLE_INSCRIPTO",
      "MONOTRIBUTO",
      "EXENTO",
      "CONSUMIDOR_FINAL",
      "NO_RESPONSABLE",
      "NO_CATEGORIZADO",
    ])
    .optional()
    .default("RESPONSABLE_INSCRIPTO"),
  cuenta_contable: z.string().max(20).optional().default(""),
  /**
   * Acuse de la advertencia de duplicados: el token que el servidor devolvió
   * junto con los candidatos. Ver `tokenDuplicados`.
   *
   * NO es un booleano. La versión anterior era `confirmar_pese_a_duplicados:
   * boolean`, y bastaba mandar `true` en la PRIMERA llamada para saltear la
   * advertencia entera sin haber visto un solo candidato.
   */
  confirmacion_duplicados: z.string().max(64).optional(),
  /**
   * Flujo desde el que se da de alta. Decide QUÉ capacidad exige la RPC:
   * `wms` pide `wms.clients.create` —el alta rápida desde un flujo operativo,
   * que NO concede el módulo general de Clientes— y `clientes` pide
   * `clientes.create`. La decisión final es del servidor, no del navegador:
   * la RPC vuelve a resolver el permiso por su cuenta.
   */
  origen: z.enum(["clientes", "wms"]).optional().default("clientes"),
});

export type NewClientInput = z.input<typeof NewClientSchema>;

export type CreateClientResult =
  | { ok: true; client: Client }
  | {
      ok: false;
      error: string;
      duplicados?: DuplicateCandidate[];
      /**
       * Acompaña a `duplicados`. Es lo que la UI debe devolver en la segunda
       * llamada para confirmar el alta. Sin candidatos, no se emite.
       */
      confirmacion_duplicados?: string;
    };

/**
 * Las acciones del maestro no usan el modo bootstrap de `denyReason`.
 * Antes de cualquier lectura privilegiada exigen sesión real y la capacidad
 * exacta devuelta por PostgreSQL. Sólo `true` autoriza; ausencia, error o
 * cualquier otro valor fallan cerrados sin propagar detalle interno.
 */
async function requireExactPermission(slug: string): Promise<string | null> {
  const supabase = createUserClient();
  if (!supabase) return "Sesión no disponible.";

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError || !user) return "Tu sesión no es válida. Volvé a iniciar sesión.";

  const { data, error } = await supabase.rpc("has_permission", { p_slug: slug });
  if (error || data !== true) return `No autorizado: se requiere el permiso ${slug}.`;
  return null;
}

// ============================================================================
// Listar
// ============================================================================

export async function fetchClients(search?: string): Promise<{
  ok: boolean;
  rows: Client[];
  total: number;
  source: string;
  warning?: string;
  error?: string;
}> {
  const deny = await requireExactPermission("clientes.view");
  if (deny) return { ok: false, rows: [], total: 0, source: "denied", error: deny };
  try {
    const r = await listClients({ search });
    return { ok: true, rows: r.rows, total: r.total, source: r.source, warning: r.warning };
  } catch {
    console.error("[clients/actions.fetchClients] failed", { code: "CLIENTS_FETCH_FAILED" });
    return {
      ok: false,
      rows: [],
      total: 0,
      source: "error",
      error: "No pudimos cargar los clientes.",
    };
  }
}

/** Candidatos a duplicado para advertir en el formulario, antes de guardar. */
export async function checkDuplicates(
  razon: string,
  cuit?: string,
): Promise<{ ok: boolean; candidatos: DuplicateCandidate[]; error?: string }> {
  const deny = await requireExactPermission("clientes.view");
  if (deny) return { ok: false, candidatos: [] };
  try {
    return { ok: true, candidatos: await duplicateCandidates(razon, cuit ?? null) };
  } catch {
    return {
      ok: false,
      candidatos: [],
      error: "No pudimos verificar posibles duplicados. Reintentá antes de crear.",
    };
  }
}

/**
 * ¿El usuario puede dar de alta un cliente desde un flujo operativo?
 *
 * Sirve para NO mostrar un botón que va a fallar. No es la autorización: la
 * decisión real la toman `createClient` y, por debajo, la RPC de 0242.
 * Ocultar un botón nunca fue autorización.
 */
export async function canCreateClientFromOrder(): Promise<boolean> {
  return (await requireExactPermission("wms.clients.create")) === null;
}

// ============================================================================
// Crear
// ============================================================================

export async function createClient(input: NewClientInput): Promise<CreateClientResult> {
  try {
    return await createClientInner(input);
  } catch {
    console.error("[clients/actions.createClient] unhandled", { code: "CLIENT_CREATE_UNHANDLED" });
    return {
      ok: false,
      error: "Error inesperado al guardar el cliente.",
    };
  }
}

async function createClientInner(input: NewClientInput): Promise<CreateClientResult> {
  const parsed = NewClientSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.slice(0, 3).map((i) => i.message).join(" · ") };
  }
  const data = parsed.data;
  const cuitDigits = data.cuit.replace(/\D/g, "");

  // La capacidad exigida depende del ORIGEN. Un encargado de depósito puede
  // dar de alta un cliente desde la orden sin tener el módulo general de
  // Clientes: son dos permisos distintos y a propósito.
  //
  // Esta barrera se evalúa ANTES de construir el cliente admin. La RPC de 0242
  // vuelve a decidir dentro de PostgreSQL, por lo que tampoco existe bypass
  // por llamada directa a PostgREST.
  const capacidad = data.origen === "wms" ? "wms.clients.create" : "clientes.create";
  const deny = await requireExactPermission(capacidad);
  if (deny) return { ok: false, error: deny };

  const admin = createAdminClient();
  if (!admin) return { ok: false, error: "Backend no disponible." };

  // Duplicado EXACTO por CUIT: bloquea siempre. Es la unicidad de la tabla.
  const { data: existing, error: existingError } = await admin
    .from("clients")
    .select("id, razon")
    .eq("cuit", cuitDigits)
    .maybeSingle();
  if (existingError) {
    console.error("[clients] exact duplicate lookup failed", {
      code: "CLIENT_EXACT_DUPLICATE_LOOKUP_FAILED",
    });
    return { ok: false, error: "No pudimos verificar el CUIT. Reintentá antes de crear." };
  }
  if (existing) {
    return { ok: false, error: `Ya existe un cliente con CUIT ${cuitDigits} (${existing.razon}).` };
  }

  // Duplicado PROBABLE por razón social: advierte, no bloquea. Un alta
  // legítima con nombre parecido debe poder completarse; lo que no puede es
  // ocurrir sin que nadie la haya visto.
  //
  // Los candidatos se recalculan SIEMPRE, también cuando viene acuse: es la
  // única forma de comprobar que la confirmación corresponde a la foto vigente
  // y no a una anterior. La decisión vive en un módulo puro y probado.
  const candidatos = await duplicateCandidates(data.razon, cuitDigits);
  const decision = decidirAlta({
    razon: data.razon,
    cuit: cuitDigits,
    candidatos,
    acuse: data.confirmacion_duplicados ?? null,
  });

  if (decision.estado === "advertir") {
    return {
      ok: false,
      error: decision.revisada
        ? "La lista de clientes parecidos cambió desde que la viste. Revisala de nuevo y confirmá."
        : "Hay clientes parecidos. Revisalos y confirmá si aun así querés crear uno nuevo.",
      duplicados: decision.candidatos as DuplicateCandidate[],
      confirmacion_duplicados: decision.acuse,
    };
  }

  const cuenta = data.cuenta_contable?.trim() || null;
  if (cuenta) {
    const { data: acc, error: accErr } = await admin
      .from("chart_of_accounts")
      .select("code, is_postable, is_active")
      .eq("code", cuenta)
      .maybeSingle();
    if (accErr) return { ok: false, error: "No pudimos validar la cuenta contable." };
    if (!acc) return { ok: false, error: `La cuenta ${cuenta} no existe en el Plan de Cuentas.` };
    if (!acc.is_postable || !acc.is_active) {
      return { ok: false, error: `La cuenta ${cuenta} no es imputable.` };
    }
  }

  // 1) El cliente NACE nativo, siempre. Clientify no participa de su creación.
  //    La RPC escribe cliente + evento de auditoría en UNA transacción, bajo
  //    la identidad del usuario. Si la auditoría falla, no queda cliente.
  const supabase = createUserClient();
  if (!supabase) return { ok: false, error: "Sesión no disponible." };

  const { data: row, error } = await supabase
    .rpc("client_create", {
      p_razon: data.razon,
      p_cuit: cuitDigits,
      p_nombre_comercial: data.nombre_comercial || null,
      p_codigo: data.codigo || null,
      p_telefono: data.telefono || null,
      p_contacto: data.contacto || null,
      p_email: data.email || null,
      p_tags: data.tags,
      p_condicion_iva: data.condicion_iva,
      p_cuenta_contable: cuenta,
      p_origen: data.origen,
      // Que el alta se hizo PESE a una advertencia queda en la auditoría, con
      // los ids advertidos. Sin esto, el evento no distingue un alta limpia de
      // una que alguien decidió forzar, que es justo lo que hay que poder
      // reconstruir después.
      p_duplicados_advertidos: decision.duplicadosAdvertidos,
      p_domicilio: data.domicilio || null,
      p_localidad: data.localidad || null,
      p_deposito_asignado: data.depot || null,
      p_observaciones: data.observ || null,
    })
    .select("*")
    .single<Client>();

  if (error || !row) {
    // El error se PROPAGA. Queda prohibido devolver éxito con la escritura o
    // la auditoría caídas: es exactamente el defecto que cerró D-1.
    console.error("[clients] client_create failed", { code: "CLIENT_CREATE_RPC_FAILED" });
    return { ok: false, error: traducirErrorRpc(error?.message) };
  }

  revalidatePath("/clients");
  revalidatePath("/orders/new");
  return { ok: true, client: row as Client };
}

// ============================================================================
// Editar registro maestro nativo
// ============================================================================

const ClientMasterSchema = z.object({
  id: z.string().uuid(),
  razon: z.string().trim().min(2, "Razón social muy corta").max(200),
  nombre_comercial: z.string().max(200).optional().default(""),
  codigo: z.string().max(30).optional().default(""),
  domicilio: z.string().max(300).optional().default(""),
  localidad: z.string().max(120).optional().default(""),
  telefono: z.string().max(40).optional().default(""),
  contacto: z.string().max(120).optional().default(""),
  email: z.string().email("Email inválido").or(z.literal("")).optional().default(""),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional().default([]),
  deposito_asignado: z.enum(["MAGALDI", "LUJAN", ""]).optional().default(""),
  observaciones: z.string().max(2000).optional().default(""),
  motivo: z.string().trim().max(500).optional().default("edición de ficha nativa"),
  expected_updated_at: z.string().datetime({ offset: true }),
});

export type ClientMasterInput = z.input<typeof ClientMasterSchema>;

export async function updateClientMaster(
  input: ClientMasterInput,
): Promise<{ ok: true; client: Client } | { ok: false; error: string }> {
  const deny = await requireExactPermission("clientes.edit");
  if (deny) return { ok: false, error: deny };

  const parsed = ClientMasterSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues.slice(0, 3).map((issue) => issue.message).join(" · "),
    };
  }

  const d = parsed.data;
  const optional = {
    nombre_comercial: d.nombre_comercial.trim(),
    codigo: d.codigo.trim(),
    domicilio: d.domicilio.trim(),
    localidad: d.localidad.trim(),
    telefono: d.telefono.trim(),
    contacto: d.contacto.trim(),
    email: d.email.trim(),
    deposito_asignado: d.deposito_asignado,
    observaciones: d.observaciones.trim(),
  };
  const limpiar = Object.entries(optional)
    .filter(([, value]) => value === "")
    .map(([field]) => field);

  const supabase = createUserClient();
  if (!supabase) return { ok: false, error: "Sesión no disponible." };

  const { data: row, error } = await supabase
    .rpc("client_update", {
      p_id: d.id,
      p_razon: d.razon,
      p_nombre_comercial: optional.nombre_comercial || null,
      p_codigo: optional.codigo || null,
      p_telefono: optional.telefono || null,
      p_contacto: optional.contacto || null,
      p_email: optional.email || null,
      p_motivo: d.motivo || "edición de ficha nativa",
      p_limpiar: limpiar,
      p_domicilio: optional.domicilio || null,
      p_localidad: optional.localidad || null,
      p_deposito_asignado: optional.deposito_asignado || null,
      p_observaciones: optional.observaciones || null,
      p_tags: d.tags,
      p_expected_updated_at: d.expected_updated_at,
    })
    .select("*")
    .single<Client>();

  if (error || !row) {
    return { ok: false, error: traducirErrorRpc(error?.message) };
  }

  revalidatePath(`/clientes/${d.id}`);
  revalidatePath("/clients");
  revalidatePath("/orders/new");
  return { ok: true, client: row };
}

// ============================================================================
// Editar ficha fiscal
// ============================================================================

const ClientFiscalSchema = z.object({
  id: z.string().uuid(),
  expected_updated_at: z.string().datetime({ offset: true }),
  condicion_iva: z.enum([
    "RESPONSABLE_INSCRIPTO",
    "MONOTRIBUTO",
    "EXENTO",
    "CONSUMIDOR_FINAL",
    "NO_RESPONSABLE",
    "NO_CATEGORIZADO",
  ]),
  cuenta_contable: z.string().max(20).optional().default(""),
});
export type ClientFiscalInput = z.input<typeof ClientFiscalSchema>;

export async function updateClientFiscal(
  input: ClientFiscalInput,
): Promise<{ ok: true; updated_at: string } | { ok: false; error: string }> {
  const deny = await requireExactPermission("clientes.edit");
  if (deny) return { ok: false, error: deny };

  const parsed = ClientFiscalSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }
  const admin = createAdminClient();
  if (!admin) return { ok: false, error: "Backend no disponible." };
  const d = parsed.data;
  const cuenta = d.cuenta_contable?.trim() || null;

  if (cuenta) {
    const { data: acc, error: accErr } = await admin
      .from("chart_of_accounts")
      .select("code, is_postable, is_active")
      .eq("code", cuenta)
      .maybeSingle();
    if (accErr) return { ok: false, error: "No pudimos validar la cuenta contable." };
    if (!acc) return { ok: false, error: `La cuenta ${cuenta} no existe en el Plan de Cuentas.` };
    if (!acc.is_postable || !acc.is_active) {
      return { ok: false, error: `La cuenta ${cuenta} no es imputable.` };
    }
  }

  const supabase = createUserClient();
  if (!supabase) return { ok: false, error: "Sesión no disponible." };

  // TRIESTADO: `null` significa «no lo toques». Para VACIAR hay que decirlo,
  // y eso es exactamente lo que hace el selector cuando el usuario elige «—».
  // Sin esta distinción, quitar una cuenta mal imputada devolvía «Guardado» y
  // la cuenta seguía ahí.
  const { data: updated, error } = await supabase
    .rpc("client_update", {
      p_id: d.id,
      p_condicion_iva: d.condicion_iva,
      p_cuenta_contable: cuenta,
      p_limpiar: cuenta === null ? ["cuenta_contable"] : [],
      p_motivo: "actualización de ficha fiscal",
      p_expected_updated_at: d.expected_updated_at,
    })
    .select("updated_at")
    .single<{ updated_at: string }>();
  if (error || !updated?.updated_at) {
    return { ok: false, error: traducirErrorRpc(error?.message) };
  }

  revalidatePath(`/clientes/${d.id}`);
  revalidatePath("/clients");
  return { ok: true, updated_at: updated.updated_at };
}

// ============================================================================
// Activar / desactivar
// ============================================================================

export async function setClientActivo(
  id: string,
  activo: boolean,
  motivo: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const deny = await requireExactPermission("clientes.delete");
  if (deny) return { ok: false, error: deny };
  if (!z.string().uuid().safeParse(id).success) return { ok: false, error: "Cliente inválido." };
  if (!motivo?.trim()) return { ok: false, error: "El motivo es obligatorio." };
  if (motivo.trim().length > 500) return { ok: false, error: "El motivo es demasiado largo." };

  const supabase = createUserClient();
  if (!supabase) return { ok: false, error: "Sesión no disponible." };

  // Un cliente NUNCA se elimina físicamente: se desactiva. Las órdenes y
  // recepciones históricas que lo referencian siguen siendo válidas.
  const { error } = await supabase.rpc("client_set_active", {
    p_id: id,
    p_activo: activo,
    p_motivo: motivo.trim(),
  });
  if (error) return { ok: false, error: traducirErrorRpc(error.message) };
  revalidatePath("/clients");
  revalidatePath(`/clientes/${id}`);
  return { ok: true };
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Traduce los códigos de las RPC de 0242 a un mensaje accionable.
 *
 * Los errores conocidos se traducen; cualquier otro detalle de PostgreSQL se
 * reemplaza por un mensaje operativo genérico para no exponer implementación,
 * datos fiscales ni texto interpolado por una excepción.
 */
function traducirErrorRpc(msg: string | undefined): string {
  if (!msg) return "No pudimos completar la operación.";
  if (msg.includes("CLIENT_DENEGADO")) return "No tenés permiso para esta operación.";
  if (msg.includes("CLIENT_SIN_IDENTIDAD")) return "Tu sesión expiró. Volvé a iniciar sesión.";
  if (msg.includes("CLIENT_CUIT_INVALIDO")) return "El CUIT o su dígito verificador no son válidos.";
  if (msg.includes("CLIENT_RAZON_VACIA")) return "La razón social es obligatoria.";
  if (msg.includes("CLIENT_ORIGEN_INVALIDO")) return "El origen del alta no es válido.";
  if (msg.includes("CLIENT_MOTIVO_REQUERIDO")) return "El motivo es obligatorio.";
  if (msg.includes("CLIENT_INEXISTENTE")) return "El cliente no existe.";
  if (msg.includes("CLIENT_CAMPO_NO_LIMPIABLE")) return "Ese campo no se puede vaciar.";
  if (msg.includes("CLIENT_CONFLICTO_CONCURRENTE")) {
    return "La ficha cambió mientras la estabas editando. Recargá y revisá la versión vigente antes de guardar.";
  }
  if (msg.includes("clients_cuit_key") || msg.includes("clients_cuit_digits_uk")) {
    return "Ya existe un cliente con ese CUIT.";
  }
  return "No pudimos completar la operación. Reintentá en unos minutos.";
}
