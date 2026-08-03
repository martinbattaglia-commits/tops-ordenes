/**
 * T-A0-03 · Protección contra producción (B-01).
 *
 * Verifica que la guarda rechaza destinos remotos ANTES de cualquier intento de
 * socket. No se abre una sola conexión en este archivo: todos los casos son
 * evaluaciones puras de la guarda.
 *
 * Los project refs que aparecen acá son identificadores públicos de proyecto,
 * no credenciales. Los valores de las variables de entorno son inertes.
 */

import { describe, expect, it } from "vitest";
import { emitSentinelWhenGreen } from "./harness/sentinel";
import {
  ONLY_ALLOWED_HOST,
  ProductionGuardError,
  TEST_DB_PREFIX,
  WATCHED_ENV_VARS,
  assertLocalMaintenanceUrl,
  assertLocalTestUrl,
  assertNoProductionEnv,
  makeTestDbName,
} from "./harness/guard";

const OK = `postgresql://postgres@127.0.0.1:55432/${TEST_DB_PREFIX}abc`;

describe("T-A0-03 · guarda contra producción", () => {
  emitSentinelWhenGreen("P3_N1A0_REMOTE_CONNECTION_REJECTED");

  // ── host ────────────────────────────────────────────────────────────────
  it("acepta únicamente 127.0.0.1", () => {
    expect(ONLY_ALLOWED_HOST).toBe("127.0.0.1");
    expect(() => assertLocalTestUrl(OK)).not.toThrow();
  });

  it.each([
    ["localhost", `postgresql://postgres@localhost:5432/${TEST_DB_PREFIX}x`],
    ["IPv6 ::1", `postgresql://postgres@[::1]:5432/${TEST_DB_PREFIX}x`],
    ["otro loopback", `postgresql://postgres@127.0.0.2:5432/${TEST_DB_PREFIX}x`],
    ["hostname", `postgresql://postgres@db.interno.tops:5432/${TEST_DB_PREFIX}x`],
    ["IP privada", `postgresql://postgres@10.0.0.5:5432/${TEST_DB_PREFIX}x`],
  ])("rechaza %s", (_label, url) => {
    expect(() => assertLocalTestUrl(url)).toThrow(/no admitido/);
  });

  it("rechaza una URL remota sin query", () => {
    expect(() =>
      assertLocalTestUrl(`postgresql://u@db.example.com:5432/${TEST_DB_PREFIX}x`),
    ).toThrow(ProductionGuardError);
  });

  // ── query parameters (el bypass de B-01) ────────────────────────────────
  it.each([
    ["?host=example.invalid", `${OK}?host=example.invalid`],
    ["?host=%2Ftmp (socket Unix)", `${OK}?host=%2Ftmp`],
    ["?port=", `${OK}?port=5432`],
    ["?sslmode=", `${OK}?sslmode=require`],
    ["?dbname=", `${OK}?dbname=produccion`],
    ["?user=", `${OK}?user=otro`],
    ["?password=", `${OK}?password=x`],
    ["?service=", `${OK}?service=prod`],
    ["query vacía con '?'", `${OK}?x=1`],
  ])("rechaza %s sin interpretarlo", (_label, url) => {
    expect(() => assertLocalTestUrl(url)).toThrow(/query parameters/);
  });

  // ── project refs y proveedores, incluso percent-encoded ─────────────────
  it.each([
    "arsksytgdnzukbmfgkju",
    "bmrtlojmqmkuirhuzhyt",
    "nwuxkwmtpbdiuvmvmwow",
  ])("rechaza el project ref %s en el host", (ref) => {
    expect(() => assertLocalTestUrl(`postgresql://u@db.${ref}.supabase.co:5432/postgres`)).toThrow(
      ProductionGuardError,
    );
  });

  it("rechaza un project ref percent-encoded en el USERNAME", () => {
    // 'arsksytgdnzukbmfgkju' con caracteres escapados: la representación cruda
    // no lo delata, pero la decodificada sí.
    const encoded = "%61rsksytgdnzukbmfgkju";
    const url = `postgresql://${encoded}@127.0.0.1:5432/${TEST_DB_PREFIX}x`;
    expect(() => assertLocalTestUrl(url)).toThrow(/project ref/);
  });

  it("rechaza un project ref percent-encoded en la CONTRASEÑA", () => {
    const encoded = "%62mrtlojmqmkuirhuzhyt";
    const url = `postgresql://u:${encoded}@127.0.0.1:5432/${TEST_DB_PREFIX}x`;
    expect(() => assertLocalTestUrl(url)).toThrow(/project ref/);
  });

  it("rechaza un proveedor gestionado percent-encoded en la contraseña", () => {
    const encoded = "x%2Esupabase%2Eco";
    const url = `postgresql://u:${encoded}@127.0.0.1:5432/${TEST_DB_PREFIX}x`;
    expect(() => assertLocalTestUrl(url)).toThrow(/fragmento remoto/);
  });

  it("no imprime el valor completo del componente ofensivo", () => {
    const encoded = "%62mrtlojmqmkuirhuzhyt";
    try {
      assertLocalTestUrl(`postgresql://u:${encoded}@127.0.0.1:5432/${TEST_DB_PREFIX}x`);
      expect.unreachable("debió lanzar");
    } catch (e) {
      expect((e as Error).message).not.toContain("bmrtlojmqmkuirhuzhyt");
      expect((e as Error).message).toMatch(/…\*\*\*/);
    }
  });

  // ── nombre de base ──────────────────────────────────────────────────────
  it("rechaza una base sin la marca de test aunque sea loopback", () => {
    expect(() => assertLocalTestUrl("postgresql://postgres@127.0.0.1:5432/postgres")).toThrow(
      /prefijo obligatorio/,
    );
    expect(() => assertLocalTestUrl("postgresql://postgres@127.0.0.1:5432/tops_ordenes")).toThrow(
      /prefijo obligatorio/,
    );
  });

  it("rechaza una base percent-encoded que no lleva el prefijo real", () => {
    // '%70ostgres' decodifica a 'postgres': el prefijo debe evaluarse SOBRE el
    // valor decodificado, no sobre la forma escapada.
    expect(() => assertLocalTestUrl("postgresql://u@127.0.0.1:5432/%70ostgres")).toThrow(
      /prefijo obligatorio/,
    );
  });

  it("acepta una base percent-encoded que SÍ lleva el prefijo", () => {
    const encoded = `%70${TEST_DB_PREFIX.slice(1)}ok`;
    expect(() => assertLocalTestUrl(`postgresql://u@127.0.0.1:5432/${encoded}`)).not.toThrow();
  });

  it("rechaza un pathname compuesto", () => {
    expect(() =>
      assertLocalTestUrl(`postgresql://u@127.0.0.1:5432/${TEST_DB_PREFIX}a%2Fb`),
    ).toThrow(/identificador simple/);
  });

  it("rechaza una URL sin nombre de base", () => {
    expect(() => assertLocalTestUrl("postgresql://postgres@127.0.0.1:5432/")).toThrow(
      /no especifica nombre de base/,
    );
  });

  it("rechaza URL vacía, no parseable o de otro protocolo", () => {
    expect(() => assertLocalTestUrl("")).toThrow(ProductionGuardError);
    expect(() => assertLocalTestUrl("no-es-una-url")).toThrow(/no parseable/);
    expect(() => assertLocalTestUrl(`https://127.0.0.1:5432/${TEST_DB_PREFIX}x`)).toThrow(
      /Protocolo/,
    );
  });

  // ── URL de mantenimiento ────────────────────────────────────────────────
  it("la guarda de mantenimiento exige la base 'postgres' y las mismas barreras", () => {
    expect(() => assertLocalMaintenanceUrl("postgresql://u@127.0.0.1:5432/postgres")).not.toThrow();
    expect(() => assertLocalMaintenanceUrl("postgresql://u@127.0.0.1:5432/otra")).toThrow(
      /debe apuntar a la base "postgres"/,
    );
    expect(() => assertLocalMaintenanceUrl("postgresql://u@localhost:5432/postgres")).toThrow(
      /no admitido/,
    );
    expect(() => assertLocalMaintenanceUrl("postgresql://u@127.0.0.1:5432/postgres?host=x")).toThrow(
      /query parameters/,
    );
  });

  // ── variables de entorno libpq ──────────────────────────────────────────
  it.each([
    "SUPABASE_SERVICE_ROLE_KEY",
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "SUPABASE_DB_URL",
    "DATABASE_URL",
    "PGHOST",
    "PGHOSTADDR",
    "PGPORT",
    "PGDATABASE",
    "PGUSER",
    "PGPASSWORD",
    "PGPASSFILE",
    "PGSERVICE",
    "PGSERVICEFILE",
    "PGSSLMODE",
    "PGOPTIONS",
  ])("aborta si %s está presente", (key) => {
    expect(() => assertNoProductionEnv({ [key]: "x" })).toThrow(/Variables prohibidas presentes/);
  });

  it("la lista vigilada cubre las variables libpq de destino", () => {
    for (const k of ["PGHOST", "PGHOSTADDR", "PGPORT", "PGDATABASE", "PGSERVICE", "PGOPTIONS"]) {
      expect(WATCHED_ENV_VARS).toContain(k);
    }
  });

  it("una variable presente pero vacía no dispara la guarda", () => {
    expect(() => assertNoProductionEnv({ PGHOST: "   " })).not.toThrow();
  });

  it("un entorno limpio pasa sin requerir ninguna clave", () => {
    expect(() => assertNoProductionEnv({})).not.toThrow();
  });

  // ── nombres generados ───────────────────────────────────────────────────
  it("los nombres generados siempre satisfacen la guarda", () => {
    for (let i = 0; i < 50; i++) {
      const name = makeTestDbName();
      expect(name.startsWith(TEST_DB_PREFIX)).toBe(true);
      expect(() => assertLocalTestUrl(`postgresql://postgres@127.0.0.1:5432/${name}`)).not.toThrow();
    }
  });

  // ── MUTANTE PERMANENTE: el override ?host= ──────────────────────────────
  it("MUTANTE PERMANENTE: una guarda que ignorara la query dejaría pasar ?host=", () => {
    const bypass = `${OK}?host=example.invalid`;
    // Guarda "mutada": sólo mira el hostname de la URL, como hacía la versión
    // anterior. El destino EFECTIVO de node-postgres sería example.invalid.
    const mutantAccepts = new URL(bypass).hostname === ONLY_ALLOWED_HOST;
    expect(mutantAccepts).toBe(true); // el mutante la aceptaría
    expect(() => assertLocalTestUrl(bypass)).toThrow(/query parameters/); // la real no
  });
});
