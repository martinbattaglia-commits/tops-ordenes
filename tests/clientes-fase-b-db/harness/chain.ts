/**
 * Cadena productiva y seed canónico del harness de CLIENTES FASE B.
 *
 * La cadena NO se adivina: se deriva del manifiesto vanilla (que ya carga el
 * WMS completo sobre PostgreSQL 17) más las migraciones que 0246–0249
 * referencian de forma dura —Nexus Link, clientes nativos y ciclo de precios
 * de órdenes de servicio—. `descubrirCadena` la recorre en orden numérico y
 * deja constancia explícita de lo que no aplica, para que ninguna omisión pase
 * por cobertura.
 */
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import type { Client } from "pg";

export const ROOT = resolve(__dirname, "..", "..", "..");
export const MIGRATIONS = resolve(ROOT, "supabase", "migrations");
export const BOOTSTRAP = resolve(ROOT, "tests", "db", "bootstrap", "00-platform-stub.sql");

/**
 * Los dos artefactos bajo prueba y sus inversas exactas.
 *
 * Eran cuatro. 0247 (RLS por nave) y 0248 (wrappers de RPC con scope) se
 * retiraron enteras al eliminarse el aislamiento por sede: Magaldi y Luján
 * están a cincuenta metros y los encargados se cubren entre sí, de modo que
 * los documentos multi-nave son la operatoria normal y no había requisito que
 * sostener. Quedan 0246 recortada —principales, capacidades y neutralización
 * del rol legacy— y 0249 entera.
 */
export const FASE_B_FORWARDS = [
  "0246_clientes_fase_b_principals_capabilities.sql",
  "0249_clientes_fase_b_service_pricing_redaction.sql",
] as const;

export const FASE_B_ROLLBACKS = [
  "ROLLBACK_0249_clientes_fase_b_service_pricing_redaction.sql",
  "ROLLBACK_0246_clientes_fase_b_principals_capabilities.sql",
] as const;

/**
 * El archive remoto 0205–0218 vive fuera del árbol ejecutable y nunca se
 * aplica; 0016 y 0036–0039 exigen PostGIS, que el stub de plataforma no
 * provee y que ninguna garantía de FASE B necesita.
 */
function esFueraDeAlcance(file: string): boolean {
  const n = Number(file.slice(0, 4));
  if (!Number.isInteger(n)) return false;
  if (n >= 205 && n <= 218) return true;
  if (n === 16) return true;
  if (n >= 36 && n <= 39) return true;
  return false;
}

/** Migraciones productivas en orden, hasta el tope del lease de FASE B. */
export function cadenaHasta(tope = 249): string[] {
  return readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .filter((f) => !f.startsWith("ROLLBACK_"))
    .filter((f) => !esFueraDeAlcance(f))
    .filter((f) => {
      const n = Number(f.slice(0, 4));
      return !Number.isInteger(n) || n <= tope;
    })
    .sort();
}

export interface ResultadoCadena {
  aplicadas: string[];
  omitidas: Array<{ file: string; error: string }>;
}

/**
 * Aplica la cadena. Una migración que no aplica NO aborta la carga: se
 * registra y se sigue, porque el objeto de prueba es el comportamiento de
 * 0246–0249 y las omisiones deben quedar declaradas, no ocultas.
 */
export async function aplicarCadena(db: Client, files: string[]): Promise<ResultadoCadena> {
  const aplicadas: string[] = [];
  const omitidas: Array<{ file: string; error: string }> = [];
  for (const file of files) {
    // Cada migración va en su propia transacción: sin esto, la primera que
    // falla deja la sesión abortada y todo lo posterior se ignora en
    // silencio, que es la forma más fácil de fabricar un verde vacío.
    await db.query("begin");
    try {
      await db.query(readFileSync(resolve(MIGRATIONS, file), "utf8"));
      await db.query("commit");
      aplicadas.push(file);
    } catch (e) {
      await db.query("rollback");
      omitidas.push({ file, error: String((e as Error).message).split("\n")[0].slice(0, 200) });
    }
  }
  return { aplicadas, omitidas };
}

export async function aplicar(db: Client, file: string): Promise<void> {
  await db.query(readFileSync(resolve(MIGRATIONS, file), "utf8"));
}

// ─────────────────────────────────────────────────────────────────────────
// Identidades canónicas del contrato de FASE B
// ─────────────────────────────────────────────────────────────────────────

export const JORGE = {
  id: "4cf9b607-36bb-4ed9-ab31-82823d625b8d",
  email: "despachos-lujan@logisticatops.com",
  depot: "LUJAN",
  warehouse: "PEDRO_LUJAN_3159",
} as const;

export const JUAN = {
  id: "3873f156-02de-4424-af48-3e590536cc1d",
  email: "despachos-magaldi@logisticatops.com",
  depot: "MAGALDI",
  warehouse: "MAGALDI_1765",
} as const;

export const ADMIN = {
  id: "a1111111-1111-4111-8111-111111111111",
  email: "admin@logisticatops.com",
} as const;

/** Las 14 capacidades que el rol tenía ANTES de 0246 (guard de precondición). */
export const CAPACIDADES_PREVIAS = [
  "cockpit.view", "connect.create", "connect.edit", "connect.view",
  "knowledge.view", "mi_espacio.view", "nexus_link.internal_chat.read",
  "nexus_link.internal_chat.send", "nexus_link.internal_chat.media",
  "servicios.create", "servicios.sign", "servicios.view", "wms.edit", "wms.view",
] as const;

/**
 * Estado productivo que el guard de 0246 exige encontrar (0246:5-91). Sin
 * esto la migración aborta y el harness no mediría nada.
 */
export async function seedCanonico(db: Client): Promise<void> {
  await db.query(
    `insert into auth.users (id, email) values ($1,$2),($3,$4),($5,$6)
     on conflict (id) do update set email = excluded.email`,
    [JORGE.id, JORGE.email, JUAN.id, JUAN.email, ADMIN.id, ADMIN.email],
  );

  await db.query(
    `insert into public.profiles (id, email, full_name, role, active)
     values ($1,$2,'Jorge Merino','operaciones',true),
            ($3,$4,'Juan Carlos Reynoso','operaciones',true),
            ($5,$6,'Administración','admin',true)
     on conflict (id) do update
       set email = excluded.email, role = excluded.role, active = excluded.active,
           depot = null`,
    [JORGE.id, JORGE.email, JUAN.id, JUAN.email, ADMIN.id, ADMIN.email],
  );

  // El rol no lo crea ninguna migración: es dato productivo. El guard exige
  // slug y nombre exactos.
  await db.query(
    `insert into public.roles (slug, name, description, is_system)
     values ('jefe_deposito','Jefe de Deposito','Encargado de deposito', false)
     on conflict (slug) do update set name = excluded.name`,
  );

  // Los permisos los siembran las migraciones (0009, 0021, 0029, 0146, 0155…),
  // con enums de módulo y acción y un unique(module, action): inventarlos acá
  // produciría un catálogo que no es el productivo. Si falta alguno, el
  // harness lo dice en vez de continuar sobre un estado inventado.
  const faltantes = await db.query<{ slug: string }>(
    `select s as slug from unnest($1::text[]) as s
     where not exists (select 1 from public.permissions p where p.slug = s)`,
    [[...CAPACIDADES_PREVIAS]],
  );
  if (faltantes.rows.length > 0) {
    throw new Error(
      `seedCanonico: faltan permisos en el catálogo productivo: ${faltantes.rows
        .map((r) => r.slug)
        .join(", ")}`,
    );
  }

  await db.query(
    `insert into public.role_permissions (role_id, permission_id)
     select r.id, p.id
     from public.roles r
     join public.permissions p on p.slug = any($1::text[])
     where r.slug = 'jefe_deposito'
     on conflict do nothing`,
    [[...CAPACIDADES_PREVIAS]],
  );

  // Exactamente una asignación por encargado, con depot NULL: es la
  // proyección previa que 0246 verifica antes de escribir la suya.
  await db.query(
    `insert into public.user_roles (user_id, role_id, depot)
     select u, r.id, null from unnest($1::uuid[]) as u
     cross join public.roles r where r.slug = 'jefe_deposito'
     on conflict do nothing`,
    [[JORGE.id, JUAN.id]],
  );
}

/**
 * Jerarquía física mínima de MAGALDI_1765.
 *
 * El árbol no la provee: el único insert de `warehouse_positions` vive en
 * 0023_lujan_cubiculos.sql:45 y es exclusivo de PEDRO_LUJAN_3159; 0020 siembra
 * para Magaldi únicamente pisos y sectores. Sin esto no existe ninguna
 * posición de la otra sede, y toda prueba de aislamiento entre naves queda sin
 * sujeto: es lo que hacía que el test negativo retornara sin ejercer su
 * aserción.
 */
export async function seedJerarquiaMagaldi(db: Client): Promise<void> {
  await db.query(
    `insert into public.warehouse_zones (sector_id, code, name, zone_type)
     select s.id, 'HN', 'Harness', 'almacenamiento'::warehouse_zone_type_t
     from public.warehouse_sectors s
     join public.warehouse_floors fl on fl.id = s.floor_id
     join public.warehouses w on w.id = fl.warehouse_id
     where w.code = 'MAGALDI_1765'
     limit 1
     on conflict (sector_id, code) do nothing`,
  );
  await db.query(
    `insert into public.warehouse_racks (zone_id, code, name)
     select z.id, 'H1', 'Rack harness'
     from public.warehouse_zones z
     join public.warehouse_sectors s on s.id = z.sector_id
     join public.warehouse_floors fl on fl.id = s.floor_id
     join public.warehouses w on w.id = fl.warehouse_id
     where w.code = 'MAGALDI_1765' and z.code = 'HN'
     on conflict (zone_id, code) do nothing`,
  );
  await db.query(
    `insert into public.warehouse_positions (rack_id, code, status, surface_m2, volume_m3)
     select rk.id, 'H01', 'disponible'::warehouse_position_status_t, null, null
     from public.warehouse_racks rk
     join public.warehouse_zones z on z.id = rk.zone_id
     join public.warehouse_sectors s on s.id = z.sector_id
     join public.warehouse_floors fl on fl.id = s.floor_id
     join public.warehouses w on w.id = fl.warehouse_id
     where w.code = 'MAGALDI_1765' and z.code = 'HN' and rk.code = 'H1'
     on conflict (rack_id, code) do nothing`,
  );

  const { rows } = await db.query<{ n: string }>(
    `select count(*)::text as n
     from public.warehouse_positions wp
     join public.warehouse_racks wr on wr.id = wp.rack_id
     join public.warehouse_zones wz on wz.id = wr.zone_id
     join public.warehouse_sectors ws on ws.id = wz.sector_id
     join public.warehouse_floors wf on wf.id = ws.floor_id
     join public.warehouses w on w.id = wf.warehouse_id
     where w.code = 'MAGALDI_1765'`,
  );
  if (Number(rows[0].n) === 0) {
    throw new Error("seedJerarquiaMagaldi: MAGALDI_1765 quedó sin posiciones");
  }
}

/** Devuelve una posición de la nave pedida, o FALLA. Nunca devuelve vacío. */
export async function posicionDe(db: Client, warehouseCode: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `select wp.id
     from public.warehouse_positions wp
     join public.warehouse_racks wr on wr.id = wp.rack_id
     join public.warehouse_zones wz on wz.id = wr.zone_id
     join public.warehouse_sectors ws on ws.id = wz.sector_id
     join public.warehouse_floors wf on wf.id = ws.floor_id
     join public.warehouses w on w.id = wf.warehouse_id
     where w.code = $1
     limit 1`,
    [warehouseCode],
  );
  if (rows.length === 0) {
    // Una precondición ausente debe ROMPER el test, nunca saltearlo: un test
    // que se auto-exime ante datos faltantes reporta verde sin haber probado
    // nada.
    throw new Error(`posicionDe: no hay ninguna posición en ${warehouseCode}`);
  }
  return rows[0].id;
}

/**
 * Migraciones que NO aplican sobre el sustrato del harness, con su motivo.
 * Es una lista CERRADA: si aparece una omisión nueva, el harness debe ponerse
 * en rojo en vez de tragársela. Cubrir menos de lo declarado es el defecto
 * que este harness existe para impedir.
 */
export const OMISIONES_ESPERADAS: ReadonlyArray<string> = [
  // Tracking: exige PostGIS (extensions.geometry), que el stub de plataforma
  // no provee, y arrastra a sus dependientes.
  "0017_tracking_geofences.sql",
  "0018_tracking_events.sql",
  "0019_tracking_rbac_seed.sql",
  // Seeds de permisos con valores de enum que la cadena vanilla no define.
  "0061_mi_espacio_permission.sql",
  "0070_rbac_gerencia_finanzas.sql",
  "0124_contabilidad_permissions_seed.sql",
  // Prospección: su tabla raíz no está en la cadena vanilla.
  "0106_prospeccion_qualification.sql",
  "0107_prospeccion_approval.sql",
  // Knowledge / AI: pg_trgm con gin_trgm_ops y ai_docs_redact, que arrastran
  // a todo lo que los consume.
  "0138_knowledge_adapter_custody.sql",
  "0176_knowledge_docs_projection.sql",
  "0178_docs_retrieval_improvements.sql",
  "0181_ai_finance_overview.sql",
  "0182_ai_analytics_overview.sql",
  "0183_ai_customer_revenue.sql",
  "0185_company_knowledge_base.sql",
  "0186_manual_nexus_kb_layer.sql",
  // Custodia: su propio expediente, con harness dedicado.
  "0221_custody_integrity_enums.sql",
  "0222_custody_integrity_foundation.sql",
  "0223_custody_integrity_decision.sql",
  "0224_custody_integrity_authority_hardening.sql",
  "0226_custody_content_attestation.sql",
  "0231_custody_read_tenant_scope.sql",
  "0232_custody_evaluation_lease_exclusive.sql",
  // FASE A · ciclo de precios de OC. Cae por ai_docs_redact, no por sí misma.
  // LIMITACIÓN DECLARADA: este harness NO ejercita 0243. FASE B no la toca
  // —0249 depende de 0244— pero su cobertura vive en el gate de PR #66, no
  // acá, y no debe afirmarse lo contrario.
  "0243_purchase_order_price_lifecycle.sql",
];

/** Aserción dura: el conjunto omitido es EXACTAMENTE el esperado. */
export function verificarOmisiones(omitidas: ReadonlyArray<{ file: string }>): {
  inesperadas: string[];
  yaNoOmitidas: string[];
} {
  const set = new Set(omitidas.map((o) => o.file));
  return {
    inesperadas: [...set].filter((f) => !OMISIONES_ESPERADAS.includes(f)).sort(),
    yaNoOmitidas: OMISIONES_ESPERADAS.filter((f) => !set.has(f)).sort(),
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Simulación de sesión
// ─────────────────────────────────────────────────────────────────────────

/** Ejecuta como un usuario autenticado concreto (auth.uid() vía GUC). */
export async function comoUsuario<T>(
  db: Client,
  userId: string,
  email: string,
  fn: () => Promise<T>,
): Promise<T> {
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [userId]);
  await db.query("select set_config('request.jwt.claims',$1,false)", [
    JSON.stringify({ sub: userId, role: "authenticated", email }),
  ]);
  await db.query("select set_config('request.jwt.claim.role','authenticated',false)");
  await db.query("set role authenticated");
  try {
    return await fn();
  } finally {
    await db.query("reset role");
    await db.query("select set_config('request.jwt.claim.sub','',false)");
    await db.query("select set_config('request.jwt.claims','',false)");
  }
}

export async function comoServiceRole<T>(db: Client, fn: () => Promise<T>): Promise<T> {
  await db.query("select set_config('request.jwt.claim.role','service_role',false)");
  await db.query("set role service_role");
  try {
    return await fn();
  } finally {
    await db.query("reset role");
    await db.query("select set_config('request.jwt.claim.role','authenticated',false)");
  }
}
