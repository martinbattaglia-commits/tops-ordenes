# BACKUP-EXECUTION-RUNBOOK

**Fecha:** 2026-05-29
**Objetivo:** cerrar el bloqueante **P0.1** de GATE 0 — implementar backup externo de Supabase (pg_dump → Google Cloud Storage vía GitHub Actions), con retención AFIP 10 años.
**Estado:** 🟡 **READY FOR EXECUTION** · documental · **nada ejecutado / creado todavía**.
**Responsable de ejecución:** Martín / TOPS (con asistencia documental del proyecto).
**Naturaleza:** operable paso a paso sin interpretación. Cada paso indica QUÉ correr/clickear, los valores EXACTOS confirmados, y QUÉ verificar.

> 🛑 **Restricciones de esta entrega (ETAPA 0B):** este documento NO crea buckets, NO crea service accounts, NO genera backups, NO commitea workflows, NO toca producción. Es la guía a ejecutar cuando se autorice.

---

## 0 · Decisiones confirmadas (presidente · 2026-05-29)

| Parámetro | Valor confirmado |
|-----------|------------------|
| Estrategia | 🏆 **Opción B** — GitHub Actions + `pg_dump` + Google Cloud Storage |
| Proyecto GCP | **`tops-nexus-ops`** (nuevo, dedicado a ops/backup) |
| Región del bucket | **`southamerica-east1`** (São Paulo) |
| Nombre del bucket | `tops-nexus-supabase-backups` |
| Service Account | `supabase-backup-uploader@tops-nexus-ops.iam.gserviceaccount.com` |
| Rol de la SA | `roles/storage.objectCreator` (write-only) |
| Cron | `02:00 ART` (= `05:00 UTC`), diario |
| Retención | 10 años (mínimo AFIP RG 1415) → lifecycle Standard→Nearline(90d)→Archive(365d)→Delete(3650d) |
| Repo de Actions | `martinbattaglia-commits/tops-ordenes` |

---

## 1 · Pre-condiciones (checklist)

- [ ] **P1.1** — Autorización explícita del presidente para ejecutar (ETAPA 1 / ejecución real).
- [ ] **P1.2** — Cuenta Google Workspace TOPS con permiso para **crear proyectos GCP** y **habilitar billing**.
  - ⚠️ El proceso quedó frenado antes porque Workspace tenía **GCP deshabilitado**. Confirmá en `admin.google.com` que GCP/Cloud está habilitado para tu organización **antes** de empezar.
- [ ] **P1.3** — Una cuenta de **billing de GCP** activa para asociar al proyecto (tarjeta o billing org). Sin billing, GCS no se puede usar.
- [ ] **P1.4** — `gcloud` CLI instalado localmente (`gcloud --version`) **o** usar la Cloud Shell del navegador (recomendado: no requiere instalar nada).
- [ ] **P1.5** — Cadena de conexión Postgres de **producción** Supabase (`SUPABASE_DB_URL` con `sslmode=require`). Obtenible en Supabase Dashboard → Project Settings → Database → Connection string (modo **Session**, puerto 5432, o pooler según corresponda). **Tratar como secreto.**
- [ ] **P1.6** — Acceso admin al repo GitHub para crear **Secrets** y **Actions**.

---

## 2 · STEP 1 — Crear el proyecto GCP `tops-nexus-ops`

**Dónde:** https://console.cloud.google.com (logueado con la cuenta Workspace TOPS). Recomendado abrir **Cloud Shell** (ícono `>_` arriba a la derecha) para los comandos.

### 2.1 — Variables de sesión (pegar en Cloud Shell)
```bash
export PROJECT_ID="tops-nexus-ops"
export REGION="southamerica-east1"
export BUCKET="tops-nexus-supabase-backups"
export SA_NAME="supabase-backup-uploader"
export SA_EMAIL="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
```

### 2.2 — Crear el proyecto
```bash
gcloud projects create "$PROJECT_ID" --name="TOPS NEXUS Ops"
gcloud config set project "$PROJECT_ID"
```
**Verificar:**
```bash
gcloud projects describe "$PROJECT_ID" --format="value(projectId,lifecycleState)"
# esperado: tops-nexus-ops   ACTIVE
```

### 2.3 — Asociar billing
```bash
# Listar cuentas de billing disponibles:
gcloud billing accounts list
# Asociar (reemplazá XXXXXX-XXXXXX-XXXXXX por tu billing account ID):
gcloud billing projects link "$PROJECT_ID" --billing-account=XXXXXX-XXXXXX-XXXXXX
```
**Verificar:**
```bash
gcloud billing projects describe "$PROJECT_ID" --format="value(billingEnabled)"
# esperado: True
```

### 2.4 — Habilitar la API de Cloud Storage
```bash
gcloud services enable storage.googleapis.com --project="$PROJECT_ID"
```

---

## 3 · STEP 2 — Crear el bucket privado en `southamerica-east1`

```bash
gcloud storage buckets create "gs://${BUCKET}" \
  --project="$PROJECT_ID" \
  --location="$REGION" \
  --uniform-bucket-level-access \
  --public-access-prevention
```
**Verificar (debe ser privado, uniform, region correcta):**
```bash
gcloud storage buckets describe "gs://${BUCKET}" \
  --format="value(location,uniform_bucket_level_access,public_access_prevention)"
# esperado: SOUTHAMERICA-EAST1   True   enforced
```

### 3.1 — Habilitar versioning + soft delete (defensa ante borrado)
```bash
gcloud storage buckets update "gs://${BUCKET}" --versioning
```

### 3.2 — Lifecycle policy (retención 10 años)
Crear archivo `lifecycle.json` (en Cloud Shell, `cat > lifecycle.json <<'EOF' ... EOF`):
```json
{
  "rule": [
    { "action": {"type": "SetStorageClass", "storageClass": "NEARLINE"},
      "condition": {"age": 90} },
    { "action": {"type": "SetStorageClass", "storageClass": "ARCHIVE"},
      "condition": {"age": 365} },
    { "action": {"type": "Delete"},
      "condition": {"age": 3650} }
  ]
}
```
Aplicar:
```bash
gcloud storage buckets update "gs://${BUCKET}" --lifecycle-file=lifecycle.json
```
**Verificar:**
```bash
gcloud storage buckets describe "gs://${BUCKET}" --format="json(lifecycle_config)"
# esperado: las 3 reglas (Nearline 90, Archive 365, Delete 3650)
```

### 3.3 — (Recomendado) Budget alert a $5/mes
En Console → Billing → Budgets & alerts → Create budget → scope `tops-nexus-ops` → monto $5 → alertas 50/90/100%.

---

## 4 · STEP 3 — Service Account write-only

```bash
# Crear la SA
gcloud iam service-accounts create "$SA_NAME" \
  --project="$PROJECT_ID" \
  --display-name="Supabase Backup Uploader"

# Otorgar SOLO objectCreator sobre el bucket (no read, no delete)
gcloud storage buckets add-iam-policy-binding "gs://${BUCKET}" \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/storage.objectCreator"
```
**Verificar el binding:**
```bash
gcloud storage buckets get-iam-policy "gs://${BUCKET}" \
  --format="json(bindings)" | grep -A2 objectCreator
```

### 4.1 — Generar la JSON key (secreto — NO commitear)
```bash
gcloud iam service-accounts keys create backup-sa-key.json \
  --iam-account="$SA_EMAIL"
```
- ⚠️ `backup-sa-key.json` es un **secreto**. NO lo subas al repo. Lo vas a pegar como GitHub Secret en STEP 4 y luego **borrarlo localmente**.
- Cloud Shell es efímero, pero igual: `rm backup-sa-key.json` cuando termines STEP 4.

---

## 5 · STEP 4 — Configurar GitHub Secrets

**Dónde:** GitHub → repo `martinbattaglia-commits/tops-ordenes` → Settings → Secrets and variables → Actions → **New repository secret**.

Crear estos 3 secrets:

| Nombre del secret | Valor |
|-------------------|-------|
| `SUPABASE_DB_URL` | cadena Postgres de **producción** con `sslmode=require` (de P1.5) |
| `GCP_SA_KEY` | contenido **completo** de `backup-sa-key.json` (multilínea, pegar tal cual) |
| `GCS_BUCKET` | `tops-nexus-supabase-backups` |

Después de pegar `GCP_SA_KEY`, borrá la key local: `rm backup-sa-key.json`.

---

## 6 · STEP 5 — Workflow de backup diario

> En ETAPA 0B este YAML queda **solo como referencia documental**. Crearlo en el repo (`.github/workflows/supabase-backup.yml`) y commitearlo es parte de la **ejecución autorizada**, no de esta entrega.

`.github/workflows/supabase-backup.yml`:
```yaml
name: Supabase Daily Backup

on:
  schedule:
    - cron: '0 5 * * *'   # 02:00 ART = 05:00 UTC
  workflow_dispatch:        # trigger manual

jobs:
  backup:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    steps:
      - name: Install pg_dump v15
        run: |
          sudo apt-get update
          sudo apt-get install -y postgresql-client-15
          pg_dump --version

      - name: Generate backup
        run: |
          DATE_PATH=$(date -u +'%Y/%m/%d')
          FILENAME="backup-$(date -u +'%Y-%m-%dT%H%M%SZ').dump"
          pg_dump "$SUPABASE_DB_URL" \
            --format=custom --compress=9 --no-owner --no-acl --verbose \
            --file="$FILENAME"
          ls -lh "$FILENAME"
          echo "FILENAME=$FILENAME" >> $GITHUB_ENV
          echo "DATE_PATH=$DATE_PATH" >> $GITHUB_ENV
        env:
          SUPABASE_DB_URL: ${{ secrets.SUPABASE_DB_URL }}

      - name: Auth to Google Cloud
        uses: google-github-actions/auth@v2
        with:
          credentials_json: ${{ secrets.GCP_SA_KEY }}

      - name: Set up Cloud SDK
        uses: google-github-actions/setup-gcloud@v2

      - name: Upload to GCS
        run: |
          gcloud storage cp "$FILENAME" \
            "gs://${{ secrets.GCS_BUCKET }}/${DATE_PATH}/${FILENAME}"

      - name: Verify upload
        run: |
          gcloud storage ls -l "gs://${{ secrets.GCS_BUCKET }}/${DATE_PATH}/${FILENAME}"

      - name: Cleanup local file
        if: always()
        run: rm -f "$FILENAME"

      - name: Notify on failure
        if: failure()
        uses: actions/github-script@v7
        with:
          script: |
            await github.rest.issues.create({
              ...context.repo,
              title: `🚨 Backup falló · ${new Date().toISOString().slice(0,10)}`,
              body: `Workflow: ${context.workflow}\nRun: ${context.serverUrl}/${context.repo.owner}/${context.repo.repo}/actions/runs/${context.runId}`,
              labels: ['ops','backup','urgent']
            });
```

> **Nota técnica:** `pg_dump` debe ser **v15** (Supabase corre Postgres 15). Si el dump falla con "server version mismatch", ajustá la versión del cliente.

---

## 7 · STEP 6 — Primer backup + restore test (validación)

> Esta es la prueba que convierte el reporte de Backup de 🔴 FAIL a 🟢 PASS. **Un backup que nunca se restauró no cuenta como backup.**

### 7.1 — Disparar el primer backup manualmente
GitHub → Actions → "Supabase Daily Backup" → **Run workflow** (botón `workflow_dispatch`).
Esperar ~3-5 min. Debe terminar verde.

### 7.2 — Confirmar el archivo en el bucket
```bash
gcloud storage ls -r "gs://${BUCKET}/**" | tail
# esperado: 1 archivo backup-<fecha>.dump bajo YYYY/MM/DD/
```

### 7.3 — Restore test en el SANDBOX (no en prod)
> Restaurar el dump en el proyecto sandbox `vrxosunxlhohmqymxots` (o una DB Postgres descartable). **Nunca restaurar sobre producción.**
```bash
# Descargar el backup más reciente
gcloud storage cp "gs://${BUCKET}/<YYYY/MM/DD>/backup-<fecha>.dump" /tmp/backup.dump

# Inspeccionar (no restaura, solo lista contenido)
pg_restore --list /tmp/backup.dump | head -30

# Restaurar en sandbox (SANDBOX_DB_URL = cadena Postgres del proyecto staging)
pg_restore --dbname="$SANDBOX_DB_URL" --no-owner --no-acl /tmp/backup.dump
```

### 7.4 — Smoke check post-restore (en sandbox)
```sql
SELECT count(*) FROM clients;   -- comparar contra prod (esperado ~2)
SELECT count(*) FROM orders;    -- esperado ~10
SELECT count(*) FROM operators; -- esperado ~7
```
Si los conteos son coherentes con producción → el backup es **restaurable y válido**. ✅

### 7.5 — Limpieza
```bash
rm -f /tmp/backup.dump
```

---

## 8 · STEP 7 — Restore test mensual automatizado (opcional pero recomendado)

Workflow `.github/workflows/restore-test.yml` (cron mensual) que:
1. Descarga el backup más reciente.
2. Lo restaura en una DB Postgres temporal (service container `postgres:15` del runner).
3. Compara conteos de tablas críticas.
4. Si OK → cierra issue; si FAIL → abre issue P0.

> Detalle de implementación en la ejecución; no es bloqueante para cerrar P0.1 (el cierre lo da STEP 6 manual).

---

## 9 · STEP 8 — Evidencia y cierre

Al validar STEP 6:
1. `BACKUP-SETUP-CLOSURE.md` — IDs del proyecto/bucket/SA, output del primer backup, output del restore test, conteos de smoke check.
2. `docs/runbooks/RESTORE-FROM-GCS-BACKUP.md` — runbook de restore para emergencia real.
3. `docs/runbooks/BACKUP-MONITORING.md` — cómo verificar los últimos N backups.
4. Re-emitir `PRE-FLIGHT-BACKUP-REPORT.md` → **PASS** (`PRE-FLIGHT-BACKUP-REPORT-V2.md`).
5. Actualizar `PRE-FLIGHT-GATE-0.md`: P0.1 → 🟢 PASS.

---

## 10 · Riesgos y mitigaciones

| ID | Riesgo | Severidad | Mitigación (ya en este runbook) |
|----|--------|-----------|----------------------------------|
| BKP.R1 | `backup-sa-key.json` commiteado por error | media | borrar local tras pegar como Secret; `.gitignore`; secret scanning |
| BKP.R2 | `pg_dump` versión ≠ Postgres 15 | media | STEP 5 fija `postgresql-client-15` + `pg_dump --version` |
| BKP.R3 | Bucket público | crítica | STEP 2 fuerza `--public-access-prevention` + uniform access |
| BKP.R4 | PII expuesta en GCP | media | bucket privado + proyecto aislado `tops-nexus-ops` + SA write-only |
| BKP.R5 | Borrado de backups | media | versioning (STEP 3.1) + SA sin permiso delete |
| BKP.R6 | Facturación inesperada | baja | budget alert $5/mes (STEP 3.3) |
| BKP.R7 | Restore nunca probado | alta | STEP 6 restore test obligatorio para cerrar P0.1 |
| BKP.R8 | GCP deshabilitado en Workspace | media | P1.2 verifica habilitación antes de empezar |

---

## 11 · Restricciones honradas (ETAPA 0B)

- 🛑 NO CREAR proyecto/bucket/service account · NO GENERAR backups · NO EJECUTAR workflows
- 🛑 NO COMMITEAR el workflow ni secrets · NO PR · NO DEPLOY · NO TOCAR producción
- 🛑 NO INVENTAR cifras — costos/lifecycle/clases trazados a `BACKUP-IMPLEMENTATION-PLAN.md` (pricing público GCS) y decisiones del presidente (2026-05-29)
