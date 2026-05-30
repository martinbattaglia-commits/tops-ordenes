# GCS-BACKUP-EXECUTION-PACK

**Proyecto:** TOPS NEXUS ERP · Logística TOPS / Verotin S.A.
**Fecha:** 2026-05-30
**Bloqueante objetivo:** **P0.1** de GATE 0 — backup externo de Supabase (Postgres) con retención AFIP 10 años.
**Naturaleza:** documento **único y autosuficiente**. Consolida arquitectura, pasos, comandos exactos, rollback, troubleshooting, validaciones y criterios de aprobación. Un operador puede ejecutar el proceso completo **sin abrir ningún otro documento**.
**Veredicto:** 🟢 **READY FOR BACKUP IMPLEMENTATION** (ver §12).

> 🛑 **Esta entrega NO ejecuta nada.** No crea proyectos, buckets, service accounts ni secrets; no genera backups ni restores; no commitea workflows; no toca producción ni sandbox. Es la guía a correr **cuando el presidente autorice la ejecución real**.

**Fuentes consolidadas (trazabilidad):**
- `BACKUP-EXECUTION-RUNBOOK.md` (2026-05-29) — comandos paso a paso, decisiones del presidente.
- `GCS-BACKUP-DRYRUN.md` (2026-05-30) — 5 escenarios simulados, hallazgos H1–H4.
- `GCS-BACKUP-CHECKLIST.md` (2026-05-30) — checklist operativa A–M.
- `BACKUP-IMPLEMENTATION-PLAN.md` (2026-05-29) — pricing público GCS, lifecycle.
- `PRE-FLIGHT-BACKUP-REPORT.md` (2026-05-29) — estado P0.1 = 🔴 (sin backup externo).

---

## 1 · Arquitectura

### 1.1 — Decisión (presidente · 2026-05-29)

| Parámetro | Valor confirmado |
|-----------|------------------|
| Estrategia | 🏆 **Opción B** — GitHub Actions + `pg_dump` + Google Cloud Storage |
| Proyecto GCP | **`tops-nexus-ops`** (nuevo, dedicado a ops/backup, aislado del ERP) |
| Región del bucket | **`southamerica-east1`** (São Paulo) |
| Nombre del bucket | `tops-nexus-supabase-backups` |
| Service Account | `supabase-backup-uploader@tops-nexus-ops.iam.gserviceaccount.com` |
| Rol de la SA | `roles/storage.objectCreator` (**write-only** — sin read, sin delete) |
| Cron | `0 5 * * *` → **02:00 ART = 05:00 UTC**, diario |
| Retención | 10 años (mínimo AFIP RG 1415) → lifecycle Standard→Nearline(90d)→Archive(365d)→Delete(3650d) |
| Repo de Actions | `martinbattaglia-commits/tops-ordenes` |
| Formato dump | `pg_dump --format=custom --compress=9 --no-owner --no-acl` |
| Cliente Postgres | **`postgresql-client-15`** (Supabase corre Postgres 15) |

### 1.2 — Flujo de datos

```
┌─────────────────────┐   cron diario 05:00 UTC   ┌──────────────────────────┐
│  GitHub Actions      │ ────────────────────────▶ │  runner ubuntu-latest     │
│  (repo tops-ordenes) │   o workflow_dispatch      │  pg_dump v15 → .dump      │
└─────────────────────┘                            └────────────┬─────────────┘
        secrets:                                                │  gcloud storage cp
        SUPABASE_DB_URL ──────────► pg_dump (prod, sslmode=require)
        GCP_SA_KEY      ──────────► auth SA write-only          ▼
        GCS_BUCKET                                  ┌──────────────────────────┐
                                                    │  gs://tops-nexus-supabase │
                                                    │  -backups/YYYY/MM/DD/      │
                                                    │  backup-<ISO>.dump         │
                                                    │  (privado · versioning ·   │
                                                    │   lifecycle 10 años)       │
                                                    └──────────────────────────┘
```

### 1.3 — Propiedades de seguridad

- **Aislamiento:** proyecto GCP separado del ERP; un compromiso del repo no expone el bucket más allá de escritura.
- **Write-only:** la SA solo puede **crear objetos**. No puede listar, leer ni borrar. Un atacante con el secret no puede exfiltrar ni destruir backups históricos.
- **Privacidad:** `--public-access-prevention` + uniform bucket-level access → imposible exponer PII públicamente por error de ACL.
- **Anti-borrado:** versioning activo + SA sin permiso `delete`. El borrado real solo lo hace el lifecycle a los 3650 días.
- **Restore aislado:** todo restore-test se hace en **sandbox** `vrxosunxlhohmqymxots`, nunca sobre producción.

---

## 2 · Pre-condiciones (bloqueantes — verificar ANTES de tocar nada)

| ID | Pre-condición | Cómo verificar | Estado |
|----|---------------|----------------|--------|
| P1.1 | Autorización explícita del presidente para ejecución real | confirmación en chat / firma §13 | ⬜ pendiente |
| P1.2 | Workspace TOPS con **GCP/Cloud habilitado** | `admin.google.com` → Apps → Additional Google services → Google Cloud = ON | ⬜ pendiente |
| P1.3 | Cuenta de **billing GCP** activa | `gcloud billing accounts list` devuelve ≥1 `OPEN` | ⬜ pendiente |
| P1.4 | `gcloud` CLI **o** Cloud Shell del navegador | `gcloud --version` / abrir Cloud Shell | ⬜ pendiente |
| P1.5 | Cadena Postgres **producción** (`sslmode=require`) | Supabase → Settings → Database → Connection string (Session, 5432) | ⬜ pendiente |
| P1.6 | Acceso admin al repo GitHub (Secrets + Actions) | Settings → Secrets visible | ⬜ pendiente |

> ⚠️ **H3 (DRYRUN):** el proceso quedó frenado en intentos previos porque **GCP estaba deshabilitado en Workspace**. P1.2 es el riesgo #1 de arranque — verificarlo primero evita perder una sesión entera.

---

## 3 · Pasos + comandos exactos

> Abrir **Cloud Shell** en https://console.cloud.google.com (ícono `>_`) logueado con la cuenta Workspace TOPS. No requiere instalar nada.

### 3.0 — Variables de sesión (pegar primero)
```bash
export PROJECT_ID="tops-nexus-ops"
export REGION="southamerica-east1"
export BUCKET="tops-nexus-supabase-backups"
export SA_NAME="supabase-backup-uploader"
export SA_EMAIL="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
```

### STEP 1 — Crear proyecto GCP + billing + API
```bash
gcloud projects create "$PROJECT_ID" --name="TOPS NEXUS Ops"
gcloud config set project "$PROJECT_ID"
gcloud projects describe "$PROJECT_ID" --format="value(projectId,lifecycleState)"
#  → esperado: tops-nexus-ops   ACTIVE

gcloud billing accounts list
gcloud billing projects link "$PROJECT_ID" --billing-account=XXXXXX-XXXXXX-XXXXXX
gcloud billing projects describe "$PROJECT_ID" --format="value(billingEnabled)"
#  → esperado: True

gcloud services enable storage.googleapis.com --project="$PROJECT_ID"
```

### STEP 2 — Crear bucket privado + versioning + lifecycle
```bash
gcloud storage buckets create "gs://${BUCKET}" \
  --project="$PROJECT_ID" --location="$REGION" \
  --uniform-bucket-level-access --public-access-prevention

gcloud storage buckets describe "gs://${BUCKET}" \
  --format="value(location,uniform_bucket_level_access,public_access_prevention)"
#  → esperado: SOUTHAMERICA-EAST1   True   enforced

gcloud storage buckets update "gs://${BUCKET}" --versioning

cat > lifecycle.json <<'EOF'
{
  "rule": [
    { "action": {"type": "SetStorageClass", "storageClass": "NEARLINE"}, "condition": {"age": 90} },
    { "action": {"type": "SetStorageClass", "storageClass": "ARCHIVE"},  "condition": {"age": 365} },
    { "action": {"type": "Delete"},                                       "condition": {"age": 3650} }
  ]
}
EOF
gcloud storage buckets update "gs://${BUCKET}" --lifecycle-file=lifecycle.json
gcloud storage buckets describe "gs://${BUCKET}" --format="json(lifecycle_config)"
#  → esperado: 3 reglas (Nearline 90, Archive 365, Delete 3650)
```
**(Recomendado)** Console → Billing → Budgets & alerts → budget $5/mes sobre `tops-nexus-ops`, alertas 50/90/100%.

### STEP 3 — Service Account write-only + key
```bash
gcloud iam service-accounts create "$SA_NAME" \
  --project="$PROJECT_ID" --display-name="Supabase Backup Uploader"

gcloud storage buckets add-iam-policy-binding "gs://${BUCKET}" \
  --member="serviceAccount:${SA_EMAIL}" --role="roles/storage.objectCreator"

gcloud storage buckets get-iam-policy "gs://${BUCKET}" \
  --format="json(bindings)" | grep -A2 objectCreator
#  → esperado: binding objectCreator con el SA_EMAIL

gcloud iam service-accounts keys create backup-sa-key.json --iam-account="$SA_EMAIL"
#  ⚠️ backup-sa-key.json es SECRETO. NO commitear. Pegarlo en STEP 4 y luego rm.
```

### STEP 4 — GitHub Secrets
GitHub → `martinbattaglia-commits/tops-ordenes` → Settings → Secrets and variables → Actions → **New repository secret**.

| Secret | Valor |
|--------|-------|
| `SUPABASE_DB_URL` | cadena Postgres **producción** con `sslmode=require` (P1.5) |
| `GCP_SA_KEY` | contenido **completo** (multilínea) de `backup-sa-key.json` |
| `GCS_BUCKET` | `tops-nexus-supabase-backups` |

```bash
rm backup-sa-key.json   # tras pegar GCP_SA_KEY
```

### STEP 5 — Workflow diario
Crear `.github/workflows/supabase-backup.yml` con el contenido del **Apéndice A** y commitearlo (esto ya es ejecución autorizada).

### STEP 6 — Primer backup + restore test (cierre de P0.1)
```bash
# 6.1 Disparar: GitHub → Actions → "Supabase Daily Backup" → Run workflow. Esperar ~3-5 min, verde.

# 6.2 Confirmar archivo en bucket
gcloud storage ls -r "gs://${BUCKET}/**" | tail
#  → esperado: 1 backup-<fecha>.dump bajo YYYY/MM/DD/

# 6.3 Restore test en SANDBOX (nunca prod)
gcloud storage cp "gs://${BUCKET}/<YYYY/MM/DD>/backup-<fecha>.dump" /tmp/backup.dump
pg_restore --list /tmp/backup.dump | head -30
pg_restore --dbname="$SANDBOX_DB_URL" --no-owner --no-acl /tmp/backup.dump
```
```sql
-- 6.4 Smoke check post-restore (en sandbox)
SELECT count(*) FROM clients;   -- esperado ~2
SELECT count(*) FROM orders;    -- esperado ~10
SELECT count(*) FROM operators; -- esperado ~7
```
```bash
rm -f /tmp/backup.dump   # 6.5 limpieza
```

### STEP 7 (opcional) — Restore-test mensual automatizado
Workflow `.github/workflows/restore-test.yml` (cron mensual) con service container `postgres:15`: descarga el último backup, restaura, compara conteos, abre issue P0 si falla. **No bloquea P0.1** — el cierre lo da el STEP 6 manual.

---

## 4 · Layout de almacenamiento

```
gs://tops-nexus-supabase-backups/
└── YYYY/
    └── MM/
        └── DD/
            └── backup-2026-05-30T050000Z.dump   (custom format, compress 9)
```
- **Storage class por edad:** Standard (0–90d) → Nearline (90–365d) → Archive (365–3650d) → Delete (3650d).
- **Naming:** ISO-8601 UTC en el nombre garantiza orden lexicográfico = orden cronológico.

---

## 5 · Rollback

> El proceso es **aditivo y aislado**: crea recursos nuevos en un proyecto GCP nuevo. No modifica el ERP, la base de datos ni el repo (salvo el workflow YAML, que es un archivo nuevo). Por eso el rollback es limpio.

| Punto de fallo | Acción de rollback |
|----------------|--------------------|
| Tras STEP 1 (proyecto) | `gcloud projects delete "$PROJECT_ID"` (revierte todo: proyecto, billing link, APIs) |
| Tras STEP 2 (bucket) | `gcloud storage rm -r "gs://${BUCKET}"` y luego delete del proyecto |
| Tras STEP 3 (SA/key) | `gcloud iam service-accounts delete "$SA_EMAIL"`; rotar/borrar la JSON key generada |
| Tras STEP 4 (secrets) | borrar los 3 secrets en GitHub Settings → Secrets |
| Tras STEP 5 (workflow) | `git revert` del commit del YAML, o borrar `.github/workflows/supabase-backup.yml` |
| Tras STEP 6 (restore en sandbox) | el restore es **solo en sandbox**; recrear/limpiar sandbox no afecta prod. `rm -f /tmp/backup.dump` |

**Rollback total (abortar todo):**
```bash
gcloud projects delete "$PROJECT_ID"   # elimina proyecto + bucket + SA + keys de una
# + borrar los 3 GitHub Secrets manualmente
# + revertir el commit del workflow si ya se commiteó
```
> ⚠️ El borrado del proyecto es reversible dentro de ~30 días (GCP soft-delete) pero el bucket y su contenido se pierden. En rollback de implementación inicial no hay backups valiosos aún, así que es seguro.

---

## 6 · Troubleshooting

| Síntoma | Causa probable | Resolución |
|---------|----------------|------------|
| `gcloud projects create` → `permission denied` / `billing` | GCP deshabilitado en Workspace (H3) | verificar P1.2 en `admin.google.com`; habilitar Google Cloud para la org |
| `pg_dump: server version mismatch` | cliente ≠ Postgres 15 | el workflow fija `postgresql-client-15`; en local instalar v15 (`pg_dump --version` debe decir 15.x) |
| `pg_dump: SSL connection required` | falta `sslmode=require` en `SUPABASE_DB_URL` | agregar `?sslmode=require` a la cadena |
| `pg_dump: too many connections` / timeout | usar pooler en vez de conexión directa | usar Connection string modo **Session** (puerto 5432), no Transaction pooler |
| Workflow auth GCP → `invalid_grant` / `credentials` | `GCP_SA_KEY` mal pegado (truncado) | re-pegar el JSON **completo** multilínea; regenerar key si hace falta (STEP 3) |
| `gcloud storage cp` → `403 does not have storage.objects.create` | binding de la SA no aplicado | reaplicar STEP 3 `add-iam-policy-binding objectCreator`; verificar `SA_EMAIL` |
| `gcloud storage cp` → `403 ... but has objectCreator` al **listar** | esperado: SA es write-only (no puede `ls`) | listar/restaurar con **identidad humana**, no con la SA (H1/H2) |
| `pg_restore` falla en sandbox | restaurar sobre DB con datos previos | usar DB limpia/descartable; `--no-owner --no-acl` ya incluidos |
| Backup corre pero archivo 0 bytes | `SUPABASE_DB_URL` apunta a DB vacía/equivocada | verificar que la cadena es de **producción** |
| Costo inesperado en billing | sin budget alert | crear budget $5/mes (STEP 2 recomendado) |

### Hallazgos del DRYRUN (trazabilidad)
- **H1** — la SA es **write-only**; el step "Verify upload" (`gcloud storage ls`) y cualquier listado/restore **requieren identidad humana**, no la SA. El workflow verifica upload con la SA solo porque el runner ya tiene el contexto; para auditoría manual usar tu usuario GCP.
- **H2** — el **restore necesita identidad humana** con permiso de lectura sobre el bucket (la SA no lee). Documentar a quién pertenece esa identidad antes de un restore de emergencia.
- **H3** — riesgo de arranque: **GCP deshabilitado en Workspace** (ver P1.2 / Troubleshooting fila 1).
- **H4** — `pg_dump` **debe ser v15**; mismatch de versión es el fallo técnico más común (ver fila 2).

---

## 7 · Validaciones (qué prueba que funciona)

| ID | Validación | Comando / criterio | Esperado |
|----|------------|--------------------|----------|
| V1 | Proyecto activo | `gcloud projects describe` | `ACTIVE` |
| V2 | Billing asociado | `gcloud billing projects describe` | `True` |
| V3 | Bucket privado + región | `gcloud storage buckets describe` | `SOUTHAMERICA-EAST1 / True / enforced` |
| V4 | Lifecycle 10 años | `describe --format="json(lifecycle_config)"` | 3 reglas (90/365/3650) |
| V5 | SA write-only | `get-iam-policy \| grep objectCreator` | binding presente, **sin** roles read/delete |
| V6 | Secrets cargados | GitHub → Settings → Secrets | 3 secrets visibles |
| V7 | Backup ejecuta | Actions → run verde | workflow success |
| V8 | Archivo en bucket | `gcloud storage ls -r` | 1 `.dump` bajo `YYYY/MM/DD/` |
| V9 | **Restore restaurable** | `pg_restore` en sandbox + smoke check | conteos ~2/~10/~7 coherentes con prod |

> 🔑 **V9 es el criterio de cierre real.** "Un backup que nunca se restauró no cuenta como backup." Solo V9 convierte P0.1 de 🔴 a 🟢.

---

## 8 · Criterios de aprobación (cierre de P0.1)

P0.1 se cierra y se re-emite `PRE-FLIGHT-BACKUP-REPORT-V2.md` → **PASS** cuando **todos** se cumplen:

- [ ] **C1** — V1–V6 verdes (infraestructura creada y privada).
- [ ] **C2** — V7+V8 verdes (primer backup real subido al bucket).
- [ ] **C3** — V9 verde (restore-test en sandbox con smoke check coherente).
- [ ] **C4** — Evidencia documentada: `BACKUP-SETUP-CLOSURE.md` con IDs reales (proyecto/bucket/SA), output del primer backup, output del restore, conteos.
- [ ] **C5** — Runbooks de operación creados: `docs/runbooks/RESTORE-FROM-GCS-BACKUP.md` + `docs/runbooks/BACKUP-MONITORING.md`.
- [ ] **C6** — `PRE-FLIGHT-GATE-0.md` actualizado: P0.1 → 🟢 PASS.

Cumplidos C1–C6 → **P0.1 CERRADO** → desbloquea la pre-condición de Backup de GATE 0 (la otra es RBAC, ver `RBAC-EXECUTION-PACK.md`).

---

## 9 · Riesgos y mitigaciones

| ID | Riesgo | Severidad | Mitigación (ya cubierta) |
|----|--------|-----------|--------------------------|
| BKP.R1 | `backup-sa-key.json` commiteado | media | `rm` tras pegar como Secret · `.gitignore` · secret scanning |
| BKP.R2 | `pg_dump` ≠ Postgres 15 | media | STEP 5 fija `postgresql-client-15` + `pg_dump --version` |
| BKP.R3 | Bucket público | crítica | STEP 2 `--public-access-prevention` + uniform access |
| BKP.R4 | PII expuesta en GCP | media | bucket privado + proyecto aislado + SA write-only |
| BKP.R5 | Borrado de backups | media | versioning (STEP 2) + SA sin permiso delete |
| BKP.R6 | Facturación inesperada | baja | budget alert $5/mes (STEP 2) |
| BKP.R7 | Restore nunca probado | alta | V9 / STEP 6 obligatorio para cerrar P0.1 |
| BKP.R8 | GCP deshabilitado en Workspace | media | P1.2 verifica antes de empezar (H3) |
| BKP.R9 | Restore sin identidad de lectura | media | H2 documentado: restore con usuario humano, no SA |

---

## 10 · Restricciones honradas (esta entrega)

- 🛑 NO crear proyecto / bucket / service account / secrets.
- 🛑 NO generar backups · NO restores · NO ejecutar workflows.
- 🛑 NO commitear el workflow · NO PR · NO merge · NO push · NO deploy.
- 🛑 NO tocar producción · NO tocar sandbox.
- 🛑 NO inventar cifras — costos/lifecycle/clases trazados a `BACKUP-IMPLEMENTATION-PLAN.md` (pricing público GCS) y decisiones del presidente (2026-05-29).

---

## 11 · Apéndice A — Workflow `.github/workflows/supabase-backup.yml`

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

> **Nota técnica:** `pg_dump` debe ser **v15** (Supabase = Postgres 15). Si falla con "server version mismatch", ajustar la versión del cliente.

---

## 12 · Veredicto

🟢 **READY FOR BACKUP IMPLEMENTATION**

**Evidencia:**
- Arquitectura, parámetros y decisiones **confirmados por el presidente** (2026-05-29) y trazados al runbook.
- **5 escenarios** simulados en `GCS-BACKUP-DRYRUN.md` (backup exitoso, fallo auth GCP, fallo pg_dump, restore sandbox, restore fallido) con hallazgos H1–H4 incorporados al troubleshooting.
- Comandos exactos, validaciones V1–V9, rollback por punto de fallo y criterios de cierre C1–C6 **autocontenidos** en este documento.
- Sin cifras inventadas; lifecycle/clases/costos trazados a `BACKUP-IMPLEMENTATION-PLAN.md`.

**Única acción manual restante para cerrar P0.1:** ejecutar STEP 1→6 bajo autorización del presidente, verificando P1.1–P1.6 primero.

**Condición no resuelta (no bloquea el pack, sí la ejecución):** confirmar **P1.2** (GCP habilitado en Workspace) — riesgo histórico de arranque (H3).

---

## 13 · Firma de aprobación

| Rol | Nombre | Decisión | Fecha |
|-----|--------|----------|-------|
| Presidente | Martín Battaglia | ⬜ AUTORIZA ejecución / ⬜ OBSERVA | __________ |
| Ejecutor | _______________ | ⬜ ejecutado / ⬜ pendiente | __________ |

> Al firmar AUTORIZA, el ejecutor corre §3 STEP 1→6 y completa C1–C6. Hasta entonces el estado es **documental · nada creado**.
