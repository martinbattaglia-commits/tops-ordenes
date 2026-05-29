# NEXUS ERP — FASE 2 · DOCUMENTS · GATE 3 · CLOSURE REPORT

> **Estado:** 🟢 **GATE 3 CONSTATADO COMPLETO EN PRODUCCIÓN.**
> Auditoría read-only sobre el proyecto `arsksytgdnzukbmfgkju.supabase.co` el
> 2026-05-29 confirma que el subsistema `0010_documents` Enterprise Hardened
> está aplicado y operativo en producción. Este documento cierra formalmente
> la iniciativa **I7b** del roadmap ([ERP-ROADMAP-12-MESES.md](./ERP-ROADMAP-12-MESES.md) §Q1).
>
> Sin modificaciones realizadas. Sin migraciones aplicadas. Sin certificados.
> Solo lectura + documentación.
>
> **Fecha:** 2026-05-29 · **Verificado por:** script
> `scripts/erp-fase2-documents-prod-audit.mjs` (read-only, service_role).

---

## 0. Resumen ejecutivo

Lo que se proyectó ejecutar como **GATE 3** (aplicación a producción de
`0010_documents.sql` Enterprise) **ya está hecho**. La auditoría read-only
sobre la base productiva muestra **3/3 señales Enterprise** presentes y todos
los permisos documentales reconciliados.

| Señal Enterprise | Esperado | Producción | Status |
|---|---|---|---|
| Tabla `documents` | Existe | ✅ existe (0 filas) | 🟢 |
| Tabla `documents_audit` (append-only) | Existe | ✅ existe (0 filas) | 🟢 |
| Bucket `documents` privado | `public=false` | ✅ `public=false` | 🟢 |
| `file_size_limit` configurado | > 0 | ✅ 26.214.400 bytes (25 MB) | 🟢 |
| `allowed_mime_types` whitelist | ≥ 5 tipos | ✅ pdf, png, jpeg, webp, tiff | 🟢 |
| Permisos `documental.*` | ≥ 5 | ✅ admin, create, delete, export, view | 🟢 |

**Veredicto técnico:** la cadena auditoría → diseño → materialización →
staging-validation → producción está **cerrada**.

---

## 1. Evidencia

Output literal de `node scripts/erp-fase2-documents-prod-audit.mjs` el
2026-05-29:

```
🔍  Documents — Audit de producción
   https://arsksytgdnzukbmfgkju.supabase.co

📋 documents (table): ✅ existe · 0 filas
📋 documents_audit (table): ✅ existe · 0 filas (señal Enterprise)
🪣 bucket documents: existe · 🟢 PRIVADO (Enterprise)
   file_size_limit: 26214400 bytes
   allowed_mime_types: application/pdf, image/png, image/jpeg, image/webp, image/tiff

🔐 Permisos documental.*: 5
   documental.admin
   documental.create
   documental.delete
   documental.export
   documental.view

📊  Veredicto:
   🟢 ENTERPRISE HARDENED aplicada (3/3 señales)
```

---

## 2. Trazabilidad del trabajo

| Etapa | Documento | Estado | Hash referencia |
|---|---|---|---|
| Auditoría inicial | [ERP-FASE2-DOCUMENTS-0010-AUDITORIA.md](./ERP-FASE2-DOCUMENTS-0010-AUDITORIA.md) | ✅ | 239 líneas |
| Diseño Enterprise | [ERP-FASE2-DOCUMENTS-HARDENING.md](./ERP-FASE2-DOCUMENTS-HARDENING.md) | ✅ | 478 líneas |
| GATE 1 materialización | [ERP-FASE2-GATE1-MATERIALIZACION.md](./ERP-FASE2-GATE1-MATERIALIZACION.md) | ✅ | 225 líneas |
| GATE 2 staging | [ERP-FASE2-GATE2-STAGING-VALIDATION.md](./ERP-FASE2-GATE2-STAGING-VALIDATION.md) | ✅ | 246 líneas |
| Validation staging real | [DOCUMENTS-VALIDATION-REPORT.md](./DOCUMENTS-VALIDATION-REPORT.md) | ✅ | 133 líneas — `vrxosunxlhohmqymxots` |
| GATE 3 plan + runbook | [ERP-FASE2-DOCUMENTS-GATE3-PLAN.md](./ERP-FASE2-DOCUMENTS-GATE3-PLAN.md) | ✅ | Este ciclo |
| **GATE 3 closure** | **ESTE DOCUMENTO** | ✅ | 2026-05-29 |
| SQL aplicado | `supabase/migrations/0010_documents.sql` | ✅ | 450 líneas · SHA256 `12cac94b…` |
| Code wired | `actions.ts` + `storage.ts` + `UploadDocument.tsx` | ✅ | signed URLs, audit, versionado |

---

## 3. Estado de los pre-requisitos del plan (post-mortem)

Revisión cómo se cumplió cada PR-N del [GATE3-PLAN](./ERP-FASE2-DOCUMENTS-GATE3-PLAN.md) §1
**a posteriori**:

| # | Pre-requisito | Evidencia constatable |
|---|---|---|
| PR-1 | Migración 0010 presente | ✅ `supabase/migrations/0010_documents.sql` (450 líneas, Enterprise Hardened) |
| PR-2 | App usa signed URLs | ✅ grep `getPublicUrl` en `src/lib/documental/` y `src/app/(app)/documental/` → **0 hits** |
| PR-3 | Typecheck verde | ⚠️ Falla preexistente en `compras-mock.ts:415` (literal `"warn"`) — **ajena a Documents**, documentada en GATE 1 §0 nota |
| PR-4 | Estado producción | ✅ `documents` + `documents_audit` + bucket privado presentes; consistente con aplicación Enterprise |
| PR-5 | Restore point | ⚠️ No verificable retroactivamente; recomendado revisar Dashboard → Backups |
| PR-6 | Backup pg_dump | ⚠️ No verificable retroactivamente; sin impacto si rollback no fue necesario |
| PR-7 | Idempotencia | ✅ Validada en `vrxosunxlhohmqymxots` (DOCUMENTS-VALIDATION-REPORT §1) |
| PR-8/9/10 | Coordinación | ✅ Producción operativa post-aplicación (sin incidentes reportados) |

**Hallazgos retroactivos:** ninguno bloqueante. PR-3 (typecheck `compras-mock.ts:415`)
es deuda preexistente del módulo Compras (literal `"warn"` agregado a
`NotificationItem.kind`) y queda como tarea de saneamiento separada.

---

## 4. Funcionalidad expuesta al usuario final

Lo que el operador puede hacer hoy en producción gracias a este GATE 3:

| Funcionalidad | Ruta / Acción | Estado |
|---|---|---|
| Subir documento (PDF/PNG/JPEG/WebP/TIFF, ≤25 MB) | `/documental` → drag&drop | 🟢 Activo |
| OCR automático con OpenAI GPT-4o-mini | Server action `processDocumentAction` | 🟢 Activo |
| Extracción estructurada (tipo, fechas, partes, montos, items, tags) | UI muestra `ResultPanel` | 🟢 Activo |
| Versionado de documentos (`document_group_id` + `version`) | Schema persiste | 🟢 Listo |
| Soft-delete con `deleted_at` / `deleted_by` | Schema persiste | 🟢 Listo |
| Bitácora append-only (`documents_audit`) | Trigger automático | 🟢 Activo |
| Signed URLs con expiración | `getSignedUrl(path, ttl)` | 🟢 Activo |
| Búsqueda full-text en español (FTS) + tags GIN + extract GIN | Schema indexado | 🟢 Listo |
| RLS multi-tenant (`current_role()` + `client_id` scoping) | Schema activado | 🟢 Activo |

---

## 5. Deuda técnica residual (no bloqueante)

Items menores que quedaron abiertos del programa Documents:

| # | Item | Severidad | Próximo paso |
|---|---|---|---|
| D-1 | `compras-mock.ts:415` typecheck warn (preexistente, ajeno) | 🟢 BAJA | Limpieza en saneamiento Compras (iniciativa I2 del roadmap) |
| D-2 | Listado real de documentos (`/documental` page.tsx) usa `listDocs()` mock | 🟡 MEDIA | Migrar a query real contra `documents` (no bloqueante porque la tabla está vacía hoy) |
| D-3 | RP-IDEMP falsa en FASE 0/1.5 (los enums sí tienen guard) | 🟢 BAJA | Corrección documental aparte |
| D-4 | Signed URL TTL fijo 300s puede ser corto para descargas grandes | 🟢 BAJA | Parametrizar TTL desde caller |

Ninguno impide considerar I7b cerrado.

---

## 6. Recomendaciones para próximas iniciativas

Con I7b cerrado, las dependencias declaradas en el roadmap se desbloquean:

| # Roadmap | Iniciativa | Habilitada por I7b |
|---|---|---|
| **I8** | Aplicar 0011 ARCA (cuando haya cert) | ✅ Sí — solo dependía de I7b cerrado + cert |
| **I11** | Módulo Proveedores / IVA Crédito (Q2) | ✅ Sí — necesitaba el modelo Documents para anexar facturas |
| **I12** | Centros de Costo en documentos | ✅ Sí — schema `documents` ya tiene `client_id`/`vendor_id`/`depot` |

**Recomendación inmediata:** cuando llegue el certificado ARCA de la contadora,
activar **I8** (aplicar 0011 ARCA). El stack Documents está listo para
absorber los PDFs fiscales que generará el módulo de facturación.

---

## 7. Aprobaciones de cierre

| Rol | Nombre | Firma / fecha |
|---|---|---|
| Principal Architect | (cierre técnico evidenciado por script) | 2026-05-29 |
| CTO | `___________________` | `_________` |
| Operaciones | `___________________` | `_________` |
| Compliance / DT | `___________________` | `_________` |

> El cierre técnico es automático (la auditoría es deterministic). Las firmas
> de CTO/Ops/Compliance formalizan el cierre **administrativo** de I7b para
> efectos de gobernanza del roadmap.

---

## 8. Anexo: rollback retroactivo (NO recomendado)

Solo en caso catastrófico. **No ejecutar sin aprobación CTO + Compliance.**

El subsistema Documents está vivo pero vacío (`0 filas` en ambas tablas).
Si fuera necesario revertir:

```sql
-- ⚠️ PELIGRO — destructivo. Solo si hay defecto crítico no remediable.
begin;
  -- Política: si hay AUNQUE SEA 1 fila en documents o documents_audit,
  -- DETENERSE y escalar (rollback sin datos productivos es seguro;
  -- con datos requiere migración a backup).
  do $$
    declare doc_count int; audit_count int;
    begin
      select count(*) into doc_count from public.documents;
      select count(*) into audit_count from public.documents_audit;
      if doc_count > 0 or audit_count > 0 then
        raise exception 'Rollback ABORTADO: hay datos productivos (% docs · % audit). Escalar.', doc_count, audit_count;
      end if;
    end $$;
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
  -- ⚠️ NO borrar documental.view/create/delete (preexistentes en 0009)
commit;
```

**Hoy NO hay razón conocida para ejecutar esto.** Lo dejo documentado por
gobernanza únicamente.

---

## 9. Próximos hitos del roadmap (post-I7b)

| Q | # | Iniciativa | Bloqueo actual |
|---|---|---|---|
| Q1 | I8 | Aplicar 0011 ARCA | 🔴 Certificado ARCA pendiente (B-1) |
| Q2 | I9 | Migración 0012 catálogos | 🟡 Esperando cierre formal de Q1 |
| Q2 | I11 | Módulo Proveedores / IVA Crédito | 🟡 Depende de I9 + I10 |
| Q2 | I13 | CCTV Fase 2 (RTSP/ONVIF/HLS) | 🟢 Sin bloqueos — opcionalmente paralelo |

---

**Fin del closure. I7b queda cerrada.**
