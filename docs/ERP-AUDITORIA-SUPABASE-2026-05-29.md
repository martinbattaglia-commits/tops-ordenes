# TOPS NEXUS — Auditoría Supabase Read-Only + Paridad Definitiva

> **Estado:** auditoría verificada en vivo · **Fecha:** 2026-05-29
> Auditoría **read-only** ejecutada contra la base de datos productiva de Supabase
> (proyecto `arsksytgdnzukbmfgkju`) vía Management API, **solo sentencias `SELECT`**.
> No se modificó ningún dato, esquema, registro ni configuración. No se ejecutaron
> migraciones ni scripts destructivos.
> Gobernado por [TOPS-NEXUS-ERP.md](./TOPS-NEXUS-ERP.md). Reemplaza la "honestidad de
> método" §6 de [ERP-CONSOLIDACION-DEFINITIVA.md](./ERP-CONSOLIDACION-DEFINITIVA.md):
> el estado de DB **sí** fue re-verificado en esta sesión y los resultados están aquí.

---

## 0. Método

- **Conexión:** Supabase Management API `POST /v1/projects/{ref}/database/query`,
  autenticada con `SUPABASE_ACCESS_TOKEN` (host-only, en `.env.local`, gitignored).
- **Naturaleza:** estrictamente lectura (`information_schema`, `pg_catalog`,
  `storage.buckets`, `supabase_migrations.schema_migrations`, `count(*)`).
- **Sin** `psql` local; CLI `supabase` presente pero **no** se usó para mutar.
- Todos los conteos y listados de abajo son salida literal de la DB al 2026-05-29.

---

## 1. ACCIÓN 2 — Resultado de la auditoría

### 1.1 Migraciones: tracker vs. realidad (hallazgo crítico)

La tabla `supabase_migrations.schema_migrations` (tracker del CLI) registra **solo**:

```
0001 init · 0002 seed · 0003 storage · 0004 extended_schema · 0005 fix_rls_recursion
```

**Pero el esquema real demuestra que 0006–0009 también fueron aplicados** (sus tablas
y columnas existen, ver §1.2). Conclusión: **0006, 0007, 0008 y 0009 se aplicaron
manualmente (SQL Editor), sin pasar por el tracker.** El tracker está
**desincronizado** y **no es fuente de verdad**.

| Migración | Tracker la conoce | Esquema real la refleja | Estado efectivo |
|-----------|:----------------:|:-----------------------:|-----------------|
| 0001 init | ✅ | ✅ | **aplicada** |
| 0002 seed | ✅ | ✅ | **aplicada** |
| 0003 storage | ✅ | ✅ | **aplicada** |
| 0004 extended_schema | ✅ | ✅ | **aplicada** |
| 0005 fix_rls_recursion | ✅ | ✅ | **aplicada** |
| 0006 real_operators | ❌ | ✅ (`operators` con 7 filas) | **aplicada (out-of-band)** |
| 0007 extend_service_units | ❌ | ✅ (`services_catalog` 13) | **aplicada (out-of-band)** |
| 0008 purchase_orders | ❌ | ✅ (6 tablas compras) | **aplicada (out-of-band)** |
| 0009 rbac | ❌ | ✅ (4 tablas RBAC) | **aplicada (out-of-band)** |
| **0010 documents** | ❌ | ❌ (`documents` ausente) | **NO aplicada** |
| **0011 arca_billing** | ❌ | ❌ (5 tablas ausentes) | **NO aplicada** |

### 1.2 Tablas reales en `public` (20 BASE TABLE)

```
attachments · audit_log · clients · email_sends · notifications · operators
order_services · orders · permissions · po_email_sends · po_events · po_items
products · profiles · purchase_orders · role_permissions · roles
services_catalog · user_roles · vendors
```

**Vistas (3):** `my_permissions`, `v_orders_dashboard`, `vendor_stats`.

### 1.3 Tablas AUSENTES (confirmado por consulta explícita → `[]`)

```
documents          (0010)  ❌  — Centro Documental no persiste
customer_invoices  (0011)  ❌  — Facturación ARCA rota en runtime
invoice_items      (0011)  ❌
fiscal_config      (0011)  ❌  — singleton de config fiscal inexistente
puntos_venta       (0011)  ❌
invoice_audit      (0011)  ❌
```

### 1.4 RBAC — estado real

| Tabla / objeto | Conteo / estado |
|----------------|-----------------|
| `roles` | **7** |
| `permissions` | **22** |
| `role_permissions` | **64** |
| `user_roles` | **0** ← **RBAC granular DORMIDO** |
| `profiles` | 6 |
| Función `current_role()` | existe → retorna `user_role_t` |
| Función `has_permission()` | existe → retorna `boolean` (presente pero inactiva sin `user_roles`) |
| Enum `user_role_t` | `admin`, `operaciones`, `supervisor`, `cliente` |

> **Divergencia de vocabulario de roles:** el enum `user_role_t` (Sistema A, el que
> usa la RLS real vía `current_role()`) tiene **4** roles. La tabla `roles` (Sistema B,
> granular) tiene **7** (incluye `director_ops`, `compliance`, `seguridad`). Los roles
> de los docs CCTV/ANMAT (`seguridad`, `compliance`) **solo existen en Sistema B**, que
> está dormido. Hoy la autorización efectiva corre por los 4 del enum.

### 1.5 Documents — estado real

Tabla `documents` **ausente**. El bucket `attachments` (privado) existe y la tabla
`attachments` existe (de 0004), pero la persistencia del Centro Documental + OCR que
introduce 0010 **no está**. → `/documental` no persiste contra su tabla objetivo.

### 1.6 Facturación ARCA — estado real

Ninguna de las 5 tablas fiscales existe. **No** existe el trigger de inmutabilidad
`customer_invoices_lock` (no puede existir sin su tabla). **No** existe el bucket
`invoices`. → `/billing` y `/settings/fiscal` fallan en runtime contra DB real.

### 1.7 Buckets de Storage (5)

| Bucket | Público | Origen |
|--------|:-------:|--------|
| `attachments` | privado | 0003/0004 |
| `pdfs` | público | 0003 |
| `signatures` | público | 0003 |
| `po-pdfs` | público | 0008 |
| `po-signatures` | privado | 0008 |
| ~~`invoices`~~ | — | **ausente (0011)** |

### 1.8 Triggers en `public` (7)

```
clients_touch_updated_at (UPDATE) · orders_touch_updated_at (UPDATE)
tg_orders_notify_ins (INSERT) · tg_orders_notify_upd (UPDATE)
trg_set_public_id (INSERT, orders) · trg_set_po_public_id (INSERT, purchase_orders)
trg_roles_updated_at (UPDATE, roles)
```

No hay triggers de inmutabilidad fiscal (ARCA ausente) ni guardas anti-DELETE de
auditoría → **el riesgo C2 (auditoría borrable por CASCADE) sigue vigente**.

### 1.9 Datos productivos (conteos)

| Tabla | Filas |
|-------|------:|
| clients | 2 |
| orders | 10 |
| order_services | 22 |
| operators | 7 |
| services_catalog | 13 |
| vendors | 10 |
| products | 20 |
| purchase_orders | 1 |
| po_items | 1 |

> Hay **datos reales** que respaldar (operaciones + catálogo + compras semilla). Sin
> backup externo a Supabase = riesgo RP6 del roadmap.

---

## 2. ACCIÓN 3 — Informe de Paridad Definitivo

Cuatro planos cruzados al 2026-05-29:

| # | Migración | **Código (main)** | **Migraciones (disco)** | **Base de datos (real)** | **Documentación** |
|---|-----------|:-----------------:|:-----------------------:|:------------------------:|-------------------|
| 0001–0007 | base/ops | ✅ SQL en main | ✅ main + wip | ✅ aplicada | ✅ correcta |
| 0008 | purchase_orders | ❌ **falta SQL en main** | ✅ solo wip | ✅ aplicada (datos) | 🟡 decía "sin SQL en main" — correcto |
| 0009 | rbac | ❌ **falta SQL en main** | ✅ solo wip | ✅ aplicada (seed, user_roles=0) | 🟡 "dormido" — correcto |
| 0010 | documents | ❌ falta SQL en main | ✅ solo wip | ❌ **NO aplicada** | 🟡 MAESTRA decía "sin aplicar" ✓ / **rector §5 la listaba como creada** ✗ |
| 0011 | arca_billing | ✅ SQL en main | ✅ main + wip | ❌ **NO aplicada** | 🟡 MAESTRA "0011 NO aplicada" ✓ / **rector §5 listaba sus 6 tablas como creadas** ✗ |

### 2.1 Resumen por plano

- **Código (main):** tiene SQL de `0001–0007` + `0011`. **Le faltan `0008`, `0009`,
  `0010`.** Paradoja: tiene el SQL de la migración NO aplicada (0011) y le falta el SQL
  de las migraciones SÍ aplicadas (0008/0009).
- **Migraciones (disco, ramas wip/docs):** set completo `0001–0011`.
- **Base de datos (real):** efectivamente `0001–0009`. **Sin `0010` ni `0011`.**
- **Documentación:** la capa MAESTRA y de riesgos era precisa sobre 0010/0011 sin
  aplicar; **el rector `TOPS-NEXUS-ERP.md` §5 sobre-declaraba** 6 tablas (documents +
  5 ARCA) como creadas. **Se corrige en esta entrega (ACCIÓN 5).**

### 2.2 Hallazgos de paridad (numerados)

- **PARIDAD-1** *(confirmado, ampliado)* — `main` carece del SQL de `0008`/`0009`
  (aplicadas en DB) y de `0010` (no aplicada). Riesgo: el esquema productivo no está
  documentado en la rama desplegada.
- **PARIDAD-2** *(nuevo)* — El **rector §5** afirmaba que `documents` + 5 tablas ARCA
  existían; la DB demuestra que **no**. Documentación sobre-declaraba el estado.
- **PARIDAD-3** *(nuevo, proceso)* — El **tracker de migraciones está desincronizado**
  (conoce `0001–0005`; `0006–0009` se aplicaron fuera de banda). Ejecutar
  `supabase db push`/`migration up` a ciegas intentaría re-aplicar `0006–0011` y podría
  **fallar o duplicar objetos**. El CLI de migraciones **no es seguro** hasta resyncar.

---

## 3. ACCIÓN 4 — Plan de remediación PARIDAD-1 (propuesta, NO ejecutar)

> Objetivo: que **Código ↔ Migraciones ↔ DB ↔ Documentación** digan lo mismo, sin
> tocar producción hasta aprobación explícita por paso. Todo lo de abajo es **propuesta**.

### 3.1 Qué falta / sobra / se traslada / se aísla

| Categoría | Detalle |
|-----------|---------|
| **Qué falta en main** | SQL de `0008_purchase_orders.sql`, `0009_rbac.sql`, `0010_documents.sql` |
| **Qué sobra en main** | Nada que borrar. `0011` está en main pero su DB no existe — es "código adelantado", se gobierna con gate, no se borra |
| **Qué debe trasladarse** | Los 3 archivos SQL faltantes desde `wip`→`main` (solo archivos; la DB de 0008/0009 ya existe, **no se re-ejecuta**) |
| **Qué se mantiene aislado** | Aplicación real de `0010` y `0011` a la DB (requiere decisión: documents y, para ARCA, cert X.509). Permanecen como migraciones no-aplicadas hasta orden |

### 3.2 Riesgos del plan

| # | Riesgo | Severidad | Mitigación |
|:-:|--------|:---------:|-----------|
| R-A | Re-aplicar 0008/0009 por error y chocar con objetos existentes | Alta | **Solo copiar archivos**, NO ejecutar SQL; los `CREATE TABLE` deberían ser idempotentes (`IF NOT EXISTS`) antes de cualquier push real |
| R-B | `supabase db push` re-corre 0006–0011 por tracker desincronizado | Alta | **No usar el CLI de migraciones** hasta resyncar el tracker (insertar filas 0006–0009 en `schema_migrations` en un paso aparte, supervisado) |
| R-C | Promover SQL a main dispara expectativa de aplicar 0010/0011 | Media | Separar tajantemente "paridad de archivos" (seguro) de "aplicar migración" (requiere decisión y cert) |
| R-D | Sin backup externo, un error es irreversible | Alta | Política de backup Supabase (RP6) **antes** de cualquier escritura a DB |

### 3.3 Orden correcto de ejecución (cuando se autorice)

```
0. (precondición) Backup del proyecto Supabase fuera de Supabase ........ [RP6]
1. Verificar idempotencia de 0008/0009/0010 (IF NOT EXISTS) — solo lectura/edición de archivos
2. Traer 0008/0009/0010 SQL a main vía PR (sin deploy de DB) ............. cierra PARIDAD-1
3. Resyncar tracker: registrar 0006–0009 como aplicadas (paso supervisado, 1 INSERT)
4. (decisión aparte) Aplicar 0010 documents a DB ........................ habilita Centro Documental
5. (decisión aparte + cert X.509) Aplicar 0011 ARCA o gatear /billing ... cierra ARCA-roto-runtime
```

> **Dependencias:** el paso 2 es puramente de archivos y de bajo riesgo (no toca DB).
> Los pasos 4 y 5 sí tocan DB y **no** se ejecutan sin backup (paso 0), idempotencia
> verificada (paso 1) y aprobación explícita. ARCA además exige cert montado en host.

---

## 4. Riesgos identificados (consolidado)

| # | Riesgo | Evidencia de esta auditoría | Severidad |
|:-:|--------|------------------------------|:---------:|
| ARCA-RT | Facturación rota en runtime | 5 tablas + bucket `invoices` + trigger lock ausentes | **Alta** |
| DOCS-RT | Centro Documental no persiste | tabla `documents` ausente | Media |
| RBAC-DORM | RBAC granular inactivo | `user_roles`=0 pese a 7/22/64 seed | Media |
| C2 | Auditoría borrable por CASCADE | sin guardas anti-DELETE en triggers reales | Media-Alta |
| PARIDAD-1 | main sin SQL 0008/0009/0010 | confirmado por `git ls-tree` | Media |
| PARIDAD-2 | Rector sobre-declaraba DB | §5 listaba 6 tablas inexistentes | Media (se corrige hoy) |
| PARIDAD-3 | Tracker de migraciones desincronizado | `schema_migrations` solo 0001–0005 | **Alta** (bloquea uso de CLI) |
| RP6 | Sin backup externo de datos reales | 10 orders, 10 vendors, 20 products, etc. | Alta |

---

## 5. Recomendación profesional

1. **El tracker desincronizado (PARIDAD-3) es el riesgo operativo más urgente:** prohíbe
   usar `supabase db push`/`migration up` hasta resyncar. Cualquier intento a ciegas es
   peligroso. Tratar el versionado de migraciones como "manual supervisado" por ahora.
2. **PARIDAD-1 se cierra barato y seguro** trayendo 3 archivos SQL a `main` vía PR — no
   toca la DB (0008/0009 ya están aplicadas). Es el primer paso del roadmap (I1) y no
   requiere ventana de riesgo.
3. **No aplicar 0010/0011 todavía:** son decisiones separadas, con backup previo
   obligatorio (RP6) e idempotencia verificada; ARCA además necesita el cert X.509.
4. **Documentación corregida hoy** (ACCIÓN 5): el rector §5 ahora refleja la DB real.

> Nada de §3 se ejecuta sin aprobación explícita por paso. Esta auditoría es solo
> lectura y diagnóstico.
