/**
 * Cierre acotado del lado CUSTODIA para el arnés vanilla.
 *
 * ─── POR QUÉ HACE FALTA ──────────────────────────────────────────────────
 *
 * `client_set_custody_level` (0256) exige las DOS mitades: el maestro nativo de
 * clientes (0241/0242, con `client_events`) y la columna `clients.custody_level`
 * que agrega 0252. Ningún arnés tiene ambas:
 *
 *   · el VANILLA tiene el maestro, pero no puede aplicar 0252: esa migración
 *     referencia `custody_integrity_cases`, `custody_events`, `custody_chain_lock`
 *     y una decena más de objetos del cierre histórico de custodia;
 *   · el de CUSTODIA tiene 0252, pero no lleva el maestro de clientes.
 *
 * Mismo patrón —y mismo motivo— que `CIERRE_ACOTADO` en `clientes-closure.ts`:
 * se reproducen las PRECONDICIONES para poder medir el SUJETO real. Lo que se
 * prueba es 0256, que acá se aplica tal cual está en disco. Estas columnas son
 * el equivalente de `auth.users`: andamio, no objeto de la prueba.
 *
 * ⚠ REPRODUCCIÓN LITERAL, Y VIGILADA. Las sentencias de abajo son copia exacta
 * de 0252:55-61 y 0252:134-140. `assertCierreAlDia()` vuelve a leer la
 * migración y compara: si alguien cambia el default, el tipo o el check en
 * 0252, este cierre deja de estar al día y la prueba lo dice, en vez de seguir
 * midiendo contra una definición que ya no existe.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MIGRATIONS_DIR } from "./manifest";

/** Copia literal de 0252:55-61 y 0252:134-140. */
export const CIERRE_CUSTODIA = `
  -- Tabla mínima de unidades físicas. En 0250a lleva su genealogía, su caso y
  -- sus disparadores; acá sólo hace falta que exista para colgarle la columna.
  create table if not exists public.custody_physical_units (
    id                uuid primary key default gen_random_uuid(),
    reception_item_id uuid,
    created_at        timestamptz not null default now()
  );

  alter table public.clients
    add column if not exists custody_level smallint not null default 1;

  alter table public.clients
    drop constraint if exists clients_custody_level_ck;
  alter table public.clients
    add constraint clients_custody_level_ck check (custody_level in (1, 2));

  alter table public.custody_physical_units
    add column if not exists custody_level smallint not null default 2;

  alter table public.custody_physical_units
    drop constraint if exists custody_physical_units_level_ck;
  alter table public.custody_physical_units
    add constraint custody_physical_units_level_ck check (custody_level in (1, 2));

  -- Lectura para el rol de la aplicacion: el test comprueba que la unidad NO
  -- cambio, y para comprobarlo hay que poder leerla.
  grant select on public.custody_physical_units to authenticated;
`;

/**
 * Falla si 0252 dejó de decir lo que este cierre reproduce. Se compara sobre el
 * texto normalizado —sin comentarios ni espacios de más— para que un reformateo
 * no dispare un falso positivo y un cambio de semántica sí.
 */
export function assertCierreAlDia(): void {
  const sql = readFileSync(join(MIGRATIONS_DIR, "0252_custody_two_levels.sql"), "utf8");
  const norm = (s: string) =>
    s.replace(/--[^\n]*/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
  const real = norm(sql);

  const EXIGIDAS = [
    "alter table public.clients add column if not exists custody_level smallint not null default 1",
    "add constraint clients_custody_level_ck check (custody_level in (1, 2))",
    "alter table public.custody_physical_units add column if not exists custody_level smallint not null default 2",
    "add constraint custody_physical_units_level_ck check (custody_level in (1, 2))",
  ];
  const faltan = EXIGIDAS.filter((f) => !real.includes(norm(f)));
  if (faltan.length > 0) {
    throw new Error(
      "CIERRE_CUSTODIA quedó desactualizado respecto de 0252_custody_two_levels.sql. " +
        `Ya no aparece: ${faltan.join(" | ")}`,
    );
  }
}
