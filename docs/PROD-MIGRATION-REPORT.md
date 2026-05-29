# TOPS NEXUS — PROD MIGRATION REPORT (FASE D · Cierre de C1)

> **Estado:** ✅ **0010 + 0011 APLICADAS EN PRODUCCIÓN Y REGISTRADAS** · **Fecha:** 2026-05-29
> Aplicación controlada en producción (`arsksytgdnzukbmfgkju` / `tops-ordenes-prod`) de **exactamente**
> las migraciones `0010_documents.sql` y `0011_arca_billing.sql`, usando la evidencia validada en GATE 2.
> Autorización: MASTER PROMPT "FASE D — PRODUCCIÓN CONTROLADA — CIERRE DE C1".

---

## 1. Alcance ejecutado (y NO ejecutado)

| Acción | Estado |
|--------|--------|
| Aplicar `0010_documents.sql` en prod | ✅ |
| Aplicar `0011_arca_billing.sql` en prod | ✅ |
| Registrar ambas en `supabase_migrations.schema_migrations` | ✅ |
| Crear nuevas migraciones | ⛔ No |
| Modificar código / desplegar funcionalidades | ⛔ No |
| Implementar `ProductionArcaService` | ⛔ No |
| Modificar RBAC / iniciar `0012` | ⛔ No |
| Tocar Tesorería / Cuentas Corrientes | ⛔ No |

---

## 2. Método de aplicación

| Campo | Valor |
|-------|-------|
| Proyecto | `arsksytgdnzukbmfgkju` (producción) |
| Mecanismo | **Supabase Management API** — `POST /v1/projects/{ref}/database/query` (autorizado vía `SUPABASE_ACCESS_TOKEN`) |
| Atomicidad | Cada migración enviada envuelta en `BEGIN … COMMIT` (rollback total ante cualquier error) |
| Registro | `INSERT INTO supabase_migrations.schema_migrations(version,name,statements)` dentro de la **misma transacción** |
| Credenciales | Sin compartir password de DB de prod; sólo access token ya autorizado. Service role / claves productivas **no modificadas**. |

> Se eligió Management API (decisión ejecutiva del operador) para no exponer la contraseña de la base de
> producción en el transcript. Equivale funcionalmente a `supabase db push`: aplica el SQL y registra la versión.

---

## 3. Pre-flight (read-only, antes de mutar)

| Verificación | Resultado |
|--------------|-----------|
| Migraciones ya registradas en prod | `0001`→`0009` presentes; `0010`/`0011` **ausentes** |
| Archivos de migración en repo | solo `0001`..`0011` — **no existe `0012`** (db-push-equivalente no barre nada extra) |
| Tablas objetivo preexistentes | **ninguna** (`documents`/`customer_invoices`/etc. no existían) → aplicación limpia, sin doble-aplicación |
| Statements incompatibles con transacción | ninguno (sin `CONCURRENTLY`, sin meta-comandos psql, sin `BEGIN/COMMIT` propios) |

---

## 4. Resultado de aplicación

| Migración | Respuesta API | Veredicto |
|-----------|---------------|-----------|
| `0010_documents.sql` | `[]` (sin error) | ✅ aplicada + registrada (`version=0010`, `name=documents`) |
| `0011_arca_billing.sql` | `[]` (sin error) | ✅ aplicada + registrada (`version=0011`, `name=arca_billing`) |

### 4.1 Migraciones registradas (post-aplicación, verificado)

```
0001 init · 0002 seed · 0003 storage · 0004 extended_schema · 0005 fix_rls_recursion
0006 real_operators · 0007 extend_service_units · 0008 purchase_orders · 0009 rbac
0010 documents · 0011 arca_billing      ← NUEVAS
```
→ `supabase migration list` ahora reportaría `0010`/`0011` como **sincronizadas** (registro verificado directamente en `schema_migrations`).

---

## 5. Objetos creados (verificados en prod)

| Categoría | Objetos |
|-----------|---------|
| Tablas (7) | `documents`, `documents_audit`, `customer_invoices`, `invoice_items`, `fiscal_config`, `puntos_venta`, `invoice_audit` |
| Triggers | `trg_documents_audit`, `trg_documents_guard`, `trg_documents_version`, `customer_invoices_lock` |
| Función fiscal | `tg_lock_authorized_invoice` |
| Buckets | `documents` (privado), `invoices` (privado) |
| Storage policies (documents/invoices) | 5 |
| RLS | habilitado (`relrowsecurity=true`) en las 7 tablas |
| Total tablas `public` | 23 (baseline) → **27** |

> **Seed de la propia `0011`:** `fiscal_config` queda con **1 fila** singleton por defecto (VEROTIN S.A.,
> **ambiente=SANDBOX**, `cert_alias=null`). Es parte de la migración, **no** habilita emisión productiva ni
> contiene datos fiscales reales. No se cargó ningún comprobante.

---

## 6. Riesgo y reversibilidad

- **Naturaleza aditiva:** `0010`/`0011` sólo **crean** objetos nuevos; **no** alteran ni borran tablas/datos preexistentes de prod. Riesgo sobre datos existentes = nulo.
- **Validación previa:** ambas migraciones pasaron GATE 2 en staging idéntico (PG 17.6, misma región) — aplican limpio y enforced.
- **Rollback disponible** (si se requiriera, con autorización): `DROP` de las 7 tablas + triggers + buckets + policies + borrar las 2 filas de `schema_migrations`. No hay dependencias de datos productivos hacia estos objetos todavía.

---

## 7. Estado de C1

> **C1 CERRADO a nivel de schema.** Las tablas que el runtime de `/billing` y `/settings/fiscal` consulta
> cuando `isMock()=false` **ya existen en producción**. La aplicación ya no fallaría por tablas ausentes.
> (La emisión fiscal real sigue dependiendo de `ProductionArcaService` — fuera del alcance de FASE D.)

---

## 8. ¿Acerca a reemplazar Neuralsoft?

**SÍ — paso decisivo.** Es la primera vez que la base documental y fiscal de TOPS Nexus existe **en producción**,
validada y registrada. Cierra el bloqueo de runtime C1 y habilita la operación documental real y la futura
emisión fiscal (sobre ARCA real, gate aparte).
