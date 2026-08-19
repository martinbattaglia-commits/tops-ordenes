/**
 * OC-FIRMANTE-POR-PERMISO · EL ESCENARIO COMPARTIDO.
 *
 * El estado previo de producción —medido, no supuesto—, la extracción de los
 * bloques de datos de 0259 y el acceso a PostgreSQL. Lo usan las dos pruebas
 * del expediente: el par rojo→verde (`run.mjs`) y la prueba de mordida de los
 * guardas (`mordida.mjs`). Vive en un solo lugar para que las dos midan
 * exactamente el mismo mundo; dos copias divergen y dejan de probar lo mismo.
 */

import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(AQUI, "..", "..", "..");
export const MIGRACIONES = join(RAIZ, "supabase", "migrations");

const arg = (n, d) => {
  const i = process.argv.indexOf(n);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : d;
};
export const SOCKET = arg("--socket", "/tmp/ocfp");
export const PORT = arg("--port", "55432");
export const USER = arg("--user", "harness");

/**
 * El cargo de Cynthia, provisto por Dirección y estampado por 0259. Se declara
 * acá para que los escenarios lo exijan por valor: si alguien lo cambia en la
 * migración sin decidirlo, el par rojo→verde lo ve.
 *
 * Hubo una ventana en que este dato faltaba y la migración llevaba un bloque
 * centinela que la abortaba entera. El extractor de abajo sigue sabiendo elidir
 * un centinela si volviera a aparecer, porque el patrón —«el dato lo da
 * Dirección, no lo inventa la migración»— vale para el próximo cargo también.
 */
export const CARGO_CYNTHIA = "Gerenta Comercial";

/**
 * Extrae de 0259 los bloques de datos: todo lo que va entre `begin;` y la
 * sección de la compuerta. Se ejecuta TAL CUAL, con sus post-condiciones, con
 * dos salvedades declaradas y verificadas acá:
 *
 *   · el bloque centinela del cargo de Cynthia se elide — es el que hace que la
 *     migración aborte a propósito hasta que Dirección entregue el dato;
 *   · el literal centinela del cargo se sustituye por el cargo de prueba.
 *
 * Si el centinela YA no está (porque Dirección entregó el cargo y alguien lo
 * cargó), no se sustituye nada y se prueba el texto real.
 */
export function extraerDatos() {
  const txt = readFileSync(join(MIGRACIONES, "0259_purchase_order_signer_by_permission.sql"), "utf8");
  const iBegin = txt.indexOf("\nbegin;\n");
  const iFin = txt.indexOf("-- ── 5 · LA COMPUERTA");
  if (iBegin < 0 || iFin < 0) throw new Error("0259: no se ubicaron los bloques de datos");
  let sql = txt.slice(iBegin + "\nbegin;\n".length, iFin);

  const iCent = sql.indexOf("do $centinela$");
  let pendiente = false;
  if (iCent >= 0) {
    const jCent = sql.indexOf("$centinela$;", iCent);
    if (jCent < 0) throw new Error("0259: bloque centinela sin cierre");
    sql = sql.slice(0, iCent) + sql.slice(jCent + "$centinela$;".length);
    pendiente = true;
  }
  const CENTINELA_CARGO = "⛔ CARGO PENDIENTE DE DIRECCIÓN";
  if (sql.includes(CENTINELA_CARGO)) {
    if (!pendiente) throw new Error("0259: hay cargo centinela pero no bloque centinela");
    sql = sql.split(CENTINELA_CARGO).join("«CARGO DE PRUEBA · NO ES EL DE PRODUCCIÓN»");
  } else if (pendiente) {
    throw new Error("0259: hay bloque centinela pero no cargo centinela");
  }
  return { sql, pendiente };
}

export function psql(sql, { tuplesOnly = true } = {}) {
  const r = spawnSync(
    "psql",
    ["-h", SOCKET, "-p", PORT, "-U", USER, "-d", "postgres", "-v", "ON_ERROR_STOP=1", ...(tuplesOnly ? ["-tA"] : []), "-c", sql],
    { encoding: "utf8" },
  );
  return { ok: r.status === 0, out: (r.stdout || "").trim(), err: (r.stderr || "").trim() };
}

export function psqlFile(ruta) {
  const r = spawnSync("psql", ["-h", SOCKET, "-p", PORT, "-U", USER, "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-f", ruta], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`psql -f ${ruta} falló:\n${r.stderr}`);
}

// ── LAS CUENTAS, CON SUS UUID REALES DE PRODUCCIÓN ──────────────────────────
//
// Los siete primeros son cuentas reales medidas en `arsksytgdnzukbmfgkju` — seis
// personas, porque Dirección tiene dos cuentas. Que los UUID coincidan con los
// escritos en 0259 es parte de lo que se prueba.
export const U = {
  direccion:  "7a9ecbdc-3ff0-459e-b340-8a07eed898fa", // martin.battaglia@ · FIRMA
  direccion2: "1f39803f-d602-4a89-90b1-72ea5d3b69e1", // martin@ · FIRMA (misma persona)
  joseluis:   "3b1607c9-32c5-4ca0-91e1-19c82099b64d", // FIRMA
  cynthia:    "4aa1203d-a943-4ef0-b1c5-3127fde3adfb", // FIRMA
  mariela:    "98acb5c2-5666-4539-991e-8a778cfecda2", // NO firma
  ruth:       "5b635940-28be-43ab-a2bd-606481052bee", // NO firma
  rinas:      "194378b5-3676-4085-8709-b82c18e8be65", // NO firma
  // Sintéticos, para los bordes del cargo que ninguna cuenta real ejercita.
  inactivo:   "aaaaaaaa-0000-4000-8000-000000000004",
  sinCargo:   "aaaaaaaa-0000-4000-8000-000000000005",
  sinNombre:  "aaaaaaaa-0000-4000-8000-000000000006",
  ambiguo:    "aaaaaaaa-0000-4000-8000-000000000007",
};

/** El estado PREVIO de producción, medido. Sobre esto corre el lado ROJO. */
export const SEMILLA = `
insert into auth.users (id, email) values
  ('${U.direccion}','martin.battaglia@logisticatops.com'),
  ('${U.direccion2}','martin@logisticatops.com'),
  ('${U.joseluis}','joseluis@logisticatops.com'),
  ('${U.cynthia}','cynthia@logisticatops.com'),
  ('${U.mariela}','mariela@sullivancamejo.com.ar'),
  ('${U.ruth}','ruth@logisticatops.com'),
  ('${U.rinas}','martinrinas@logisticatops.com'),
  ('${U.inactivo}','inactivo@logisticatops.com'),
  ('${U.sinCargo}','sincargo@logisticatops.com'),
  ('${U.sinNombre}','sinnombre@logisticatops.com'),
  ('${U.ambiguo}','ambiguo@logisticatops.com');

insert into public.profiles (id, full_name, email, role, active) values
  ('${U.direccion}','Martín F. Battaglia','martin.battaglia@logisticatops.com','admin',true),
  ('${U.direccion2}','Martín F. Battaglia','martin@logisticatops.com','admin',true),
  ('${U.joseluis}','José Luis Rodríguez Silva','joseluis@logisticatops.com','admin',true),
  ('${U.cynthia}','Cynthia Alba','cynthia@logisticatops.com','supervisor',true),
  ('${U.mariela}','Mariela Camejo','mariela@sullivancamejo.com.ar','admin',true),
  ('${U.ruth}','Ruth Carrasquero','ruth@logisticatops.com','supervisor',true),
  ('${U.rinas}','Martin Rinas','martinrinas@logisticatops.com','admin',true),
  ('${U.inactivo}','Alguien Inactivo','inactivo@logisticatops.com','admin',false),
  ('${U.sinCargo}','Alguien Sin Cargo','sincargo@logisticatops.com','admin',true),
  ('${U.sinNombre}',null,'sinnombre@logisticatops.com','admin',true),
  ('${U.ambiguo}','Alguien Ambiguo','ambiguo@logisticatops.com','admin',true);

-- Roles tal como estaban repartidos en producción. Sólo Dirección tenía cargo
-- cargado, y era el valor mezclado que 0259 corrige.
insert into public.user_roles (user_id, role_id, position_title)
select '${U.direccion}', id, 'Presidente · Super Administrador' from public.roles where slug='super_admin';
insert into public.user_roles (user_id, role_id, position_title)
select '${U.direccion}', id, null from public.roles where slug='ai_docs_pilot';
insert into public.user_roles (user_id, role_id, position_title)
select '${U.direccion2}', id, 'Presidente · Super Administrador' from public.roles where slug='super_admin';
insert into public.user_roles (user_id, role_id, position_title)
select '${U.joseluis}', id, null from public.roles where slug='director_ops';
insert into public.user_roles (user_id, role_id, position_title)
select '${U.joseluis}', id, null from public.roles where slug='rrhh_admin';
insert into public.user_roles (user_id, role_id, position_title)
select '${U.cynthia}', id, null from public.roles where slug='admin_sin_rrhh';
insert into public.user_roles (user_id, role_id, position_title)
select '${U.mariela}', id, null from public.roles where slug='director_ops';
insert into public.user_roles (user_id, role_id, position_title)
select '${U.mariela}', id, null from public.roles where slug='rrhh_admin';
insert into public.user_roles (user_id, role_id, position_title)
select '${U.ruth}', id, null from public.roles where slug='admin_sin_rrhh';
insert into public.user_roles (user_id, role_id, position_title)
select '${U.ruth}', id, null from public.roles where slug='facturacion_ventas';
insert into public.user_roles (user_id, role_id, position_title)
select '${U.rinas}', id, null from public.roles where slug='gerencia';
insert into public.user_roles (user_id, role_id, position_title)
select '${U.inactivo}', id, 'Director de Operaciones y Apoderado' from public.roles where slug='director_ops';

-- ── LAS 24 ÓRDENES YA EMITIDAS ──────────────────────────────────────────────
-- Forma reducida de \`public.purchase_orders\`: sólo las columnas que hacen a la
-- invariancia. Los valores son sintéticos; lo que se prueba es que la migración
-- no escribe NI UNA de estas filas.
create table public.purchase_orders (
  id              uuid primary key default gen_random_uuid(),
  public_id       text unique not null,
  signed_by       text,
  signature_hash  text,
  integrity_hash  text
);
insert into public.purchase_orders (public_id, signed_by, signature_hash, integrity_hash)
select 'OC-2026-' || lpad(n::text, 4, '0'),
       'José Luis Rodríguez Silva',
       md5('sig' || n), md5('int' || n)
from generate_series(1, 24) n;
`;

/**
 * Bordes del cargo. Se siembran DESPUÉS de los bloques de datos de 0259 —y por
 * lo tanto después de sus post-condiciones, que exigen exactamente tres
 * firmantes— porque ejercitan qué pasa cuando un portador legítimo de la firma
 * tiene el perfil incompleto, y ninguna cuenta real está en ese estado.
 */
export const BORDES = `
insert into public.user_roles (user_id, role_id, position_title)
select '${U.sinCargo}', id, null from public.roles where slug='firmante_oc';
insert into public.user_roles (user_id, role_id, position_title)
select '${U.sinNombre}', id, 'Apoderada' from public.roles where slug='firmante_oc';
insert into public.user_roles (user_id, role_id, position_title)
select '${U.ambiguo}', id, 'Presidente' from public.roles where slug='firmante_oc';
insert into public.user_roles (user_id, role_id, position_title)
select '${U.ambiguo}', id, 'Director de Operaciones' from public.roles where slug='super_admin';
insert into public.user_roles (user_id, role_id, position_title)
select '${U.inactivo}', id, null from public.roles where slug='firmante_oc';
`;

/**
 * EL TERCER CERROJO, EJERCITADO. A los tres excluidos se les carga un cargo
 * DESPUÉS de la migración, que es exactamente lo que cualquier administrador de
 * RRHH podría hacer. Antes de este expediente, eso alcanzaba para firmar. La
 * prueba es que ahora no alcanza.
 */
export const CARGOS_A_LOS_EXCLUIDOS = `
update public.user_roles ur set position_title = 'Contadora'
  from public.roles r where r.id = ur.role_id
   and ur.user_id = '${U.mariela}' and r.slug = 'director_ops';
update public.user_roles ur set position_title = 'Administración'
  from public.roles r where r.id = ur.role_id
   and ur.user_id = '${U.ruth}' and r.slug = 'admin_sin_rrhh';
update public.user_roles ur set position_title = 'Gerente General'
  from public.roles r where r.id = ur.role_id
   and ur.user_id = '${U.rinas}' and r.slug = 'gerencia';
`;

export const AQUI_TESTS = AQUI;
