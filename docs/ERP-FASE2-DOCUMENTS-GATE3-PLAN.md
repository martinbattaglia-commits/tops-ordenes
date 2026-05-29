# NEXUS ERP — FASE 2 · DOCUMENTS · GATE 3 · PLAN DE APLICACIÓN A PRODUCCIÓN

> **⚠️ STATUS REAL (2026-05-29 post-audit):** 🟢 **GATE 3 YA EJECUTADO EN PRODUCCIÓN.**
> Verificado read-only por `scripts/erp-fase2-documents-prod-audit.mjs`: tablas
> `documents` + `documents_audit` existen, bucket privado con whitelist MIME y
> file_size_limit, 5 permisos `documental.*` activos. Cierre formal en
> [ERP-FASE2-DOCUMENTS-GATE3-CLOSURE.md](./ERP-FASE2-DOCUMENTS-GATE3-CLOSURE.md).
>
> Este documento queda vivo como **runbook de referencia** + **rollback procedure**
> + **plan de re-aplicación** para entornos futuros (DR, nuevo tenant, staging
> rebuild). El plan teórico abajo se mantiene íntegro a efectos de gobernanza.

---

> **Estado del entregable original (cuando se redactó):** 📋 **PLAN · NO EJECUCIÓN.**
> Este documento es el cierre formal de la **iniciativa I7b** del roadmap
> ([ERP-ROADMAP-12-MESES.md](./ERP-ROADMAP-12-MESES.md) §Q1). Consolida el camino
> auditado → diseñado → materializado → validado en staging, y formaliza el
> **plan de aplicación a producción** con runbook, verificación, rollback y
> communication plan.
>
> **PROHIBIDO en esta fase:** aplicar a producción · `db push` a prod · merge a
> `main` · abrir PR · modificar `fiscal_config` · ejecutar F2–F6 ARCA · usar
> certificados reales. Las únicas acciones permitidas son **lectura** y
> **documentación**. El `GATE 3 — EXECUTION` queda como gate aparte que
> requiere aprobación explícita del CTO + Operaciones + Compliance.
>
> **Fecha:** 2026-05-30 · **Rama:** `feature/arca-production-fase-e` · **Punto
> de restauración previo:** tag `arca/fase-f1-freeze` (`35ae33f`).

---

## 0. Resumen ejecutivo

**FASE 2 · DOCUMENTS** llegó a punto de aplicación. La migración
`0010_documents.sql` (449 líneas, Enterprise Hardened) cierra los 8 bloqueantes
de la auditoría inicial, está materializada en disco, **validada en staging
aislado** (`tops-nexus-staging` = `vrxosunxlhohmqymxots`), y la app
(`/documental` + `actions.ts` + `storage.ts` + `UploadDocument.tsx`) compila
contra ese schema con `signed URLs` + auditoría + versionado + soft-delete.

**El único trabajo restante es GATE 3 — la ejecución coordinada en producción.**
Este plan documenta esa ejecución de forma turn-key: cuando exista la
autorización explícita, el operador sigue el runbook sin improvisar.

| Componente | Estado | Evidencia |
|---|---|---|
| Auditoría diagnóstica | ✅ Completa | [ERP-FASE2-DOCUMENTS-0010-AUDITORIA.md](./ERP-FASE2-DOCUMENTS-0010-AUDITORIA.md) (239 líneas) |
| Diseño Enterprise Hardened | ✅ Aprobado | [ERP-FASE2-DOCUMENTS-HARDENING.md](./ERP-FASE2-DOCUMENTS-HARDENING.md) (478 líneas) |
| GATE 1 — Materialización | ✅ En disco | [ERP-FASE2-GATE1-MATERIALIZACION.md](./ERP-FASE2-GATE1-MATERIALIZACION.md) (225 líneas) |
| GATE 2 — Validación staging | ✅ Validado | [DOCUMENTS-VALIDATION-REPORT.md](./DOCUMENTS-VALIDATION-REPORT.md) (133 líneas) |
| GATE 3 — Plan de aplicación | 📋 **ESTE DOCUMENTO** | Pendiente de ejecución autorizada |
| GATE 3 — Ejecución | ⏳ NO EJECUTADO | Requiere aprobación CTO + Operaciones + Compliance |

---

## 1. Pre-requisitos (verificables sin tocar producción)

Cada item debe quedar ✅ antes de que el CTO autorice ejecución. Marque con
fecha + responsable. El script `scripts/erp-fase2-documents-gate3-preflight.mjs`
verifica los 6 primeros automáticamente (read-only).

| # | Pre-requisito | Tipo | Cómo verificar | Estado |
|---|---|---|---|---|
| **PR-1** | Migración `0010_documents.sql` presente en repo, idéntica a la validada en staging | Estático | `git log --oneline supabase/migrations/0010_documents.sql` + diff vs `feature/documents-enterprise-ready` HEAD `5cf6a44` | ☐ |
| **PR-2** | App `actions.ts` + `storage.ts` + `UploadDocument.tsx` referencian `createSignedUrl`, NO `getPublicUrl` | Estático | `grep -n getPublicUrl src/lib/documental/ src/app/\(app\)/documental/` debe devolver 0 hits | ☐ |
| **PR-3** | `npm run build` verde con tipo-check estricto | Build | `npm run typecheck && npm run build` | ☐ |
| **PR-4** | Producción NO tiene la tabla `documents` ni el bucket `documents` (precondición de idempotencia limpia) | Read-only DB | `node scripts/supabase-check.mjs` apuntando a `arsksytgdnzukbmfgkju` | ☐ |
| **PR-5** | Restore point Supabase creado en proyecto producción ANTES de ejecutar | DB action (sin schema change) | Supabase Dashboard → Database → Backups → "Restore Points" → "Create now" | ☐ |
| **PR-6** | Backup lógico `pg_dump` completo de producción guardado fuera de Supabase | DB read | `supabase db dump` o `pg_dump` con `service_role` → archivo `backups/prod-pre-0010-YYYYMMDD.sql.gz` | ☐ |
| **PR-7** | Idempotencia del SQL verificada en staging (re-ejecución sin error) | Re-ejecución staging | Aplicar 0010 dos veces consecutivas a `tops-nexus-staging`; ambas deben terminar OK | ☐ |
| **PR-8** | Ventana de mantenimiento acordada (≥30 min, fuera de horario operativo) | Coordinación | Confirmar con Ruth (Admin) + JL (Director Ops) + Cynthia (Comercial) | ☐ |
| **PR-9** | Equipo on-call disponible: 1 DBA, 1 dev front, 1 sponsor | Coordinación | Lista de teléfonos + WhatsApp en §9 | ☐ |
| **PR-10** | Rollback runbook (§7) revisado y comprendido | Lectura | Walkthrough con CTO + DBA | ☐ |

---

## 2. Decisión de ejecución (GO / NO-GO)

GATE 3 se ejecuta SOLO si **todos** los pre-requisitos están ✅ y se cumplen las
siguientes condiciones:

- [ ] Aprobación firmada CTO: `___________________________ · fecha _________`
- [ ] Aprobación firmada Operaciones (JL): `_______________ · fecha _________`
- [ ] Aprobación firmada Compliance / DT: `_______________ · fecha _________`
- [ ] Hora de ejecución: `_________________` (horario UTC-3, fuera de pico)
- [ ] Comunicación enviada a stakeholders (§9) `T-24h`

Si **cualquier** item queda en blanco → **NO-GO**, reprogramar.

---

## 3. Orden crítico — co-deploy

> ⚠️ **NO se puede aplicar 0010 sin desplegar la app sincronizada.** El bucket
> pasa de público a privado; la UI vieja con `getPublicUrl` dejaría de mostrar
> archivos. Y la app nueva sin 0010 fallaría porque la tabla no existe.

```
┌──────────────────────────────────────────────────────┐
│  T-15min  · Pre-flight script (read-only)             │
│  T-10min  · Anuncio "ventana inicia en 10 min"        │
│  T+0      · 1. Crear restore point Supabase           │
│  T+1min   · 2. Aplicar 0010 vía SQL Editor             │
│  T+3min   · 3. Verificar objetos creados (§5)         │
│  T+5min   · 4. Deploy app a Netlify (--prod)          │
│  T+8min   · 5. Smoke test /documental (§6)            │
│  T+12min  · 6. Confirmación final · anuncio cierre    │
│  T+15min  · Ventana cierra                            │
└──────────────────────────────────────────────────────┘
```

**Total ejecución estimado: 15 min**. Margen de seguridad: ventana total
≥ 30 min.

---

## 4. Runbook de aplicación

### 4.1 Preparación (T-15min)

```bash
# 1. Pre-flight (read-only, no toca prod)
cd /Users/martinbattaglia/CODE/tops-ordenes
node scripts/erp-fase2-documents-gate3-preflight.mjs

# Output esperado: TODAS las verificaciones ✅
# Si alguna falla → ABORT, no proceder.

# 2. Confirmar branch + HEAD
git status
git rev-parse HEAD
# Branch debe ser feature/arca-production-fase-e o derivada limpia
# HEAD debe contener 0010_documents.sql Enterprise Hardened (449 líneas)

# 3. Confirmar typecheck + build local
npm run typecheck
npm run build
# Ambos deben pasar limpio.
```

### 4.2 Restore point (T+0)

1. Abrir [app.supabase.com/project/arsksytgdnzukbmfgkju/database/backups](https://app.supabase.com/project/arsksytgdnzukbmfgkju/database/backups)
2. Click **"Create restore point"**
3. Nombre: `pre-0010-documents-YYYYMMDD-HHMM`
4. Esperar confirmación (~30s)
5. Anotar el ID del restore point en el log de ejecución

### 4.3 Aplicar migración (T+1min)

1. Abrir [app.supabase.com/project/arsksytgdnzukbmfgkju/sql/new](https://app.supabase.com/project/arsksytgdnzukbmfgkju/sql/new)
2. Copiar el contenido **completo** de `supabase/migrations/0010_documents.sql`
3. Pegar en el SQL Editor
4. Click **Run**
5. Verificar output: cada bloque debe terminar con "Success. No rows returned"
   o con count > 0 para los `insert into ... select`.
6. **Anotar timing en log de ejecución.**

### 4.4 Verificación inmediata (T+3min)

Ejecutar en el SQL Editor:

```sql
-- Tablas
select
  (select count(*) from information_schema.tables
   where table_schema='public' and table_name='documents') as documents_table,
  (select count(*) from information_schema.tables
   where table_schema='public' and table_name='documents_audit') as audit_table;
-- Esperado: 1, 1

-- Tipos
select
  (select count(*) from pg_type where typname='document_type_t') as t_type,
  (select count(*) from pg_type where typname='document_source_t') as t_source,
  (select count(*) from pg_type where typname='document_audit_action_t') as t_action;
-- Esperado: 1, 1, 1

-- Bucket privado
select id, name, public, file_size_limit, allowed_mime_types
from storage.buckets where id='documents';
-- Esperado: public=false, file_size_limit>0, allowed_mime_types con pdf+png+jpeg+webp+tiff

-- Triggers
select count(*) from pg_trigger where tgname like 'tg_documents%';
-- Esperado: ≥2 (tg_documents_guard, tg_documents_version, tg_documents_audit)

-- RLS
select tablename, rowsecurity from pg_tables
where schemaname='public' and tablename in ('documents','documents_audit');
-- Esperado: ambas con rowsecurity=true

-- Permisos
select slug from public.permissions where slug like 'documental%' order by slug;
-- Esperado: documental.view, documental.create, documental.delete, documental.export, documental.admin

-- Schema reload
notify pgrst, 'reload schema';
```

### 4.5 Deploy app (T+5min)

```bash
cd /Users/martinbattaglia/CODE/tops-ordenes
export NETLIFY_AUTH_TOKEN=<token>
npx netlify deploy --prod --build --cwd /Users/martinbattaglia/CODE/tops-ordenes
```

Esperar a `Deploy is live!`. Anotar el `deploy_id` y el URL único.

### 4.6 Smoke test post-deploy (T+8min)

Validar en `https://tops-ordenes.netlify.app` (o custom domain si configurado):

```bash
# Ping endpoints aún funcionan
curl -s https://tops-ordenes.netlify.app/api/clientify/ping | head -3
curl -s https://tops-ordenes.netlify.app/api/cctv/ping | head -3

# /documental responde sin 500
curl -s -I https://tops-ordenes.netlify.app/documental
```

Manualmente desde browser (operador con login real):

1. Login con `joseluis@logisticatops.com`
2. Ir a `/documental`
3. Subir un PDF de prueba (factura sandbox, no real)
4. Verificar:
   - ✅ Upload completa sin error
   - ✅ Mensaje "Documento procesado" aparece
   - ✅ OCR extrae datos (tipo, fecha, monto)
   - ✅ Click en "Ver archivo original" abre un **signed URL** (NO `getPublicUrl`)
   - ✅ El signed URL tiene expiración (`?token=...&expires=...`)
5. Verificar en Supabase:
   ```sql
   select id, type, title, version, is_current, deleted_at
   from public.documents order by uploaded_at desc limit 5;
   ```
   - El documento subido debe estar listado, `version=1`, `is_current=true`,
     `deleted_at=null`.
6. Verificar audit:
   ```sql
   select * from public.documents_audit order by ts desc limit 5;
   ```
   - Debe existir una fila `action='create'` para el documento.

### 4.7 Cierre (T+12min)

- [ ] Notificar canal interno: "GATE 3 completado. /documental operativo."
- [ ] Actualizar este documento (sección §10) con: timestamp final,
      `deploy_id`, `restore_point_id`, `commit_sha` aplicado.
- [ ] Tag de éxito: `git tag -a "erp-fase2-documents-gate3-applied" -m "..."`
      + push tag.
- [ ] Cerrar ventana de mantenimiento.

---

## 5. Verificación post-aplicación (read-only)

Después del runbook, dejar correr `node scripts/erp-fase2-documents-gate3-preflight.mjs --post`
(modo post-aplicación) para confirmar el estado final. Esperado:

```
🟢 documents table         exists (0 rows)
🟢 documents_audit table   exists (0 rows)
🟢 document_type_t          11 valores
🟢 document_source_t         5 valores
🟢 document_audit_action_t   4 valores
🟢 bucket documents          private (public=false)
🟢 file_size_limit          20971520 bytes (20 MB)
🟢 allowed_mime_types       5 tipos (pdf + 4 imágenes)
🟢 triggers                  3 (guard, version, audit)
🟢 RLS habilitada            documents=t, documents_audit=t
🟢 permisos                  5 documental.*
🟢 idempotencia              re-ejecutar 0010 → 0 errores
```

---

## 6. Criterios de éxito

GATE 3 se considera **EXITOSO** si:

- ✅ Todas las verificaciones de §5 pasan
- ✅ Smoke test de §4.6 completa sin error
- ✅ Audit registra el upload de prueba
- ✅ Signed URL del documento de prueba se abre sin error
- ✅ No hay errores 500 en `/documental` durante 30 min post-aplicación
- ✅ Endpoints existentes (`/api/clientify/ping`, `/api/cctv/ping`,
      `/compras`, `/dashboard`) siguen respondiendo 200

GATE 3 se considera **FALLIDO** y dispara rollback (§7) si:

- ❌ El SQL de 0010 lanza error durante la aplicación
- ❌ Cualquier verificación de §5 reporta estado incorrecto
- ❌ El bucket queda accidentalmente público
- ❌ La app post-deploy lanza 500 en `/documental`
- ❌ El upload de prueba falla en cualquier paso

---

## 7. Rollback procedure

### 7.1 Si falla durante §4.3 (aplicación SQL)

El SQL es **idempotente con guards** (`do $$ begin … exception when duplicate_object then null; end $$`).
La mayoría de errores son por:
- Falta de extensión `pgcrypto` (instalada en migrations 0001)
- Conflicto con objetos pre-existentes (no debería haber, validado en PR-4)
- Permisos insuficientes del rol postgres

**Acción:** copiar el output exacto del error al log, **NO seguir adelante**.
Notificar al canal #ops + DBA. Restore point queda intacto, NO se aplicó nada
parcialmente porque cada bloque es transaccional.

### 7.2 Si falla durante §4.6 (smoke test post-deploy)

Si la app no anda pero el SQL aplicó OK:

```bash
# 1. Revert deploy app
npx netlify rollback  # o redeploy desde commit anterior

# 2. Si el bug es del schema → eliminar objetos creados
```

```sql
-- Rollback del schema (con datos vivos = NO usar; con tabla vacía recién creada = OK)
begin;
  drop trigger if exists tg_documents_audit on public.documents;
  drop trigger if exists tg_documents_version on public.documents;
  drop trigger if exists tg_documents_guard on public.documents;
  drop function if exists public.tg_documents_audit() cascade;
  drop function if exists public.tg_documents_version() cascade;
  drop function if exists public.tg_documents_guard() cascade;
  drop function if exists public.log_document_event(uuid,document_audit_action_t,text,text,jsonb) cascade;
  drop table if exists public.documents_audit;
  drop table if exists public.documents cascade;
  drop type if exists public.document_audit_action_t;
  drop type if exists public.document_source_t;
  drop type if exists public.document_type_t;
  delete from storage.buckets where id='documents';
  delete from public.permissions where slug in ('documental.export','documental.admin');
  -- (los permisos documental.view/create/delete ya existían — NO borrar)
commit;
```

### 7.3 Si falla después del cierre (datos cargados)

**NO drop.** Hay data productiva. Rollback degradado:

1. Desactivar la UI: feature-flag o deploy de la app con `/documental` returning 503
2. Mantener el schema intacto (la data está privada + auditada, no se pierde)
3. Diagnosticar offline qué falló
4. Corregir en una migración 0011-followup
5. Re-aplicar

**El restore point del paso 4.2 NO se debe usar para rollback de datos** si
ya hay uploads productivos (se perderían). El restore point es para
**catastrophic recovery** únicamente.

---

## 8. Riesgos y mitigaciones (heredados de GATE 1)

| Riesgo | Severidad | Mitigación implementada | Validable en pre-flight |
|---|---|---|---|
| `tg_documents_version` dispara `tg_documents_guard` | BAJO | Guard solo bloquea cambios de contenido; `is_current` no es contenido | Sí — staging validó |
| Dedup unique `(client_id,file_hash)`: docs globales no deduplican | BAJO | Aceptado y documentado | Sí — diseño |
| Signed URL TTL 300s puede ser corto | BAJO | `getSignedUrl(path, ttl)` parametrizable | Sí — code review |
| `log_document_event` SECURITY DEFINER | BAJO | `set search_path=public`, solo inserta en audit | Sí — code review |
| App `getUser()` sin sesión → `uploaded_by` null | BAJO | Nullable por diseño | Sí — schema |
| Co-deploy mal sincronizado | **MEDIO** | Runbook §3 enforza orden estricto | Sí — runbook |
| Bucket queda público por error humano | **MEDIO** | Verificación §4.4 + §5 explícita | Sí — script post |
| Restore point no se creó | **CRÍTICO** | PR-5 obligatorio + checkbox en §2 | Sí — pre-flight |

**Nuevos riesgos detectados en este GATE 3 plan:** NINGUNO.

---

## 9. Communication plan

### 9.1 Pre-ejecución (T-24h)

**Destinatarios:** Ruth (Admin), JL (Director Ops), Cynthia (Comercial),
M. Inés Cardozo (DT/Compliance), encargados de depósito.

**Mensaje** (WhatsApp + email):
> "Mañana entre `[HH:MM-HH:MM]` aplicamos una mejora del Centro Documental
> (`/documental`) de NEXUS en producción. Ventana acordada: 30 min. El módulo
> puede no responder durante 10 min. Resto de la plataforma (Compras, OS,
> CCTV, Dashboard) sigue operativa. Cualquier consulta a soporte@logisticatops.com."

### 9.2 Durante ejecución (T-10min, T+0, T+15min)

Canal interno (WhatsApp #ops):
- T-10: "Ventana de mantenimiento en 10 min."
- T+0: "Inicia GATE 3 Documents. ETA 15 min."
- T+15: "GATE 3 completado · `/documental` operativo con signed URLs."

### 9.3 Post-ejecución (T+1h)

Email a stakeholders con resumen ejecutivo:
- ✅ Migración aplicada (`0010_documents` Enterprise Hardened)
- ✅ Bucket pasó a privado con signed URLs
- ✅ Auditoría append-only activa
- ✅ Versionado de documentos habilitado
- ✅ Soft-delete con grace period
- ✅ Restore point disponible por 7 días (`pre-0010-documents-YYYYMMDD-HHMM`)

### 9.4 Equipo on-call durante ventana

| Rol | Nombre | Contacto | Responsabilidad |
|---|---|---|---|
| Ejecutor | Martín Battaglia | (a completar) | Ejecutar runbook |
| Sponsor | JL Battaglia | (a completar) | Decisión GO/NO-GO en tiempo real |
| DBA backup | (a designar) | (a completar) | Diagnóstico SQL si falla |
| Front backup | (a designar) | (a completar) | Diagnóstico app si falla post-deploy |

---

## 10. Log de ejecución

> Esta sección se completa **el día de la ejecución de GATE 3**.

| Item | Valor |
|---|---|
| Fecha y hora inicio | `___________________` |
| Fecha y hora cierre | `___________________` |
| Ejecutor | `___________________` |
| Restore point ID | `___________________` |
| Commit SHA aplicado | `___________________` |
| Netlify deploy ID | `___________________` |
| Documentos de prueba creados | `___________________` |
| Errores encontrados | `___________________` |
| Rollback ejecutado | ☐ No · ☐ Sí (motivo: `___________________`) |
| Aprobación final | `___________________` |

---

## 11. Bloqueos para ejecutar GATE 3

Estado al `2026-05-30`:

| # | Bloqueo | Tipo | Resolución |
|---|---|---|---|
| **B-G3-1** | Pre-requisitos PR-1 a PR-10 sin marcar | Operativo | Ejecutar `scripts/erp-fase2-documents-gate3-preflight.mjs` + marcar checkboxes en §1 |
| **B-G3-2** | Restore point producción no creado (PR-5) | Operativo | Crear desde Supabase Dashboard antes de ejecutar |
| **B-G3-3** | Ventana de mantenimiento no acordada (PR-8) | Coordinación | Coordinar con Ruth + JL |
| **B-G3-4** | Equipo on-call no designado (PR-9) | Coordinación | Designar DBA backup + Front backup |
| **B-G3-5** | Aprobaciones formales no firmadas (§2) | Gobernanza | Obtener firmas CTO + Operaciones + Compliance |

**Bloqueos heredados de FASE F1 ARCA (no impiden GATE 3 Documents):**

- B-1 ARCA — Certificado de homologación ausente. NO afecta este GATE.

---

## 12. Anexos

### 12.1 Comandos de verificación rápida (read-only)

```bash
# Pre-flight automático
node scripts/erp-fase2-documents-gate3-preflight.mjs

# Estado de Supabase (read-only)
node scripts/supabase-check.mjs

# Diff entre HEAD actual y staging branch
git diff feature/documents-enterprise-ready..HEAD -- supabase/migrations/0010_documents.sql

# Tag de rollback disponible
git tag -l | grep -i fase
```

### 12.2 Plantilla de email post-aplicación

> Subject: TOPS NEXUS · Centro Documental · Mejora desplegada
>
> Hola equipo,
>
> Acabamos de aplicar la versión Enterprise del Centro Documental
> (`/documental`) en producción. Cambios visibles:
>
> - Los archivos ahora se sirven con URLs firmadas y expiración (mayor seguridad)
> - Toda subida, descarga y borrado queda registrada en una bitácora inmutable
> - Los documentos pueden versionarse (subir una nueva versión sin perder la anterior)
> - El borrado es lógico — se puede recuperar dentro de la ventana de retención
>
> No requiere ninguna acción de su parte. Si encuentran algún comportamiento
> raro, reportar a soporte@logisticatops.com.
>
> Saludos,
> M. Battaglia · TOPS NEXUS

### 12.3 Referencias cruzadas

- `supabase/migrations/0010_documents.sql` — SQL versionado (Enterprise Hardened)
- `src/lib/documental/storage.ts` — signed URL + path versionado
- `src/app/(app)/documental/actions.ts` — auditoría + RLS + soft-delete
- `src/app/(app)/documental/UploadDocument.tsx` — UI con signed URL
- `docs/ERP-FASE2-DOCUMENTS-0010-AUDITORIA.md` — auditoría inicial (8 bloqueantes)
- `docs/ERP-FASE2-DOCUMENTS-HARDENING.md` — diseño Enterprise (resuelve P1–P8)
- `docs/ERP-FASE2-GATE1-MATERIALIZACION.md` — materialización en disco
- `docs/ERP-FASE2-GATE2-STAGING-VALIDATION.md` — gate inicial bloqueado por entorno
- `docs/DOCUMENTS-VALIDATION-REPORT.md` — validación en staging aislado (`vrxosunxlhohmqymxots`)
- `docs/ERP-ROADMAP-12-MESES.md` §Q1 · I7b — iniciativa origen
- `tag arca/fase-f1-freeze` (`35ae33f`) — punto de restauración previo

---

**Fin del plan. Próxima acción: ejecutar GATE 3 cuando los 10 pre-requisitos
estén marcados y las 3 aprobaciones firmadas. Hasta entonces, este documento
es el contrato de ejecución.**
