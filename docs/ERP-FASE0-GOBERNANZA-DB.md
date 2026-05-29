# TOPS NEXUS — FASE 0: Gobernanza y Trazabilidad de Base de Datos

> **Estado:** fase de gobernanza · **Fecha:** 2026-05-29
> Restaurar una **única fuente de verdad** entre Código, Migraciones, Base de datos y
> Documentación. Basado en la auditoría read-only en vivo de
> [ERP-AUDITORIA-SUPABASE-2026-05-29.md](./ERP-AUDITORIA-SUPABASE-2026-05-29.md).
> Gobernado por [TOPS-NEXUS-ERP.md](./TOPS-NEXUS-ERP.md).
> **No ejecuta nada.** Toda evidencia abajo proviene de consultas `SELECT` y lectura de
> archivos. Ninguna migración, dato, tabla, columna o función fue modificada.

---

## 1. Informe de Gobernanza de Base de Datos

### 1.1 El problema (diagnóstico)

El riesgo central de TOPS Nexus hoy **no es ARCA ni Documents**: es la **pérdida de
trazabilidad entre el repositorio y la base de datos**. Tres fuentes que deberían
coincidir, divergen:

1. **Tracker de migraciones** (`supabase_migrations.schema_migrations`) → cree que solo
   corrieron `0001–0005`.
2. **Base de datos real** → demuestra que `0001–0009` están aplicadas.
3. **Repositorio `main`** → tiene el SQL de `0001–0007` + `0011`, pero **le falta**
   `0008`/`0009`/`0010`.

Ninguna de las tres puede usarse hoy como fuente de verdad sin contrastarla con las
otras. Eso vuelve **peligrosa** cualquier operación de migración o deploy automatizada.

### 1.2 Causa raíz (verificada)

El script `scripts/supabase-bootstrap.mjs` aplica archivos `.sql` **directamente**
contra la DB (vía conexión con service_role / SQL), pero **no inserta filas en
`schema_migrations`** (grep `schema_migrations` en el script = **0** coincidencias).

> **Conclusión:** las migraciones `0006`–`0009` se aplicaron con bootstrap/SQL Editor,
> que **omite el registro en el tracker**. Por eso el esquema avanzó hasta 0009 pero el
> tracker quedó congelado en 0005. Esto es **deuda de proceso**, no de datos: el
> esquema productivo es correcto; lo que falló es el **registro de trazabilidad**.

### 1.3 Estado del tooling local

| Artefacto | Estado | Implicancia |
|-----------|:------:|-------------|
| `supabase/.temp/linked-project.json` + `project-ref` (`arsksytgdnzukbmfgkju`) | ✅ presente | El repo está **parcialmente linkeado** a prod por CLI |
| `supabase/config.toml` | ❌ ausente | Falta config canónica del CLI → estado de CLI incompleto |
| `scripts/supabase-bootstrap.mjs` | ✅ | Aplica SQL **sin** registrar en tracker (causa raíz) |
| `scripts/supabase-check.mjs` | ✅ | Diagnóstico read-only |
| `scripts/setup-supabase.sh` | ✅ | Setup |

> El link parcial + ausencia de `config.toml` significa que `supabase db push` podría
> ejecutarse pero contra un estado de CLI **incoherente** con la realidad. Ver §4.

---

## 2. Matriz Completa de Migraciones

Estado verificado por **evidencia independiente del esquema** (tipos, tablas, columnas,
funciones), no por el tracker ni por inferencia.

| Mig | En disco | En `main` | Registrada (tracker) | **Aplicada (DB real)** | Cómo se aplicó | Evidencia de DB |
|-----|:--------:|:---------:|:--------------------:|:----------------------:|----------------|-----------------|
| 0001 init | ✅ | ✅ | ✅ | ✅ | CLI/tracker | tipos `depot_t`/`order_status_t`/`user_role_t`; tablas base |
| 0002 seed | ✅ | ✅ | ✅ | ✅ | CLI/tracker | `services_catalog`=13, `operators` seed |
| 0003 storage | ✅ | ✅ | ✅ | ✅ | CLI/tracker | buckets `signatures`/`pdfs`/`attachments` |
| 0004 extended_schema | ✅ | ✅ | ✅ | ✅ | CLI/tracker | tablas `notifications`+`attachments`; trigger touch |
| 0005 fix_rls_recursion | ✅ | ✅ | ✅ | ✅ | CLI/tracker | funciones `is_staff`/`is_admin` |
| 0006 real_operators | ✅ | ✅ | ❌ | ✅ | **manual (bootstrap)** | `operators`=7 + índice `operators_full_name_uniq` |
| 0007 extend_service_units | ✅ | ✅ | ❌ | ✅ | **manual** | enum `service_unit_t` contiene `m3` + `viaje` |
| 0008 purchase_orders | ✅ | ❌ **falta** | ❌ | ✅ | **manual** | tipos `po_status_t`/`po_event_kind_t`; 6 tablas compras; `set_po_public_id` |
| 0009 rbac | ✅ | ❌ **falta** | ❌ | ✅ | **manual** | tipos `permission_*_t`; 4 tablas RBAC; `has_permission` |
| 0010 documents | ✅ | ❌ **falta** | ❌ | ❌ **NO** | — | tipo `document_type_t` **ausente**; tabla `documents` **ausente** |
| 0011 arca_billing | ✅ | ✅ | ❌ | ❌ **NO** | — | 5 tipos ARCA **ausentes**; 5 tablas fiscales **ausentes**; sin bucket `invoices` |

### 2.1 Lectura de la matriz

- **Disco (wip/docs):** set completo `0001–0011`.
- **`main`:** le faltan `0008`/`0009`/`0010`; tiene `0011` (no aplicada). → **PARIDAD-1**.
- **Tracker:** congelado en `0001–0005`. → **PARIDAD-3** (raíz: bootstrap sin registro).
- **DB real:** `0001–0009` aplicadas; `0010`/`0011` no.
- **4 migraciones aplicadas fuera de banda:** `0006`, `0007`, `0008`, `0009`.
- **2 migraciones genuinamente pendientes:** `0010` (documents), `0011` (ARCA).

### 2.2 Idempotencia de los archivos (clave para sincronizar)

| Migración | Patrón de creación | ¿Re-ejecutable sin error? |
|-----------|--------------------|:-------------------------:|
| 0001 | `create type` / `create table` **sin guard** | ❌ no idempotente |
| 0004, 0006 | `create table if not exists` / `index if not exists` | ✅ mayormente |
| 0007 | `alter type ... add value if not exists` | ✅ |
| 0008, 0009, 0010, 0011 | `create table if not exists` **pero `create type` SIN guard** | ❌ **el `create type` rompe en re-ejecución** |

> **Crítico:** aunque las tablas usan `IF NOT EXISTS`, las sentencias `create type ...
> as enum` de `0008`–`0011` **no** son idempotentes. Re-correr cualquiera de ellas
> contra una DB donde el tipo ya existe aborta con *"type already exists"*. Esto
> condiciona toda estrategia de sincronización (§3) y de `db push` (§4).

---

## 3. Estrategia de Sincronización Segura (propuesta, NO ejecutar)

Objetivo: que el **tracker**, el **repo `main`** y la **DB** cuenten la misma historia,
**sin re-ejecutar SQL ya aplicado** y **sin tocar datos**.

### 3.1 Principio rector

> Separar tajantemente dos operaciones de naturaleza distinta:
> **(A) sincronizar trazabilidad** (metadata: archivos + tracker) — bajo riesgo.
> **(B) aplicar migraciones pendientes** (`0010`/`0011`) — alto riesgo, decisión aparte.
> FASE 0 sólo prepara y propone (A). (B) queda fuera de alcance hasta nueva orden.

### 3.2 Secuencia propuesta

```
PASO 0 — Backup del proyecto Supabase fuera de Supabase (precondición RP6) ........ [requiere aprobación]
PASO 1 — Paridad de archivos: traer 0008/0009/0010 SQL a main vía PR (NO toca DB) . cierra PARIDAD-1
PASO 2 — Resync del tracker: marcar 0006–0009 como aplicadas SIN ejecutarlas ...... cierra PARIDAD-3
          → mecanismo canónico: `supabase migration repair --status applied 0006 0007 0008 0009`
          → alternativa equivalente: INSERT supervisado en supabase_migrations.schema_migrations
PASO 3 — Crear supabase/config.toml + verificar link CLI coherente ................ cierra gap de tooling
PASO 4 — (decisión separada) Endurecer idempotencia de 0010/0011 (guard en create type)
PASO 5 — (decisión separada + backup) Aplicar 0010 documents
PASO 6 — (decisión separada + backup + cert X.509) Aplicar 0011 ARCA o gatear /billing
```

### 3.3 Qué hace y qué NO hace cada paso

| Paso | Toca DB | Toca datos | Toca esquema | Reversible |
|:----:|:-------:|:----------:|:------------:|:----------:|
| 0 backup | lee | no | no | n/a |
| 1 archivos→main | **no** | no | no | sí (revert PR) |
| 2 repair tracker | sí (metadata) | **no** (solo tabla de control) | **no** | sí (DELETE de las filas insertadas) |
| 3 config.toml | no | no | no | sí |
| 4 endurecer SQL | no | no | no | sí |
| 5 aplicar 0010 | **sí** | crea tabla vacía | **sí** | down-migration |
| 6 aplicar 0011 | **sí** | crea tablas+seed | **sí** | down-migration |

> Los pasos **1–4 son seguros** (no alteran el esquema productivo). Los pasos **5–6**
> son los únicos que tocan el esquema y **no se ejecutan en FASE 0**.

### 3.4 Por qué `migration repair` y no `db push`

`supabase migration repair --status applied <versión>` escribe **solo** en el tracker
(marca la migración como aplicada) **sin ejecutar su SQL**. Es exactamente lo que se
necesita para `0006`–`0009`: el SQL ya corrió, falta el registro. `db push`, en cambio,
**ejecutaría** el SQL faltante → rompería por los `create type` no idempotentes (§2.2).

---

## 4. Análisis de Riesgos

### 4.1 Riesgo de `supabase db push` (hoy)

| # | Escenario | Resultado probable | Severidad |
|:-:|-----------|--------------------|:---------:|
| DBP-1 | `db push` con tracker en 0005 | Intenta aplicar `0006–0011`; `create type po_status_t` (0008) aborta con *type already exists* | **Alta** |
| DBP-2 | push "forzado" salteando errores | Estado parcial inconsistente; posible doble seed (RBAC/puntos_venta) | **Crítica** |
| DBP-3 | push tras aplicar 0010/0011 reales | Coherente solo si antes se hizo `repair` de 0006–0009 | Media |

> **Conclusión:** `supabase db push` **no debe ejecutarse** hasta completar PASO 2
> (repair) + PASO 4 (idempotencia). Hoy es una operación destructiva en potencia.

### 4.2 Riesgo de futuras migraciones (0012+)

| # | Riesgo | Mitigación |
|:-:|--------|-----------|
| FM-1 | Nueva migración numerada 0012 asume tracker coherente | Hacer repair (PASO 2) **antes** de crear 0012 |
| FM-2 | Seguir aplicando por bootstrap perpetúa PARIDAD-3 | Prohibir bootstrap para cambios de esquema; usar flujo `supabase migration` con registro |
| FM-3 | `create type` sin guard se repite en nuevas migraciones | Estándar: todo tipo nuevo en bloque `do $$ ... exception when duplicate_object` o `if not exists` |
| FM-4 | Migración sin down/rollback | Exigir down-migration documentada por archivo |

### 4.3 Riesgo de futuros deploys

| # | Riesgo | Mitigación |
|:-:|--------|-----------|
| FD-1 | Código en `main` (p.ej. 0011/ARCA) referencia tablas que no existen → runtime roto | Gatear rutas por `env.arca.configured` / feature-flag hasta aplicar DB |
| FD-2 | Deploy de código nuevo asume esquema 0010/0011 presente | Acoplar checklist: "¿la migración que este código necesita está aplicada en DB?" |
| FD-3 | Solo `main` auto-deploya; el esquema vive adelantado del SQL de `main` | Cerrar PARIDAD-1 (PASO 1) para que `main` documente el esquema que la prod ya tiene |
| FD-4 | Sin backup, un deploy + migración fallida es irreversible | Backup obligatorio (PASO 0) antes de cualquier cambio de esquema |

---

## 5. Recomendación Profesional

1. **El orden correcto es metadata primero, esquema después.** Cerrar PARIDAD-1 (traer
   3 archivos SQL a `main`, PASO 1) y PARIDAD-3 (`migration repair` de 0006–0009,
   PASO 2) **antes** de tocar nada de esquema. Ambos son de bajo riesgo y reversibles.
2. **Congelar `supabase db push` y `supabase-bootstrap.mjs` para cambios de esquema**
   hasta completar la sincronización. Hoy `db push` es destructivo en potencia (§4.1).
3. **No aplicar `0010`/`0011`** en FASE 0. Son decisión separada, con backup previo
   (PASO 0), idempotencia endurecida (PASO 4) y —ARCA— cert X.509.
4. **Institucionalizar el proceso:** crear `config.toml`, exigir registro en tracker
   para todo cambio de esquema, estándar de `create type` idempotente y down-migration
   por archivo. Esto evita reincidir en PARIDAD-3.
5. **Documentación ya alineada a la realidad** (rector §5 corregido + auditoría + esta
   gobernanza). La fuente de verdad documental es: este doc + la auditoría.

> Nada de §3 se ejecuta sin aprobación explícita por paso. FASE 0 entrega diagnóstico,
> matriz, estrategia y riesgos — todo en modo lectura/propuesta.
