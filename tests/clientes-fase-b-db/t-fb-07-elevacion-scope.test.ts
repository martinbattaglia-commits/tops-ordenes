/**
 * T-FB-07 · H-1 · La elevación transaccional no se puede falsificar.
 *
 * `current_role()` devuelve 'operaciones' para un encargado sólo dentro de una
 * transacción que pasó por `nexus_wms_begin_scope`. Antes eso se acreditaba
 * con la GUC `nexus.wms_scope`, que es PGC_USERSET: cualquier rol puede
 * setearla con SET o set_config, y `current_role() = 'operaciones'` es la
 * llave de ciento sesenta cláusulas de policy.
 *
 * El patrón de centinela por GUC del resto del sistema —treasury.via_rpc,
 * ap.via_rpc— RESTRINGE: deniega mientras no esté puesta. Éste CONCEDÍA. La
 * diferencia importa porque lo que concede es una identidad, no un permiso
 * puntual.
 *
 * Ahora la concesión vive en una fila que sólo el definer puede escribir.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type { Client } from "pg";
import { connectGuarded, startEphemeralCluster, type EphemeralCluster } from "../db/harness/cluster";
import {
  BOOTSTRAP,
  FASE_B_FORWARDS,
  JORGE,
  aplicar,
  aplicarCadena,
  cadenaHasta,
  comoUsuario,
  seedCanonico,
  seedJerarquiaMagaldi,
} from "./harness/chain";

let cluster: EphemeralCluster;
let db: Client;

beforeAll(async () => {
  cluster = await startEphemeralCluster();
  try {
    db = await connectGuarded(cluster.url);
    await db.query(readFileSync(BOOTSTRAP, "utf8"));
    await aplicarCadena(db, cadenaHasta(245));
    await seedCanonico(db);
    await seedJerarquiaMagaldi(db);
    for (const f of FASE_B_FORWARDS) await aplicar(db, f);
  } catch (e) {
    await cluster.teardown().catch(() => {});
    throw e;
  }
}, 300_000);

afterAll(async () => {
  await db?.end().catch(() => {});
  await cluster?.teardown().catch(() => {});
});

async function rolDe(): Promise<string> {
  const { rows } = await db.query<{ cr: string }>(`select public.current_role()::text as cr`);
  return rows[0].cr;
}

describe("T-FB-07 · H-1 · la elevación exige una concesión no falsificable", () => {
  it("sin concesión, un encargado es 'cliente'", async () => {
    await comoUsuario(db, JORGE.id, JORGE.email, async () => {
      expect(await rolDe()).toBe("cliente");
    });
  });

  it("setear la GUC a mano YA NO eleva", async () => {
    await comoUsuario(db, JORGE.id, JORGE.email, async () => {
      // Este es el ataque exacto que el centinela anterior no resistía: la GUC
      // es PGC_USERSET y el propio usuario puede ponerle el valor mágico.
      await db.query(`select set_config('nexus.wms_scope','fase-b-0248',true)`);
      expect(await rolDe()).toBe("cliente");
    });
  });

  it("tampoco eleva inventando una fila de concesión: la tabla está cerrada", async () => {
    await comoUsuario(db, JORGE.id, JORGE.email, async () => {
      await expect(
        db.query(
          `insert into public.nexus_wms_scope_grants (xid8_txn, granted_to)
           values (pg_current_xact_id()::text, $1)`,
          [JORGE.id],
        ),
      ).rejects.toThrow(/permission denied|denegado/i);
      expect(await rolDe()).toBe("cliente");
    });
  });

  it("ni leyendo la tabla para descubrir el mecanismo", async () => {
    await comoUsuario(db, JORGE.id, JORGE.email, async () => {
      await expect(
        db.query(`select * from public.nexus_wms_scope_grants`),
      ).rejects.toThrow(/permission denied|denegado/i);
    });
  });

  it("el rol global no se ve afectado por el mecanismo", async () => {
    // La elevación es exclusiva del principal; para el resto current_role()
    // sigue leyendo profiles.role como siempre.
    const { rows } = await db.query<{ cr: string }>(
      `select public.current_role()::text as cr`,
    );
    expect(rows[0].cr).not.toBe("operaciones");
  });
});
