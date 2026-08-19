import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * OC-FIRMANTE-POR-PERMISO · invariancia estructural de la compuerta de emisión.
 *
 * El comportamiento del firmante se prueba contra un PostgreSQL real en
 * `supabase/tests/oc-firmante-por-permiso/run.mjs`. Este archivo cubre lo que
 * una prueba de comportamiento NO puede ver: que 0259 sea un REEMPLAZO y no una
 * sobrecarga, que no afloje ninguna guarda ajena al firmante, y que el literal
 * que se vino a sacar no quede vivo en el árbol ejecutable.
 */

const raiz = process.cwd();
const leer = (p: string) => readFileSync(resolve(raiz, p), "utf8");

const sql0243 = leer("supabase/migrations/0243_purchase_order_price_lifecycle.sql");
const sql0259 = leer("supabase/migrations/0259_purchase_order_signer_by_permission.sql");
const rollback = leer("supabase/migrations/ROLLBACK_0259_purchase_order_signer_by_permission.sql");
const catalogo = JSON.parse(leer("supabase/lineage/catalog.json")) as {
  entries: { filename: string; estado: string; requires: string[] }[];
};

/** Cuerpo de `purchase_order_issue` dentro de un archivo de migración. */
function cuerpoDeLaFuncion(sql: string): string {
  const i = sql.indexOf(
    "create or replace function public.purchase_order_issue(p_order jsonb, p_items jsonb)",
  );
  expect(i).toBeGreaterThan(-1);
  const fin = sql.indexOf("\n$$;", i);
  expect(fin).toBeGreaterThan(i);
  return sql.slice(i, fin);
}

describe("0259 · el firmante se resuelve por permiso, no por un correo literal", () => {
  it("reemplaza la función con la MISMA firma: no crea una sobrecarga", () => {
    // Una firma distinta dejaría viva y alcanzable la versión de 0243.
    const firmas = sql0259.match(/create or replace function public\.purchase_order_issue\([^)]*\)/g);
    expect(firmas).toEqual([
      "create or replace function public.purchase_order_issue(p_order jsonb, p_items jsonb)",
    ]);
    expect(sql0259).toContain(
      "revoke all on function public.purchase_order_issue(jsonb, jsonb)",
    );
    expect(sql0259).toContain(
      "grant execute on function public.purchase_order_issue(jsonb, jsonb) to authenticated;",
    );
  });

  it("saca los TRES literales del firmante del árbol EJECUTABLE", () => {
    // Los comentarios SÍ nombran el literal viejo: explicar qué se sacó es
    // parte del cambio. Lo que no puede quedar es una línea ejecutable que lo
    // compare, así que la comprobación se hace sobre el código sin comentarios.
    const ejecutable = cuerpoDeLaFuncion(sql0259)
      .split("\n")
      .filter((l) => !l.trimStart().startsWith("--"))
      .join("\n");
    expect(sql0243).toContain("= 'joseluis@logisticatops.com'");
    expect(ejecutable).not.toContain("joseluis@logisticatops.com");
    expect(ejecutable).not.toContain("'José Luis Rodríguez Silva'");
    expect(ejecutable).not.toContain(
      "    'Director de Operaciones y Apoderado'\n  into v_signer",
    );
  });

  it("resuelve nombre y cargo desde el perfil del actor de la sesión", () => {
    const cuerpo = cuerpoDeLaFuncion(sql0259);
    expect(cuerpo).toContain("select p.full_name, lower(btrim(u.email))");
    expect(cuerpo).toContain("into v_signer, v_emitter_email");
    expect(cuerpo).toContain("count(distinct btrim(ur.position_title))");
    expect(cuerpo).toContain("from public.user_roles ur");
    expect(cuerpo).toContain("where ur.user_id = v_actor");
  });

  it("rechaza con mensaje propio cuando falta el nombre, falta el cargo o es ambiguo", () => {
    const cuerpo = cuerpoDeLaFuncion(sql0259);
    expect(cuerpo).toContain("no tiene nombre cargado");
    expect(cuerpo).toContain("no tiene cargo cargado");
    expect(cuerpo).toContain("cargo del firmante es ambiguo");
    // Fail-closed: los tres rechazos usan el mismo errcode que el resto del gate.
    const rechazos = cuerpo.match(/using errcode = 'insufficient_privilege'/g) ?? [];
    expect(rechazos.length).toBeGreaterThanOrEqual(5);
  });

  it("NO afloja ninguna guarda ajena al firmante", () => {
    const cuerpo = cuerpoDeLaFuncion(sql0259);
    // El gate de permisos sigue siendo obligatorio y anterior a todo efecto.
    expect(cuerpo).toContain("has_permission('compras.create')");
    expect(cuerpo).toContain("has_permission('compras.sign')");
    expect(cuerpo.indexOf("has_permission('compras.sign')")).toBeLessThan(
      cuerpo.indexOf("count(distinct btrim(ur.position_title))"),
    );
    // Perfil activo, identidad de sesión y forma del payload, intactos.
    expect(cuerpo).toContain("PO_ISSUE_SIN_IDENTIDAD");
    expect(cuerpo).toContain("PO_ISSUE_SIN_PERFIL_ACTIVO");
    expect(cuerpo).toContain("Firmante, fecha, emisor y hashes son datos canónicos del servidor");
    // Guardas de precio de 0243: se conservan textualmente.
    expect(cuerpo).toContain("La OC requiere al menos una línea");
    expect(cuerpo).toContain("El estado de emisión es canónico: firmada");
    expect(cuerpo).toContain("v_emitter_name := v_signer");
  });

  it("el delta contra 0243 son exactamente dos bloques y nada más", () => {
    const viejo = cuerpoDeLaFuncion(sql0243).split("\n");
    const nuevo = cuerpoDeLaFuncion(sql0259).split("\n");
    // Toda línea de 0243 que no sea del bloque del firmante sobrevive idéntica.
    const delBloqueViejo = new Set([
      "  select",
      "    'José Luis Rodríguez Silva',",
      "    lower(btrim(u.email)),",
      "    'Director de Operaciones y Apoderado'",
      "  into v_signer, v_emitter_email, v_emitter_role",
      "    and lower(btrim(coalesce(u.email,''))) = 'joseluis@logisticatops.com'",
      "  if not found",
      "     or v_emitter_email is null or length(v_emitter_email) > 254",
    ]);
    const nuevoSet = new Set(nuevo);
    const perdidas = viejo.filter((l) => !delBloqueViejo.has(l) && !nuevoSet.has(l));
    expect(perdidas).toEqual([]);
  });

  it("no toca las órdenes ya emitidas: fuera de la función no hay DML sobre purchase_orders", () => {
    // Dentro de la función, el INSERT es su trabajo: crear la orden nueva. Lo
    // que ninguna de las dos migraciones puede hacer es reescribir filas ya
    // emitidas, y eso se mide sobre el texto FUERA del cuerpo de la función.
    for (const sql of [sql0259, rollback]) {
      const cuerpo = cuerpoDeLaFuncion(sql);
      const fuera = sql.split(cuerpo).join("");
      expect(fuera).not.toMatch(/update\s+public\.purchase_orders/i);
      expect(fuera).not.toMatch(/delete\s+from\s+public\.purchase_orders/i);
      expect(fuera).not.toMatch(/insert\s+into\s+public\.purchase_orders/i);
    }
    // Y las únicas tablas que el DML de datos de 0259 escribe son las tres del
    // modelo de autoridad, más los cargos. La lista es cerrada a propósito: si
    // mañana alguien agrega un UPDATE sobre otra tabla, este test lo ve.
    const cuerpo0259 = cuerpoDeLaFuncion(sql0259);
    const fuera0259 = sql0259.split(cuerpo0259).join("");
    const tablasEscritas = new Set(
      [...fuera0259.matchAll(/(?:insert\s+into|update|delete\s+from)\s+(public\.\w+)/gi)]
        .map((m) => m[1].toLowerCase()),
    );
    expect([...tablasEscritas].sort()).toEqual([
      "public.role_permissions",
      "public.roles",
      "public.user_roles",
    ]);
  });

  it("el rollback restituye el cuerpo de 0243 byte a byte y deshace el modelo de autoridad", () => {
    expect(cuerpoDeLaFuncion(rollback)).toEqual(cuerpoDeLaFuncion(sql0243));
    expect(rollback).toContain("set position_title = 'Presidente · Super Administrador'");
    expect(rollback).toContain("set position_title = null");
    // Y devuelve compras.sign a los cinco roles medidos, y borra el rol nuevo.
    for (const slug of [
      "admin_sin_rrhh", "administracion_finanzas", "director_ops",
      "gerencia_comercial", "super_admin",
    ]) {
      expect(rollback).toContain(`'${slug}'`);
    }
    expect(rollback).toMatch(/delete\s+from\s+public\.roles\s+r\s+where\s+r\.slug\s*=\s*'firmante_oc'/i);
  });

  it("0259 carga los cargos de los tres firmantes y ninguno inventado", () => {
    expect(sql0259).toContain("set position_title = 'Presidente'");
    expect(sql0259).toContain("set position_title = 'Director de Operaciones y Apoderado'");
    // El cargo de José Luis es el literal exacto que 0243 ya estampaba.
    expect(sql0243).toContain("'Director de Operaciones y Apoderado'");
    // Nadie más recibe cargo: exactamente tres UPDATE de position_title, uno
    // por firmante. La segunda cuenta de Dirección (`martin@`) NO está entre
    // ellos, porque no firma.
    const cargos = sql0259.match(/^\s*set position_title = /gm) ?? [];
    expect(cargos.length).toBe(3);
    expect(sql0259).not.toContain("'martin@logisticatops.com'");
  });

  // R-1 · el rol de firma es el único portador, y se concede por nombre.
  it("crea firmante_oc, le da compras.sign y se lo quita a todos los demás", () => {
    expect(sql0259).toContain("'firmante_oc'");
    // La revocación es POR NEGACIÓN: alcanza también a un rol que haya recibido
    // el permiso después de la medición.
    expect(sql0259).toMatch(/delete from public\.role_permissions[\s\S]*?p\.slug = 'compras\.sign'[\s\S]*?r\.slug <> 'firmante_oc'/);
    // Y el padrón se concede por UUID *y* correo: una sola de las dos llaves no
    // alcanza, para que un correo reasignado no herede la firma.
    for (const [uuid, email] of [
      ["7a9ecbdc-3ff0-459e-b340-8a07eed898fa", "martin.battaglia@logisticatops.com"],
      ["3b1607c9-32c5-4ca0-91e1-19c82099b64d", "joseluis@logisticatops.com"],
      ["4aa1203d-a943-4ef0-b1c5-3127fde3adfb", "cynthia@logisticatops.com"],
    ]) {
      expect(sql0259).toContain(`('${uuid}'::uuid, '${email}')`);
    }
    // Y NADIE más. Los excluidos SÍ están nombrados en la cabecera —documentar
    // a quién Dirección dejó afuera es parte de la decisión—, así que la
    // propiedad se mide sobre el SQL EJECUTABLE, con los comentarios quitados.
    const ejecutable = sql0259
      .split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n");
    for (const excluido of [
      "mariela@sullivancamejo.com.ar", "ruth@logisticatops.com",
      "martinrinas@logisticatops.com", "despachos-lujan@", "despachos-magaldi@",
    ]) {
      expect(ejecutable).not.toContain(excluido);
    }
  });

  // R-3 · el gate del firmante no puede resolverse por `has_permission`, que
  // termina en un bypass por `profiles.role='admin'`.
  it("el gate del firmante lee las tablas de RBAC directo, sin has_permission", () => {
    // El bloque EXACTO que produce el rechazo, no una ventana alrededor: el
    // gate de `compras.create` de 0243 vive unas líneas más arriba y sigue
    // usando `has_permission`, que es correcto y no se toca.
    const cuerpo = cuerpoDeLaFuncion(sql0259);
    const iMsg = cuerpo.indexOf("No estás autorizado a firmar");
    const iGate = cuerpo.lastIndexOf("if not exists (", iMsg);
    expect(iGate).toBeGreaterThan(-1);
    const gate = cuerpo.slice(iGate, iMsg);
    expect(gate).toContain("from public.user_roles ur");
    expect(gate).toContain("join public.role_permissions rp");
    expect(gate).toContain("join public.permissions pe");
    expect(gate).not.toContain("has_permission");
    // Y no toca `has_permission`: corregir el bypass es otro expediente.
    expect(sql0259).not.toMatch(/create or replace function public\.has_permission/i);
    expect(rollback).not.toMatch(/create or replace function public\.has_permission/i);
  });

  it("queda catalogada en el linaje junto con su rollback", () => {
    const activa = catalogo.entries.find(
      (e) => e.filename === "0259_purchase_order_signer_by_permission.sql",
    );
    const inversa = catalogo.entries.find(
      (e) => e.filename === "ROLLBACK_0259_purchase_order_signer_by_permission.sql",
    );
    expect(activa?.estado).toBe("active");
    expect(activa?.requires).toContain("0243_purchase_order_price_lifecycle.sql");
    expect(inversa?.estado).toBe("rollback");
  });
});
