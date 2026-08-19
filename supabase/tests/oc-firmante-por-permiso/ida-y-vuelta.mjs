#!/usr/bin/env node
/**
 * OC-FIRMANTE-POR-PERMISO · IDA Y VUELTA, contra PostgreSQL real.
 *
 * Un rollback que nadie ejecutó es una promesa, no una salida. Esta prueba
 * fotografía el estado previo de producción, aplica los bloques de datos de
 * 0259, aplica los del ROLLBACK, vuelve a fotografiar, y exige que las dos
 * fotos sean IDÉNTICAS.
 *
 * Fotografía lo que la migración toca y nada más: el reparto de `compras.sign`,
 * el padrón del rol de firma, todos los cargos de `user_roles`, el inventario
 * de roles y la huella de las órdenes ya emitidas.
 *
 * Los dos textos SQL se extraen de los archivos en disco. No hay copias acá.
 *
 * Uso:  node supabase/tests/oc-firmante-por-permiso/ida-y-vuelta.mjs --socket /tmp/ocfp --port 55432
 * Exit: 0 si la vuelta restituye el estado previo exacto.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AQUI_TESTS, MIGRACIONES, SEMILLA, psql, psqlFile, extraerDatos } from "./comun.mjs";

/** Bloques de datos del rollback: todo lo que va después de restituir la función. */
function extraerRollback() {
  const txt = readFileSync(join(MIGRACIONES, "ROLLBACK_0259_purchase_order_signer_by_permission.sql"), "utf8");
  const i = txt.indexOf("-- ── 2 · LOS CARGOS, AL ESTADO PREVIO");
  const j = txt.lastIndexOf("commit;");
  if (i < 0 || j < 0) throw new Error("ROLLBACK_0259: no se ubicaron los bloques de datos");
  return txt.slice(i, j);
}

/** Todo lo que la migración puede llegar a mover, en una sola cadena comparable. */
const FOTO = [
  ["compras.sign en roles", `select coalesce(string_agg(r.slug, ',' order by r.slug), '(ninguno)')
      from public.role_permissions rp
      join public.roles r on r.id = rp.role_id
      join public.permissions p on p.id = rp.permission_id
     where p.slug = 'compras.sign'`],
  ["inventario de roles", `select coalesce(string_agg(slug, ',' order by slug), '(ninguno)') from public.roles`],
  ["asignaciones y cargos", `select coalesce(string_agg(
        lower(btrim(u.email)) || '/' || r.slug || '=' || coalesce(ur.position_title, '∅'),
        ' · ' order by lower(btrim(u.email)), r.slug), '(ninguna)')
      from public.user_roles ur
      join public.roles r on r.id = ur.role_id
      join auth.users u on u.id = ur.user_id`],
  ["órdenes ya emitidas", `select md5(string_agg(
        public_id || '|' || coalesce(signed_by,'') || '|' ||
        coalesce(signature_hash,'') || '|' || coalesce(integrity_hash,''),
        E'\\n' order by public_id)) || ' · ' || count(*)::text
      from public.purchase_orders`],
];

function fotografiar() {
  return FOTO.map(([nombre, sql]) => {
    const r = psql(sql);
    if (!r.ok) throw new Error(`foto «${nombre}» falló:\n${r.err}`);
    return [nombre, r.out];
  });
}

function estadoPrevio() {
  const r = psql("drop schema if exists auth cascade; drop schema if exists public cascade; create schema public;", { tuplesOnly: false });
  if (!r.ok) throw new Error(`no se pudo limpiar el esquema:\n${r.err}`);
  psqlFile(join(AQUI_TESTS, "fixture.sql"));
  const s = psql(SEMILLA, { tuplesOnly: false });
  if (!s.ok) throw new Error(`semilla falló:\n${s.err}`);
}

function aplicar(nombre, sql) {
  const r = psql(sql, { tuplesOnly: false });
  if (!r.ok) {
    console.error(`\n${nombre} NO APLICÓ:\n${r.err}`);
    process.exit(1);
  }
}

console.log("\n══ IDA Y VUELTA · OC-FIRMANTE-POR-PERMISO ════════════════════════════════\n");

estadoPrevio();
const antes = fotografiar();

aplicar("0259 (ida)", extraerDatos().sql);
const migrado = fotografiar();

aplicar("ROLLBACK_0259 (vuelta)", extraerRollback());
const despues = fotografiar();

const fallas = [];
for (let i = 0; i < FOTO.length; i++) {
  const [nombre] = FOTO[i];
  // La ida tiene que MOVER lo que dice mover: si una dimensión no cambió, esta
  // prueba no está midiendo la reversibilidad de nada.
  if (nombre !== "órdenes ya emitidas" && antes[i][1] === migrado[i][1]) {
    fallas.push(`«${nombre}»: la ida no lo movió; la vuelta no prueba nada`);
  }
  if (nombre === "órdenes ya emitidas" && antes[i][1] !== migrado[i][1]) {
    fallas.push(`«${nombre}»: la ida las tocó · antes=${antes[i][1]} · migrado=${migrado[i][1]}`);
  }
  if (antes[i][1] !== despues[i][1]) {
    fallas.push(`«${nombre}» NO volvió al estado previo\n      antes:   ${antes[i][1]}\n      después: ${despues[i][1]}`);
  }
  const veredicto = antes[i][1] === despues[i][1] ? "✓ vuelve" : "✗ NO vuelve";
  const movio = antes[i][1] !== migrado[i][1] ? "la ida lo mueve" : "la ida no lo toca";
  console.log(`${veredicto} · ${nombre} · ${movio}`);
}

if (fallas.length) {
  console.error("\nIDA Y VUELTA: FAIL\n  - " + fallas.join("\n  - "));
  process.exit(1);
}
console.log(`\nIDA Y VUELTA: PASS · ${FOTO.length}/${FOTO.length} dimensiones restituidas`);
