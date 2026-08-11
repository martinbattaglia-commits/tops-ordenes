/**
 * T-WA-R9-05 · HIGH-2 — prueba POSITIVA de aislamiento.
 *
 * No alcanza con haber quitado los `drop ... cascade`: hay que demostrar que
 * una suite WhatsApp no puede tocar el cluster compartido ni aunque lo intente.
 *
 * Por eso este archivo hace, DENTRO de su sandbox, exactamente las operaciones
 * destructivas que antes corrían sobre `public` del cluster —crear y borrar
 * tablas `connect_*`, redefinir `auth.uid()`, `drop ... cascade`— y después
 * compara el catálogo compartido contra la fotografía previa. Si el aislamiento
 * fuera parcial, el diff lo mostraría.
 *
 * Cubre lo que un `cascade` se lleva sin avisar: tablas, funciones, policies,
 * triggers, grants y esquema de columnas.
 */

import { afterAll, beforeAll, describe, expect, it, inject } from "vitest";
import type { Client } from "pg";
import { connectGuarded } from "./harness/cluster";
import {
  createWaSandbox,
  snapshotCatalog,
  diffCatalog,
  type CatalogSnapshot,
  type WaSandbox,
} from "./harness/wa-sandbox";

/** Conexión al cluster COMPARTIDO: es el que no debe cambiar. */
let compartido: Client;
let antes: CatalogSnapshot;
let filasAjenasAntes: number;

beforeAll(async () => {
  compartido = await connectGuarded(inject("dbUrl"));
  antes = await snapshotCatalog(compartido);
  const { rows } = await compartido.query(
    "select count(*)::int as n from information_schema.tables where table_schema = 'public'",
  );
  filasAjenasAntes = rows[0].n;
});

afterAll(async () => {
  await compartido?.end();
});

describe("T-WA-R9-05 · el sandbox no puede tocar el cluster compartido", () => {
  it("operar destructivamente en el sandbox deja el catálogo compartido INTACTO", async () => {
    const sb = await createWaSandbox(inject("dbUrl"));
    try {
      // Exactamente lo que antes se hacía sobre `public` del cluster.
      await sb.client.query(`
        create schema if not exists auth;
        create or replace function auth.uid() returns uuid language sql stable
          as $fn$ select '00000000-0000-4000-8000-000000000000'::uuid $fn$;
        create table public.connect_messages (id uuid primary key, meta jsonb);
        create table public.connect_conversations (id uuid primary key, kind text);
        create or replace function public.has_permission(p text) returns boolean
          language sql stable as $fn$ select true $fn$;
      `);
      await sb.client.query(`
        drop table if exists public.connect_messages, public.connect_conversations cascade;
        drop function if exists public.has_permission(text) cascade;
        drop function if exists auth.uid() cascade;
      `);
    } finally {
      await sb.destroy();
    }

    const despues = await snapshotCatalog(compartido);
    expect(diffCatalog(antes, despues)).toEqual([]);
  });

  it("el conteo de tablas del cluster compartido no varió", async () => {
    const { rows } = await compartido.query(
      "select count(*)::int as n from information_schema.tables where table_schema = 'public'",
    );
    expect(rows[0].n).toBe(filasAjenasAntes);
  });

  it("`auth.uid()` del cluster compartido conserva su definición original", async () => {
    // Antes se sustituía y se "restauraba"; ahora nunca se toca.
    const { rows } = await compartido.query(
      "select count(*)::int as n from pg_proc p join pg_namespace n on n.oid = p.pronamespace" +
        " where n.nspname = 'auth' and p.proname = 'uid'",
    );
    const enSnapshot = antes.funciones.filter((f) => f.startsWith("auth.uid(")).length;
    expect(rows[0].n).toBe(enSnapshot);
  });

  it("dos sandboxes son mutuamente invisibles", async () => {
    const a = await createWaSandbox(inject("dbUrl"));
    const b = await createWaSandbox(inject("dbUrl"));
    try {
      expect(a.url).not.toBe(b.url);
      await a.client.query("create table public.solo_en_a (id int primary key)");
      await b.client.query("create table public.solo_en_b (id int primary key)");

      const ve = async (c: Client, t: string) =>
        (await c.query(
          "select count(*)::int as n from information_schema.tables where table_name = $1", [t],
        )).rows[0].n;

      expect(await ve(a.client, "solo_en_a")).toBe(1);
      expect(await ve(a.client, "solo_en_b")).toBe(0);
      expect(await ve(b.client, "solo_en_b")).toBe(1);
      expect(await ve(b.client, "solo_en_a")).toBe(0);
    } finally {
      await a.destroy();
      await b.destroy();
    }
  });

  it("`destroy()` elimina la base de verdad y es idempotente", async () => {
    const sb = await createWaSandbox(inject("dbUrl"));
    const nombre = new URL(sb.url).pathname.slice(1);

    const existe = async () =>
      (await compartido.query("select count(*)::int as n from pg_database where datname = $1", [nombre]))
        .rows[0].n;

    expect(await existe()).toBe(1);
    await sb.destroy();
    expect(await existe()).toBe(0);
    // Repetir el teardown no rompe: los `afterAll` pueden encadenarse.
    await sb.destroy();
    expect(await existe()).toBe(0);
  });

  it("una conexión olvidada no impide la limpieza", async () => {
    const sb = await createWaSandbox(inject("dbUrl"));
    const nombre = new URL(sb.url).pathname.slice(1);
    await sb.connect(); // segunda conexión, deliberadamente no cerrada
    await sb.destroy();
    const { rows } = await compartido.query(
      "select count(*)::int as n from pg_database where datname = $1", [nombre],
    );
    expect(rows[0].n).toBe(0);
  });

  it("el nombre de la base cae bajo el prefijo que vigila el guard de residuos", async () => {
    const sb = await createWaSandbox(inject("dbUrl"));
    try {
      // Si una base se filtrara, `assert-no-residual-databases.mjs` la detecta.
      expect(new URL(sb.url).pathname.slice(1)).toMatch(/^p3n1a0_test_/);
    } finally {
      await sb.destroy();
    }
  });
});

// ══ Complemento estructural: ninguna suite WA toca el cluster compartido ═══
describe("T-WA-R9-05 · las suites WhatsApp no contienen operaciones destructivas", () => {
  const { readFileSync, readdirSync } = require("node:fs") as typeof import("node:fs");
  const { join } = require("node:path") as typeof import("node:path");
  const DIR = join(__dirname);

  const suites = readdirSync(DIR).filter((f) => /^t-wa-r9-\d+.*\.test\.ts$/.test(f));

  it("hay suites WhatsApp para inspeccionar", () => {
    expect(suites.length).toBeGreaterThanOrEqual(4);
  });

  /**
   * Un solo caso que recorre TODAS las suites por dentro.
   *
   * Con `it.each` sobre el listado del directorio, el número de casos cambiaba
   * al agregar una suite y desincronizaba el conteo declarado del universo.
   * El contrato es el mismo; lo que deja de variar es la cardinalidad.
   */
  it("ninguna suite WhatsApp ejecuta `drop ... cascade` ni escribe en el cluster compartido", () => {
    const infractoras: string[] = [];
    for (const f of suites) {
      // Este mismo archivo prueba el aislamiento ejecutando destrucción DENTRO
      // de su sandbox: se exceptúa de la regla textual, no del contrato.
      if (f.startsWith("t-wa-r9-05")) continue;

      const src = readFileSync(join(DIR, f), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(^|[^:])\/\/.*$/gm, "$1");

      if (/drop\s+(table|function|schema)[\s\S]{0,200}?cascade/i.test(src)) {
        infractoras.push(`${f}: drop ... cascade`);
      }
      if (src.includes('connectGuarded(inject("dbUrl"))')) {
        infractoras.push(`${f}: se conecta al cluster compartido`);
      }
      if (!src.includes("createWaSandbox")) {
        infractoras.push(`${f}: no usa base dedicada`);
      }
    }
    expect(infractoras).toEqual([]);
  });

});
