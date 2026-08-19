#!/usr/bin/env node
/**
 * OC-FIRMANTE-POR-PERMISO · PAR ROJO→VERDE DEL FIRMANTE, contra PostgreSQL real.
 *
 * ─── QUÉ PRUEBA, Y POR QUÉ ASÍ ──────────────────────────────────────────────
 *
 * No re-escribe el SQL a probar: lo EXTRAE del archivo de migración tal como
 * está en disco. El preludio de `purchase_order_issue` —identidad de sesión,
 * perfil activo, gate de `compras.create`/`compras.sign`, forma del payload y
 * resolución del firmante— se recorta entre dos anclas textuales y se envuelve
 * en una función de prueba. Si alguien edita ese bloque, esta prueba lo mide;
 * si alguien la copia a mano, deja de medir. Por eso se extrae.
 *
 *   ROJO  = el preludio de 0243 (firmante por correo literal)
 *   VERDE = el preludio de 0259 (firmante por permiso + perfil)
 *
 * Cada escenario declara qué espera de CADA lado. Un escenario que pasara igual
 * en los dos lados no probaría nada: el corredor exige que el par difiera donde
 * el expediente dice que tiene que diferir.
 *
 * Uso:  node supabase/tests/oc-firmante-por-permiso/run.mjs --socket /tmp/ocfp --port 55432
 * Exit: 0 si el par cierra · 1 con el detalle de cada desvío.
 */

import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(AQUI, "..", "..", "..");
const MIGRACIONES = join(RAIZ, "supabase", "migrations");

const arg = (n, d) => {
  const i = process.argv.indexOf(n);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : d;
};
const SOCKET = arg("--socket", "/tmp/ocfp");
const PORT = arg("--port", "55432");
const USER = arg("--user", "harness");

/** Ancla de inicio: primera línea del preludio, idéntica en 0243 y 0259. */
const ANCLA_INICIO = "  if v_actor is null then";
/** Ancla de fin: cierre del guard del firmante, idéntico en 0243 y 0259. */
const ANCLA_FIN = `    raise exception 'No se pudo resolver el firmante canónico de la sesión'
      using errcode = 'insufficient_privilege';
  end if;
`;

/** Recorta el bloque `declare … begin` y el preludio de una migración. */
function extraer(archivo) {
  const txt = readFileSync(join(MIGRACIONES, archivo), "utf8");
  const iFn = txt.indexOf("create or replace function public.purchase_order_issue(p_order jsonb, p_items jsonb)");
  if (iFn < 0) throw new Error(`${archivo}: no declara purchase_order_issue(jsonb, jsonb)`);
  const iDeclare = txt.indexOf("\ndeclare\n", iFn);
  const iBegin = txt.indexOf("\nbegin\n", iDeclare);
  if (iDeclare < 0 || iBegin < 0) throw new Error(`${archivo}: no se ubicó declare/begin`);
  const declaraciones = txt.slice(iDeclare + "\ndeclare\n".length, iBegin);

  const iIni = txt.indexOf(ANCLA_INICIO, iBegin);
  const iFin = txt.indexOf(ANCLA_FIN, iIni);
  if (iIni < 0 || iFin < 0) throw new Error(`${archivo}: no se ubicó el preludio del firmante`);
  return { declaraciones, preludio: txt.slice(iIni, iFin + ANCLA_FIN.length) };
}

/** Envuelve el preludio extraído en una función de prueba con la misma forma. */
function envolver(nombre, { declaraciones, preludio }) {
  return `
create or replace function public.${nombre}(p_order jsonb, p_items jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $harness$
declare
${declaraciones}begin
${preludio}
  return jsonb_build_object(
    'signer', v_signer, 'email', v_emitter_email, 'role', v_emitter_role
  );
end;
$harness$;
`;
}

function psql(sql, { tuplesOnly = true } = {}) {
  const r = spawnSync(
    "psql",
    ["-h", SOCKET, "-p", PORT, "-U", USER, "-d", "postgres", "-v", "ON_ERROR_STOP=1", ...(tuplesOnly ? ["-tA"] : []), "-c", sql],
    { encoding: "utf8" },
  );
  return { ok: r.status === 0, out: (r.stdout || "").trim(), err: (r.stderr || "").trim() };
}

function psqlFile(ruta) {
  const r = spawnSync("psql", ["-h", SOCKET, "-p", PORT, "-U", USER, "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-f", ruta], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`psql -f ${ruta} falló:\n${r.stderr}`);
}

/** Payload mínimo que atraviesa las validaciones de forma del preludio. */
const P_ORDER = `'{"vendor_id":"11111111-1111-4111-8111-111111111111"}'::jsonb`;
const P_ITEMS = `'[{"sku":"X"}]'::jsonb`;

/** Ejecuta un escenario y devuelve `{ emitio, detalle }`. */
function correr(fn, actor) {
  const r = psql(
    `set local harness.actor = '${actor}'; select public.${fn}(${P_ORDER}, ${P_ITEMS})::text;`,
  );
  if (r.ok) return { emitio: true, detalle: r.out };
  const m = /ERROR:\s*(.*)/.exec(r.err);
  return { emitio: false, detalle: m ? m[1].trim() : r.err.split("\n")[0] };
}

// ── DATOS DE LOS ESCENARIOS ─────────────────────────────────────────────────
const U = {
  direccion: "aaaaaaaa-0000-4000-8000-000000000001",
  joseluis: "aaaaaaaa-0000-4000-8000-000000000002",
  sinFirma: "aaaaaaaa-0000-4000-8000-000000000003",
  inactivo: "aaaaaaaa-0000-4000-8000-000000000004",
  sinCargo: "aaaaaaaa-0000-4000-8000-000000000005",
  sinNombre: "aaaaaaaa-0000-4000-8000-000000000006",
  ambiguo: "aaaaaaaa-0000-4000-8000-000000000007",
};

const SEMILLA = `
insert into auth.users (id, email) values
  ('${U.direccion}','martin.battaglia@logisticatops.com'),
  ('${U.joseluis}','joseluis@logisticatops.com'),
  ('${U.sinFirma}','martinrinas@logisticatops.com'),
  ('${U.inactivo}','inactivo@logisticatops.com'),
  ('${U.sinCargo}','sincargo@logisticatops.com'),
  ('${U.sinNombre}','sinnombre@logisticatops.com'),
  ('${U.ambiguo}','ambiguo@logisticatops.com');

insert into public.profiles (id, full_name, email, role, active) values
  ('${U.direccion}','Martín F. Battaglia','martin.battaglia@logisticatops.com','admin',true),
  ('${U.joseluis}','José Luis Rodríguez Silva','joseluis@logisticatops.com','admin',true),
  ('${U.sinFirma}','Martin Rinas','martinrinas@logisticatops.com','operaciones',true),
  ('${U.inactivo}','Alguien Inactivo','inactivo@logisticatops.com','admin',false),
  ('${U.sinCargo}','Alguien Sin Cargo','sincargo@logisticatops.com','admin',true),
  ('${U.sinNombre}',null,'sinnombre@logisticatops.com','admin',true),
  ('${U.ambiguo}','Alguien Ambiguo','ambiguo@logisticatops.com','admin',true);

-- Cargos: exactamente los dos que 0259 carga, más los casos de borde.
insert into public.user_roles (user_id, role_id, position_title)
select '${U.direccion}', id, 'Presidente' from public.roles where slug='super_admin';
insert into public.user_roles (user_id, role_id, position_title)
select '${U.joseluis}', id, 'Director de Operaciones y Apoderado' from public.roles where slug='director_ops';
insert into public.user_roles (user_id, role_id, position_title)
select '${U.sinFirma}', id, 'Gerente General' from public.roles where slug='gerencia';
insert into public.user_roles (user_id, role_id, position_title)
select '${U.inactivo}', id, 'Director de Operaciones y Apoderado' from public.roles where slug='director_ops';
insert into public.user_roles (user_id, role_id, position_title)
select '${U.sinCargo}', id, null from public.roles where slug='super_admin';
insert into public.user_roles (user_id, role_id, position_title)
select '${U.sinNombre}', id, 'Apoderada' from public.roles where slug='super_admin';
insert into public.user_roles (user_id, role_id, position_title)
select '${U.ambiguo}', id, 'Presidente' from public.roles where slug='super_admin';
insert into public.user_roles (user_id, role_id, position_title)
select '${U.ambiguo}', id, 'Director de Operaciones' from public.roles where slug='director_ops';
`;

/**
 * Cada escenario declara el veredicto esperado de los DOS lados.
 * `emite` = la resolución del firmante llegó hasta el final;
 * `dice`  = fragmento que debe aparecer en el resultado o en el error.
 */
const ESCENARIOS = [
  {
    id: "R-19-1", nombre: "Dirección · super_admin con compras.sign", actor: U.direccion,
    rojo: { emite: false, dice: "No se pudo resolver el firmante canónico" },
    verde: { emite: true, dice: "Martín F. Battaglia" },
    verdeAdemas: ["Presidente"],
  },
  {
    id: "R-19-2", nombre: "joseluis@ · sigue emitiendo igual que siempre", actor: U.joseluis,
    rojo: { emite: true, dice: "José Luis Rodríguez Silva" },
    verde: { emite: true, dice: "José Luis Rodríguez Silva" },
    verdeAdemas: ["Director de Operaciones y Apoderado"],
    rojoAdemas: ["Director de Operaciones y Apoderado"],
  },
  {
    id: "R-19-3", nombre: "usuario SIN compras.sign · sigue rechazado", actor: U.sinFirma,
    rojo: { emite: false, dice: "Sin permisos compras.create/compras.sign" },
    verde: { emite: false, dice: "Sin permisos compras.create/compras.sign" },
    permiteIgual: true,
  },
  {
    id: "R-19-4", nombre: "perfil INACTIVO · sigue rechazado", actor: U.inactivo,
    rojo: { emite: false, dice: "PO_ISSUE_SIN_PERFIL_ACTIVO" },
    verde: { emite: false, dice: "PO_ISSUE_SIN_PERFIL_ACTIVO" },
    permiteIgual: true,
  },
  {
    id: "R-19-5", nombre: "con permiso pero SIN cargo · rechazo claro", actor: U.sinCargo,
    rojo: { emite: false, dice: "No se pudo resolver el firmante canónico" },
    verde: { emite: false, dice: "no tiene cargo cargado" },
  },
  {
    id: "R-19-6", nombre: "con permiso pero SIN nombre · rechazo claro", actor: U.sinNombre,
    rojo: { emite: false, dice: "No se pudo resolver el firmante canónico" },
    verde: { emite: false, dice: "no tiene nombre cargado" },
  },
  {
    id: "R-19-7", nombre: "cargo AMBIGUO · rechazo claro", actor: U.ambiguo,
    rojo: { emite: false, dice: "No se pudo resolver el firmante canónico" },
    verde: { emite: false, dice: "cargo del firmante es ambiguo" },
  },
];

// ── EJECUCIÓN ───────────────────────────────────────────────────────────────
const rojo = extraer("0243_purchase_order_price_lifecycle.sql");
const verde = extraer("0259_purchase_order_signer_by_permission.sql");

// Cada corrida parte de un esquema limpio: la prueba tiene que ser repetible
// sobre el mismo cluster sin arrastrar objetos de la corrida anterior.
{
  const r = psql(
    "drop schema if exists auth cascade; drop schema if exists public cascade; create schema public;",
    { tuplesOnly: false },
  );
  if (!r.ok) throw new Error(`no se pudo limpiar el esquema:\n${r.err}`);
}

psqlFile(join(AQUI, "fixture.sql"));
{
  const r = psql(SEMILLA, { tuplesOnly: false });
  if (!r.ok) throw new Error(`semilla falló:\n${r.err}`);
}
for (const [fn, bloque] of [["_h_rojo", rojo], ["_h_verde", verde]]) {
  const r = psql(envolver(fn, bloque), { tuplesOnly: false });
  if (!r.ok) throw new Error(`no compiló ${fn}:\n${r.err}`);
}

const fallas = [];
const filas = [];

for (const e of ESCENARIOS) {
  const r = correr("_h_rojo", e.actor);
  const v = correr("_h_verde", e.actor);

  const chequear = (lado, obs, esp, ademas) => {
    if (obs.emitio !== esp.emite) {
      fallas.push(`${e.id} ${lado}: se esperaba ${esp.emite ? "EMITE" : "RECHAZA"} y ${obs.emitio ? "emitió" : "rechazó"} → ${obs.detalle}`);
      return;
    }
    for (const frag of [esp.dice, ...(ademas || [])]) {
      if (!obs.detalle.includes(frag)) {
        fallas.push(`${e.id} ${lado}: no contiene «${frag}» → ${obs.detalle}`);
      }
    }
  };
  chequear("ROJO", r, e.rojo, e.rojoAdemas);
  chequear("VERDE", v, e.verde, e.verdeAdemas);

  // Un par que no cambia sólo es legítimo donde el expediente lo declara.
  const igual = r.emitio === v.emitio && r.detalle === v.detalle;
  if (!e.permiteIgual && igual && e.id !== "R-19-2") {
    fallas.push(`${e.id}: ROJO y VERDE dan lo mismo; el par no prueba nada`);
  }

  filas.push({
    id: e.id, escenario: e.nombre,
    rojo: `${r.emitio ? "EMITE" : "RECHAZA"} · ${r.detalle.slice(0, 62)}`,
    verde: `${v.emitio ? "EMITE" : "RECHAZA"} · ${v.detalle.slice(0, 62)}`,
  });
}

console.log("\n══ PAR ROJO→VERDE · OC-FIRMANTE-POR-PERMISO ══════════════════════════════\n");
for (const f of filas) {
  console.log(`${f.id} · ${f.escenario}`);
  console.log(`   ROJO  (0243) ${f.rojo}`);
  console.log(`   VERDE (0259) ${f.verde}\n`);
}

if (fallas.length) {
  console.error("PAR ROJO→VERDE: FAIL\n  - " + fallas.join("\n  - "));
  process.exit(1);
}
console.log(`PAR ROJO→VERDE: PASS · ${ESCENARIOS.length}/${ESCENARIOS.length} escenarios`);
