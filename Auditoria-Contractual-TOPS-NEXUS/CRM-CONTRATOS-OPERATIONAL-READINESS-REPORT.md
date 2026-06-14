# CRM CONTRATOS · OPERATIONAL READINESS REPORT

**Módulo:** CRM Comercial → Contratos + Sincronización Google Drive
**Branch/worktree:** `claude/recursing-saha-e73036`
**Fecha de gate:** 2026-06-13 · **Fecha de corte de datos:** 13/06/2026
**Alcance:** validación operativa previa a commit. **NO** se hizo push / merge / deploy / aplicación de migraciones.

## CLASIFICACIÓN: 🟡 APPROVED WITH OBSERVATIONS

El código entregado pasa **todas** las validaciones ejecutables (lógica, tablero, seguridad de diseño, no‑regresión, build). Las observaciones son **dependientes de operación** (credenciales/compartición de la carpeta Drive) o **aclaraciones de diseño**, no defectos del código. La prueba **end‑to‑end contra la carpeta real** «Comercial → Cynthia → Clientes» **no puede ejecutarse en este entorno** (requiere la Service Account compartida sobre esa carpeta + variables de entorno) y queda como gate de despliegue.

> Por la condición establecida (“sólo si el resultado es APPROVED queda autorizado el commit”), **NO ejecuté el commit de revisión.** Ver §9.

---

## 1 · Validación de escenarios obligatorios

Ejecutados de forma **determinista** contra la **lógica real** del motor (`plan.ts` + `classify.ts`) y del tablero (`contracts-engine.ts`), vía `scripts/contracts-sync-gate.ts` (**32/32 PASS**, `node scripts/contracts-sync-gate.ts` → exit 0). Estas funciones puras son exactamente las que consume el motor en `engine.ts`.

| # | Escenario | Resultado | Evidencia |
|---|---|---|---|
| 1 | Contrato nuevo en Drive → aparece en Nexus | ✅ PASS | `diffDoc(∅) = 'new'` ⇒ el motor inserta; clasificación `contrato` |
| 2 | Adenda agregada/modificada → contrato actualizado | ✅ PASS | adenda nueva `'new'` (se agrega al dossier); adenda con md5 distinto `'updated'` + alerta `adenda_modificada` |
| 3 | Documento eliminado → alerta generada | ✅ PASS | `planRemovals` marca baja + alerta `documento_eliminado` |
| 4 | Rescisión detectada → alerta/estado | ✅ PASS | clasifica `rescision` (rescisión/distracto) + alerta `rescision_detectada` |
| 5 | Modificación documental → evento registrado | ✅ PASS | `diffDoc` por md5 o `modifiedTime` ⇒ `'updated'` ⇒ evento `updated` |

**Robustez adicional validada:** sin cambios ⇒ `unchanged` (no‑op); y el **fix crítico** de la revisión adversarial — un documento cuyo contrato **no** fue recorrido en la corrida **no** se marca como baja (evita corrupción por errores/timeout parciales).

> **Observación O1 (no bloqueante de código):** la prueba E2E con la carpeta Drive real no se ejecutó aquí (sin credenciales/compartición). La lógica de decisión está validada; resta validar el cableado en el primer `?dry=1` del despliegue (ver §9).
> **Observación O2 (diseño):** en el Escenario 4, el sync **detecta** la rescisión y emite alerta; **no** cambia automáticamente `contracts.estado` a `Rescindido` (decisión de Legal). El “estado actualizado” se materializa por la alerta + acción humana.

## 2 · Tablero (Dashboard)

| Elemento | Estado | Evidencia |
|---|---|---|
| KPIs | ✅ | 8/8 agregados coinciden con la auditoría (activos 42, ANMAT 35, CG 10, m² 6.843,97, ARS $49.677.060, USD $26.140, críticos 7, ≤180d 8) — harness + captura |
| Estado de sincronización | ✅ | Vista «Sincronización»: Drive/DB, última/próxima corrida, frecuencia 21:00 ART — captura `evidencia/07-sincronizacion.png` |
| Calidad documental | ✅ | barra ok/parcial/sin_texto/error/pendiente |
| Alertas | ✅ | sección de alertas de sync (eliminado/adenda/rescisión) + badge en tab |
| Logs | ✅ | `contract_sync_runs` + `contract_sync_events` (bitácora) + KPIs de última corrida |
| Próxima / última ejecución | ✅ | `computeNextRunAt` (próximo 00:00 UTC = 21:00 ART) + `fmtRel/fmtDateTime` |

## 3 · Seguridad

| Control | Estado | Detalle |
|---|---|---|
| RLS | ✅ | `contracts*`, `contract_sync_runs/events`: SELECT/ALL sólo staff (`current_role() in (admin,supervisor,operaciones)`). Catálogo `contract_status`: lectura autenticada. Políticas **idempotentes** (`drop policy if exists`). |
| Service Account | ✅ | Reutiliza la SA corporativa existente (`GOOGLE_SERVICE_ACCOUNT_JSON`), scopes mínimos `drive.readonly` + `drive.file`. Resolver de carpeta valida `isUnderRoot` (enforce de scope). Walk con guarda de ciclos. |
| Bucket privado / Signed URLs | ⚠️ N/A | **Por diseño** (Addendum): el repositorio documental es **Google Drive**, no Supabase Storage. Los documentos se referencian por `webViewLink` y su acceso lo gobiernan la compartición de Drive + la SA. No hay bucket ni signed URLs en la ruta de Contratos (eso aplica al módulo Documental existente). Ver **O3**. |
| Auditoría | ✅ | `contract_sync_runs` (corridas) + `contract_sync_events` (eventos append‑only) + `contract_events` (bitácora del contrato). |
| Trazabilidad | ✅ | Por documento: `md5_checksum`, `drive_modified_at`, `text_source`, `quality`, `sync_status`, `last_synced_at`; por contrato: `source`, `drive_folder_id`, `last_synced_at`. |
| Endpoint cron | ✅ | `/api/comercial/contratos/sync` exige `Authorization: Bearer ${CRON_SECRET}` cuando está seteado; escritura sólo vía service‑role. |

> **Observación O3 (aclaración):** si Dirección requiere que los documentos se sirvan vía URLs firmadas/bucket privado de Supabase (en lugar de enlaces de Drive), es un cambio de alcance: implicaría copiar binarios de Drive a Storage. Hoy, en línea con “Drive = fuente de verdad”, se referencian los archivos en Drive.

## 4 · No‑regresión

`npm run build` ✅ (Compiled successfully) · `tsc --noEmit` ✅ · `next lint` ✅ (sólo warnings preexistentes ajenos). **24/24 rutas 200** en dev:

Cockpit (`/ejecutivo`,`/dashboard`) · CRM (`/comercial/oportunidades`,`/pipeline`,`/contactos`) · Compras (`/compras`,`/ordenes`,`/facturas`,`/libro-iva`) · Proveedores (`/compras/proveedores`) · Drive (`/drive`,`/compras/drive`) · Tesorería (`/tesoreria`,`/cobranzas`,`/pagos`) · Compliance/ANMAT (`/anmat`) · Facturación/ARCA (`/billing`,`/reports`,`/settings/fiscal`) · Tracking (`/operaciones/tracking`,`/settings/tracking`) · WMS (`/wms`,`/inventario`) · Contratos (`/comercial/contratos`).

OCR / Clientify / Fiscal / ARCA: sin cambios de código; el Drive client se **extendió** (funciones nuevas) sin tocar las existentes; `extractFromPdf` se **reutiliza** sin modificar. Degradación controlada verificada en vivo: endpoint `?dry=1` → `status: skipped` con mensaje claro; módulo sin DB → seed marcado «Carga inicial (sin sincronizar)».

## 5 · Migraciones (revisadas, NO aplicadas)

| Migración | Estado | Validación estática |
|---|---|---|
| `0076_crm_contracts.sql` | ✅ revisada | 6 tablas + 11 enums (guardas `duplicate_object`), RLS idempotente, `$$`/`$f$` balanceados |
| `0077_contracts_drive_sync.sql` | ✅ revisada | columnas Drive en `contracts`/`contract_documents` + `contract_sync_runs`/`events`; índice único **no‑parcial** sobre `drive_file_id` (habilita `ON CONFLICT` del upsert); RLS idempotente; `$$`/`$f$` balanceados |

**No aplicadas.** El seed `supabase/seed/0076_contracts_audit_seed.sql` (45 contratos) tampoco.

## 6 · Revisión adversarial (previa al gate)

Se corrió una revisión multi‑agente (3 revisores + verificación) que confirmó **8 bugs** + 1 detectado adicional, **todos corregidos** y re‑verificados:
falsos positivos de baja (crítico) · scope/ciclos del walk · `ON CONFLICT` vs índice parcial · escritura NULL de `extracted_text` · bajas no batcheadas · enmascaramiento de errores auth/quota · RLS no idempotente (0076+0077) · presupuesto de tiempo. Detalle en el informe de la sesión.

## 7 · Observaciones (resumen)

| Id | Tipo | Observación | Impacto |
|---|---|---|---|
| O1 | Operación | E2E contra Drive real pendiente de credenciales/compartición | Validar en 1er `?dry=1` del deploy |
| O2 | Diseño | Rescisión → alerta, no auto‑cambia `estado` | Acción de Legal (intencional) |
| O3 | Aclaración | Sin signed‑URLs/bucket: se usan enlaces de Drive | Cambio de alcance si se requiere bucket |
| O4 | Límite | DOCX se cataloga sin extracción de texto | Documentos quedan trazados; texto opcional |
| O5 | Operación | Timeout de función Netlify en carpetas muy grandes | Mitigado: budget 20s + estado `partial`; reintenta al día siguiente |

## 8 · Checklist de activación (post‑aprobación, acción de Dirección/Ops)

1. Aplicar `0076` + seed `0076` + `0077` en Supabase productivo (`arsksytgdnzukbmfgkju`).
2. Netlify env: `GOOGLE_SERVICE_ACCOUNT_JSON`, `GOOGLE_DRIVE_ROOT_FOLDER_ID`, `CONTRATOS_DRIVE_FOLDER_ID` (id de «Clientes»), `CRON_SECRET`.
3. Compartir la carpeta «Comercial → Cynthia → Clientes» con el email de la Service Account (rol Lector).
4. GitHub Actions: secrets `CRON_SECRET` (+ `APP_URL`).
5. Primera corrida con `?dry=1` → revisar reporte → corrida real → validar Dashboard de Sincronización.

## 9 · Veredicto y autorización

**APPROVED WITH OBSERVATIONS.** Todas las validaciones a mi alcance pasan; las observaciones son operativas o de diseño, no defectos.

Conforme a la **condición establecida** (commit autorizado **sólo** con resultado *APPROVED*), **no realicé el commit de revisión**. Para avanzar, Dirección puede: (a) aceptar O1–O5 como **no bloqueantes** ⇒ elevar a *APPROVED* y autorizar el commit de revisión (sin push/merge/deploy); o (b) indicar cuáles observaciones desea resolver antes.
