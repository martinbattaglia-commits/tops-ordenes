# TOPS NEXUS — GATE 2 EXECUTION PLAN (Entregable 2 · Fase C)

> **Estado:** plan de ejecución · **NO ejecutado** · **Fecha:** 2026-05-29
> Define el **paso a paso operativo** para correr GATE 2 (aplicar `0010` y, encadenado,
> `0011`) en un entorno **aislado de producción**, con criterios de aprobación/rechazo y
> plan de rollback. **No ejecuta nada.** GATE 2 permanece **PENDIENTE**.
> Fuentes de verdad:
> [INFRASTRUCTURE-DECISION-REPORT.md](./INFRASTRUCTURE-DECISION-REPORT.md) ·
> [ERP-FASE2-GATE2-STAGING-VALIDATION.md](./ERP-FASE2-GATE2-STAGING-VALIDATION.md) ·
> [ERP-FASE3-AUDITORIA-REPOSITORIO.md](./ERP-FASE3-AUDITORIA-REPOSITORIO.md).

---

## 0. Alcance y encuadre

| Dimensión | Definición |
|-----------|------------|
| **Qué valida** | Que el esquema actual soporta `0010` (documents) y, encadenada, `0011` (ARCA) en un entorno fiel, antes de habilitarlas en producción. |
| **Qué NO hace** | NO aplica migraciones en producción · NO toca `main` · NO despliega a Netlify prod · NO crea módulos financieros · NO activa ARCA productivo. |
| **Migraciones bajo prueba** | `0010_documents.sql` (unidad principal) → `0011_arca_billing.sql` (encadenada). |
| **Baseline obligatorio** | `0001`→`0009` (prerequisitos; `0010` NO es auto-contenido — ver §2). |
| **Entorno** | El elegido en Entregable 1 (recomendado: **Supabase Staging aislado**; fallback: **Docker Local**). |
| **Criterio rector** | Cada validación existe porque **acerca a reemplazar Neuralsoft** (storage documental + facturación fiscal son núcleo del ERP). |

> **Estado live verificado (read-only, `supabase migration list`):** remoto tiene `0001`→`0009`
> aplicadas; **`0010` y `0011` NO**. Por eso GATE 2 valida exactamente la transición pendiente.

---

## 1. Prerrequisitos (bloqueantes — deben cumplirse TODOS antes de ejecutar)

### 1.1 Decisión de entorno (Entregable 1)
- [ ] Entorno seleccionado y **autorizado** por el usuario (Staging cloud **o** Docker Local).
- [ ] Si **Staging cloud**: org/región/budget aprobados; proyecto creado (`tops-nexus-staging`, región `sa-east-1`).
- [ ] Si **Docker Local**: Docker Desktop instalado + `supabase init` (crea `config.toml`) + `supabase start` OK.

### 1.2 Aislamiento de producción (CRÍTICO — mitigación del único riesgo real)
> Hoy la CLI **apunta a PROD** (`supabase/.temp/project-ref` = `arsksytgdnzukbmfgkju`).

- [ ] **Re-linkear** la CLI al ref de Staging (cloud) **o** trabajar 100% local (Docker).
- [ ] **Verificar el ref impreso** antes de cualquier comando mutante:
  ```bash
  supabase projects list        # confirmar proyecto activo
  cat supabase/.temp/project-ref  # DEBE != arsksytgdnzukbmfgkju
  ```
- [ ] Variable de conexión exportada apuntando a **STAGING/LOCAL**, nunca a prod:
  ```bash
  echo "$SUPABASE_DB_URL"   # DEBE contener el host de staging/local, jamás el de prod
  ```
- [ ] **Regla permanente:** PROHIBIDO `db push` / `db execute` contra `arsksytgdnzukbmfgkju`.

### 1.3 Herramientas
- [ ] `psql` disponible (hoy ❌ — requerido para correr la batería SQL y los tests).
- [ ] `supabase` CLI ✅ `2.101.0` (verificado).
- [ ] Acceso de red (Staging) o stack local levantado (Docker).

### 1.4 Insumos del repositorio (ya presentes — verificado)
- [ ] `supabase/migrations/0001`→`0011` en disco.
- [ ] `supabase/tests/0010_documents_versioning_test.sql` (test transaccional v1→v2→v3).
- [ ] Capa app de referencia: `src/lib/documents/*`, `src/lib/invoicing/*`, `src/lib/arca/*`.

> **Gate de arranque:** si **cualquier** ítem de §1.1–§1.3 falla → **DETENERSE**. No se ejecuta GATE 2.

---

## 2. Dependencias (por qué "solo 0010" no es literal)

`0010` **no es auto-contenido**: referencia objetos de `0001`→`0009`. Aplicarlo sobre base vacía **falla**.

| Objeto que `0010`/`0011` referencian | Definido en | Dependencia |
|---|---|---|
| `public.clients(id)` | `0001_init.sql` | FK `documents.client_id` |
| `public.vendors(id)` | `0008_purchase_orders.sql` | FK `documents.vendor_id` |
| `depot_t` (enum) | `0001_init.sql` | columna `documents.depot` |
| `public.current_role()` | `0001` + `0005_fix_rls_recursion.sql` | TODAS las RLS + `log_document_event` |
| `public.profiles(id, client_id, role)` | `0001_init.sql` | scoping multi-tenant |
| `permissions / roles / role_permissions` | `0009_rbac.sql` | seeds RBAC de `0010`/`0011` |
| `auth.users`, `storage.*`, `pg_publication` | Supabase nativo | FKs, buckets, policies, realtime |

**Orden de aplicación correcto:**
```
baseline 0001 → 0002 → … → 0009   (prerequisitos)
   └─ unidad principal:  0010_documents.sql
        └─ encadenada:   0011_arca_billing.sql   (depende de profiles/clients/current_role + patrón audit de 0010)
EXCLUIR: 0012+ (no existe migración; solo diseño conceptual — Entregable 5)
```

---

## 3. Procedimiento de ejecución (paso a paso · NO ejecutar ahora)

> Todos los comandos asumen `SUPABASE_DB_URL` → **STAGING/LOCAL**. Verificado en §1.2.

### Paso 0 — Provisión + verificación de aislamiento
```bash
# (Staging) crear/confirmar proyecto aislado, re-linkear, verificar ref != prod
# (Local)  supabase start  → usar la DB_URL local impresa
test "$(cat supabase/.temp/project-ref 2>/dev/null)" != "arsksytgdnzukbmfgkju" || { echo "ABORT: apunta a PROD"; exit 1; }
```

### Paso 1 — Baseline 0001→0009
```bash
for f in 0001 0002 0003 0004 0005 0006 0007 0008 0009; do
  psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/${f}_*.sql || exit 1
done
```
**Check:** las 9 migraciones aplican sin error; `current_role()`, `profiles`, `clients`, `vendors`, RBAC seeds presentes.

### Paso 2 — Unidad principal: 0010
```bash
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/0010_documents.sql
```
**Check:** crea `documents`, `documents_audit`, triggers (version/audit/guard), policies, bucket `documents` (`public=false`, 25 MiB, mime allowlist).

### Paso 3 — Batería de validación de 0010 (ver §4 para criterios)
1. **Versionado:** `psql -f supabase/tests/0010_documents_versioning_test.sql` + test de concurrencia (dos sesiones, mismo `supersedes_id`, `FOR UPDATE` serializa → un solo `is_current`).
2. **Auditoría append-only:** ciclo create/soft-delete/restore/hard-delete; `log_document_event` bajo cliente ajeno → `RAISE 'Acceso denegado'`; `insert into documents_audit` como `authenticated` → falla (sin policy).
3. **Soft-delete:** invisibilidad para no-admin; restore reaparece + audit `restore`.
4. **Signed URLs:** TTL 300 s abre; expira; acceso directo sin firma → denegado por policy de `storage.objects`.
5. **MIME:** SVG/GIF/HEIC rechazados en las 3 barreras (app `ALLOWED_MIME`, check constraint, bucket allowlist).
6. **Multi-tenant A/B/C:** 3 clients + 3 profiles `cliente`; cada uno ve solo lo propio en **tabla y storage** (`split_part(name,'/',1)`); cross-tenant → 0 filas / denegado.
7. **Performance 100/500/1000/5000:** `explain analyze` listado (p95 < 200 ms), FTS español, rango temporal BRIN, dedup hash; **ningún `Seq Scan`** en caminos indexados.

### Paso 4 — Encadenada: 0011 (ARCA)
```bash
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/0011_arca_billing.sql
```
**Check:** crea `fiscal_config` (singleton), `puntos_venta`, `customer_invoices`, `invoice_items`, `invoice_audit`; trigger `customer_invoices_lock` (fn `tg_lock_authorized_invoice`); RLS; bucket privado `invoices`.

### Paso 5 — Batería de validación de 0011
1. **Singleton `fiscal_config`:** segunda fila → rechazada.
2. **Inmutabilidad fiscal:** con `estado_arca='AUTORIZADO_ARCA'`, UPDATE de campos fiscales (`cae`, `total`, `numero_comprobante`, `cuit_cliente`, etc.) → `tg_lock_authorized_invoice` RAISE. Permitido: anulación lógica + materializar PDF.
3. **Auditoría facturas:** emisión escribe filas en `invoice_audit` (estado + payload); append-only.
4. **RLS multi-tenant facturas:** cliente solo ve sus comprobantes; internos ven todo.
5. **Storage `invoices`:** privado; verificar scoping (R4 conocido: bucket sin scoping por cliente → **documentar gap**, no bloquea GATE 2 de schema).
6. **Emisión MOCK (SANDBOX):** `emitInvoice()` end-to-end con `MockArcaService` → CAE simulado, QR fiscal (`buildFiscalQr`), PDF render, persistencia + 2 filas audit. **NO** se prueba ARCA producción (STUB `NOT_READY`).

### Paso 6 — Rollback de prueba (ver §6)
Ejecutar el rollback de `0011` y `0010` y confirmar que la DB vuelve a baseline `0001`→`0009` sin huérfanos.

---

## 4. Criterios de APROBACIÓN (GO de GATE 2)

GATE 2 se aprueba **solo si TODOS** se cumplen con evidencia capturada (logs/`explain`/screenshots):

| # | Criterio | Evidencia requerida |
|---|----------|---------------------|
| A1 | `0001`→`0009`→`0010`→`0011` aplican en orden sin error | salida `psql ON_ERROR_STOP=1` limpia |
| A2 | Versionado: un solo `is_current` por grupo incluso bajo concurrencia | test + prueba de 2 sesiones |
| A3 | Auditoría documents/invoices append-only e inviolable | intentos de INSERT directo fallan |
| A4 | Multi-tenant aísla **fila y objeto** (A/B/C) | matriz cruzada con 0 fugas |
| A5 | Signed URLs: abre con firma, expira, deniega sin firma | 3 casos verificados |
| A6 | MIME allowlist bloquea SVG/GIF/HEIC en 3 capas | rechazos verificados |
| A7 | Performance p95 < 200 ms a 5000 docs, sin `Seq Scan` indebido | `explain analyze` |
| A8 | `fiscal_config` singleton + inmutabilidad de factura autorizada | RAISE verificados |
| A9 | Emisión MOCK (SANDBOX) completa: CAE sim + QR + PDF + audit | flujo end-to-end |
| A10 | Rollback deja baseline intacto, sin objetos huérfanos | DB diff pre/post |

---

## 5. Criterios de RECHAZO (NO-GO / DETENERSE)

DETENER y documentar (no continuar sin nueva autorización) ante **cualquiera**:

| # | Condición de rechazo | Acción |
|---|----------------------|--------|
| R1 | Cualquier comando apunta o impacta `arsksytgdnzukbmfgkju` (PROD) | **ABORTAR inmediato**, incidente |
| R2 | `0010` u `0011` fallan al aplicar sobre baseline | DETENER, capturar error, NO tocar prod |
| R3 | Aparece segundo `is_current` o se rompe la serialización de versiones | DETENER (C-1 reabierto) |
| R4 | Fuga multi-tenant (cliente ve fila/objeto ajeno) | DETENER (riesgo de datos) |
| R5 | Auditoría falsificable (INSERT directo exitoso) | DETENER (integridad) |
| R6 | Signed URL accesible sin firma o no expira | DETENER (exposición) |
| R7 | Factura `AUTORIZADO_ARCA` resulta mutable | DETENER (compliance fiscal) |
| R8 | Performance con `Seq Scan` en caminos críticos o p95 >> 200 ms | DETENER, revisar índices |
| R9 | Rollback deja huérfanos o corrompe baseline | DETENER, no certificar |

> Regla del gate: **"Ante hallazgo crítico: DETENERSE. DOCUMENTAR. NO CONTINUAR SIN APROBACIÓN."**

---

## 6. Plan de ROLLBACK

> Aislado por diseño: en Staging/Local, revertir es trivial y **no afecta producción**.

### 6.1 Rollback rápido (preferido)
```bash
# Staging cloud:  supabase db reset   (re-aplica migraciones desde cero) — o borrar el proyecto.
# Docker local:   supabase db reset    o   supabase stop  (descarta el stack efímero).
```

### 6.2 Rollback quirúrgico de 0011 (orden inverso)
```sql
drop trigger if exists customer_invoices_lock on public.customer_invoices;
drop function if exists public.tg_lock_authorized_invoice();
-- drop policies de customer_invoices / invoice_items / invoice_audit / fiscal_config / puntos_venta / storage.objects(invoices)
drop table if exists public.invoice_audit;
drop table if exists public.invoice_items;
drop table if exists public.customer_invoices;
drop table if exists public.puntos_venta;
drop table if exists public.fiscal_config;
delete from storage.buckets where id='invoices';
-- drop enums propios de 0011 (estado de comprobante, tipo, etc.)
```

### 6.3 Rollback quirúrgico de 0010 (orden inverso)
```sql
drop trigger if exists trg_documents_audit on public.documents;
drop trigger if exists trg_documents_version on public.documents;
drop trigger if exists trg_documents_guard on public.documents;
drop function if exists public.tg_documents_audit(), public.tg_documents_version(),
  public.tg_documents_guard(), public.log_document_event(uuid,document_audit_action_t,text,text,jsonb);
-- drop policies de documents / documents_audit / storage.objects(documents)
drop table if exists public.documents_audit;
drop table if exists public.documents;
delete from storage.buckets where id='documents';
drop type if exists document_source_t; drop type if exists document_audit_action_t; drop type if exists document_type_t;
```
**Criterio de rollback OK:** DB vuelve a estado pre-0010 (baseline `0001`→`0009` intacto), buckets y objetos eliminados, sin objetos huérfanos.

---

## 7. ¿Acerca a reemplazar Neuralsoft?

| Pregunta | Respuesta |
|----------|-----------|
| ¿GATE 2 acerca a reemplazar Neuralsoft? | **SÍ.** Certifica las dos capas núcleo del ERP: gestión documental multi-tenant (`0010`) y facturación fiscal con inmutabilidad/auditoría (`0011`). Sin GATE 2 verde no se puede habilitar el ERP financiero con seguridad. |
| ¿Este plan implementa algo? | **No.** Es el procedimiento listo para ejecutar cuando exista el entorno aislado autorizado. |

> **Estado final:** plan completo y accionable. **GATE 2 PENDIENTE** hasta que (1) se autorice el entorno
> (Entregable 1) y (2) se ejecute este plan capturando evidencia. La decisión de ejecutar es **ejecutiva**.
