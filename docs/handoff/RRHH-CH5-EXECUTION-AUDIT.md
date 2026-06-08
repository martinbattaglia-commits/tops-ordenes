# RRHH-CH5-EXECUTION-AUDIT

**Fecha:** 2026-06-08 · **Modo:** auditoría **read-only** (autorizado por Presidencia).
**Proyecto productivo:** `arsksytgdnzukbmfgkju` (source of truth) — confirmado que la app apunta ahí.
**NO se escribió en producción.** Las migraciones `0062`/`0063` quedan listas para que las apliques vos / tu pipeline.

---

## TL;DR — Causa raíz

Las migraciones de carga **se generaron pero nunca se ejecutaron contra producción**.
`rrhh_empleados` en prod tiene **0 filas**, verificado con **service role (bypassa RLS)** → no es RLS, no es fuente equivocada, no es sincronización. La tabla **existe** (responde HTTP 200) pero está **vacía**.

> El Dashboard RRHH cuenta `rrhh_empleados` con cliente de sesión. Sin filas en la tabla → Dotación = 0. Es el comportamiento correcto del código sobre una tabla vacía.

---

## Tablas auditadas (evidencia)

Conteo exacto vía PostgREST (`Prefer: count=exact`, `Range: 0-0` → header `Content-Range`). Solo se imprimieron headers; ningún secreto expuesto.

| Tabla | service role (bypass RLS) | anon (RLS) | Lectura |
|---|---|---|---|
| `rrhh_empleados` | HTTP 200 · `content-range: */0` | HTTP 200 · `*/0` | **Vacía** — no es RLS, está sin datos |
| `rrhh_empleado_bancario` | HTTP 200 · `*/0` | — | Vacía |
| `rrhh_documents` | HTTP 200 · `*/0` | — | Vacía (sin recibos cargados) |

- **service role = anon = 0** → descarta hipótesis RLS (si fuera RLS, service role vería filas y anon 0).
- HTTP 200 (no 404) → las tablas **existen** (migraciones de esquema 0056–0060 sí están aplicadas); lo que falta es la **carga de datos** 0062/0063.

## Fuente de datos del Dashboard (código)

`src/lib/rrhh/data.ts` → `getDashboardCounts()`:
- Usa **cliente de sesión** (`createClient`, RLS-bound) — correcto.
- `dotacion_total = count(rrhh_empleados)`, `activos = count(... estado='activo')`, `en_licencia = count(... estado='licencia')`.
- Sin vistas `rrhh_v_*`; conteos directos (FD-9, ningún cálculo en TS).
- Listado (`listEmpleados`) y legajo (`getEmpleado`/`getMiLegajo`) también leen `rrhh_empleados` con sesión.

→ El código está **correcto**. El 0 proviene exclusivamente de la tabla vacía, no de la consulta, filtros ni permisos.

---

## Respuestas explícitas (las 5 preguntas)

1. **¿Qué pasó con la carga?**
   Se generaron las migraciones `0062_rrhh_carga_inicial.sql` (19 empleados) y `0063_rrhh_bancario_carga.sql` (16 cuentas) a partir de los recibos 05/2026. El INSERT directo a prod de la sesión anterior fue **bloqueado por el clasificador de seguridad (correcto: PII a producción)**. Las migraciones quedaron **pendientes de aplicar** y nunca corrieron.

2. **¿Por qué RRHH sigue mostrando 0?**
   Porque `rrhh_empleados` tiene **0 filas en prod** (verificado con bypass de RLS). El Dashboard cuenta esa tabla; tabla vacía → Dotación/Activos/Empleados = 0.

3. **¿Las migraciones fueron ejecutadas?**
   **No.** La tabla vacía con service role lo confirma. El esquema (0056–0060) sí está; la carga (0062/0063) no.

4. **¿Cuántos empleados quedaron cargados?**
   **0.** (Objetivo tras aplicar: **19** empleados + **16** cuentas bancarias; 3 legajos cobran en efectivo y no llevan cuenta.)

5. **¿Los recibos quedaron vinculados al legajo?**
   **No.** `rrhh_documents` = 0 y sin empleados no hay legajo al cual vincular. CH5-B no puede ejecutarse hasta que la carga esté aplicada.

---

## Estado de las migraciones (listas para aplicar)

| Migración | Contenido | Idempotencia | Estado |
|---|---|---|---|
| `0062_rrhh_carga_inicial.sql` | 19 empleados (legajo, apellido, DNI, CUIL, ingreso, categoría, sección, calificación, modalidad, estado=activo) | `on conflict (cuil) do nothing` + `setval` del seq de legajo | ✅ Lista · no aplicada |
| `0063_rrhh_bancario_carga.sql` | 16 cuentas bancarias (resuelve `empleado_id` por CUIL) | `where not exists (empleado+cuenta)` | ✅ Lista · aplicar **después** de 0062 |

Ambas son re-ejecutables sin duplicar. Datos derivados de los recibos reales (sin re-analizar el PDF).

### Cómo aplicarlas (cuando autorices el write a prod)
- Vía Supabase CLI / pipeline de migraciones del proyecto (`supabase db push` o el mecanismo que use el deploy), **en orden** 0062 → 0063.
- Tras aplicar, el Dashboard mostrará Dotación 19 / Activos 19 automáticamente (sin cambios de código).

---

## CH5-B — Vinculación recibos → legajo (PENDIENTE, bloqueada por la carga)

No ejecutable en modo read-only. Plan listo para cuando los empleados existan:
1. Subir las 34 páginas del PDF (recibos 05/2026) a Storage RRHH, una por empleado.
2. Insertar en `rrhh_documents` con clasificación **RRHH → Recibos de sueldo → 2026 → Mayo**, `empleado_id` resuelto por CUIL/legajo.
3. Verificar el legajo 360 de cada empleado muestre su recibo asociado.

> Requiere: (a) 0062 aplicada (para tener `empleado_id`), (b) autorización de write a prod, (c) ingesta de PDF a Storage. Hoy `rrhh_documents` = 0.

---

## Correcciones realizadas en esta auditoría

- **Ninguna escritura a producción** (decisión: audit-only).
- Se **confirmó** que la app productiva apunta a `arsksytgdnzukbmfgkju` (no staging) — `NEXT_PUBLIC_SUPABASE_URL` y `SUPABASE_PROJECT_REF` coinciden.
- Se **validó** que el código del Dashboard es correcto (no requiere fix).
- Se **verificó** que las migraciones 0062/0063 están bien formadas e idempotentes → listas para aplicar.

## Validaciones finales

| | Resultado |
|---|---|
| Proyecto = prod | ✅ `arsksytgdnzukbmfgkju` (URL + REF) |
| `rrhh_empleados` (service role) | ✅ `*/0` → tabla existe, vacía |
| Descartado RLS | ✅ service role también 0 |
| Descartada fuente equivocada | ✅ app apunta a prod |
| Código Dashboard | ✅ correcto (cuenta tabla real, sin fix necesario) |
| Migraciones 0062/0063 | ✅ presentes, idempotentes, no aplicadas |
| Escritura a prod | ⛔ no realizada (audit-only, por diseño) |

**Acción requerida de Presidencia:** autorizar la aplicación de `0062`→`0063` a producción (o aprobar que las corra el pipeline). Recién entonces se ejecuta CH5-B (vínculo de recibos al legajo).
