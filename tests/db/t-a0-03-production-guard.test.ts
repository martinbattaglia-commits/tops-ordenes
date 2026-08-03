/**
 * T-A0-03 · Protección contra producción.
 *
 * Verifica que la guarda rechaza destinos remotos ANTES de abrir conexión.
 * No se usa el valor real de ninguna clave ni project ref secreto: los refs
 * que aparecen acá son identificadores públicos de proyecto, no credenciales.
 */

import { describe, expect, it } from "vitest";
import { emitSentinelWhenGreen } from "./harness/sentinel";
import {
  ProductionGuardError,
  assertLocalTestUrl,
  assertNoProductionEnv,
  makeTestDbName,
  TEST_DB_PREFIX,
} from "./harness/guard";

describe("T-A0-03 · guarda contra producción", () => {
  emitSentinelWhenGreen("P3_N1A0_REMOTE_CONNECTION_REJECTED");

  it("rechaza el host de un proyecto Supabase", () => {
    expect(() =>
      assertLocalTestUrl(
        "postgresql://postgres@db.arsksytgdnzukbmfgkju.supabase.co:5432/postgres",
      ),
    ).toThrow(ProductionGuardError);
  });

  it("rechaza el pooler de Supabase", () => {
    expect(() =>
      assertLocalTestUrl(
        "postgresql://u@aws-0-sa-east-1.pooler.supabase.com:6543/p3n1a0_test_x",
      ),
    ).toThrow(ProductionGuardError);
  });

  it.each([
    ["arsksytgdnzukbmfgkju", "Nexus OS producción"],
    ["bmrtlojmqmkuirhuzhyt", "Tops Connect B2B producción"],
    ["nwuxkwmtpbdiuvmvmwow", "Nexus Creative producción"],
  ])("rechaza el project ref %s aunque viaje disfrazado en loopback", (ref) => {
    // Caso túnel / alias de /etc/hosts: host loopback, nombre de base válido,
    // pero el ref aparece en el usuario. Debe rechazarse igual.
    expect(() =>
      assertLocalTestUrl(`postgresql://${ref}@127.0.0.1:5432/${TEST_DB_PREFIX}x`),
    ).toThrow(ProductionGuardError);
  });

  it("rechaza cualquier host que no sea loopback", () => {
    expect(() =>
      assertLocalTestUrl("postgresql://postgres@10.0.0.5:5432/p3n1a0_test_x"),
    ).toThrow(/no es loopback/);
    expect(() =>
      assertLocalTestUrl("postgresql://postgres@db.interno.tops:5432/p3n1a0_test_x"),
    ).toThrow(/no es loopback/);
  });

  it("rechaza una base sin la marca de test aunque sea loopback", () => {
    expect(() =>
      assertLocalTestUrl("postgresql://postgres@127.0.0.1:5432/postgres"),
    ).toThrow(/prefijo obligatorio/);
    expect(() =>
      assertLocalTestUrl("postgresql://postgres@127.0.0.1:5432/tops_ordenes"),
    ).toThrow(/prefijo obligatorio/);
  });

  it("rechaza una URL sin nombre de base", () => {
    expect(() => assertLocalTestUrl("postgresql://postgres@127.0.0.1:5432/")).toThrow(
      /no especifica nombre de base/,
    );
  });

  it("rechaza URL vacía, no parseable o de otro protocolo", () => {
    expect(() => assertLocalTestUrl("")).toThrow(ProductionGuardError);
    expect(() => assertLocalTestUrl("no-es-una-url")).toThrow(/no parseable/);
    expect(() =>
      assertLocalTestUrl("https://127.0.0.1:5432/p3n1a0_test_x"),
    ).toThrow(/Protocolo/);
  });

  it("acepta únicamente loopback + base marcada como test", () => {
    expect(() =>
      assertLocalTestUrl("postgresql://postgres@127.0.0.1:55432/p3n1a0_test_abc"),
    ).not.toThrow();
    expect(() =>
      assertLocalTestUrl("postgres://postgres@localhost:5432/p3n1a0_test_abc"),
    ).not.toThrow();
  });

  it("los nombres generados siempre satisfacen la guarda", () => {
    for (let i = 0; i < 50; i++) {
      const name = makeTestDbName();
      expect(name.startsWith(TEST_DB_PREFIX)).toBe(true);
      expect(() =>
        assertLocalTestUrl(`postgresql://postgres@127.0.0.1:5432/${name}`),
      ).not.toThrow();
    }
  });

  it("aborta si el proceso tiene credenciales productivas cargadas", () => {
    // Los valores son deliberadamente inertes: a la guarda sólo le importa que
    // la variable esté PRESENTE y no vacía, nunca su contenido. Mantenerlos de
    // un solo carácter evita que un escáner de secretos los tome por reales.
    for (const key of [
      "SUPABASE_SERVICE_ROLE_KEY",
      "NEXT_PUBLIC_SUPABASE_URL",
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      "SUPABASE_DB_URL",
      "DATABASE_URL",
    ]) {
      expect(() => assertNoProductionEnv({ [key]: "x" })).toThrow(
        /Variables productivas presentes/,
      );
    }
  });

  it("una variable presente pero vacía no dispara la guarda", () => {
    expect(() =>
      assertNoProductionEnv({ SUPABASE_SERVICE_ROLE_KEY: "   " }),
    ).not.toThrow();
  });

  it("un entorno limpio pasa sin requerir ninguna clave", () => {
    expect(() => assertNoProductionEnv({})).not.toThrow();
  });

});
