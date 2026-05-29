# TOPS NEXUS — STAGING SETUP REPORT (GATE 2 · Fase 1)

> **Estado:** ✅ **STAGING PROVISIONADO Y AISLADO** · **Fecha:** 2026-05-29
> Entorno Supabase Staging creado para ejecutar GATE 2. **Producción intacta.**
> Autorización: MASTER PROMPT "AUTORIZACIÓN GATE 2 — SUPABASE STAGING AISLADO".

---

## 1. Identidad del proyecto

| Campo | Valor |
|-------|-------|
| **Project ID / ref** | `vrxosunxlhohmqymxots` |
| **Nombre** | `tops-nexus-staging` |
| **Organización** | `bzpogcxjwsfvtlebijuy` ("martinbattaglia-commits's Org") |
| **Región** | `sa-east-1` — South America (São Paulo) · **misma región que producción** |
| **Estado** | `ACTIVE_HEALTHY` |
| **PostgreSQL** | 17.6 |
| **Creado** | 2026-05-29T11:18:39Z |
| **Dashboard** | https://supabase.com/dashboard/project/vrxosunxlhohmqymxots |

---

## 2. Conexión (pooler — los proyectos nuevos no exponen conexión directa IPv4)

| Campo | Valor |
|-------|-------|
| Host | `aws-1-sa-east-1.pooler.supabase.com` |
| Puerto | `5432` (session mode — apto para DDL/migraciones) |
| Usuario | `postgres.vrxosunxlhohmqymxots` |
| DB | `postgres` |
| Cliente psql | `psql 18.4` vía `libpq` (Homebrew, keg-only) → `/opt/homebrew/opt/libpq/bin/psql` |

> El host directo `db.<ref>.supabase.co` **no resuelve** (solo IPv6/deprecado); se usa el **pooler** en session mode.

---

## 3. Manejo de secretos

| Secreto | Tratamiento |
|---------|-------------|
| **DB password staging** | Generada aleatoria (`openssl rand -hex 20`, 40 chars). **Nunca impresa en claro.** Fingerprint sha256(first16) = `731fcf23c3ea7452`. |
| Persistencia | `.env.local` (✅ gitignored, verificado `git check-ignore`) bajo claves nuevas con prefijo `STAGING_` (`STAGING_DB_PASSWORD`, `STAGING_PROJECT_REF`, `STAGING_DB_HOST`, `STAGING_DB_URL`). |
| Claves de **producción** en `.env.local` | **Intactas** — no se modificó `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_PROJECT_REF` ni ninguna otra. Solo se **agregaron** claves staging. |
| Access token | Leído de `.env.local` sin imprimir; usado solo para la API de creación. |

---

## 4. Validaciones de aislamiento (verificadas, no asumidas)

| # | Validación | Resultado |
|---|-----------|-----------|
| V1 | Ref staging ≠ ref producción | `vrxosunxlhohmqymxots` ≠ `arsksytgdnzukbmfgkju` ✅ |
| V2 | CLI re-linkeada a staging | `supabase/.temp/project-ref` = `vrxosunxlhohmqymxots` ✅ (ya no apunta a prod) |
| V3 | DB fresca / vacía | `public` tiene **0 tablas**; `supabase_migrations.schema_migrations` no existe ✅ |
| V4 | Conectividad psql | `select version()` → PostgreSQL 17.6 OK ✅ |
| V5 | Proyecto separado en la misma org | listado de proyectos muestra prod + staging como entidades distintas ✅ |
| V6 | App no apunta a staging | `NEXT_PUBLIC_SUPABASE_URL` sigue → prod; la app no se ejecutó contra staging ✅ |

---

## 5. Riesgos y mitigaciones

| Riesgo | Severidad | Mitigación |
|--------|-----------|------------|
| Un `db push`/`db execute` accidental contra prod | 🔴 | CLI re-linkeada a staging (V2); regla permanente: prohibido operar sobre `arsksytgdnzukbmfgkju`; verificación de ref antes de cada comando mutante. |
| Free/shared tier → métricas de performance no idénticas a prod | 🟡 | Documentar números como indicativos; fidelidad de schema/RLS/storage es alta (misma plataforma). |
| Proyecto staging puede pausarse por inactividad | 🟢 | GATE 2 se ejecuta en una sesión continua; al cerrar se puede borrar el proyecto. |
| DB password en `.env.local` | 🟡 | Archivo gitignored; password fuerte; nunca commiteada; rotar/borrar al cerrar GATE 2. |
| Pooler en transaction mode (6543) rompería DDL | 🟢 | Se usa session mode (5432), apto para migraciones. |

---

## 6. Confirmación de aislamiento

> **CONFIRMADO:** el entorno `tops-nexus-staging` (`vrxosunxlhohmqymxots`) está **completamente aislado**
> de producción (`tops-ordenes-prod` / `arsksytgdnzukbmfgkju`): proyecto distinto, ref distinto, DB vacía e
> independiente, CLI re-linkeada a staging, credenciales de prod intactas y app sin apuntar a staging.
> **Producción no fue tocada en ningún momento de la Fase 1.**

---

## 7. ¿Acerca a reemplazar Neuralsoft?

**SÍ.** Sin un entorno fiel y aislado no se puede certificar la base documental/fiscal del ERP sin arriesgar
producción. Este staging habilita la ejecución de GATE 2 (Fases 2–5) con evidencia real y riesgo nulo.

**Próximo paso:** Fase 2 — ejecutar `GATE-2-EXECUTION-PLAN.md` (baseline `0001→0009` → `0010` → `0011`),
capturando evidencia en `GATE2-EVIDENCE-REPORT.md`.
