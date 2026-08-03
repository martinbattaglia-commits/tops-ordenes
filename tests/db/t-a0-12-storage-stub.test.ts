/**
 * T-A0-12 · Semántica del stub de storage (§12).
 *
 * `storage.foldername()` devuelve las CARPETAS del path, EXCLUYENDO el nombre
 * del objeto final. La versión anterior del stub devolvía el path completo
 * partido —incluido el archivo—, lo que habría hecho pasar pruebas de scoping
 * por prefijo que en producción fallarían.
 */

import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { Client } from "pg";
import { connectGuarded } from "./harness/cluster";

let client: Client;

beforeAll(async () => {
  client = await connectGuarded(inject("dbUrl"));
});

afterAll(async () => {
  await client?.end();
});

async function foldername(name: string): Promise<string[]> {
  const { rows } = await client.query<{ f: string[] }>(
    `select storage.foldername($1) as f`,
    [name],
  );
  return rows[0].f ?? [];
}

describe("T-A0-12 · storage.foldername", () => {
  it("archivo en la raíz → sin carpetas", async () => {
    expect(await foldername("file.txt")).toEqual([]);
  });

  it("una carpeta → sólo la carpeta", async () => {
    expect(await foldername("a/file.txt")).toEqual(["a"]);
  });

  it("múltiples carpetas → todas menos el archivo", async () => {
    expect(await foldername("a/b/c/file.txt")).toEqual(["a", "b", "c"]);
  });

  it("trailing slash → el segmento vacío final se descarta como 'archivo'", async () => {
    expect(await foldername("a/b/")).toEqual(["a", "b"]);
  });

  it("NUNCA incluye el nombre del objeto final", async () => {
    for (const p of ["file.txt", "a/file.txt", "a/b/file.txt"]) {
      expect(await foldername(p)).not.toContain("file.txt");
    }
  });

  it("el primer segmento sigue siendo el usado por el scoping por tenant", async () => {
    // Las migraciones 0010/0013 hacen scoping con split_part(name,'/',1); esta
    // aserción deja asentado que foldername()[1] coincide con ese criterio.
    const { rows } = await client.query<{ a: string; b: string }>(
      `select (storage.foldername($1))[1] as a, split_part($1, '/', 1) as b`,
      ["cliente-uuid/2026/03/doc.pdf"],
    );
    expect(rows[0].a).toBe(rows[0].b);
    expect(rows[0].a).toBe("cliente-uuid");
  });

  it("storage.filename devuelve el objeto final", async () => {
    const { rows } = await client.query<{ f: string }>(
      `select storage.filename('a/b/doc.pdf') as f`,
    );
    expect(rows[0].f).toBe("doc.pdf");
  });

  it("storage.extension devuelve la extensión", async () => {
    const { rows } = await client.query<{ e: string }>(
      `select storage.extension('a/b/doc.pdf') as e`,
    );
    expect(rows[0].e).toBe("pdf");
  });
});
