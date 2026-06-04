# TOPS NEXUS — BACKUP SYSTEM MASTER (Supabase → Google Drive)

> Documento maestro y transferible del sistema de backup de la base de datos de producción.
> Consolida diseño, operación, recuperación, mantenimiento y evidencia. Fecha: 2026-06-04.
> Docs relacionadas: `GOOGLE_DRIVE_BACKUP_MIGRATION_REPORT.md`, `A2_DATABASE_BACKUP_VALIDATION_REPORT.md`,
> `A2_1_BACKUP_WORKFLOW_REMEDIATION.md`, `OPERATIONS_RUNBOOKS.md`, `INFRASTRUCTURE_AUDIT_REPORT.md`.

---

## 1. Resumen ejecutivo

- **Problema original:** la DB de producción de Supabase (`arsksytgdnzukbmfgkju`) **no tenía ningún backup real**.
  El workflow existía pero **nunca corrió con éxito**: fallaba en la instalación de `pg_dump` (exit 100,
  `postgresql-client-15` no disponible en `ubuntu-latest`) y, más adelante, en el upload a Google Cloud Storage.
- **Motivo de abandono de Google Cloud Storage:** no existía bucket, **no había billing activa** y no se quería
  depender de GCS/billing de Google Cloud. Decisión: eliminar GCS por completo.
- **Decisión arquitectónica final:** respaldar a **Google Drive** ("TOPS Nexus Backups") usando una **Service
  Account** + **Domain-Wide Delegation** (impersonando al usuario Workspace) para aprovechar los **18 TB** del
  Workspace, sin buckets, sin `gs://`, sin billing de GCS. *(Se evaluó Shared Drive como alternativa; se descartó
  porque el Workspace no exponía "Unidades compartidas".)*
- **Resultado final:** ✅ **operativo.** Primer run verde `26985215969`: dump generado con `pg_dump 17.10`,
  validado, subido y verificado en Drive (`Backup uploaded successfully`).

---

## 2. Arquitectura final

```
Supabase PROD (arsksytgdnzukbmfgkju, PostgreSQL 17.x)
   │   conexión: Session Pooler + sslmode=require
   ▼
pg_dump 17  (PGDG · /usr/lib/postgresql/17/bin · --format=custom --compress=9 --no-owner --no-acl)
   ▼
Validación pg_restore 17  (pg_restore --list → integridad)
   ▼
Google Drive API v3  (files().create, supportsAllDrives=True)
   │   auth: Service Account + Domain-Wide Delegation (impersona usuario Workspace)
   ▼
Google Drive → carpeta "TOPS Nexus Backups"  (cuota del Workspace: 18 TB)
```

Orquestación: **GitHub Actions** (`.github/workflows/supabase-backup.yml`), cron diario `0 5 * * *` (02:00 ART)
+ `workflow_dispatch`. Hardening: fail-fast de secrets, `set -euo pipefail`, validación de pg_dump v17,
validación de integridad del dump, verificación post-subida, cleanup, y `Notify on failure` (abre issue).

---

## 3. Componentes

| Componente | Rol |
|---|---|
| **GitHub Actions** | Orquesta el backup (cron + manual); corre `pg_dump`, sube a Drive, verifica, alerta. |
| **Supabase** | DB de producción origen del dump (`arsksytgdnzukbmfgkju`, PG 17.x). |
| **Session Pooler** | Cadena de conexión usada por `pg_dump` (`sslmode=require`). |
| **Google Workspace** | Provee la cuota de almacenamiento (18 TB) del usuario impersonado. |
| **Service Account** | Identidad que llama a la Drive API. |
| **Domain-Wide Delegation** | Autoriza a la SA a impersonar al usuario Workspace (scope Drive) → usa su cuota. |
| **Google Drive** | Destino final de los `.dump` ("TOPS Nexus Backups"). |

---

## 4. Datos operativos

| Dato | Valor |
|---|---|
| Folder Name | **TOPS Nexus Backups** |
| Folder ID | `1Erng2SywVN9ymHqUzkT0iMRrKSmrHWBw` |
| Service Account | `tops-ordenes-drive@tops-ordenes.iam.gserviceaccount.com` |
| Client ID (DWD) | `108380855184331951446` |
| OAuth Scope | `https://www.googleapis.com/auth/drive` |
| Usuario impersonado | `martin.battaglia@logisticatops.com` |
| Supabase PROD ref | `arsksytgdnzukbmfgkju` |
| Cron | `0 5 * * *` (05:00 UTC = 02:00 ART) |

### Secrets utilizados (GitHub → Settings → Secrets → Actions) — **sin valores**
- `SUPABASE_DB_URL` — cadena Postgres de PROD (Session Pooler) con `sslmode=require`.
- `GCP_SA_KEY` — JSON de la key de la SA `tops-ordenes-drive@...`.

> `DRIVE_FOLDER_ID` y el usuario a impersonar van como `env` del job (no son secretos).

### Rama de desarrollo
- **`infra/drive-backup`** (no mergeada a `main` por decisión: evitar deploy de Netlify).
- Commits relevantes:
  - `a0ca428` — `feat(backup): migrate storage backend from GCS to Google Drive`
  - `a4f7e8a` — `fix(backup): use PostgreSQL 17 client binaries (server 17.6 mismatch)`

### Evidencia del primer run exitoso
- **Run:** `26985215969` (rama `infra/drive-backup`, `workflow_dispatch`, `completed/success`, 3m16s).
- **Archivo:** `backup-2026-06-04T231356Z.dump`
- **Tamaño:** `697003 bytes`
- **Drive file id:** `15l61VQ9Cu2NTUCxJJpJ9IriRxqQOHFYj` · created `2026-06-04T23:16:46.680Z`
- **Resultado:** `Backup uploaded successfully`

---

## 5. Procedimiento de recuperación — Restaurar base desde backup

> Requisitos: acceso a Drive ("TOPS Nexus Backups"), `pg_restore 17`, y la cadena de conexión de la **DB destino**
> (NUNCA restaurar sobre PROD viva sin backup previo; preferir un proyecto efímero/staging).

1. **Localizar el dump en Drive:** abrir "TOPS Nexus Backups", elegir el `backup-YYYY-MM-DDThhmmssZ.dump` deseado
   (el nombre lleva la fecha/hora UTC; el más reciente es el último cron verde).
2. **Descargar** el archivo a una máquina con `pg_restore 17` (descarga manual desde Drive, o vía Drive API con la SA).
3. **Crear la base destino** (proyecto Supabase nuevo/efímero, o DB local PG17). Tener su connection string.
4. **Ejecutar `pg_restore`:**
   ```bash
   pg_restore --no-owner --no-acl --clean --if-exists \
     --dbname="<DESTINO_DB_URL>" ./backup-<...>.dump
   ```
   *(Usar el binario v17: `/usr/lib/postgresql/17/bin/pg_restore` si hay varias versiones.)*
5. **Validar tablas y datos:**
   ```bash
   pg_restore --list ./backup-<...>.dump | head        # contenido esperado
   psql "<DESTINO_DB_URL>" -c "select
     (select count(*) from custody_events) ce,
     (select count(*) from inventory_items) ii,
     (select count(*) from delivery_pods) pods,
     (select count(*) from shipments) sh;"
   ```
   Comparar con los conteos esperados; correr smoke tests (p. ej. `RLS_0040_SMOKE_TEST.sql`).

> **RPO:** hasta 24h (último dump diario). **RTO:** ~1–2h (crear destino + restore + validación).
> Para granularidad fina, complementar con PITR en Supabase (fuera de este frente).

---

## 6. Procedimiento de mantenimiento

### 6.1 Alta de nueva Service Account
1. GCP → IAM → Service Accounts → crear SA en `tops-ordenes`.
2. Generar **key JSON** → cargarla en el secret `GCP_SA_KEY`.
3. Compartir la carpeta "TOPS Nexus Backups" con el email de la SA (o configurarla como sujeto de DWD).
4. Autorizar el **Client ID** de la nueva SA en DWD (ver 6.5).

### 6.2 Rotación de claves
1. GCP → la SA → **Keys → Add key (JSON)** (nueva).
2. Actualizar el secret `GCP_SA_KEY` con la nueva.
3. Re-ejecutar el workflow y verificar verde.
4. **Eliminar la key vieja** en GCP. *(Recomendado: rotación trimestral.)*

### 6.3 Cambio de carpeta destino
1. Obtener el nuevo **Folder ID** (de la URL de Drive).
2. Editar `env.DRIVE_FOLDER_ID` en `.github/workflows/supabase-backup.yml`.
3. Asegurar que la SA/usuario impersonado tenga acceso de escritura a la nueva carpeta.
4. Commit en `infra/drive-backup` (o la rama vigente) → re-ejecutar.

### 6.4 Cambio de usuario Workspace (impersonado)
1. Editar `env.DRIVE_IMPERSONATE_SUBJECT` al nuevo email Workspace.
2. Verificar que ese usuario tenga acceso a la carpeta y cuota suficiente.
3. Re-ejecutar y verificar.

### 6.5 Renovación / reconfiguración de DWD
1. admin.google.com → Security → API Controls → **Manage Domain-Wide Delegation**.
2. Confirmar/recrear la entrada: **Client ID** de la SA + scope `https://www.googleapis.com/auth/drive`.
3. Esperar propagación (~5–10 min) → re-ejecutar el workflow (validación funcional).

---

## 7. Checklist operativo mensual

- [ ] **Workflow verde:** último run de "Supabase Daily Backup" = success (`gh run list --workflow=supabase-backup.yml`).
- [ ] **Archivo en Drive:** existe un `.dump` reciente en "TOPS Nexus Backups" con la fecha esperada.
- [ ] **Tamaño razonable:** el `.dump` no está vacío ni anómalamente chico/grande vs. el histórico.
- [ ] **Espacio Workspace:** cuota del usuario impersonado con margen (18 TB; revisar uso).
- [ ] **DWD activo:** la delegación sigue listada en Admin (Client ID + scope Drive).
- [ ] **Service Account vigente:** la SA existe, habilitada, y su key no está por expirar/comprometida.
- [ ] *(Trimestral)* prueba de **restore** real a destino efímero (ver §5).

---

## 8. Limpieza — issues históricos de fallos

- **10 issues `🚨 Backup Supabase falló`** abiertos (`ops/backup/urgent`), generados automáticamente por el step
  `Notify on failure` durante el período de diagnóstico/corrección del 2026-06-04.
- **Motivo de los fallos (cronológico):**
  1. `Install pg_dump v15` → exit 100 (`postgresql-client-15` ausente en `ubuntu-latest`).
  2. Secrets ausentes / upload a GCS sin bucket/billing.
  3. `pg_dump 16.14` vs server `17.6` (binario v17 no priorizado en PATH).
  4. `unauthorized_client` (DWD aún no habilitado).
- **Estado actual: RESUELTO** — run `26985215969` verde end-to-end.
- **Acción:** **NO cerrar automáticamente.** El owner los cierra manualmente tras confirmar el verde.

---

## 9. Estado final

```
STATUS: PRODUCTIVO

Backup de base de datos operativo.
Google Drive operativo.
DWD operativo.
Sin dependencia de Google Cloud Storage.
Sin dependencia de buckets.
Sin dependencia de billing de GCS.

FRONT CLOSED.
```

### Pendientes operativos (no bloqueantes; decisión del owner)
- **Mergear `infra/drive-backup` → `main`** para que el **cron diario** corra desde la rama por defecto (hoy corre
  on-demand sobre la rama). ⚠️ Ese merge/push **deploya Netlify** → queda a criterio del owner.
- **Cerrar los 10 issues** históricos tras confirmar el verde.
- **Backup de Storage** (binarios de custody/POD/facturas) sigue pendiente (Fase A1) — este frente cubre **solo la DB**.

---

> **FIN — BACKUP SYSTEM MASTER.** Frente de backup de DB consolidado y transferible. Sin merge a `main`, sin tocar
> Netlify, sin cerrar issues.
