# STAGING_ENVIRONMENT_CHECK — CRM Comercial F2.1

**Fase:** 1 — Preparación del entorno staging · **Fecha:** 2026-06-06
**Resultado:** ✅ Entorno apto y aislado · ejecución autorizada (staging, NO prod).

---

## 1. Verificación de entorno

| Ítem | Estado | Detalle |
|---|---|---|
| Proyecto Supabase **linkeado** (CLI) | ✅ **staging** | `tops-nexus-staging` · ref `vrxosunxlhohmqymxots` |
| Aislamiento vs producción | ✅ | prod = `arsksytgdnzukbmfgkju` (≠ staging). Regla permanente: prohibido operar sobre prod (STAGING-SETUP-REPORT) |
| Rama de trabajo | ✅ | `feature/crm-comercial-f2-1` (main intacto) |
| Conexión a staging | ✅ | como `postgres` · pooler `aws-1-sa-east-1` (sesión, puerto 5432) · Postgres **17.6** |
| Cliente SQL para ejecutar | ✅ | node `pg` (en `node_modules`) + `STAGING_DB_URL` en `.env.local` (psql ausente; docker daemon abajo — no usados) |
| Migraciones 0041–0046 presentes | ✅ | en `supabase/migrations/` |
| Esquema base en staging | ✅ | `clients, documents, permissions, profiles, roles, role_permissions, user_roles` presentes (0001–0040 aplicado) |
| Esquema CRM en staging (pre-ejecución) | ✅ ausente | ninguna tabla `crm_*` → 0041–0046 a aplicar |

## 2. Guard de seguridad aplicado

El runner de ejecución abortaría si la URL **contiene el ref de prod** o **no contiene el ref de staging**. Verificado en cada conexión:
```
SAFETY: target=staging(vrxosunxlhohmqymxots) · port=5432  ✅
```

## 3. Hallazgo relevante

- El historial `supabase_migrations.schema_migrations` **no es accesible** en staging (la CLI mostraba "Remote" vacío para las 46 migraciones), pero el **esquema real 0001–0040 sí está aplicado**.
- **Decisión:** NO usar `supabase db push` (reintentaría las 46). Aplicar **solo 0041–0046** directamente vía `pg` (son idempotentes), exactamente como pide la Fase 2.

## 4. Veredicto Fase 1

✅ **Entorno staging correcto, aislado de producción, con esquema base presente y herramientas de ejecución disponibles.** Autorizada la Fase 2 (aplicar 0041–0046) y Fase 3 (validación).
