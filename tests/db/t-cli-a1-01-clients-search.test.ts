/**
 * T-CLI-A1-01 · NEXUS-CLIENTES-ORDENES-PRECIOS-USUARIOS-001 · Carril A.
 *
 * Ensayo de 0240 + 0241 contra PostgreSQL REAL, en una base efímera dedicada.
 *
 * ─── QUÉ DEMUESTRA ─────────────────────────────────────────────────────────
 *
 * Búsqueda normalizada, invariantes del registro maestro, y —desde la
 * remediación de C4 1/2— la FRONTERA DE SEGURIDAD de `client_events`:
 * aislamiento por cliente, imposibilidad de forjar la atribución, y denegación
 * efectiva de UPDATE/DELETE bajo un rol sin bypass.
 *
 * El SQL bajo prueba es el REAL, leído de disco. El cierre acotado es
 * compartido y declara el origen de cada pieza (ver harness/clientes-closure).
 *
 * ─── QUÉ CAMBIÓ TRAS LA REVISIÓN ADVERSARIAL ───────────────────────────────
 *
 * · El cierre ya incluye `unique (module, action)` de 0009: sin esa
 *   restricción, ningún test podía ver que `on conflict (slug)` deja escapar
 *   el segundo índice único (H-03/H-04).
 * · La aserción de append-only ya no lee `pg_policies`: INTENTA el UPDATE y el
 *   DELETE bajo `set role authenticated` y exige que fallen (H-05).
 * · Los tres casos tautológicos se reescribieron para que la propiedad que
 *   prometen sea la que se mide (H-06).
 */

import { afterAll, beforeAll, describe, expect, it, inject } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Client } from "pg";
import { createWaSandbox, type WaSandbox } from "./harness/wa-sandbox";
import { CIERRE_ACOTADO } from "./harness/clientes-closure";

const DIR = resolve(__dirname, "..", "..", "supabase", "migrations");
const M0240 = resolve(DIR, "0240_clientes_permission_module.sql");
const M0241 = resolve(DIR, "0241_clients_native_master.sql");

/** Identidades fijas. Nada se infiere. */
const INTERNO = "11111111-1111-4111-8111-111111111111";
const CLIENTE_A = "22222222-2222-4222-8222-222222222222";
const CLIENTE_B = "33333333-3333-4333-8333-333333333333";
const DUPLICADOR = "44444444-4444-4444-8444-444444444444";
const AUDITOR = "55555555-5555-4555-8555-555555555555";

/** Cartera FICTICIA, elegida para ejercitar cada criterio de búsqueda. */
const CARTERA: ReadonlyArray<{
  razon: string;
  cuit: string;
  nombre_comercial: string | null;
  codigo: string | null;
  email: string | null;
  telefono: string | null;
  activo: boolean;
}> = [
  // Tildes + mayúsculas + espacio doble, los tres a la vez y a propósito.
  { razon: "DISTRIBUIDORA  ÁVILA S.A.", cuit: "30-71234567-1", nombre_comercial: "Ávila Logística", codigo: "AVL", email: "compras@avila.test", telefono: "11 5555-0001", activo: true },
  { razon: "Farmacéutica del Plata SRL", cuit: "30712345689", nombre_comercial: "FarmaPlata", codigo: "FDP", email: "info@farmaplata.test", telefono: "11 5555-0002", activo: true },
  // Su TELÉFONO contiene el CUIT de FarmaPlata: obliga al desempate por CUIT
  // exacto. Sin este señuelo, la prueba de prioridad sería tautológica.
  { razon: "Transportes Avellaneda SA", cuit: "30-71234569-8", nombre_comercial: null, codigo: null, email: null, telefono: "30712345689", activo: true },
  { razon: "Comercial Retirada SRL", cuit: "30-71234570-1", nombre_comercial: null, codigo: "RET", email: null, telefono: null, activo: false },
];

let sb: WaSandbox;
let db: Client;

/** Ejecuta como observador dado, con el rol `authenticated` (sin bypass). */
async function comoUsuario<T>(uid: string, fn: () => Promise<T>): Promise<T> {
  await db.query("begin");
  await db.query("select set_config('test.observer', $1, true)", [uid]);
  await db.query("set local role authenticated");
  try {
    return await fn();
  } finally {
    await db.query("rollback");
  }
}

beforeAll(async () => {
  sb = await createWaSandbox(inject("dbUrl"));
  db = sb.client;
  await db.query(CIERRE_ACOTADO);
}, 120_000);

afterAll(async () => {
  await sb?.destroy();
});

describe("T-CLI-A1-01 · orden obligatorio 0240 → 0241", () => {
  it("0241 sin 0240 falla: el enum no conoce el valor 'clientes'", async () => {
    await db.query("begin");
    let mensaje: string | null = null;
    try {
      await db.query(readFileSync(M0241, "utf8"));
    } catch (e) {
      mensaje = e instanceof Error ? e.message : String(e);
    }
    await db.query("rollback");
    expect(mensaje).not.toBeNull();
    expect(mensaje).toMatch(/clientes/i);
  });

  it("0241 tolera un permiso preexistente que ocupa (module, action)", async () => {
    // REGRESIÓN DE H-03. `permissions` tiene DOS restricciones únicas. Se
    // ocupa (wms,'create') con OTRO slug: si 0241 usara `on conflict (slug)`,
    // el choque por (module, action) abortaría la migración entera.
    await db.query(readFileSync(M0240, "utf8"));
    await db.query(
      `insert into public.permissions (slug, module, action, label)
       values ('wms.legacy.create','wms','create','WMS · legacy')`,
    );
    await expect(db.query(readFileSync(M0241, "utf8"))).resolves.toBeDefined();
  });

  it("siembra los cuatro permisos de clientes y omite el que ya estaba ocupado", async () => {
    const { rows } = await db.query<{ n: string }>(
      "select count(*)::text as n from public.permissions where module = 'clientes'",
    );
    expect(rows[0].n).toBe("4");
    // wms.clients.create NO entró: (wms,'create') ya estaba tomado. La
    // migración no aborta, simplemente no lo siembra.
    const wms = await db.query<{ slug: string }>(
      "select slug from public.permissions where module='wms' and action='create'",
    );
    expect(wms.rows.map((r) => r.slug)).toEqual(["wms.legacy.create"]);
  });
});

describe("T-CLI-A1-01 · búsqueda normalizada", () => {
  beforeAll(async () => {
    for (const c of CARTERA) {
      await db.query(
        `insert into public.clients (razon, cuit, nombre_comercial, codigo, email, telefono, activo)
         values ($1,$2,$3,$4,$5,$6,$7)`,
        [c.razon, c.cuit, c.nombre_comercial, c.codigo, c.email, c.telefono, c.activo],
      );
    }
  });

  const buscar = async (q: string, soloActivos = true): Promise<string[]> => {
    const { rows } = await db.query<{ razon: string }>(
      "select razon from public.clients_search($1, 20, $2)",
      [q, soloActivos],
    );
    return rows.map((r) => r.razon);
  };

  it("ignora las tildes en los dos sentidos", async () => {
    expect(await buscar("avila")).toContain("DISTRIBUIDORA  ÁVILA S.A.");
    expect(await buscar("ÁVILA")).toContain("DISTRIBUIDORA  ÁVILA S.A.");
    expect(await buscar("farmaceutica")).toContain("Farmacéutica del Plata SRL");
  });

  it("ignora mayúsculas y espacios repetidos", async () => {
    expect(await buscar("distribuidora   avila")).toContain("DISTRIBUIDORA  ÁVILA S.A.");
    expect(await buscar("  DiStRiBuIdOrA aViLa  ")).toContain("DISTRIBUIDORA  ÁVILA S.A.");
  });

  it("encuentra por nombre comercial, no sólo por razón social", async () => {
    expect(await buscar("FarmaPlata")).toContain("Farmacéutica del Plata SRL");
    expect(await buscar("logistica")).toContain("DISTRIBUIDORA  ÁVILA S.A.");
  });

  it("encuentra por CUIT sin importar el formato", async () => {
    for (const q of ["30-71234567-1", "30712345671", "30 71234567 1"]) {
      expect(await buscar(q)).toContain("DISTRIBUIDORA  ÁVILA S.A.");
    }
  });

  it("desempata por CUIT exacto cuando hay más de un candidato", async () => {
    // "30712345689" es el CUIT de FarmaPlata y ADEMÁS el teléfono de
    // Avellaneda: la consulta devuelve DOS filas y el orden es lo que se mide.
    const r = await buscar("30712345689");
    expect(r).toHaveLength(2);
    expect(r).toContain("Transportes Avellaneda SA");
    expect(r[0]).toBe("Farmacéutica del Plata SRL");
  });

  it("acepta coincidencias parciales", async () => {
    expect(await buscar("avell")).toContain("Transportes Avellaneda SA");
  });

  it("encuentra por código exacto y por email", async () => {
    expect(await buscar("AVL")).toContain("DISTRIBUIDORA  ÁVILA S.A.");
    expect(await buscar("compras@avila.test")).toContain("DISTRIBUIDORA  ÁVILA S.A.");
  });

  it("excluye inactivos por defecto y los incluye si se piden", async () => {
    expect(await buscar("retirada")).not.toContain("Comercial Retirada SRL");
    expect(await buscar("retirada", false)).toContain("Comercial Retirada SRL");
  });

  it("no confunde 'avila' con 'avellaneda': la búsqueda discrimina", async () => {
    expect(await buscar("avila")).not.toContain("Transportes Avellaneda SA");
  });
});

describe("T-CLI-A1-01 · acotamiento del límite", () => {
  beforeAll(async () => {
    // 120 filas: por encima del techo de 100. Sin esto, el techo no se puede
    // medir (con 4 clientes, cualquier límite «pasa»).
    await db.query(`
      with bases as (
        select g, '20' || lpad(g::text, 8, '0') as d10
          from generate_series(1, 120) g
      ), checksums as (
        select b.g, b.d10,
               sum(substring(b.d10 from w.i::int for 1)::int * w.peso)::int as total
          from bases b
          cross join unnest(array[5,4,3,2,7,6,5,4,3,2]) with ordinality as w(peso, i)
         group by b.g, b.d10
      )
      insert into public.clients (razon, cuit)
      select 'Masiva ' || g,
             d10 || case 11 - (total % 11) when 11 then 0 when 10 then 9 else 11 - (total % 11) end
        from checksums
    `);
  });

  it("nunca devuelve más de 100 filas aunque se pidan 9999", async () => {
    const { rows } = await db.query<{ n: string }>(
      "select count(*)::text as n from public.clients_search('masiva', 9999, true)",
    );
    expect(Number(rows[0].n)).toBe(100);
  });

  it("un límite de 0 o negativo devuelve al menos una fila, no cero", async () => {
    for (const limite of [0, -5]) {
      const { rows } = await db.query<{ n: string }>(
        "select count(*)::text as n from public.clients_search('masiva', $1, true)",
        [limite],
      );
      expect(Number(rows[0].n)).toBe(1);
    }
  });
});

describe("T-CLI-A1-01 · advertencia de duplicado", () => {
  beforeAll(async () => {
    await db.query("insert into auth.users(id) values ($1)", [DUPLICADOR]);
    await db.query("insert into public.profiles(id,role) values ($1,'operaciones')", [DUPLICADOR]);
    await db.query("insert into public.roles(slug,name) values ('duplicador_clientes','Duplicador')");
    await db.query(`
      insert into public.role_permissions(role_id,permission_id)
      select r.id,p.id from public.roles r join public.permissions p on p.slug='clientes.view'
       where r.slug='duplicador_clientes'
    `);
    await db.query(`
      insert into public.user_roles(user_id,role_id)
      select $1,id from public.roles where slug='duplicador_clientes'
    `, [DUPLICADOR]);
  });

  it("detecta CUIT idéntico aunque el formato difiera", async () => {
    const rows = await comoUsuario(DUPLICADOR, async () => (await db.query<{
      match_reason: string;
      razon: string;
    }>("select match_reason, razon from public.clients_duplicate_candidates($1,$2)", [
      "Nombre Totalmente Distinto SA",
      "30712345671",
    ])).rows);
    expect(rows[0].match_reason).toBe("cuit_identico");
    expect(rows[0].razon).toBe("DISTRIBUIDORA  ÁVILA S.A.");
  });

  it("advierte por razón social parecida, sin CUIT", async () => {
    const rows = await comoUsuario(DUPLICADOR, async () => (await db.query<{
      razon: string;
      match_reason: string;
    }>("select razon, match_reason from public.clients_duplicate_candidates($1,$2)", [
      "Distribuidora Avila S.A.",
      null,
    ])).rows);
    expect(rows.map((r) => r.razon)).toContain("DISTRIBUIDORA  ÁVILA S.A.");
    expect(rows[0].match_reason).toBe("razon_similar");
  });

  it("no advierte por un nombre que no se parece a nada", async () => {
    const rows = await comoUsuario(DUPLICADOR, async () => (await db.query(
      "select 1 from public.clients_duplicate_candidates($1,$2)",
      ["Zzz Qqq Xxx Sociedad Anonima", null],
    )).rows);
    expect(rows).toHaveLength(0);
  });
});

describe("T-CLI-A1-01 · invariantes del registro maestro", () => {
  it("la base valida el dígito verificador y rechaza un CUIT inválido", async () => {
    const { rows } = await db.query<{ valido: boolean; invalido: boolean }>(
      `select public.cuit_is_valid('30-71234567-1') as valido,
              public.cuit_is_valid('30-71234567-8') as invalido`,
    );
    expect(rows[0]).toEqual({ valido: true, invalido: false });

    await expect(
      db.query("insert into public.clients (razon,cuit) values ('CUIT inválido','30-71234567-8')"),
    ).rejects.toThrow(/clients_cuit_checksum_ck/);
  });

  it("la unicidad canónica impide duplicar el mismo CUIT con otro formato", async () => {
    await expect(
      db.query("insert into public.clients (razon,cuit) values ('Duplicada','30712345671')"),
    ).rejects.toThrow(/clients_cuit_digits_uk/);
  });

  it("el código es único sin distinguir mayúsculas", async () => {
    let fallo: string | null = null;
    try {
      await db.query(
        "insert into public.clients (razon, cuit, codigo) values ('Otra SA','30-99999999-5','avl')",
      );
    } catch (e) {
      fallo = e instanceof Error ? e.message : String(e);
    }
    expect(fallo).toMatch(/clients_codigo_uk/);
  });

  it("el registro maestro NO tiene estado de sincronización externa", async () => {
    // Clientify quedó fuera del registro maestro por decisión de Dirección:
    // ninguna columna de sincronización sobrevive. Su presencia volvería a
    // abrir la puerta a estados parciales y a falsos éxitos.
    const { rows } = await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_schema='public' and table_name='clients'
          and column_name like 'sync%'`,
    );
    expect(rows).toEqual([]);
  });

  it("el registro maestro NO tiene columnas de procedencia externa", async () => {
    // Se evaluaron `external_source` / `external_id` y se retiraron: no
    // existían en producción, no tenían datos, no tenían consumidores y no
    // cumplían función nativa. Introducirlas habría sido dejar columnas e
    // índices muertos. Esta aserción impide reintroducirlas por inercia.
    const { rows } = await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_schema='public' and table_name='clients'
          and (column_name like 'external%' or column_name like '%clientify%')`,
    );
    expect(rows).toEqual([]);
  });

  it("0241 NO duplica el trigger de updated_at que ya existe desde 0004", async () => {
    const { rows } = await db.query<{ trigger_name: string }>(
      `select trigger_name from information_schema.triggers
        where event_object_schema='public' and event_object_table='clients'
          and action_timing='BEFORE' and event_manipulation='UPDATE'
        order by trigger_name`,
    );
    const nombres = rows.map((r) => r.trigger_name);
    expect(nombres).toContain("clients_touch_updated_at"); // el de 0004
    expect(nombres).toContain("clients_stamp_update_trg"); // el de 0241
    // Y el de 0241 NO toca updated_at: esa responsabilidad tiene un solo dueño.
    const src = await db.query<{ prosrc: string }>(
      "select prosrc from pg_proc where proname = 'clients_stamp_update'",
    );
    expect(src.rows[0].prosrc).not.toMatch(/updated_at/);
    expect(src.rows[0].prosrc).toMatch(/updated_by/);
  });

  it("la auditoría NO sabe nombrar la sincronización: el CHECK es la frontera", async () => {
    // Una versión anterior de la tabla admitía los tipos `sync_attempt` y
    // `sync_conflict` y el origen `sync`, heredados del diseño en que Clientify
    // participaba del maestro. Un esquema que sabe nombrar la sincronización
    // invita a reintroducirla, y un revisor no puede distinguir el residuo de
    // la intención. Se comprueba EJECUTANDO, no leyendo el DDL.
    const { rows: cli } = await db.query<{ id: string }>("select id from public.clients limit 1");
    for (const [col, valor] of [
      ["kind", "sync_attempt"],
      ["kind", "sync_conflict"],
      ["origin", "sync"],
    ] as const) {
      let msg: string | null = null;
      await db.query("begin");
      try {
        await db.query(
          col === "kind"
            ? "insert into public.client_events (client_id, kind) values ($1, $2)"
            : "insert into public.client_events (client_id, kind, origin) values ($1, 'updated', $2)",
          [cli[0].id, valor],
        );
      } catch (e) {
        msg = e instanceof Error ? e.message : String(e);
      }
      await db.query("rollback");
      expect(msg, `${col} = ${valor} debería ser rechazado`).toMatch(/check constraint|violates/i);
    }
  });

  it("los actos nativos SIGUEN siendo admitidos", async () => {
    // La contracara: endurecer el CHECK no puede haber cerrado el vocabulario
    // legítimo. Sin esta prueba, un CHECK de más rompería la auditoría entera
    // y la prueba anterior seguiría verde.
    const { rows: cli } = await db.query<{ id: string }>("select id from public.clients limit 1");
    for (const kind of ["created", "updated", "activated", "deactivated"]) {
      await db.query("begin");
      await db.query("insert into public.client_events (client_id, kind) values ($1, $2)", [
        cli[0].id,
        kind,
      ]);
      await db.query("rollback");
    }
  });
});

describe("T-CLI-A1-01 · frontera de seguridad de client_events", () => {
  beforeAll(async () => {
    await db.query("insert into auth.users (id) values ($1),($2),($3),($4)", [
      INTERNO,
      CLIENTE_A,
      CLIENTE_B,
      AUDITOR,
    ]);
    const { rows } = await db.query<{ id: string; razon: string }>(
      "select id, razon from public.clients where codigo in ('AVL','FDP') order by codigo",
    );
    const avl = rows[0].id;
    const fdp = rows[1].id;
    await db.query(
      `insert into public.profiles (id, role, client_id) values
         ($1,'operaciones',null), ($2,'cliente',$5), ($3,'cliente',$6),
         ($4,'admin',null)`,
      [INTERNO, CLIENTE_A, CLIENTE_B, AUDITOR, avl, fdp],
    );
    await db.query(
      `insert into public.user_roles(user_id,role_id)
       select $1,id from public.roles where slug='admin'`,
      [AUDITOR],
    );
    await db.query(`
      insert into public.role_permissions(role_id,permission_id)
      select r.id,p.id from public.roles r cross join public.permissions p
       where r.slug='admin' and p.slug in ('clientes.view','clientes.create')
      on conflict do nothing
    `);
    // Dos eventos, uno por cliente. Se insertan con el observador interno
    // para que el trigger de sello registre un actor real.
    await db.query("select set_config('test.observer', $1, false)", [INTERNO]);
    await db.query(
      "insert into public.client_events (client_id, kind, after) values ($1,'created','{\"x\":1}'::jsonb)",
      [avl],
    );
    await db.query(
      "insert into public.client_events (client_id, kind, after) values ($1,'created','{\"y\":2}'::jsonb)",
      [fdp],
    );
    await db.query("select set_config('test.observer', '', false)");
  });

  it("un usuario de portal no ve la auditoría aunque sea de su cliente", async () => {
    const propios = await comoUsuario(CLIENTE_A, async () => {
      const { rows } = await db.query<{ n: string }>(
        "select count(*)::text as n from public.client_events",
      );
      return Number(rows[0].n);
    });
    expect(propios).toBe(0);
  });

  it("un usuario de portal NO ve los eventos de otro cliente", async () => {
    const ajenos = await comoUsuario(CLIENTE_A, async () => {
      const { rows } = await db.query<{ n: string }>(
        `select count(*)::text as n from public.client_events e
          where e.after ? 'y'`,
      );
      return Number(rows[0].n);
    });
    expect(ajenos).toBe(0);
  });

  it("un interno legacy sin clientes.view no ve la auditoría", async () => {
    const total = await comoUsuario(INTERNO, async () => {
      const { rows } = await db.query<{ n: string }>(
        "select count(*)::text as n from public.client_events",
      );
      return Number(rows[0].n);
    });
    expect(total).toBe(0);
  });

  it("un usuario con clientes.view ve la auditoría completa", async () => {
    const total = await comoUsuario(AUDITOR, async () => {
      const { rows } = await db.query<{ n: string }>(
        "select count(*)::text as n from public.client_events",
      );
      return Number(rows[0].n);
    });
    expect(total).toBe(2);
  });

  // La escritura NO ocurre. Concurren dos barreras y se mide el EFECTO, no el
  // mecanismo: 0241 concede a `authenticated` sólo select+insert, y la RLS
  // tampoco tiene policy de UPDATE ni DELETE.
  it("UPDATE está denegado bajo un rol sin bypass", async () => {
    let fallo: string | null = null;
    await comoUsuario(INTERNO, async () => {
      try {
        await db.query("update public.client_events set motivo = 'adulterado'");
      } catch (e) {
        fallo = e instanceof Error ? e.message : String(e);
      }
    });
    expect(fallo).toMatch(/permission denied|row-level security/i);
  });

  it("DELETE está denegado bajo un rol sin bypass", async () => {
    let fallo: string | null = null;
    await comoUsuario(INTERNO, async () => {
      try {
        await db.query("delete from public.client_events");
      } catch (e) {
        fallo = e instanceof Error ? e.message : String(e);
      }
    });
    expect(fallo).toMatch(/permission denied|row-level security/i);
  });

  // El sustrato reproduce el bootstrap de Supabase (`alter default privileges
  // ... grant all on tables to anon, authenticated, service_role`), así que
  // estas tres aserciones miden que el REVOKE de 0241 efectivamente recuperó
  // los privilegios que la tabla habría heredado. Sin ese bootstrap en el
  // cierre, pasarían por vacuidad.
  it("authenticated queda exactamente con select+insert", async () => {
    const { rows } = await db.query<{ privilege_type: string }>(
      `select privilege_type from information_schema.role_table_grants
        where table_schema='public' and table_name='client_events' and grantee='authenticated'
        order by privilege_type`,
    );
    expect(rows.map((r) => r.privilege_type)).toEqual(["INSERT", "SELECT"]);
  });

  it("service_role queda con SELECT y NADA de escritura", async () => {
    // Es el punto que la revisión C4 2/2 marcó como bloqueante: sin revocarle,
    // el bootstrap le da ALL y podría adulterar o borrar la auditoría.
    const { rows } = await db.query<{ privilege_type: string }>(
      `select privilege_type from information_schema.role_table_grants
        where table_schema='public' and table_name='client_events' and grantee='service_role'
        order by privilege_type`,
    );
    expect(rows.map((r) => r.privilege_type)).toEqual(["SELECT"]);
  });

  it("anon no conserva ningún privilegio sobre la auditoría", async () => {
    const { rows } = await db.query(
      `select 1 from information_schema.role_table_grants
        where table_schema='public' and table_name='client_events' and grantee='anon'`,
    );
    expect(rows).toHaveLength(0);
  });

  it("la tabla lleva ENABLE y deliberadamente NO lleva FORCE", async () => {
    // FORCE sujetaría al DUEÑO de la tabla a las policies, y una RPC SECURITY
    // DEFINER corre como su dueño: la única policy de INSERT es
    // `to authenticated`, rol que el dueño no es, así que la escritura sólo
    // funcionaría si el dueño tuviera BYPASSRLS. Depender de un atributo del
    // rol que aplica las migraciones es una precondición no declarada, y con
    // ella la vía legítima de escritura se rompía en producción.
    //
    // La contención no viene de la RLS sino del PRIVILEGIO: 0242 deja la tabla
    // sin INSERT para nadie y la única vía es la RPC.
    const { rows } = await db.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `select relrowsecurity, relforcerowsecurity from pg_class
        where oid = 'public.client_events'::regclass`,
    );
    expect(rows[0].relrowsecurity).toBe(true);
    expect(rows[0].relforcerowsecurity).toBe(false);
  });

  it("la atribución NO se puede forjar: el trigger la sella", async () => {
    const { rows } = await db.query<{ id: string }>("select id from public.clients limit 1");
    const forjado = await comoUsuario(AUDITOR, async () => {
      await db.query(
        `insert into public.client_events (client_id, kind, actor, actor_email, motivo)
         values ($1,'updated',$2,'otra.persona@ejemplo.test','lo hizo otro')`,
        [rows[0].id, CLIENTE_B],
      );
      const { rows: r } = await db.query<{ actor: string | null; actor_email: string | null }>(
        "select actor, actor_email from public.client_events order by ts desc limit 1",
      );
      return r[0];
    });
    // El actor declarado por el cliente se descarta: queda el observador real.
    expect(forjado.actor).toBe(AUDITOR);
    expect(forjado.actor_email).not.toBe("otra.persona@ejemplo.test");
  });

  it("un usuario de portal no puede insertar auditoría", async () => {
    const { rows } = await db.query<{ id: string }>("select id from public.clients limit 1");
    let fallo: string | null = null;
    await comoUsuario(CLIENTE_A, async () => {
      try {
        await db.query(
          "insert into public.client_events (client_id, kind) values ($1,'updated')",
          [rows[0].id],
        );
      } catch (e) {
        fallo = e instanceof Error ? e.message : String(e);
      }
    });
    expect(fallo).toMatch(/row-level security/i);
  });
});

describe("T-CLI-A1-01 · referencias mínimas por capacidad", () => {
  it("OS/WMS operan sin clientes.view y no reciben PII fuera de su scope", async () => {
    await db.query(`
      insert into public.roles(slug,name)
      values ('operaciones','Operaciones')
      on conflict (slug) do nothing
    `);
    await db.query(`
      insert into public.permissions(slug,module,action,label) values
        ('servicios.create','servicios','create','Crear OS'),
        ('servicios.sign','servicios','sign','Firmar OS'),
        ('wms.edit','wms','edit','Operar WMS')
      on conflict (slug) do nothing
    `);
    await db.query(`
      insert into public.user_roles(user_id,role_id)
      select $1,id from public.roles where slug='operaciones'
      on conflict do nothing
    `, [INTERNO]);
    await db.query(`
      insert into public.role_permissions(role_id,permission_id)
      select r.id,p.id from public.roles r cross join public.permissions p
       where r.slug='operaciones'
         and p.slug in ('servicios.create','servicios.sign','wms.edit')
      on conflict do nothing
    `);

    const osRows = await comoUsuario(INTERNO, async () => {
      const { rows } = await db.query<Record<string, unknown>>(
        "select to_jsonb(x) row from public.clients_service_order_candidates('create') x limit 1",
      );
      return rows;
    });
    expect(osRows).toHaveLength(1);
    expect(Object.keys(osRows[0].row as Record<string, unknown>).sort()).toEqual(
      ["activo", "cuit", "id", "razon", "tags"],
    );

    const wmsRows = await comoUsuario(INTERNO, async () => {
      const { rows } = await db.query<Record<string, unknown>>(
        "select to_jsonb(x) row from public.clients_active_refs('wms') x limit 1",
      );
      return rows;
    });
    expect(Object.keys(wmsRows[0].row as Record<string, unknown>).sort()).toEqual(["id", "razon"]);

    let crossScope: string | null = null;
    await comoUsuario(INTERNO, async () => {
      try {
        await db.query("select * from public.clients_active_refs('pedidos')");
      } catch (error) {
        crossScope = error instanceof Error ? error.message : String(error);
      }
    });
    expect(crossScope).toMatch(/CLIENT_REFS_DENEGADO/i);

    const auditCount = await comoUsuario(INTERNO, async () => {
      const { rows } = await db.query<{ n: string }>(
        "select count(*)::text n from public.client_events",
      );
      return Number(rows[0].n);
    });
    expect(auditCount).toBe(0);
  });
});
