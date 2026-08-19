#!/usr/bin/env node
/**
 * OC-FIRMANTE-POR-PERMISO · PAR ROJO→VERDE DEL FIRMANTE, contra PostgreSQL real.
 *
 * ─── QUÉ PRUEBA, Y POR QUÉ ASÍ ──────────────────────────────────────────────
 *
 * No re-escribe nada de lo que prueba: lo EXTRAE de los archivos de migración
 * tal como están en disco. Dos cosas se extraen, no se copian:
 *
 *   1 · el PRELUDIO de `purchase_order_issue` —identidad de sesión, perfil
 *       activo, gate de permisos, gate directo del firmante y resolución del
 *       firmante— recortado entre dos anclas textuales y envuelto en una
 *       función de prueba;
 *   2 · los BLOQUES DE DATOS de 0259 —rol `firmante_oc`, revocación de
 *       `compras.sign`, padrón de firmantes y cargos— ejecutados tal cual,
 *       con sus post-condiciones vivas.
 *
 * Si alguien edita cualquiera de los dos, esta prueba lo mide; si alguien los
 * copia a mano, deja de medir. Por eso se extraen.
 *
 *   ROJO  = estado previo de producción + preludio de 0243 (firmante por email)
 *   VERDE = estado previo + bloques de datos de 0259 + preludio de 0259
 *
 * El estado previo del que parten los dos lados es el MEDIDO en producción:
 * las cuentas reales con sus UUID reales, `compras.sign` colgando de los cinco
 * roles que lo portaban, y los cargos tal como estaban. Que los UUID escritos
 * en la migración sean los correctos es, por lo tanto, parte de lo que se
 * prueba: si uno estuviera mal, la post-condición del padrón aborta.
 *
 * Cada escenario declara qué espera de CADA lado. Un escenario que pasara igual
 * en los dos lados no probaría nada: el corredor exige que el par difiera donde
 * el expediente dice que tiene que diferir.
 *
 * Uso:  node supabase/tests/oc-firmante-por-permiso/run.mjs --socket /tmp/ocfp --port 55432
 * Exit: 0 si el par cierra · 1 con el detalle de cada desvío.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  AQUI_TESTS, MIGRACIONES, CARGO_PRUEBA_CYNTHIA, U, SEMILLA, BORDES,
  CARGOS_A_LOS_EXCLUIDOS, psql, psqlFile, extraerDatos,
} from "./comun.mjs";

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

/**
 * Cada escenario declara el veredicto esperado de los DOS lados.
 * `emite` = la resolución del firmante llegó hasta el final;
 * `dice`  = fragmento que debe aparecer en el resultado o en el error.
 */
const ESCENARIOS = [
  {
    id: "R-19-1", nombre: "Dirección · martin.battaglia@ · FIRMA", actor: U.direccion,
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
    id: "R-19-3", nombre: "rinas@ · perfil admin SIN compras.sign · el bypass, cerrado", actor: U.rinas,
    // ROJO: el bypass `profiles.role='admin'` le da TRUE en has_permission, así
    // que atraviesa el gate de permisos y sólo lo frena el literal del email.
    rojo: { emite: false, dice: "No se pudo resolver el firmante canónico" },
    // VERDE: el gate directo lo frena por lo que ES, con el motivo real.
    verde: { emite: false, dice: "No estás autorizado a firmar" },
  },
  {
    id: "R-19-4", nombre: "perfil INACTIVO · sigue rechazado", actor: U.inactivo,
    rojo: { emite: false, dice: "PO_ISSUE_SIN_PERFIL_ACTIVO" },
    verde: { emite: false, dice: "PO_ISSUE_SIN_PERFIL_ACTIVO" },
    permiteIgual: true,
  },
  {
    id: "R-19-5", nombre: "firmante autorizado pero SIN cargo · rechazo claro", actor: U.sinCargo,
    rojo: { emite: false, dice: "No se pudo resolver el firmante canónico" },
    verde: { emite: false, dice: "no tiene cargo cargado" },
  },
  {
    id: "R-19-6", nombre: "firmante autorizado pero SIN nombre · rechazo claro", actor: U.sinNombre,
    rojo: { emite: false, dice: "No se pudo resolver el firmante canónico" },
    verde: { emite: false, dice: "no tiene nombre cargado" },
  },
  {
    id: "R-19-7", nombre: "cargo AMBIGUO · rechazo claro", actor: U.ambiguo,
    rojo: { emite: false, dice: "No se pudo resolver el firmante canónico" },
    verde: { emite: false, dice: "cargo del firmante es ambiguo" },
  },
  {
    id: "R-19-9", nombre: "mariela@ · admin + director_ops + CARGO CARGADO · NO firma", actor: U.mariela,
    rojo: { emite: false, dice: "No se pudo resolver el firmante canónico" },
    verde: { emite: false, dice: "No estás autorizado a firmar" },
  },
  {
    id: "R-19-10", nombre: "cynthia@ · FIRMA (antes no podía)", actor: U.cynthia,
    // ROJO: Cynthia YA tenía compras.sign por `admin_sin_rrhh`, así que
    // atravesaba el gate de permisos sin problema. Lo único que la frenaba era
    // el literal del email — la medición de por qué este expediente existe.
    rojo: { emite: false, dice: "No se pudo resolver el firmante canónico" },
    verde: { emite: true, dice: "Cynthia Alba" },
    verdeAdemas: [CARGO_PRUEBA_CYNTHIA],
  },
  {
    id: "R-19-11", nombre: "ruth@ · admin_sin_rrhh + CARGO CARGADO · NO firma", actor: U.ruth,
    // Ruth comparte rol con Cynthia: ANTES firmaba tanto como ella, y sólo la
    // frenaba el literal del email. DESPUÉS la frena el gate de permisos, que
    // ya dice la verdad: su perfil es `supervisor`, así que no tiene el bypass
    // y la revocación de `compras.sign` la alcanza de lleno. El rechazo llega
    // un gate antes que el de Mariela, por eso el mensaje difiere.
    rojo: { emite: false, dice: "No se pudo resolver el firmante canónico" },
    verde: { emite: false, dice: "Sin permisos compras.create/compras.sign" },
  },
  {
    id: "R-19-12", nombre: "martin@ · 2ª cuenta de Dirección, no nombrada · NO firma", actor: U.direccion2,
    rojo: { emite: false, dice: "No se pudo resolver el firmante canónico" },
    verde: { emite: false, dice: "No estás autorizado a firmar" },
  },
];

// ── EJECUCIÓN ───────────────────────────────────────────────────────────────
const rojo = extraer("0243_purchase_order_price_lifecycle.sql");
const verde = extraer("0259_purchase_order_signer_by_permission.sql");
const datos = extraerDatos();

// Cada corrida parte de un esquema limpio: la prueba tiene que ser repetible
// sobre el mismo cluster sin arrastrar objetos de la corrida anterior.
{
  const r = psql(
    "drop schema if exists auth cascade; drop schema if exists public cascade; create schema public;",
    { tuplesOnly: false },
  );
  if (!r.ok) throw new Error(`no se pudo limpiar el esquema:\n${r.err}`);
}

psqlFile(join(AQUI_TESTS, "fixture.sql"));
{
  const r = psql(SEMILLA, { tuplesOnly: false });
  if (!r.ok) throw new Error(`semilla falló:\n${r.err}`);
}

const fallas = [];

// ── R-19-8 · INVARIANCIA DE LAS ÓRDENES YA EMITIDAS ─────────────────────────
//
// La huella se toma ANTES de aplicar los bloques de datos y se vuelve a tomar
// DESPUÉS. La fórmula vive acá, en el repositorio, y no en la memoria de una
// sesión: una huella cuya definición no está escrita no se puede volver a medir.
const HUELLA = `select md5(string_agg(
    public_id || '|' || coalesce(signed_by,'') || '|' ||
    coalesce(signature_hash,'') || '|' || coalesce(integrity_hash,''),
    E'\\n' order by public_id)) || ' · ' || count(*)::text
  from public.purchase_orders`;

const huellaAntes = psql(HUELLA);
if (!huellaAntes.ok) throw new Error(`huella previa falló:\n${huellaAntes.err}`);

// ── EL LADO ROJO SE MIDE ANTES DE MIGRAR ────────────────────────────────────
//
// Esto no es un detalle de orden: es lo que hace honesto al par. Si el preludio
// viejo se ejercitara contra la base YA migrada, el «rojo» estaría midiendo el
// código viejo sobre datos nuevos, que es un estado que no existió nunca. El
// rojo tiene que ver exactamente el mundo que había antes.
{
  const r = psql(envolver("_h_rojo", rojo), { tuplesOnly: false });
  if (!r.ok) throw new Error(`no compiló _h_rojo:\n${r.err}`);
}
const OBS_ROJO = new Map(ESCENARIOS.map((e) => [e.id, correr("_h_rojo", e.actor)]));

// ── LOS BLOQUES DE DATOS DE 0259, EJECUTADOS ────────────────────────────────
{
  const r = psql(datos.sql, { tuplesOnly: false });
  if (!r.ok) {
    console.error("\nLOS BLOQUES DE DATOS DE 0259 NO APLICARON:\n" + r.err);
    process.exit(1);
  }
}

const huellaDespues = psql(HUELLA);
if (!huellaDespues.ok) throw new Error(`huella posterior falló:\n${huellaDespues.err}`);

if (huellaAntes.out !== huellaDespues.out) {
  fallas.push(`R-19-8: la migración tocó órdenes ya emitidas · antes=${huellaAntes.out} · después=${huellaDespues.out}`);
}
// Y además, estáticamente, sobre los BLOQUES DE DATOS: son lo único que corre
// al aplicar la migración. El cuerpo de la función también nombra la tabla —
// insertar la orden nueva es literalmente su trabajo—, así que medir el archivo
// entero confundiría el DML de la aplicación con el DML de cada emisión futura.
if (/\b(insert\s+into|update|delete\s+from)\s+public\.purchase_orders\b/i.test(datos.sql)) {
  fallas.push("R-19-8: los bloques de datos de 0259 tocan public.purchase_orders");
}

// ── POST-CONDICIONES DEL MODELO DE AUTORIDAD, MEDIDAS ───────────────────────
const portadores = psql(
  `select coalesce(string_agg(r.slug, ',' order by r.slug), '(ninguno)')
     from public.role_permissions rp
     join public.roles r on r.id = rp.role_id
     join public.permissions p on p.id = rp.permission_id
    where p.slug = 'compras.sign'`,
);
if (portadores.out !== "firmante_oc") {
  fallas.push(`R-2: tras la migración, compras.sign quedó en «${portadores.out}» (se esperaba sólo firmante_oc)`);
}
const padron = psql(
  `select coalesce(string_agg(lower(btrim(u.email)), ',' order by lower(btrim(u.email))), '(vacío)')
     from public.user_roles ur
     join public.roles r on r.id = ur.role_id
     join auth.users u on u.id = ur.user_id
    where r.slug = 'firmante_oc'`,
);
const PADRON_ESPERADO = "cynthia@logisticatops.com,joseluis@logisticatops.com,martin.battaglia@logisticatops.com";
if (padron.out !== PADRON_ESPERADO) {
  fallas.push(`R-1: el padrón de firmante_oc quedó en «${padron.out}» (se esperaba «${PADRON_ESPERADO}»)`);
}

// Bordes del cargo y el tercer cerrojo, después de la migración.
for (const [nombre, sql] of [["bordes", BORDES], ["cargos a los excluidos", CARGOS_A_LOS_EXCLUIDOS]]) {
  const r = psql(sql, { tuplesOnly: false });
  if (!r.ok) throw new Error(`${nombre} falló:\n${r.err}`);
}

// ── Y EL LADO VERDE, SOBRE EL MUNDO MIGRADO ─────────────────────────────────
{
  const r = psql(envolver("_h_verde", verde), { tuplesOnly: false });
  if (!r.ok) throw new Error(`no compiló _h_verde:\n${r.err}`);
}

const filas = [];

for (const e of ESCENARIOS) {
  const r = OBS_ROJO.get(e.id);
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
if (datos.pendiente) {
  console.log("⚠ El cargo de cynthia@ sigue PENDIENTE de Dirección: la migración aborta");
  console.log(`  a propósito hasta tenerlo. Acá se ejercita con ${CARGO_PRUEBA_CYNTHIA}.\n`);
}
console.log(`R-19-8 · órdenes ya emitidas · antes  ${huellaAntes.out}`);
console.log(`R-19-8 · órdenes ya emitidas · después ${huellaDespues.out}`);
console.log(`R-2    · portadores de compras.sign   ${portadores.out}`);
console.log(`R-1    · padrón de firmante_oc        ${padron.out}\n`);
for (const f of filas) {
  console.log(`${f.id} · ${f.escenario}`);
  console.log(`   ROJO  (0243) ${f.rojo}`);
  console.log(`   VERDE (0259) ${f.verde}\n`);
}

if (fallas.length) {
  console.error("PAR ROJO→VERDE: FAIL\n  - " + fallas.join("\n  - "));
  process.exit(1);
}
console.log(`PAR ROJO→VERDE: PASS · ${ESCENARIOS.length}/${ESCENARIOS.length} escenarios + R-19-8 + R-1 + R-2`);
