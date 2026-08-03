/**
 * T-A0-11 · RLS y permisos EFECTIVOS (H-02).
 *
 * La revisión C4 señaló que verificar la existencia de una policy por su nombre
 * produce falsos PASS. Acá se ejecutan operaciones REALES como `anon` y
 * `authenticated`, con `row_security = on`, y se comprueban resultados
 * positivos y negativos.
 *
 * NO se usa el superusuario como evidencia de RLS: el owner la bypasea, y eso
 * se demuestra explícitamente en un caso para dejar constancia de por qué el
 * resto se ejecuta con `SET LOCAL ROLE`.
 *
 * DECLARACIÓN HONESTA DEL ESTADO VIGENTE: el esquema actual restringe por ROL
 * AUTENTICADO, no por cliente. Estos tests documentan eso; NO afirman
 * aislamiento tenant-aware, porque no existe. Cerrar esa brecha corresponde a
 * SEC-INV-001, fuera de A0.
 *
 * Cada caso corre en su propia transacción con ROLLBACK: cero estado compartido.
 */

import { afterAll, beforeAll, describe, expect, it, inject } from "vitest";
import { Client } from "pg";
import { connectGuarded } from "./harness/cluster";

let client: Client;

beforeAll(async () => {
  client = await connectGuarded(inject("dbUrl"));
});

afterAll(async () => {
  await client?.end();
});

/** Ejecuta el cuerpo en una transacción que SIEMPRE se revierte. */
async function withRollback<T>(fn: () => Promise<T>): Promise<T> {
  await client.query("begin");
  try {
    return await fn();
  } finally {
    await client.query("rollback");
  }
}

/** Siembra una fila de inventario como owner, dentro de la transacción actual. */
async function seedItem(sku: string): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `insert into public.inventory_items (sku, description, client_name)
     values ($1, 'fixture RLS', '__A0_RLS__') returning id`,
    [sku],
  );
  return rows[0].id;
}

/** Cambia a un rol no privilegiado con su claim JWT y RLS activa. */
async function becomeRole(role: "anon" | "authenticated"): Promise<void> {
  await client.query(`select set_config('request.jwt.claim.role', $1, true)`, [role]);
  await client.query("set local row_security = on");
  await client.query(`set local role ${role}`);
}

describe("T-A0-11 · RLS efectiva", () => {
  it("el OWNER bypasea RLS — por eso no sirve como evidencia", async () => {
    await withRollback(async () => {
      await seedItem("__A0_RLS_OWNER__");
      const { rows } = await client.query(
        `select 1 from public.inventory_items where sku = '__A0_RLS_OWNER__'`,
      );
      // El owner ve la fila sin que ninguna policy lo autorice: si midiéramos
      // RLS con este rol, cualquier policy pasaría el test.
      expect(rows).toHaveLength(1);
    });
  });

  it("anon NO ve inventario (la policy exige rol authenticated)", async () => {
    await withRollback(async () => {
      await seedItem("__A0_RLS_ANON__");
      await becomeRole("anon");
      const { rows } = await client.query(
        `select 1 from public.inventory_items where sku = '__A0_RLS_ANON__'`,
      );
      expect(rows).toHaveLength(0);
    });
  });

  it("authenticated SÍ ve inventario", async () => {
    await withRollback(async () => {
      await seedItem("__A0_RLS_AUTH__");
      await becomeRole("authenticated");
      const { rows } = await client.query(
        `select 1 from public.inventory_items where sku = '__A0_RLS_AUTH__'`,
      );
      expect(rows).toHaveLength(1);
    });
  });

  it("authenticated ve TODO el inventario, de todos los depositantes (estado vigente)", async () => {
    await withRollback(async () => {
      await client.query(
        `insert into public.inventory_items (sku, description, client_name) values
           ('__A0_T1__','fixture','__A0_CLIENTE_A__'),
           ('__A0_T2__','fixture','__A0_CLIENTE_B__')`,
      );
      await becomeRole("authenticated");
      const { rows } = await client.query<{ client_name: string }>(
        `select distinct client_name from public.inventory_items
          where sku in ('__A0_T1__','__A0_T2__') order by 1`,
      );
      // No hay aislamiento por cliente: un principal autenticado ve ambos.
      // Fotografía honesta del estado actual, no aprobación del diseño.
      expect(rows.map((r) => r.client_name)).toEqual(["__A0_CLIENTE_A__", "__A0_CLIENTE_B__"]);
    });
  });

  it("authenticated NO puede INSERT en inventory_items (lockdown 0027)", async () => {
    await withRollback(async () => {
      await becomeRole("authenticated");
      await expect(
        client.query(
          `insert into public.inventory_items (sku, description, client_name)
           values ('__A0_RLS_INS__','x','__A0__')`,
        ),
      ).rejects.toThrow(/row-level security/i);
    });
  });

  it("authenticated NO puede UPDATE inventory_items", async () => {
    await withRollback(async () => {
      await seedItem("__A0_RLS_UPD__");
      await becomeRole("authenticated");
      const r = await client.query(
        `update public.inventory_items set description = 'hack' where sku = '__A0_RLS_UPD__'`,
      );
      expect(r.rowCount).toBe(0); // sin policy de UPDATE, ninguna fila es actualizable
    });
  });

  it("authenticated NO puede DELETE inventory_items", async () => {
    await withRollback(async () => {
      await seedItem("__A0_RLS_DEL__");
      await becomeRole("authenticated");
      const r = await client.query(
        `delete from public.inventory_items where sku = '__A0_RLS_DEL__'`,
      );
      expect(r.rowCount).toBe(0);
    });
  });

  it("anon NO puede INSERT ni ver el ledger", async () => {
    await withRollback(async () => {
      await becomeRole("anon");
      const { rows } = await client.query(`select 1 from public.inventory_movements limit 1`);
      expect(rows).toHaveLength(0);
      await expect(
        client.query(
          `insert into public.inventory_movements (movement_type, quantity, before_quantity, after_quantity)
           values ('ajuste',1,0,1)`,
        ),
      ).rejects.toThrow(/row-level security/i);
    });
  });

  it("el ledger es inmutable incluso para el OWNER (el trigger, no la RLS)", async () => {
    await withRollback(async () => {
      await client.query(
        `insert into public.inventory_movements (movement_type, quantity, before_quantity, after_quantity)
         values ('ajuste',1,0,1)`,
      );
      await expect(
        client.query(`update public.inventory_movements set reason = 'x'`),
      ).rejects.toThrow(/ledger append-only/i);
    });
  });

  // ── MUTANTES PERMANENTES DE POLICY (§8.3) ───────────────────────────────
  // Se mutan DENTRO de una transacción revertida: el esquema del candidato no
  // se toca y no queda rastro fuera del caso.

  it("MUTANTE: FOR SELECT → FOR ALL habilita escritura que hoy está bloqueada", async () => {
    await withRollback(async () => {
      await client.query(`drop policy "inventory_items read" on public.inventory_items`);
      await client.query(
        `create policy "inventory_items read" on public.inventory_items
           for all using (auth.role() = 'authenticated')
           with check (auth.role() = 'authenticated')`,
      );
      await becomeRole("authenticated");
      // Con la mutación, el INSERT que el test permanente exige que falle, pasa.
      const r = await client.query(
        `insert into public.inventory_items (sku, description, client_name)
         values ('__A0_MUT_ALL__','x','__A0__') returning id`,
      );
      expect(r.rowCount).toBe(1);
    });
    // Y fuera de la transacción la policy real sigue siendo SELECT.
    const { rows } = await client.query<{ cmd: string }>(
      `select cmd from pg_policies where tablename='inventory_items'`,
    );
    expect(rows.map((r) => r.cmd)).toEqual(["SELECT"]);
  });

  it("MUTANTE: roles de la policy ampliados a anon dan visibilidad indebida", async () => {
    await withRollback(async () => {
      await seedItem("__A0_MUT_ROLES__");
      await client.query(`drop policy "inventory_items read" on public.inventory_items`);
      await client.query(
        `create policy "inventory_items read" on public.inventory_items
           for select to anon, authenticated using (true)`,
      );
      await becomeRole("anon");
      const { rows } = await client.query(
        `select 1 from public.inventory_items where sku = '__A0_MUT_ROLES__'`,
      );
      // Con la mutación anon ve la fila; el test permanente exige que NO la vea.
      expect(rows).toHaveLength(1);
    });
  });

  it("MUTANTE: qual debilitado a `true` expone el inventario a anon", async () => {
    await withRollback(async () => {
      await seedItem("__A0_MUT_QUAL__");
      await client.query(`drop policy "inventory_items read" on public.inventory_items`);
      await client.query(
        `create policy "inventory_items read" on public.inventory_items
           for select using (true)`,
      );
      await becomeRole("anon");
      const { rows } = await client.query(
        `select 1 from public.inventory_items where sku = '__A0_MUT_QUAL__'`,
      );
      expect(rows).toHaveLength(1);
    });
  });

  it("MUTANTE: with_check retirado permite escribir filas fuera del criterio", async () => {
    await withRollback(async () => {
      await client.query(`drop policy "inventory_items read" on public.inventory_items`);
      // FOR ALL con USING restrictivo pero SIN with_check: PostgreSQL usa USING
      // como with_check por defecto; al ponerlo en `true` la escritura queda libre.
      await client.query(
        `create policy "inventory_items read" on public.inventory_items
           for all using (true)`,
      );
      await becomeRole("authenticated");
      const r = await client.query(
        `insert into public.inventory_items (sku, description, client_name)
         values ('__A0_MUT_WC__','x','__A0__') returning id`,
      );
      expect(r.rowCount).toBe(1);
    });
  });

  it("MUTANTE: revocar los grants de escritura enmascararía la RLS", async () => {
    await withRollback(async () => {
      await client.query(`revoke insert on public.inventory_items from authenticated`);
      await becomeRole("authenticated");
      // Sin el grant, el INSERT falla por PRIVILEGIO, no por policy. Un test que
      // sólo mirara "¿falló?" daría un falso PASS de RLS. Por eso el bootstrap
      // reproduce los grants de Supabase y este caso distingue ambos motivos.
      await expect(
        client.query(
          `insert into public.inventory_items (sku, description, client_name)
           values ('__A0_MUT_GRANT__','x','__A0__')`,
        ),
      ).rejects.toThrow(/permission denied/i);
    });
  });

  it("el mensaje distingue policy de privilegio: con grants, el rechazo es de RLS", async () => {
    await withRollback(async () => {
      await becomeRole("authenticated");
      await expect(
        client.query(
          `insert into public.inventory_items (sku, description, client_name)
           values ('__A0_RLS_MSG__','x','__A0__')`,
        ),
      ).rejects.toThrow(/row-level security/i);
    });
  });
});
