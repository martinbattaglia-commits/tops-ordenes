# GCS-BACKUP-CHECKLIST

**Bloqueante:** P0.1 (Backup externo Supabase) · **Gate de implementación**
**Fecha:** 2026-05-30
**Decisión a tomar:** ¿Se implementa el backup GCS en **infraestructura real**? → 🟢 GO / 🔴 NO-GO
**Documentos de respaldo:** `GCS-BACKUP-DRYRUN.md` · `BACKUP-EXECUTION-RUNBOOK.md` · `BACKUP-IMPLEMENTATION-PLAN.md` · `PRE-FLIGHT-BACKUP-REPORT.md`
**Restricciones:** 🛑 NADA en esta checklist crea recursos, ejecuta backups ni hace deploy. Es un instrumento de decisión.

---

## A · Estado de partida (verificado · 2026-05-30)

| Ítem | Estado |
|------|--------|
| Estrategia (Opción B: GitHub Actions + pg_dump + GCS) | ✅ aprobada por Presidencia (2026-05-29) |
| Runbook paso-a-paso | ✅ `BACKUP-EXECUTION-RUNBOOK.md` (operable sin interpretación) |
| Dry-run punta-a-punta | ✅ `GCS-BACKUP-DRYRUN.md` → 🟢 LISTO PARA IMPLEMENTAR |
| Proyecto GCP `tops-nexus-ops` | ❌ no creado |
| Bucket `tops-nexus-supabase-backups` | ❌ no creado |
| Service Account write-only | ❌ no creada |
| GitHub Secrets (3) | ❌ no configurados |
| Workflow `.github/workflows/supabase-backup.yml` | ❌ no existe en repo |
| Primer backup + restore-test | ❌ nunca ejecutado |
| `PRE-FLIGHT-BACKUP-REPORT` | 🔴 FAIL (se reemite a PASS al cerrar §G) |

---

## B · Pre-condiciones (gate humano · cerrar ANTES de tocar nada)

> Referencia: `BACKUP-EXECUTION-RUNBOOK.md` §1.

- [ ] **B1** · Autorización explícita del presidente para ejecución real (ETAPA 1).
- [ ] **B2** · 🛑 GCP **habilitado** en Google Workspace TOPS (`admin.google.com`) — *frenó el intento anterior (BKP.R8); confirmar PRIMERO*.
- [ ] **B3** · Cuenta de **billing GCP** activa para asociar al proyecto.
- [ ] **B4** · `gcloud` CLI local **o** Cloud Shell del navegador (recomendado).
- [ ] **B5** · `SUPABASE_DB_URL` de **producción** con `sslmode=require` a mano (tratar como secreto).
- [ ] **B6** · Acceso admin al repo `martinbattaglia-commits/tops-ordenes` (Secrets + Actions).

**Gate B:** ▢ 🟢 Pre-condiciones OK ▢ 🔴 Bloqueado → _motivo: _____________________

---

## C · Proyecto GCP

> Runbook §2.

- [ ] **C1** · `gcloud projects create tops-nexus-ops` → `describe` muestra `ACTIVE`.
- [ ] **C2** · Billing asociado → `gcloud billing projects describe` muestra `billingEnabled: True`.
- [ ] **C3** · API Cloud Storage habilitada (`gcloud services enable storage.googleapis.com`).

---

## D · Bucket

> Runbook §3.

- [ ] **D1** · `tops-nexus-supabase-backups` creado en `southamerica-east1`, `--uniform-bucket-level-access`, `--public-access-prevention`.
- [ ] **D2** · `describe` confirma `SOUTHAMERICA-EAST1· True· enforced` (privado).
- [ ] **D3** · Versioning habilitado (defensa ante borrado).
- [ ] **D4** · Lifecycle aplicada: Nearline@90d · Archive@365d · Delete@3650d (10 años AFIP).
- [ ] **D5** · (Recomendado) Budget alert a $5/mes (50/90/100%).

---

## E · Service Account

> Runbook §4.

- [ ] **E1** · SA `supabase-backup-uploader@tops-nexus-ops.iam.gserviceaccount.com` creada.
- [ ] **E2** · Binding **solo** `roles/storage.objectCreator` sobre el bucket (write-only: sin read, sin delete).
- [ ] **E3** · JSON key generada (`backup-sa-key.json`) — **secreto, NO commitear**.

---

## F · GitHub Secrets

> Runbook §5.

- [ ] **F1** · `SUPABASE_DB_URL` (cadena Postgres prod con `sslmode=require`).
- [ ] **F2** · `GCP_SA_KEY` (contenido completo de `backup-sa-key.json`, multilínea).
- [ ] **F3** · `GCS_BUCKET` = `tops-nexus-supabase-backups`.
- [ ] **F4** · `backup-sa-key.json` **borrado** localmente tras pegarlo (`rm backup-sa-key.json`).

---

## G · Workflow

> Runbook §6.

- [ ] **G1** · `.github/workflows/supabase-backup.yml` creado (cron `0 5 * * *` + `workflow_dispatch`).
- [ ] **G2** · Step de dump usa `postgresql-client-15` + `pg_dump --format=custom --compress=9 --no-owner --no-acl` (BKP.R2).
- [ ] **G3** · 🔧 Aplicar decisión **H1** del dry-run: el Step "Verify upload" usa `gcloud storage ls`, que la SA write-only **no puede** ejecutar (`objectCreator` ≠ `list`). Resolver: quitar/degradar el Step a no-bloqueante (el `cp` ya falla si no sube) **o** documentar excepción de permisos. *No bloquea el backup; sí evita un falso rojo en el verify.*
- [ ] **G4** · Step "Notify on failure" abre issue automático (`ops,backup,urgent`).

---

## H · Backup (primer disparo)

> Runbook §7.1–§7.2.

- [ ] **H1** · `workflow_dispatch` manual → run termina **verde** (~3–5 min).
- [ ] **H2** · `gcloud storage ls -r gs://<bucket>/**` muestra 1 archivo `backup-<fecha>.dump` bajo `YYYY/MM/DD/`.

---

## I · Restore Test — *la prueba que cierra P0.1*

> Runbook §7.3–§7.5. Dry-run §6/§7. **Solo en SANDBOX `vrxosunxlhohmqymxots`, nunca en prod.**

- [ ] **I1** · 🔑 Operador usa **identidad humana con read** sobre el bucket (NO la SA write-only — hallazgo H2 del dry-run).
- [ ] **I2** · `gcloud storage cp` descarga el dump más reciente a `/tmp/backup.dump`.
- [ ] **I3** · `pg_restore --list /tmp/backup.dump` lista el TOC → dump **íntegro** (valida antes de tocar la DB).
- [ ] **I4** · `pg_restore --dbname="$SANDBOX_DB_URL" --no-owner --no-acl` restaura en sandbox sin errores.
- [ ] **I5** · Smoke check: `clients ~2 · orders ~10 · operators ~7` coherentes con prod.
- [ ] **I6** · `pg_restore`/`pg_dump` ambos **v15** (sin mismatch de versión).
- [ ] **I7** · Limpieza: `rm -f /tmp/backup.dump`.

**Gate I:** ▢ 🟢 Restore VÁLIDO (backup restaurable) ▢ 🔴 Falló → _motivo: _____________________

---

## J · Evidencia y cierre

> Runbook §9.

- [ ] **J1** · `BACKUP-SETUP-CLOSURE.md` con IDs (proyecto/bucket/SA), output del primer backup y del restore-test, conteos del smoke.
- [ ] **J2** · `docs/runbooks/RESTORE-FROM-GCS-BACKUP.md` (runbook de restore para emergencia real).
- [ ] **J3** · `docs/runbooks/BACKUP-MONITORING.md` (cómo verificar los últimos N backups).
- [ ] **J4** · Re-emitir `PRE-FLIGHT-BACKUP-REPORT.md` → **PASS** (`-V2`).
- [ ] **J5** · `PRE-FLIGHT-GATE-0.md`: P0.1 → 🟢 PASS.

---

## K · Aceptación de alcance

- [ ] **K1** · Entiendo que P0.1 se cierra con el **restore-test exitoso** (§I), no con el primer backup. *Un backup que nunca se restauró no cuenta.*
- [ ] **K2** · Entiendo que `pg_dump` **lee** producción (read-only); el restore va **solo a sandbox**. Producción nunca se escribe ni se restaura encima.
- [ ] **K3** · Entiendo que la SA es **write-only** por diseño: el CI sube, pero descargar/restaurar requiere identidad humana (H2).
- [ ] **K4** · Entiendo que RPO ≈ 24h (backup diario) y RTO ≈ 30–60 min, con retención 10 años (AFIP).

---

## L · Firma de aprobación

| Rol | Nombre | Decisión | Fecha |
|-----|--------|----------|-------|
| Presidente | Martín F. Battaglia | ▢ 🟢 GO ▢ 🔴 NO-GO | __________ |

**Condiciones / notas del aprobador:**

_______________________________________________________________________

---

## M · Estado del gate

▢ **PENDIENTE** — diseño listo, infra no creada
▢ **EN EJECUCIÓN** — recursos creándose (C–G)
▢ **BACKUP OK** — primer dump en bucket (H), falta restore-test
▢ **P0.1 CERRADO** — restore-test 🟢 → habilita Track Backup como PASS y desbloquea GATE 0
▢ **NO-GO / ABORTADO** — _motivo: _____________________
