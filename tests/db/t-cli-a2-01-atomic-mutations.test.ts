/**
 * T-CLI-A2-01 · NEXUS-CLIENTES-ORDENES-PRECIOS-USUARIOS-001 · Carril A.
 *
 * Ensayo de 0242 —mutación de cliente y auditoría como UNA unidad atómica—
 * contra PostgreSQL REAL.
 *
 * ─── QUÉ DEMUESTRA, Y POR QUÉ ESTA SUITE EXISTE ────────────────────────────
 *
 * El dictamen C4 encontró que 0241 revocó toda escritura de `client_events` a
 * `service_role` mientras la aplicación seguía insertando el evento con
 * `service_role`. Cada mutación producía `permission denied`, el error se
 * tragaba en `console.error` y la UI devolvía éxito: la auditoría quedaba
 * vacía para siempre, en silencio. Y `updated_by` no se sellaba nunca, porque
 * el JWT de `service_role` no lleva `sub` y `auth.uid()` era NULL.
 *
 * Acá no se afirma que 0242 lo cierra: se MIDE. En particular se mide lo que
 * es fácil de dar por sentado —que si la auditoría falla, la mutación se va
 * con ella— forzando el fallo del evento y comprobando que el cliente NO
 * quedó escrito.
 *
 * El SQL bajo prueba es el REAL, leído de disco.
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
const M0242 = resolve(DIR, "0242_clients_atomic_mutations.sql");
const R0242 = resolve(DIR, "ROLLBACK_0242_clients_atomic_mutations.sql");

/** Identidades fijas. Nada se infiere. */
const ADMIN = "11111111-1111-4111-8111-111111111111"; // perfil supervisor + capacidades
const MIRON = "22222222-2222-4222-8222-222222222222"; // autenticado, sin permisos
const OPERARIO = "33333333-3333-4333-8333-333333333333"; // sólo wms.clients.create
const WMS_REF = "55555555-5555-4555-8555-555555555555"; // sólo wms.edit
const OS_REF = "66666666-6666-4666-8666-666666666666"; // sólo servicios.create+sign
const NO_PROFILE = "77777777-7777-4777-8777-777777777777";
const NO_PROFILE_WITH_GRANTS = "88888888-8888-4888-8888-888888888888";
const WRONG_ROLE = "99999999-9999-4999-8999-999999999999";

let sb: WaSandbox;
let db: Client;

/** Ejecuta como observador dado y con rol `authenticated`, en tx revertida. */
async function como<T>(uid: string | null, fn: () => Promise<T>): Promise<T> {
  return comoRol(uid, "authenticated", fn);
}

async function comoRol<T>(
  uid: string | null,
  role: "authenticated" | "anon",
  fn: () => Promise<T>,
): Promise<T> {
  await db.query("begin");
  await db.query("select set_config('test.observer', $1, true)", [uid ?? ""]);
  await db.query(`set local role ${role}`);
  try {
    return await fn();
  } finally {
    await db.query("rollback");
  }
}

/**
 * Captura el mensaje de error de una sentencia, o null si no falló.
 *
 * Va envuelta en un SAVEPOINT: en PostgreSQL, un error deja la transacción
 * abortada y toda sentencia posterior se ignora hasta el fin del bloque. Sin
 * el savepoint, el primer `fallo()` esperado envenenaría el resto del caso y
 * los errores siguientes serían «current transaction is aborted» en vez del
 * error que se quiere medir.
 */
let sp = 0;
async function fallo(sql: string, params: unknown[] = []): Promise<string | null> {
  const nombre = `sp_${++sp}`;
  await db.query(`savepoint ${nombre}`);
  try {
    await db.query(sql, params);
    await db.query(`release savepoint ${nombre}`);
    return null;
  } catch (e) {
    await db.query(`rollback to savepoint ${nombre}`);
    return e instanceof Error ? e.message : String(e);
  }
}

async function clientVersion(id: string, client: Client = db): Promise<string> {
  const { rows } = await client.query<{ updated_at: string }>(
    "select updated_at::text from public.clients where id=$1",
    [id],
  );
  if (!rows[0]?.updated_at) throw new Error("CLIENT_VERSION_NOT_FOUND");
  return rows[0].updated_at;
}

async function clientStateDigest(): Promise<{ clients: string; events: string }> {
  const { rows } = await db.query<{ clients: string; events: string }>(`
    select
      md5(coalesce((select string_agg(to_jsonb(c)::text, '|' order by c.id::text)
                      from public.clients c), '')) clients,
      md5(coalesce((select string_agg(to_jsonb(e)::text, '|' order by e.id::text)
                      from public.client_events e), '')) events
  `);
  return rows[0];
}

beforeAll(async () => {
  sb = await createWaSandbox(inject("dbUrl"));
  db = sb.client;
  await db.query(CIERRE_ACOTADO);
  await db.query(readFileSync(M0240, "utf8"));
  await db.query(readFileSync(M0241, "utf8"));
  await db.query(readFileSync(M0242, "utf8"));

  await db.query("insert into auth.users (id) values ($1),($2),($3),($4),($5),($6),($7),($8)", [
    ADMIN, MIRON, OPERARIO, WMS_REF, OS_REF, NO_PROFILE, NO_PROFILE_WITH_GRANTS, WRONG_ROLE,
  ]);
  await db.query(
    `insert into public.profiles (id, role) values
       ($1,'supervisor'),($2,'operaciones'),($3,'operaciones'),
       ($4,'operaciones'),($5,'operaciones'),($6,'operaciones')`,
    [ADMIN, MIRON, OPERARIO, WMS_REF, OS_REF, WRONG_ROLE],
  );
  await db.query(
    `insert into public.roles (slug, name) values
       ('admin_clientes','Admin'),('operario_wms','Operario'),
       ('wms_refs','Referencias WMS'),('os_refs','Referencias OS'),
       ('empty_role','Rol sin permisos')`,
  );
  // admin_clientes: las cuatro capacidades del módulo. operario_wms: SÓLO el
  // alta desde el flujo operativo — no el módulo general de Clientes.
  await db.query(`
    insert into public.role_permissions (role_id, permission_id)
    select r.id, p.id from public.roles r, public.permissions p
     where r.slug='admin_clientes' and p.module='clientes';
    insert into public.role_permissions (role_id, permission_id)
    select r.id, p.id from public.roles r, public.permissions p
     where r.slug='operario_wms' and p.slug='wms.clients.create';
  `);
  // Una sentencia por llamada: pg no admite múltiples comandos con parámetros.
  await db.query(
    "insert into public.user_roles (user_id, role_id) select $1, id from public.roles where slug='admin_clientes'",
    [ADMIN],
  );
  await db.query(
    "insert into public.user_roles (user_id, role_id) select $1, id from public.roles where slug='operario_wms'",
    [OPERARIO],
  );
  await db.query(
    "insert into public.user_roles (user_id, role_id) select $1, id from public.roles where slug='admin_clientes'",
    [NO_PROFILE_WITH_GRANTS],
  );
  await db.query(
    "insert into public.user_roles (user_id, role_id) select $1, id from public.roles where slug='empty_role'",
    [WRONG_ROLE],
  );
  await db.query(`
    insert into public.permissions (slug,module,action,label) values
      ('wms.edit','wms','edit','Operar WMS'),
      ('servicios.create','servicios','create','Crear OS'),
      ('servicios.sign','servicios','sign','Firmar OS');
    insert into public.role_permissions(role_id,permission_id)
    select r.id,p.id from public.roles r join public.permissions p on
      (r.slug='wms_refs' and p.slug='wms.edit')
      or (r.slug='os_refs' and p.slug in ('servicios.create','servicios.sign'));
  `);
  await db.query(
    "insert into public.user_roles (user_id,role_id) select $1,id from public.roles where slug='wms_refs'",
    [WMS_REF],
  );
  await db.query(
    "insert into public.user_roles (user_id,role_id) select $1,id from public.roles where slug='os_refs'",
    [OS_REF],
  );
}, 120_000);

afterAll(async () => {
  await sb?.destroy();
});

describe("T-CLI-A2-01 · nadie escribe la auditoría directamente", () => {
  it("authenticated ya no tiene INSERT sobre client_events", async () => {
    const { rows } = await db.query<{ privilege_type: string }>(
      `select privilege_type from information_schema.role_table_grants
        where table_schema='public' and table_name='client_events' and grantee='authenticated'
        order by privilege_type`,
    );
    // 0241 le había dado select+insert; 0242 le quita el insert.
    expect(rows.map((r) => r.privilege_type)).toEqual(["SELECT"]);
  });

  it("service_role tampoco: sigue con SELECT y nada más", async () => {
    const { rows } = await db.query<{ privilege_type: string }>(
      `select privilege_type from information_schema.role_table_grants
        where table_schema='public' and table_name='client_events' and grantee='service_role'
        order by privilege_type`,
    );
    expect(rows.map((r) => r.privilege_type)).toEqual(["SELECT"]);
  });

  it.each(["anon", "authenticated", "service_role"])(
    "%s no puede mutar ni truncar el registro maestro por fuera de las RPC",
    async (role) => {
      const { rows } = await db.query<{ can_insert: boolean; can_update: boolean; can_delete: boolean; can_truncate: boolean }>(
        `select
           has_table_privilege($1, 'public.clients', 'insert') can_insert,
           has_table_privilege($1, 'public.clients', 'update') can_update,
           has_table_privilege($1, 'public.clients', 'delete') can_delete,
           has_table_privilege($1, 'public.clients', 'truncate') can_truncate`,
        [role],
      );
      expect(rows[0]).toEqual({
        can_insert: false,
        can_update: false,
        can_delete: false,
        can_truncate: false,
      });
    },
  );
});

describe("T-CLI-A2-01 · referencias mínimas con capacidad explícita", () => {
  it("WMS y OS acceden sólo por su RPC; MIRON no obtiene maestro ni auditoría", async () => {
    const client = await db.query<{ id: string }>(
      `insert into public.clients(razon,cuit,activo)
       values ('Selector autorizado SA','30-70000010-5',true) returning id`,
    );
    try {
      await como(WMS_REF, async () => {
        const refs = await db.query<{ id: string; razon: string }>(
          "select * from public.clients_active_refs('wms')",
        );
        expect(refs.rows).toEqual([{ id: client.rows[0].id, razon: "Selector autorizado SA" }]);
        expect(await fallo("select * from public.clients_active_refs('pedidos')")).toMatch(/CLIENT_REFS_DENEGADO/);
      });
      await como(OS_REF, async () => {
        const refs = await db.query<{ id: string; razon: string; cuit: string }>(
          "select id,razon,cuit from public.clients_service_order_candidates('create')",
        );
        expect(refs.rows).toEqual([{
          id: client.rows[0].id,
          razon: "Selector autorizado SA",
          cuit: "30-70000010-5",
        }]);
        expect((await db.query("select 1 from public.clients")).rowCount).toBe(0);
      });
      await como(MIRON, async () => {
        expect(await fallo("select * from public.clients_active_refs('wms')")).toMatch(/CLIENT_REFS_DENEGADO/);
        expect(await fallo("select * from public.clients_service_order_candidates('create')")).toMatch(/OS_CLIENTS_DENEGADO/);
        expect((await db.query("select 1 from public.client_events")).rowCount).toBe(0);
      });
    } finally {
      await db.query("delete from public.clients where id=$1", [client.rows[0].id]);
    }
  });
});

describe("T-CLI-A2-01 · identidad incompleta y booleanos NULL fallan cerrados", () => {
  const calls: Array<{ name: string; sql: string; params: unknown[] }> = [
    {
      name: "client_create",
      sql: "select public.client_create($1,$2)",
      params: ["Denegada por identidad SA", "30-70000011-3"],
    },
    {
      name: "client_update",
      sql: "select public.client_update(p_id=>$1,p_contacto=>'No debe persistir',p_motivo=>'prueba de frontera')",
      params: ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"],
    },
    {
      name: "client_set_active",
      sql: "select public.client_set_active($1,false,'prueba de frontera')",
      params: ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"],
    },
  ];

  it("deniega cada RPC antes de efectos para NULL, sin perfil, sin rol, rol vacío y anon", async () => {
    const before = await clientStateDigest();

    const helperNull = await como(NO_PROFILE, async () => (
      await db.query<{ allowed: boolean | null }>(
        "select public.has_permission('fasea.permission.inexistente') allowed",
      )
    ).rows[0].allowed);
    const helperFalse = await como(MIRON, async () => (
      await db.query<{ allowed: boolean | null }>(
        "select public.has_permission('fasea.permission.inexistente') allowed",
      )
    ).rows[0].allowed);
    const helperTrue = await como(ADMIN, async () => (
      await db.query<{ can_create: boolean; can_edit: boolean; can_deactivate: boolean }>(`
        select public.has_permission('clientes.create') can_create,
               public.has_permission('clientes.edit') can_edit,
               public.has_permission('clientes.delete') can_deactivate
      `)
    ).rows[0]);
    expect(helperNull).toBeNull();
    expect(helperFalse).toBe(false);
    expect(helperTrue).toEqual({ can_create: true, can_edit: true, can_deactivate: true });

    for (const rpc of calls) {
      for (const [uid, expected] of [
        [null, /CLIENT_SIN_IDENTIDAD/],
        [NO_PROFILE, /CLIENT_SIN_PERFIL_ACTIVO/],
        [NO_PROFILE_WITH_GRANTS, /CLIENT_SIN_PERFIL_ACTIVO/],
        [MIRON, /CLIENT_DENEGADO/],
        [WRONG_ROLE, /CLIENT_DENEGADO/],
      ] as const) {
        const denied = await como(uid, () => fallo(rpc.sql, rpc.params));
        expect(denied, `${rpc.name}:${uid ?? "NULL"}`).toMatch(expected);
      }
      const anonDenied = await comoRol(ADMIN, "anon", () => fallo(rpc.sql, rpc.params));
      expect(anonDenied, `${rpc.name}:anon`).toMatch(/permission denied/i);
    }

    expect(await clientStateDigest()).toEqual(before);
  });
});

describe("T-CLI-A2-01 · alta atómica", () => {
  it("crea el cliente Y su evento en la misma operación", async () => {
    await como(ADMIN, async () => {
      const { rows } = await db.query<{ id: string; razon: string; updated_by: string }>(
        "select id, razon, updated_by from public.client_create($1,$2)",
        ["Atómica SA", "30-70000010-5"],
      );
      expect(rows[0].razon).toBe("Atómica SA");
      // D-2: el actor real queda sellado, no NULL.
      expect(rows[0].updated_by).toBe(ADMIN);

      const ev = await db.query<{ kind: string; actor: string }>(
        "select kind, actor from public.client_events where client_id = $1",
        [rows[0].id],
      );
      expect(ev.rows).toHaveLength(1);
      expect(ev.rows[0].kind).toBe("created");
      expect(ev.rows[0].actor).toBe(ADMIN);
    });
  });

  it("el actor NO es parámetro: no se puede escribir a nombre de otro", async () => {
    // La firma de client_create no admite ningún argumento de actor. Se
    // comprueba contra el catálogo, no por inspección del texto.
    //
    // ─── POR QUÉ NO ALCANZA CON PROHIBIR `uuid` A SECAS ────────────────────
    //
    // Una versión anterior de esta prueba exigía que la firma no contuviera la
    // subcadena `uuid`. Funcionaba por coincidencia —no había ningún parámetro
    // uuid— y por eso no distinguía entre un `p_actor uuid`, que sería el
    // defecto real, y un `uuid[]` de datos que no designa a nadie. Al aparecer
    // `p_duplicados_advertidos uuid[]` la prueba habría fallado sobre un
    // parámetro inocuo, y el reflejo fácil habría sido borrar la aserción.
    //
    // Se reescribe para nombrar el invariante en lugar de la coincidencia, y
    // queda MÁS estricta que antes: además de vetar los nombres que podrían
    // designar a una persona y todo uuid ESCALAR, ahora exige positivamente que
    // el actor se derive de `auth.uid()` y que ningún parámetro lo alimente.
    const { rows } = await db.query<{ args: string; def: string }>(
      `select pg_get_function_identity_arguments(p.oid) as args,
              pg_get_functiondef(p.oid)                 as def
         from pg_proc p join pg_namespace n on n.oid=p.pronamespace
        where n.nspname='public' and p.proname='client_create'`,
    );
    const args = rows[0].args;

    // 1 · Ningún parámetro puede NOMBRAR a una persona.
    expect(args).not.toMatch(/actor|usuario|\buser\b|\buid\b|created_by|updated_by/i);

    // 2 · Ningún parámetro puede ser un uuid ESCALAR. Un uuid[] es un conjunto
    //     de referencias a filas, no una identidad con la que actuar.
    const escalarUuid = args
      .split(",")
      .map((s) => s.trim())
      .filter((s) => /\buuid\b/i.test(s) && !/uuid\s*\[\s*\]/i.test(s));
    expect(escalarUuid).toEqual([]);

    // 3 · Y positivamente: el actor sale del JWT, no de la llamada.
    expect(rows[0].def).toMatch(/v_actor\s+uuid\s*:=\s*auth\.uid\(\)/);
    expect(rows[0].def).not.toMatch(/v_actor\s*:=\s*p_/);
  });

  it("sin identidad no se opera", async () => {
    const msg = await como(null, () =>
      fallo("select public.client_create($1,$2)", ["Sin Actor SA", "30-70000011-3"]),
    );
    expect(msg).toMatch(/CLIENT_SIN_IDENTIDAD/);
  });

  it("un autenticado sin permiso es rechazado", async () => {
    const msg = await como(MIRON, () =>
      fallo("select public.client_create($1,$2)", ["Sin Permiso SA", "30-70000012-1"]),
    );
    expect(msg).toMatch(/CLIENT_DENEGADO/);
    expect(msg).toMatch(/clientes\.create/);
  });

  it("una llamada DIRECTA fuera de la UI está igual de controlada", async () => {
    // Es la misma vía que usaría PostgREST: la autorización vive dentro de la
    // función, no en la capa de aplicación.
    const msg = await como(MIRON, () =>
      fallo("select * from public.client_create($1,$2)", ["Bypass SA", "30-70000013-9"]),
    );
    expect(msg).toMatch(/CLIENT_DENEGADO/);
  });

  it("una llamada directa no puede inventar un origen externo", async () => {
    const msg = await como(ADMIN, () =>
      fallo(
        "select public.client_create(p_razon=>$1,p_cuit=>$2,p_origen=>'externo')",
        ["Origen falso SA", "30-70000044-9"],
      ),
    );
    expect(msg).toMatch(/CLIENT_ORIGEN_INVALIDO/);
  });

  it("el alta desde WMS exige wms.clients.create, no clientes.create", async () => {
    await db.query(
      "insert into public.clients(razon,cuit) values ('Duplicada Global WMS SA','30-70000044-9')",
    );
    await como(OPERARIO, async () => {
      const { rows: duplicates } = await db.query<{ razon: string }>(
        "select razon from public.clients_duplicate_candidates($1,null)",
        ["Duplicada Global WMS SA"],
      );
      expect(duplicates.map((row) => row.razon)).toContain("Duplicada Global WMS SA");

      // Con origen 'wms' pasa: tiene esa capacidad exacta.
      const { rows } = await db.query<{ razon: string }>(
        "select razon from public.client_create($1,$2,null,null,null,null,null,'{}','RESPONSABLE_INSCRIPTO',null,'wms')",
        ["Alta Desde Deposito SA", "30-70000014-8"],
      );
      expect(rows[0].razon).toBe("Alta Desde Deposito SA");
    });
    // Con origen por defecto NO pasa: no tiene el módulo general de Clientes.
    const msg = await como(OPERARIO, () =>
      fallo("select public.client_create($1,$2)", ["Otra SA", "30-70000015-6"]),
    );
    expect(msg).toMatch(/clientes\.create/);

    const unauthorized = await como(MIRON, () => fallo(
      "select 1 from public.clients_duplicate_candidates($1,null)",
      ["Duplicada Global WMS SA"],
    ));
    expect(unauthorized).toMatch(/CLIENT_DENEGADO/);
  });

  it("valida CUIT y razón social antes de escribir nada", async () => {
    await como(ADMIN, async () => {
      expect(await fallo("select public.client_create($1,$2)", ["X SA", "123"])).toMatch(
        /CLIENT_CUIT_INVALIDO/,
      );
      expect(
        await fallo("select public.client_create($1,$2)", ["Checksum inválido SA", "30-70000010-4"]),
      ).toMatch(/CLIENT_CUIT_INVALIDO/);
      expect(await fallo("select public.client_create($1,$2)", ["  ", "30-70000016-4"])).toMatch(
        /CLIENT_RAZON_VACIA/,
      );
    });
  });

  it("persiste depósito, domicilio, localidad y observaciones desde el alta nativa", async () => {
    await como(ADMIN, async () => {
      const { rows } = await db.query<{
        domicilio: string;
        localidad: string;
        deposito_asignado: string;
        observaciones: string;
      }>(`
        select domicilio, localidad, deposito_asignado::text, observaciones
          from public.client_create(
            p_razon => 'Completa SA',
            p_cuit => '30-70000043-1',
            p_domicilio => 'Magaldi 765',
            p_localidad => 'CABA',
            p_deposito_asignado => 'MAGALDI',
            p_observaciones => 'Ingreso coordinado'
          )
      `);
      expect(rows[0]).toEqual({
        domicilio: "Magaldi 765",
        localidad: "CABA",
        deposito_asignado: "MAGALDI",
        observaciones: "Ingreso coordinado",
      });
    });
  });
});

describe("T-CLI-A2-01 · ROLLBACK TOTAL si la auditoría falla", () => {
  /**
   * Estos casos NO usan `como()`.
   *
   * `como()` envuelve todo en `begin … rollback`, así que un `count = 0`
   * medido adentro sale de la reversión externa, no de la atomicidad de la
   * RPC. La revisión C4 lo refutó con un mutante que reproduce el antipatrón
   * de D-1 —inserta el cliente y se traga el fallo de auditoría— y que ASÍ
   * MEDIDO también daba cero. La aserción no discriminaba nada.
   *
   * Acá se usa una conexión propia en AUTOCOMMIT: cada sentencia termina de
   * verdad. Si la RPC no fuera atómica, el cliente quedaría escrito y visible
   * después del fallo, que es exactamente lo que se quiere poder ver.
   */
  let solo: Client;

  beforeAll(async () => {
    solo = await sb.connect();
    await solo.query("set role authenticated");
    await solo.query("select set_config('test.observer', $1, false)", [ADMIN]);
  });

  afterAll(async () => {
    await solo?.end().catch(() => {});
  });

  const contarCliente = async (cuit: string): Promise<number> => {
    const { rows } = await db.query<{ n: string }>(
      "select count(*)::text as n from public.clients where cuit = $1",
      [cuit],
    );
    return Number(rows[0].n);
  };

  const contarEventos = async (cuit: string): Promise<number> => {
    const { rows } = await db.query<{ n: string }>(
      `select count(*)::text as n from public.client_events e
         join public.clients c on c.id = e.client_id
        where c.cuit = $1`,
      [cuit],
    );
    return Number(rows[0].n);
  };

  const instalarFalloAuditoria = async () => {
    await db.query(`
      create or replace function public.forzar_fallo_auditoria() returns trigger
      language plpgsql as $fn$ begin raise exception 'AUDITORIA_CAIDA'; end $fn$;
    `);
    await db.query(`
      create trigger tg_forzar_fallo before insert on public.client_events
        for each row execute function public.forzar_fallo_auditoria();
    `);
  };

  const quitarFalloAuditoria = async () => {
    await db.query("drop trigger if exists tg_forzar_fallo on public.client_events");
    await db.query("drop function if exists public.forzar_fallo_auditoria()");
  };

  it("operación normal: quedan escritos el cliente Y su evento, ya committeados", async () => {
    await solo.query("select public.client_create($1,$2)", ["Committeada SA", "30-70000030-9"]);
    // Se lee desde OTRA conexión: sólo ve lo que está committeado.
    expect(await contarCliente("30700000309")).toBe(1);
    expect(await contarEventos("30700000309")).toBe(1);
  });

  it("fallo de auditoría: NO queda el cliente ni el evento, después del commit real", async () => {
    await instalarFalloAuditoria();
    let msg: string | null = null;
    try {
      await solo.query("select public.client_create($1,$2)", ["No Debe Quedar SA", "30-70000031-8"]);
    } catch (e) {
      msg = e instanceof Error ? e.message : String(e);
    }
    await quitarFalloAuditoria();

    expect(msg).toMatch(/AUDITORIA_CAIDA/);
    // Sin transacción externa que lo maquille: si la RPC no fuera atómica,
    // esto sería 1.
    expect(await contarCliente("30700000318")).toBe(0);
    expect(await contarEventos("30700000318")).toBe(0);
  });

  it("MUTANTE · el antipatrón de D-1 SÍ deja el cliente escrito, y el test lo ve", async () => {
    // Reproduce exactamente lo que hacía la aplicación antes de 0242: escribe
    // el cliente y se traga el fallo de la auditoría. Es el control que le da
    // fuerza discriminante al caso anterior: si el mutante también diera 0, la
    // medición no probaría nada.
    await db.query(`
      create or replace function public.client_create_mutante(p_razon text, p_cuit text)
      returns void language plpgsql security definer set search_path = public, pg_catalog as $fn$
      declare v_row public.clients;
      begin
        insert into public.clients (razon, cuit, created_by, updated_by)
        values (p_razon, regexp_replace(p_cuit,'\\D','','g'), auth.uid(), auth.uid())
        returning * into v_row;
        begin
          insert into public.client_events (client_id, kind, origin, after)
          values (v_row.id, 'created', 'manual', to_jsonb(v_row));
        exception when others then
          null; -- el "console.error" del antipatrón, en SQL
        end;
      end $fn$;
    `);
    await db.query("grant execute on function public.client_create_mutante(text, text) to authenticated");
    await instalarFalloAuditoria();

    // El mutante NO propaga: devuelve éxito con la auditoría caída.
    await expect(
      solo.query("select public.client_create_mutante($1,$2)", ["Mutante SA", "30-70000032-6"]),
    ).resolves.toBeDefined();

    await quitarFalloAuditoria();

    // Y deja el cliente escrito SIN su evento: el daño exacto de D-1.
    expect(await contarCliente("30700000326")).toBe(1);
    expect(await contarEventos("30700000326")).toBe(0);

    await db.query("drop function public.client_create_mutante(text, text)");
  });

  it("la RPC real y el mutante difieren: la medición discrimina", async () => {
    // Resumen explícito de los dos casos anteriores. Si algún día la RPC
    // dejara de ser atómica, este contraste se rompe.
    expect(await contarCliente("30700000318")).toBe(0); // RPC real: nada
    expect(await contarCliente("30700000326")).toBe(1); // antipatrón: basura
  });
});

describe("T-CLI-A2-01 · edición y activación", () => {
  let clienteId: string;

  beforeAll(async () => {
    await db.query("select set_config('test.observer', $1, false)", [ADMIN]);
    const { rows } = await db.query<{ id: string }>(
      "select id from public.client_create($1,$2)",
      ["Editable SA", "30-70000020-2"],
    );
    clienteId = rows[0].id;
    await db.query("select set_config('test.observer', '', false)");
  });

  it("un alta forzada pese a parecidos queda REGISTRADA como tal", async () => {
    // Que alguien haya creado un cliente ignorando una advertencia es
    // exactamente lo que hay que poder reconstruir después. Sin esto, la
    // auditoría no distingue un alta limpia de una forzada.
    await como(ADMIN, async () => {
      const { rows: creado } = await db.query<{ id: string }>(
        `select id from public.client_create($1,$2,null,null,null,null,null,'{}',
                 'RESPONSABLE_INSCRIPTO',null,'clientes',$3::uuid[])`,
        ["Forzada SA", "30-70000040-7", [clienteId]],
      );
      const { rows } = await db.query<{ motivo: string }>(
        "select motivo from public.client_events where client_id=$1 and kind='created'",
        [creado[0].id],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].motivo).toMatch(/confirmada pese a 1 parecido/i);
      expect(rows[0].motivo).toContain(clienteId);
    });
  });

  it("un alta sin advertencia NO inventa una confirmación en la auditoría", async () => {
    await como(ADMIN, async () => {
      const { rows: creado } = await db.query<{ id: string }>(
        "select id from public.client_create($1,$2)",
        ["Limpia SA", "30-70000041-5"],
      );
      const { rows } = await db.query<{ motivo: string }>(
        "select motivo from public.client_events where client_id=$1 and kind='created'",
        [creado[0].id],
      );
      expect(rows[0].motivo).toBe("alta desde clientes");
      expect(rows[0].motivo).not.toMatch(/pese a/i);
    });
  });

  it("editar registra before y after en la misma transacción", async () => {
    await como(ADMIN, async () => {
      await db.query(`select public.client_update(
        p_id=>$1,p_telefono=>$2,p_motivo=>$3,p_expected_updated_at=>$4::timestamptz
      )`, [
        clienteId,
        "11 5555-9999",
        "corrección de contacto",
        await clientVersion(clienteId),
      ]);
      const { rows } = await db.query<{ kind: string; motivo: string; before: Record<string, unknown> }>(
        "select kind, motivo, before from public.client_events where client_id=$1 and kind='updated'",
        [clienteId],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].motivo).toBe("corrección de contacto");
      expect(rows[0].before).toHaveProperty("razon", "Editable SA");
    });
  });

  it("edita todos los campos nativos admitidos y conserva una cadena before/after completa", async () => {
    await como(ADMIN, async () => {
      const { rows } = await db.query<{
        razon: string;
        domicilio: string;
        localidad: string;
        deposito_asignado: string;
        observaciones: string;
        tags: string[];
      }>(`
        select razon, domicilio, localidad, deposito_asignado::text, observaciones, tags
          from public.client_update(
            p_id => $1,
            p_razon => 'Editable Renovada SA',
            p_nombre_comercial => 'Editable',
            p_codigo => 'EDI-01',
            p_telefono => '11 4444-5555',
            p_contacto => 'Ana Operadora',
            p_email => 'ana@editable.test',
            p_motivo => 'actualización integral',
            p_domicilio => 'Ruta 5 km 67',
            p_localidad => 'Luján',
            p_deposito_asignado => 'LUJAN',
            p_observaciones => 'Operación refrigerada',
            p_tags => array['ANMAT','REFRIGERADO'],
            p_expected_updated_at => $2::timestamptz
          )
      `, [clienteId, await clientVersion(clienteId)]);
      expect(rows[0]).toEqual({
        razon: "Editable Renovada SA",
        domicilio: "Ruta 5 km 67",
        localidad: "Luján",
        deposito_asignado: "LUJAN",
        observaciones: "Operación refrigerada",
        tags: ["ANMAT", "REFRIGERADO"],
      });

      const { rows: events } = await db.query<{ before: Record<string, unknown>; after: Record<string, unknown> }>(
        "select before, after from public.client_events where client_id=$1 and kind='updated' order by id desc limit 1",
        [clienteId],
      );
      expect(events[0].before).toHaveProperty("razon", "Editable SA");
      expect(events[0].after).toMatchObject({
        razon: "Editable Renovada SA",
        deposito_asignado: "LUJAN",
        observaciones: "Operación refrigerada",
      });
    });
  });

  it("no se puede alterar updated_by desde afuera: lo sella el trigger", async () => {
    await como(ADMIN, async () => {
      // `updated_by` no es parámetro de client_update. Y aunque se intentara
      // un UPDATE directo, el trigger lo reescribe con auth.uid().
      const { rows } = await db.query<{ args: string }>(
        `select pg_get_function_identity_arguments(p.oid) as args
           from pg_proc p join pg_namespace n on n.oid=p.pronamespace
          where n.nspname='public' and p.proname='client_update'`,
      );
      expect(rows[0].args).not.toMatch(/updated_by/i);
    });
  });

  it("desactivar exige motivo y no borra la fila", async () => {
    await como(ADMIN, async () => {
      expect(
        await fallo("select public.client_set_active($1,false,$2)", [clienteId, "   "]),
      ).toMatch(/CLIENT_MOTIVO_REQUERIDO/);

      await db.query("select public.client_set_active($1,false,$2)", [clienteId, "cesó operación"]);
      const { rows } = await db.query<{ activo: boolean }>(
        "select activo from public.clients where id=$1",
        [clienteId],
      );
      expect(rows[0].activo).toBe(false);

      const ev = await db.query<{ kind: string; motivo: string }>(
        "select kind, motivo from public.client_events where client_id=$1 and kind='deactivated'",
        [clienteId],
      );
      expect(ev.rows[0].motivo).toBe("cesó operación");
    });
  });

  it("reactivar también deja su evento, con motivo", async () => {
    await como(ADMIN, async () => {
      await db.query("select public.client_set_active($1,false,$2)", [clienteId, "baja temporal"]);
      await db.query("select public.client_set_active($1,true,$2)", [clienteId, "volvió a operar"]);

      const { rows } = await db.query<{ activo: boolean }>(
        "select activo from public.clients where id=$1",
        [clienteId],
      );
      expect(rows[0].activo).toBe(true);

      const ev = await db.query<{ motivo: string }>(
        "select motivo from public.client_events where client_id=$1 and kind='activated'",
        [clienteId],
      );
      expect(ev.rows).toHaveLength(1);
      expect(ev.rows[0].motivo).toBe("volvió a operar");
    });
  });

  it("editar sella updated_by con el actor real, no con NULL", async () => {
    // Es D-2 medido sobre la EDICIÓN, no sólo sobre el alta: la fila la creó
    // ADMIN, así que sin el sello real este assert pasaría por coincidencia.
    // Se edita como un actor DISTINTO para que el valor tenga que cambiar.
    await db.query(
      "insert into public.user_roles (user_id, role_id) select $1, id from public.roles where slug='admin_clientes'",
      [MIRON],
    );
    await como(MIRON, async () => {
      await db.query(
        `select public.client_update(
          p_id=>$1,p_motivo=>$2,p_expected_updated_at=>$3::timestamptz
        )`,
        [clienteId, "editado por otro actor", await clientVersion(clienteId)],
      );
      const { rows } = await db.query<{ updated_by: string }>(
        "select updated_by from public.clients where id=$1",
        [clienteId],
      );
      expect(rows[0].updated_by).toBe(MIRON);
      expect(rows[0].updated_by).not.toBe(ADMIN);
    });
    await db.query("delete from public.user_roles where user_id=$1", [MIRON]);
  });

  it("TRIESTADO · un nulo NO vacía: conserva el valor anterior", async () => {
    await como(ADMIN, async () => {
      await db.query(
        `select public.client_update(
          p_id=>$1,p_cuenta_contable=>$2,p_motivo=>$3,
          p_expected_updated_at=>$4::timestamptz
        )`,
        [clienteId, "4.1.1.01", "imputación inicial", await clientVersion(clienteId)],
      );
      // Segunda edición SIN mandar la cuenta: no debe borrarla.
      await db.query(
        `select public.client_update(
          p_id=>$1,p_telefono=>$2,p_motivo=>$3,p_expected_updated_at=>$4::timestamptz
        )`,
        [clienteId, "11 5555-1234", "sólo teléfono", await clientVersion(clienteId)],
      );
      const { rows } = await db.query<{ cuenta_contable: string | null }>(
        "select cuenta_contable from public.clients where id=$1",
        [clienteId],
      );
      expect(rows[0].cuenta_contable).toBe("4.1.1.01");
    });
  });

  it("TRIESTADO · p_limpiar SÍ vacía, que es lo que el coalesce impedía", async () => {
    // El defecto: quitar una cuenta contable mal imputada devolvía éxito y la
    // cuenta seguía ahí, de modo que toda la facturación posterior seguía
    // imputando al lugar equivocado.
    await como(ADMIN, async () => {
      await db.query(
        `select public.client_update(
          p_id=>$1,p_cuenta_contable=>$2,p_motivo=>$3,
          p_expected_updated_at=>$4::timestamptz
        )`,
        [clienteId, "4.1.1.01", "imputación inicial", await clientVersion(clienteId)],
      );
      await db.query(
        `select public.client_update(
          p_id=>$1,p_motivo=>$2,p_limpiar=>$3,
          p_expected_updated_at=>$4::timestamptz
        )`,
        [clienteId, "se quita la imputación", ["cuenta_contable"], await clientVersion(clienteId)],
      );
      const { rows } = await db.query<{ cuenta_contable: string | null }>(
        "select cuenta_contable from public.clients where id=$1",
        [clienteId],
      );
      expect(rows[0].cuenta_contable).toBeNull();
    });
  });

  it("TRIESTADO · limpia también los opcionales operativos sin tocar los omitidos", async () => {
    await como(ADMIN, async () => {
      await db.query(`
        select public.client_update(
          p_id => $1,
          p_domicilio => 'Domicilio inicial',
          p_localidad => 'CABA',
          p_deposito_asignado => 'MAGALDI',
          p_observaciones => 'Con turno',
          p_tags => array['ANMAT'],
          p_motivo => 'preparación',
          p_expected_updated_at => $2::timestamptz
        )
      `, [clienteId, await clientVersion(clienteId)]);
      await db.query(`
        select public.client_update(
          p_id => $1,
          p_limpiar => array['domicilio','deposito_asignado','observaciones'],
          p_motivo => 'limpieza explícita',
          p_expected_updated_at => $2::timestamptz
        )
      `, [clienteId, await clientVersion(clienteId)]);
      const { rows } = await db.query<{
        domicilio: string | null;
        localidad: string | null;
        deposito_asignado: string | null;
        observaciones: string | null;
        tags: string[];
      }>("select domicilio, localidad, deposito_asignado::text, observaciones, tags from public.clients where id=$1", [clienteId]);
      expect(rows[0]).toEqual({
        domicilio: null,
        localidad: "CABA",
        deposito_asignado: null,
        observaciones: null,
        tags: ["ANMAT"],
      });
    });
  });

  it("TRIESTADO · sólo se pueden vaciar campos opcionales enumerados", async () => {
    await como(ADMIN, async () => {
      // `cuit` y `razon` no son limpiables: son identidad y obligatorio.
      for (const campo of ["cuit", "razon", "activo", "inventado"]) {
        expect(
          await fallo(
            `select public.client_update(
              p_id=>$1,p_motivo=>$2,p_limpiar=>$3,
              p_expected_updated_at=>$4::timestamptz
            )`,
            [clienteId, "intento", [campo], await clientVersion(clienteId)],
          ),
          campo,
        ).toMatch(/CLIENT_CAMPO_NO_LIMPIABLE/);
      }
    });
  });

  it("TRIESTADO · una edición que no cambia nada NO deja evento espurio", async () => {
    // Antes quedaba un `updated` con before == after: la auditoría registraba
    // un cambio que no había ocurrido.
    await como(ADMIN, async () => {
      const antes = await db.query<{ n: string }>(
        "select count(*)::text as n from public.client_events where client_id=$1",
        [clienteId],
      );
      await db.query(
        `select public.client_update(
          p_id=>$1,p_motivo=>$2,p_expected_updated_at=>$3::timestamptz
        )`,
        [clienteId, "sin cambios", await clientVersion(clienteId)],
      );
      const despues = await db.query<{ n: string }>(
        "select count(*)::text as n from public.client_events where client_id=$1",
        [clienteId],
      );
      expect(despues.rows[0].n).toBe(antes.rows[0].n);
    });
  });

  it("un usuario sin clientes.delete no puede desactivar", async () => {
    const msg = await como(OPERARIO, () =>
      fallo("select public.client_set_active($1,false,$2)", [clienteId, "intento"]),
    );
    expect(msg).toMatch(/clientes\.delete/);
  });
});

describe("T-CLI-A2-01 · concurrencia: auditoría serial y CAS", () => {
  let concurrentId: string;

  beforeAll(async () => {
    await db.query("select set_config('test.observer', $1, false)", [ADMIN]);
    const { rows } = await db.query<{ id: string }>(
      "select id from public.client_create($1,$2)",
      ["Concurrente SA", "30-70000042-3"],
    );
    concurrentId = rows[0].id;
    await db.query("select set_config('test.observer', '', false)");
  });

  it("dos ediciones concurrentes con la misma versión no pierden actualizaciones", async () => {
    const a = await sb.connect();
    const b = await sb.connect();
    try {
      const version = await clientVersion(concurrentId);
      await b.query("set role authenticated");
      await a.query("select set_config('test.observer', $1, false)", [ADMIN]);
      await b.query("select set_config('test.observer', $1, false)", [ADMIN]);
      await b.query("set application_name = 't-cli-a2-concurrent-b'");

      await a.query("begin");
      await a.query("set local role authenticated");
      await a.query(
        `select public.client_update(
          p_id=>$1,p_telefono=>'11 1111-1111',p_motivo=>'actor A',
          p_expected_updated_at=>$2::timestamptz
        )`,
        [concurrentId, version],
      );

      const segunda = b.query(
        `select public.client_update(
          p_id=>$1,p_telefono=>'11 2222-2222',p_motivo=>'actor B',
          p_expected_updated_at=>$2::timestamptz
        )`,
        [concurrentId, version],
      ).then(() => "").catch((error: unknown) => error instanceof Error ? error.message : String(error));

      // Espera hasta que B esté realmente bloqueado en la fila. Con `for
      // update` correcto bloquea antes de comparar el CAS. Tras el commit de A,
      // B debe releer la fila y fallar: nunca puede pisar la corrección.
      let blocked = false;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const { rows } = await db.query<{ wait_event_type: string | null }>(
          `select wait_event_type from pg_stat_activity
            where application_name='t-cli-a2-concurrent-b' and state='active'`,
        );
        if (rows[0]?.wait_event_type === "Lock") {
          blocked = true;
          break;
        }
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 10));
      }
      expect(blocked, "la segunda sesión nunca llegó al lock de la fila").toBe(true);

      await a.query("commit");
      expect(await segunda).toMatch(/CLIENT_CONFLICTO_CONCURRENTE/);

      const { rows: events } = await db.query<{ before: Record<string, unknown>; after: Record<string, unknown> }>(
        "select before, after from public.client_events where client_id=$1 and kind='updated' order by id",
        [concurrentId],
      );
      expect(events).toHaveLength(1);
      expect(events[0].before).toHaveProperty("telefono", null);
      expect(events[0].after).toHaveProperty("telefono", "11 1111-1111");
    } finally {
      await a.query("rollback").catch(() => {});
      await a.end().catch(() => {});
      await b.end().catch(() => {});
    }
  });

  it("el CAS rechaza una ficha abierta sobre una versión anterior", async () => {
    const solo = await sb.connect();
    try {
      await solo.query("set role authenticated");
      await solo.query("select set_config('test.observer', $1, false)", [ADMIN]);
      await expect(
        solo.query(
          "select public.client_update(p_id=>$1,p_contacto=>'Sin versión',p_motivo=>'bypass')",
          [concurrentId],
        ),
      ).rejects.toThrow(/CLIENT_CONFLICTO_CONCURRENTE/);
      const { rows } = await db.query<{ updated_at: string }>(
        "select updated_at::text from public.clients where id=$1",
        [concurrentId],
      );
      const version = rows[0].updated_at;

      await solo.query(
        "select public.client_update(p_id=>$1,p_contacto=>'Versión vigente',p_motivo=>'primera',p_expected_updated_at=>$2::timestamptz)",
        [concurrentId, version],
      );
      await expect(
        solo.query(
          "select public.client_update(p_id=>$1,p_contacto=>'Pisada obsoleta',p_motivo=>'segunda',p_expected_updated_at=>$2::timestamptz)",
          [concurrentId, version],
        ),
      ).rejects.toThrow(/CLIENT_CONFLICTO_CONCURRENTE/);

      const { rows: current } = await db.query<{ contacto: string }>(
        "select contacto from public.clients where id=$1",
        [concurrentId],
      );
      expect(current[0].contacto).toBe("Versión vigente");
    } finally {
      await solo.end().catch(() => {});
    }
  });
});

describe("T-CLI-A2-01 · la rama de admin de has_permission es REAL", () => {
  it("un perfil role='admin' obtiene la capacidad sin asignación explícita", async () => {
    // `has_permission` (0009:173) termina en `or current_role() = 'admin'`.
    // No es un defecto de este candidato, pero el cierre acotado lo reproduce
    // porque una prueba de denegación que lo ignorara daría una seguridad que
    // el sistema real no tiene. Se deja MEDIDO y visible.
    const JEFE = "44444444-4444-4444-8444-444444444444";
    await db.query("insert into auth.users (id) values ($1)", [JEFE]);
    await db.query("insert into public.profiles (id, role) values ($1,'admin')", [JEFE]);
    await como(JEFE, async () => {
      const { rows } = await db.query<{ ok: boolean }>(
        "select public.has_permission('clientes.create') as ok",
      );
      expect(rows[0].ok).toBe(true);
    });
    const { rows } = await db.query<{ n: string }>(
      "select count(*)::text as n from public.user_roles where user_id=$1",
      [JEFE],
    );
    expect(rows[0].n).toBe("0"); // sin una sola asignación
  });
});

describe("T-CLI-A2-01 · defensas del constructo SECURITY DEFINER", () => {
  it("las tres RPC tienen search_path fijo", async () => {
    const { rows } = await db.query<{ proname: string; cfg: string[] | null }>(
      `select proname, proconfig as cfg from pg_proc p
         join pg_namespace n on n.oid=p.pronamespace
        where n.nspname='public'
          and proname in ('client_create','client_update','client_set_active')
        order by proname`,
    );
    expect(rows).toHaveLength(3);
    for (const r of rows) {
      expect(r.cfg?.join(" "), r.proname).toMatch(/search_path=/);
    }
  });

  it("ninguna concede EXECUTE a public ni a anon", async () => {
    const { rows } = await db.query<{ grantee: string }>(
      `select distinct grantee from information_schema.routine_privileges
        where routine_schema='public'
          and routine_name in ('client_create','client_update','client_set_active')
          and privilege_type='EXECUTE'
        order by grantee`,
    );
    expect(rows.map((r) => r.grantee)).not.toContain("PUBLIC");
    expect(rows.map((r) => r.grantee)).not.toContain("anon");
    expect(rows.map((r) => r.grantee)).toContain("authenticated");
  });

  it("ningún control se apoya en current_user", async () => {
    // Dentro de un SECURITY DEFINER, current_user es el DUEÑO de la función:
    // un control basado en él sería tautológico. El actor sale de auth.uid().
    const { rows } = await db.query<{ prosrc: string }>(
      `select prosrc from pg_proc p join pg_namespace n on n.oid=p.pronamespace
        where n.nspname='public'
          and p.proname in ('client_create','client_update','client_set_active')`,
    );
    for (const r of rows) {
      expect(r.prosrc).not.toMatch(/current_user/);
      expect(r.prosrc).toMatch(/auth\.uid\(\)/);
    }
  });
});

describe("T-CLI-A2-01 · la capacidad de WMS queda registrada o la migración aborta", () => {
  it("wms.clients.create existe con su módulo y acción exactos", async () => {
    const { rows } = await db.query<{ slug: string; module: string; action: string }>(
      "select slug, module::text, action::text from public.permissions where slug='wms.clients.create'",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].module).toBe("wms");
    expect(rows[0].action).toBe("create");
  });

  it("si el slot estuviera ocupado, 0242 aborta con una causa legible", async () => {
    // Se reproduce el escenario que el `on conflict do nothing` sin target
    // ocultaría: otra fila ocupa (wms,'create') y la capacidad no se siembra.
    await db.query("begin");
    await db.query("delete from public.permissions where slug='wms.clients.create'");
    await db.query(
      `insert into public.permissions (slug, module, action, label)
       values ('wms.otro.create','wms','create','Otro')`,
    );
    const msg = await fallo(readFileSync(M0242, "utf8"));
    await db.query("rollback");
    expect(msg).toMatch(/CAPACIDAD_NO_REGISTRADA/);
    expect(msg).toMatch(/wms\.otro\.create/);
  });
});

describe("T-CLI-A2-01 · reversibilidad de 0242 · COMPORTAMIENTO, no bits", () => {
  /**
   * La versión anterior de estos casos leía `role_table_grants` y concluía que
   * el rollback «restituye el INSERT». Era falso y se midió: 0242 dropea la
   * policy `client_events insert internal`, la inversa devolvía sólo el
   * privilegio y el INSERT seguía muriendo con violación de RLS. El sistema
   * quedaba sin RPC y sin vía de escritura, con una aserción en verde.
   *
   * Acá se EJECUTA el INSERT en cada etapa. Un bit de privilegio no prueba
   * que se pueda escribir.
   */
  let solo2: Client;
  let clienteRef: string;

  beforeAll(async () => {
    solo2 = await sb.connect();
    await solo2.query("select set_config('test.observer', $1, false)", [ADMIN]);
    const { rows } = await db.query<{ id: string }>("select id from public.clients limit 1");
    clienteRef = rows[0].id;
  });

  afterAll(async () => {
    await solo2?.end().catch(() => {});
  });

  /** Intenta un INSERT DIRECTO como `authenticated`. Devuelve el error o null. */
  const insertDirecto = async (marca: string): Promise<string | null> => {
    await solo2.query("begin");
    await solo2.query("set local role authenticated");
    try {
      await solo2.query(
        "insert into public.client_events (client_id, kind, motivo) values ($1,'updated',$2)",
        [clienteRef, marca],
      );
      await solo2.query("commit");
      return null;
    } catch (e) {
      await solo2.query("rollback");
      return e instanceof Error ? e.message : String(e);
    }
  };

  it("ETAPA 2 · con 0242 aplicada: el INSERT directo está denegado", async () => {
    // Estado de partida de esta suite: 0240+0241+0242.
    expect(await insertDirecto("con-0242")).toMatch(/permission denied|row-level security/i);
  });

  it("ETAPA 2 · y la escritura por RPC sí funciona", async () => {
    await solo2.query("set role authenticated");
    await expect(
      solo2.query("select public.client_create($1,$2)", ["Via RPC SA", "30-70000040-7"]),
    ).resolves.toBeDefined();
    await solo2.query("reset role");
  });

  it("ETAPA 3 · tras ROLLBACK_0242, el INSERT del camino restaurado FUNCIONA de verdad", async () => {
    await db.query(readFileSync(R0242, "utf8"));

    // Las RPC se fueron.
    const fn = await db.query<{ n: string }>(
      `select count(*)::text as n from pg_proc p join pg_namespace n on n.oid=p.pronamespace
        where n.nspname='public' and p.proname in ('client_create','client_update','client_set_active')`,
    );
    expect(fn.rows[0].n).toBe("0");

    // Y la vía directa vuelve a estar viva. ESTO es lo que la versión anterior
    // no medía: con el grant pero sin la policy, esto fallaba.
    expect(await insertDirecto("post-rollback")).toBeNull();

    // La auditoría previa sobrevive.
    const ev = await db.query<{ n: string }>("select count(*)::text as n from public.client_events");
    expect(Number(ev.rows[0].n)).toBeGreaterThan(0);
  });

  it("ETAPA 3 · el rollback repetido es idempotente y no rompe la vía", async () => {
    await expect(db.query(readFileSync(R0242, "utf8"))).resolves.toBeDefined();
    expect(await insertDirecto("segundo-rollback")).toBeNull();
  });

  it("ETAPA 4 · reaplicar 0242 vuelve a cerrar la vía directa y devuelve las RPC", async () => {
    await db.query(readFileSync(M0242, "utf8"));
    expect(await insertDirecto("reaplicado")).toMatch(/permission denied|row-level security/i);
    const fn = await db.query<{ n: string }>(
      `select count(*)::text as n from pg_proc p join pg_namespace n on n.oid=p.pronamespace
        where n.nspname='public' and p.proname in ('client_create','client_update','client_set_active')`,
    );
    expect(fn.rows[0].n).toBe("3");
  });
});
