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
    // Y el único DML de datos de 0259 son los dos cargos.
    const cuerpo0259 = cuerpoDeLaFuncion(sql0259);
    const fuera0259 = sql0259.split(cuerpo0259).join("");
    expect((fuera0259.match(/^update /gm) ?? []).length).toBe(2);
  });

  it("el rollback restituye el cuerpo de 0243 byte a byte y revierte los dos cargos", () => {
    expect(cuerpoDeLaFuncion(rollback)).toEqual(cuerpoDeLaFuncion(sql0243));
    expect(rollback).toContain("set position_title = 'Presidente · Super Administrador'");
    expect(rollback).toContain("set position_title = null");
  });

  it("0259 carga dos cargos y ninguno inventado", () => {
    expect(sql0259).toContain("set position_title = 'Presidente'");
    expect(sql0259).toContain("set position_title = 'Director de Operaciones y Apoderado'");
    // El cargo de José Luis es el literal exacto que 0243 ya estampaba.
    expect(sql0243).toContain("'Director de Operaciones y Apoderado'");
    // Nadie más recibe cargo: sólo dos UPDATE en toda la migración.
    expect((sql0259.match(/^update public\.user_roles ur$/gm) ?? []).length).toBe(2);
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
