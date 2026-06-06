# PROD_PHASE1_APPLY — Aplicación de 0041–0051 a PROD (Fase 1)

**Proyecto:** TOPS Nexus — Logística TOPS (Verotin S.A.)
**Fecha:** 2026-06-06
**Alcance:** Fase 1 — backup + aplicar `0041`–`0051` a PROD por **SQL Editor**. **Sin Write E2E, sin datos de prueba, sin cleanup.**

> **Reparto de tareas (importante):** los **pasos 1 y 2** los ejecutás **vos** en tu Dashboard/CI (no tengo acceso al SQL Editor de PROD ni puedo disparar tu backup). Los **pasos de verificación 3** los hago **yo** (UI + REST) y vos pegás la salida del script SQL.

---

## Paso 1 — Backup fresco (vos / CI)
- Disparar/confirmar el backup **Supabase→Drive** (sistema productivo) y verificar que termine **verde**.
- Anotar el timestamp/artefacto del backup (es la red de rollback de Fase 1).

## Paso 2 — Aplicar migraciones en orden (vos · SQL Editor PROD)
En el **SQL Editor** de `arsksytgdnzukbmfgkju`, pegar y ejecutar **en este orden estricto** el contenido de cada archivo (`supabase/migrations/`):

```
1.  0041_crm_enums.sql
2.  0042_crm_core.sql
3.  0043_crm_quotes_proposals.sql
4.  0044_crm_contracts_onboarding.sql
5.  0045_crm_sync_audit.sql
6.  0046_crm_rbac_seed.sql
7.  0047_crm_write_path_fns.sql
8.  0048_crm_ingest_lead.sql
9.  0049_crm_list_commercial_users.sql
10. 0050_crm_promote_lead.sql
11. 0051_crm_onboarding_autocreate.sql
```

- Recomendado: **una por una**, confirmando que cada una termina sin error (todas cierran con `notify pgrst, 'reload schema';`).
- Son **idempotentes** (`if not exists` / `create or replace` / `on conflict` / `exception when duplicate_object`) → re-pegar no rompe.
- **Nota sobre `0040`:** NO está en el set autorizado (0041–0051) y `0041+` **no dependen** de él (usan `has_permission`/`profiles` ya en PROD). Queda como ítem aparte (gap de secuencia), no requerido para esta fase.

## Paso 3 — Verificación (mixta)
**(a) Vos · SQL Editor:** ejecutar `supabase/tests/PROD_VERIFY_CRM.sql` y pegarme la tabla de salida. Cubre puntos **2 y 4** del reporte (tablas, enums, RLS, funciones, trigger, RBAC, `profiles_public`). Esperado: todo `PASS`.

**(b) Yo · una vez que confirmes aplicado:**
- **UI** (tu Chrome): navego `/comercial/leads` → confirmo que la fuente dice **Supabase** (ya no "muestra local (sin tabla)"). → punto **3** del reporte.
- **REST** (service-role ya en `.env.local`): confirmo existencia de `crm_*` en PROD (count, sin escribir). → punto **2** (corroboración independiente).

---

## Qué te entrego al cerrar Fase 1 (reporte)
1. **Evidencia de aplicación correcta** — salida de `PROD_VERIFY_CRM.sql` (la pegás vos) + mi corroboración REST.
2. **Tablas CRM existen en PROD** — verificado (SQL + REST).
3. **UI dejó de caer en "muestra local"** — screenshot del browser (lo hago yo).
4. **Estado RLS / RBAC / funciones** — de la salida del verify (RLS en 10 tablas, 7 funciones, trigger, permisos comercial.*).

**Recién con ese reporte decidís el Write E2E.** No ejecuto E2E, no merge, no PR, no deploy.

---

## Restricciones de esta fase
- ✅ Solo schema (0041–0051). Sin datos de prueba, sin cleanup, sin E2E.
- ✅ Backup previo (rollback: restore Supabase→Drive, o teardown por-objeto — ver `PROD_MIGRATION_IMPACT_MATRIX.md §1`).
- ✅ Sin merge / PR / deploy adicional.

> **Acción tuya ahora:** Paso 1 (backup) + Paso 2 (aplicar las 11 en orden) + Paso 3a (correr `PROD_VERIFY_CRM.sql` y pegarme la salida). Con eso ejecuto 3b y compilo el reporte de Fase 1.
