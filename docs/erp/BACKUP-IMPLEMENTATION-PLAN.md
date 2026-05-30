# BACKUP-IMPLEMENTATION-PLAN

**Fecha:** 2026-05-29
**Objetivo:** cerrar P0.1 — diseñar e implementar backup externo Supabase con solución mínima viable y soporte AFIP 10 años retention.
**Estado:** plan documental · **NO ejecutar nada todavía**.
**Restricciones:** sin ejecutar nada · sin crear buckets · sin tocar producción.

---

## 0 · Contexto

`PRE-FLIGHT-BACKUP-REPORT.md` confirmó:
- ❌ 0 scripts de backup externo
- ❌ 0 env vars de S3/GCS para backup
- ❌ 0 documentación de cron de backup
- ⚠️ Supabase Pro PITR built-in (7 días) **NO sustituye** backup externo
- ⚠️ Riesgo: pérdida total ante incidente Supabase + incumplimiento AFIP

**Necesidad:** RPO razonable (≤24h), retention AFIP 10 años, costo bajo, complejidad operacional baja.

---

## 1 · Comparativa de opciones

### 1.1 Opción A — GitHub Actions + pg_dump + Amazon S3

#### Arquitectura
```
┌────────────────────┐       cron 02:00 ART     ┌─────────────────────┐
│   GitHub Actions    │ ──────────────────────── │  AWS S3             │
│   (Free tier)       │                          │  tops-nexus-backups │
│                     │  pg_dump --format=custom │                     │
│   Secret:           │  → backup-YYYY-MM-DD.    │  Lifecycle:         │
│   SUPABASE_DB_URL   │     dump (encrypted)     │   90d Standard      │
│   AWS credentials   │                          │   Glacier IR 1y     │
│                     │  aws s3 cp ...           │   Glacier Deep 10y  │
└────────────────────┘                          └─────────────────────┘
```

#### Costos mensuales (estimado)
| Recurso | Volumen | Costo |
|---------|---------|-------|
| GitHub Actions | ~30 min/mes (1.5 min/día × 30 días) | $0 (free 2000 min/mes en cuenta personal o team free) |
| AWS S3 Standard (primeros 90 días) | ~1.5 GB acumulado (50 MB/día × 30 días) | ~$0.03 |
| AWS S3 IA → Glacier IR | 5 GB | ~$0.10 |
| AWS S3 Glacier Deep Archive (10 años) | 18 GB acumulado | ~$0.04 |
| Egress (descargas para restore tests) | 50 MB/mes test | ~$0.01 |
| Lambda/cron trigger | n/a | $0 |
| **Total** | | **~$0.20/mes** |

**Costo a 10 años con crecimiento 2x:** ~$50 total.

#### Complejidad
- **Setup inicial:** 1-2 días
  - Crear bucket S3
  - IAM user con `s3:PutObject` solo a ese bucket
  - Generar Access Key / Secret
  - Configurar lifecycle policy (Standard 90d → IA → Glacier IR → Deep Archive)
  - Crear workflow `.github/workflows/supabase-backup.yml`
  - Configurar GitHub Secrets (SUPABASE_DB_URL, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY)
- **Mantenimiento:** ~30 min/mes
  - Verificar último backup
  - Validar checksum (vía health endpoint)
  - Rotación de credenciales AWS cada 6 meses
- **Curva de aprendizaje:** baja (S3 es ampliamente conocido)

#### Restore
- **RPO:** 24 horas (peor caso, próximo backup en cron diario)
- **RTO:** 30-60 min para restore completo en sandbox separado
- **Procedimiento:**
  ```bash
  # Sin ejecutar — propuesta
  aws s3 cp s3://tops-nexus-backups/2026/05/29.dump - | \
    pg_restore --dbname=$SANDBOX_DB_URL --no-owner --no-acl
  ```
- **Portabilidad:** ✅ alta — pg_dump es estándar Postgres, restore en cualquier instancia

#### Mantenimiento
- ✅ Workflow YAML versionado en repo
- ✅ Lifecycle policy automática (sin intervención humana)
- ✅ Alertas via GitHub si workflow falla
- ✅ Costo bajo y predecible
- ⚠️ Dependencia: GitHub Actions + AWS
- ⚠️ Credenciales AWS deben rotarse manualmente

#### Pros / Contras
**Pros:**
- Costo despreciable (<$1/mes)
- Estándar de la industria
- Restore portátil (Postgres puro)
- AWS S3 Glacier Deep Archive cubre 10 años AFIP por <$5 total
- Workflow versionado y revisable

**Contras:**
- Requiere cuenta AWS (si TOPS no tiene)
- Rotación manual de credenciales
- RPO 24h (no minutos)

---

### 1.2 Opción B — GitHub Actions + pg_dump + Google Cloud Storage

#### Arquitectura
Idéntica a Opción A pero target GCS en lugar de S3.

```
┌────────────────────┐       cron 02:00 ART     ┌─────────────────────┐
│   GitHub Actions    │ ──────────────────────── │  GCS                │
│   (Free tier)       │                          │  tops-nexus-backups │
│                     │  pg_dump → gsutil cp     │                     │
│   Secret:           │                          │  Lifecycle:         │
│   GCP_SA_KEY        │                          │   90d Standard      │
│                     │                          │   Nearline 1y       │
│                     │                          │   Archive 10y       │
└────────────────────┘                          └─────────────────────┘
```

#### Costos mensuales (estimado)
| Recurso | Volumen | Costo |
|---------|---------|-------|
| GitHub Actions | ídem A | $0 |
| GCS Standard (primeros 90d) | 1.5 GB | ~$0.04 |
| GCS Nearline → Archive | 5 GB | ~$0.06 |
| GCS Archive (10 años) | 18 GB | ~$0.07 |
| Egress | trivial | ~$0.01 |
| **Total** | | **~$0.18/mes** |

#### Complejidad
- **Setup inicial:** 1-2 días — similar a S3
  - Crear bucket GCS
  - Service Account con `roles/storage.objectCreator`
  - JSON key → GitHub Secret `GCP_SA_KEY`
  - Lifecycle policy en JSON
  - Workflow YAML
- **Mantenimiento:** ~30 min/mes (idem A)
- **Curva de aprendizaje:** media (GCS menos común que S3 en el ecosistema)

#### Restore
- RPO/RTO: idénticos a Opción A
- Procedimiento:
  ```bash
  # Sin ejecutar — propuesta
  gsutil cp gs://tops-nexus-backups/2026/05/29.dump - | \
    pg_restore --dbname=$SANDBOX_DB_URL --no-owner --no-acl
  ```
- Portabilidad: ✅ alta

#### Ventaja específica TOPS
- ✅ **TOPS ya usa Google Workspace** (Drive corporativo, ANMAT folder, etc.)
- ✅ **Credenciales / facturación centralizadas** en mismo proveedor
- ✅ **Service Account ya existe** para Drive integration (módulo Drive `src/lib/drive/`)
- ✅ **GCP project staging si se configura** podría compartir billing org

#### Pros / Contras vs A
**Pros adicionales:**
- Misma cuenta Google que Workspace TOPS
- Service Account ya familiar para el equipo
- GCS Archive ligeramente más barato a largo plazo

**Contras:**
- GCS menos común en docs/tutoriales que S3
- Si TOPS no tiene GCP project, requiere setup nuevo

---

### 1.3 Opción C — wal-g + S3 (continuous WAL archiving)

**Alternativa técnicamente superior identificada:** archivado continuo de WALs (Write-Ahead Logs) + base backups periódicos, vía herramienta open-source [wal-g](https://github.com/wal-g/wal-g).

#### Arquitectura
```
┌────────────────────┐       cada cambio        ┌─────────────────────┐
│   Supabase         │ ──────────────────────── │  AWS S3             │
│   Postgres          │   WAL streaming via      │  tops-nexus-wal     │
│                     │   archive_command =      │  + base backups    │
│   (requiere SU)     │   `wal-g wal-push`       │                     │
└────────────────────┘                          └─────────────────────┘
       │                                                  ▲
       │  base backup diario                              │
       └──── wal-g backup-push ───────────────────────────┘
```

#### Costos mensuales (estimado)
| Recurso | Volumen | Costo |
|---------|---------|-------|
| GitHub Actions (base backup) | ~30 min/mes | $0 |
| AWS S3 Standard (WALs activos) | 2-5 GB | ~$0.10 |
| AWS S3 IA → Glacier IR | acumulado | ~$0.20 |
| Egress | n/a | ~$0.02 |
| **Total** | | **~$0.40-0.60/mes** |

#### Complejidad
- **Setup inicial:** **5-7 días** (significativamente más)
  - ⚠️ **Requiere acceso a Postgres-level config** (`archive_command`, `archive_mode`)
  - ⚠️ **Supabase no permite editar postgresql.conf directamente** en plan Pro
  - ⚠️ **Necesita SUPABASE Enterprise tier** o self-hosted Postgres
  - Si avanza: configurar wal-g en runtime, secretos AWS, base backup schedule
- **Mantenimiento:** ~2-4 horas/mes
  - Monitoreo de continuous WAL push
  - Validación periódica de base backups
  - Pruning de WALs viejos
- **Curva de aprendizaje:** alta (concepto WAL streaming requiere conocimiento Postgres avanzado)

#### Restore
- **RPO:** **5 minutos** (mucho mejor que A/B)
- **RTO:** 1-3 horas (base backup + WAL replay)
- **Portabilidad:** ✅ alta (Postgres estándar)

#### Limitación crítica
**Supabase Pro NO expone configuración postgresql.conf para `archive_command`.** Necesitaría:
- Plan Enterprise Supabase (~$599/mes mínimo)
- O self-hosted Postgres (eliminaría ventaja de managed Supabase)

**Verdict técnico:** wal-g es **superior técnicamente** pero **no viable en Supabase Pro plan actual sin upgrade significativo de costo y complejidad operativa**.

#### Pros / Contras
**Pros:**
- RPO de minutos (vs 24h)
- Continuous backup verdadero

**Contras:**
- Requiere Supabase Enterprise ($599+/mes vs $25/mes Pro) o self-hosting
- Complejidad operativa alta
- Costo total ~$575/mes adicional, vs <$1/mes para A/B
- NO viable hoy

---

### 1.4 Opción D (mención) — Servicios managed terceros

Ejemplos: SimpleBackups, Snaplet, DBBackup, etc.

#### Características generales
- **Costo:** $20-100/mes según volumen y features
- **Complejidad:** baja (configuras vía panel web)
- **Restore:** UI con 1 click
- **Portabilidad:** variable (algunos lock-in)
- **Mantenimiento:** mínimo (servicio managed)

#### Verdict
✅ Conveniente para equipos sin DevOps interno.
❌ Sobre-costo significativo vs solución casera A/B (~$0.20/mes).
❌ Dependencia adicional de proveedor con SLA propio.
❌ Innecesario para volumen pequeño de TOPS (50 MB/día).

**No recomendada** para FASE 1A actual.

---

## 2 · Tabla comparativa consolidada

| Criterio | Opción A (S3) | Opción B (GCS) | Opción C (wal-g) | Opción D (Managed) |
|----------|---------------|-----------------|-------------------|----------------------|
| **Costo mensual** | ~$0.20 | ~$0.18 | ~$575+ | $20-100 |
| **Setup tiempo** | 1-2 días | 1-2 días | 5-7 días | 0.5 día |
| **RPO** | 24h | 24h | 5 min | varía |
| **RTO** | 30-60 min | 30-60 min | 1-3 h | <30 min UI |
| **Complejidad operativa** | baja | baja | alta | mínima |
| **Mantenimiento /mes** | ~30 min | ~30 min | ~3 h | <10 min |
| **Portabilidad** | alta | alta | alta | variable |
| **Lock-in** | bajo (S3 estándar) | bajo (GCS estándar) | bajo (Postgres puro) | medio-alto |
| **Integración con stack TOPS** | media (AWS nuevo) | **alta (Google Workspace ya activo)** | n/a (Supabase Enterprise) | media |
| **Costo a 10 años** | ~$50 total | ~$45 total | ~$70k+ total (con Enterprise) | $2.4k-12k |
| **Cumple retention AFIP 10y** | ✅ Glacier Deep Archive | ✅ Archive | ✅ | ✅ |
| **Requiere account nuevo?** | AWS (probable nuevo) | GCP (probable nuevo) | Supabase Enterprise | provider |
| **Restore tests automáticos** | sí (workflow extra) | sí | sí | depende |
| **Encriptación at-rest** | ✅ AES-256 | ✅ AES-256 | ✅ | ✅ |

---

## 3 · Análisis vs requisitos TOPS

### 3.1 Requisitos identificados

| # | Requisito | Origen | Crítico? |
|---|-----------|--------|----------|
| 1 | RPO ≤ 24h | Buena práctica | sí |
| 2 | Retention 10 años | AFIP Art. 33 RG 1415 | sí |
| 3 | Costo total bajo (cuenta startup) | TOPS / Verotin S.A. | sí |
| 4 | Bajo mantenimiento operativo | Sin DevOps full-time | sí |
| 5 | Restore portátil (no lock-in) | Independencia técnica | sí |
| 6 | Integración con stack actual | Eficiencia | no (deseable) |
| 7 | Encriptación at-rest + in-transit | Compliance | sí |
| 8 | Audit trail de quién/cuándo/qué | Compliance | sí (loggeable en workflow) |
| 9 | Restore test automático periódico | Confianza | sí |

### 3.2 Scoring por opción

| Criterio (peso) | A | B | C | D |
|------------------|---|---|---|---|
| Costo (peso 25%) | 9/10 | 9/10 | 1/10 | 5/10 |
| Complejidad (20%) | 8/10 | 8/10 | 3/10 | 9/10 |
| RPO (15%) | 6/10 | 6/10 | 10/10 | 7/10 |
| Integración stack (15%) | 6/10 | **9/10** | 1/10 | 6/10 |
| Portabilidad (10%) | 9/10 | 9/10 | 9/10 | 6/10 |
| Mantenimiento (10%) | 8/10 | 8/10 | 4/10 | 9/10 |
| Retention AFIP (5%) | 10/10 | 10/10 | 10/10 | 8/10 |
| **Score total** | **7.7** | **8.3** | **3.6** | **6.9** |

---

## 4 · 🏆 Recomendación final

# 🏆 **Opción B — GitHub Actions + pg_dump + Google Cloud Storage**

### 4.1 Justificación

1. **Integración nativa con stack TOPS:**
   - TOPS ya usa **Google Workspace** (Drive corporativo, ANMAT, etc.)
   - El módulo Drive en `src/lib/drive/` usa Service Accounts de Google Cloud
   - GCP billing ya conocido por el equipo
   - Sin necesidad de gestionar 2da cuenta cloud (AWS sería nueva)

2. **Costo mínimo (~$0.18/mes hoy, ~$45 total a 10 años):**
   - Cumple budget startup TOPS
   - Sin tier nuevo de Supabase requerido
   - GitHub Actions free tier cubre el cron

3. **Complejidad baja (1-2 días setup):**
   - Service Account + IAM ya familiar al equipo
   - Workflow YAML versionado y revisable
   - Lifecycle policy declarativa

4. **Cumple requisitos AFIP 10 años retention:**
   - GCS Archive class: $0.0012/GB/mes
   - 18 GB acumulado en 10 años → ~$2.6 total

5. **Restore portátil:**
   - pg_dump custom format → cualquier Postgres lo lee
   - Sin lock-in con proveedor managed

6. **Score más alto en evaluación:** 8.3/10 vs 7.7 A / 3.6 C / 6.9 D.

### 4.2 Por qué NO Opción A (S3)

Aunque técnicamente equivalente, Opción A requiere:
- Crear cuenta AWS nueva (TOPS no la tiene, hasta donde está documentado en este proyecto)
- Gestionar credenciales en 2do proveedor cloud
- Onboarding del equipo a AWS

Beneficio marginal: cero. Costo marginal: tiempo de onboarding.

### 4.3 Por qué NO Opción C (wal-g)

Aunque RPO de 5 min es atractivo:
- Requiere Supabase Enterprise plan ($575+/mes)
- O self-hosted Postgres (eliminaría ventaja managed)
- Complejidad operativa 6x mayor
- TOPS no tiene equipo DevOps full-time para mantenerlo

**Trade-off:** RPO 24h aceptable hoy. Si crecemos a operación crítica con volumen alto, evaluar wal-g en futuro.

### 4.4 Por qué NO Opción D (managed)

- 100-500x más caro que B sin valor proporcional
- Lock-in con tercero
- TOPS tiene capacidad técnica para A/B

---

## 5 · Plan de implementación Opción B (sin ejecutar)

### 5.1 Paso 1 — Setup GCP

**Tiempo:** 30 min

```
1. Login en https://console.cloud.google.com con cuenta Workspace TOPS
2. Crear proyecto: `tops-nexus-ops` (o reusar si existe)
3. Habilitar Cloud Storage API
4. Crear bucket: `tops-nexus-supabase-backups`
   - Region: `us-east1` (cerca de Supabase) o `southamerica-east1` (cerca de TOPS)
   - Storage class: Standard
   - Uniform bucket-level access: enabled
   - Public access prevention: enforced
5. Configurar lifecycle policy (JSON):
   {
     "lifecycle": {
       "rule": [
         { "action": {"type":"SetStorageClass","storageClass":"NEARLINE"},
           "condition": {"age":90} },
         { "action": {"type":"SetStorageClass","storageClass":"ARCHIVE"},
           "condition": {"age":365} },
         { "action": {"type":"Delete"},
           "condition": {"age":3650} }
       ]
     }
   }
6. Crear Service Account: `supabase-backup-uploader@tops-nexus-ops.iam.gserviceaccount.com`
   - Role: `roles/storage.objectCreator` (write-only, no read/delete)
   - Scope: solo bucket tops-nexus-supabase-backups
7. Generar JSON key y guardar localmente como `backup-sa-key.json`
   - ⚠️ Tratar como secreto: NO commitear
```

### 5.2 Paso 2 — Setup GitHub Actions

**Tiempo:** 30 min

```
1. En GitHub repo `martinbattaglia-commits/tops-ordenes`:
   Settings → Secrets and variables → Actions → New repository secret

2. Crear los siguientes secrets:
   - SUPABASE_DB_URL          (cadena Postgres con sslmode=require)
   - GCP_SA_KEY               (contenido del JSON key, multilinea OK)
   - GCS_BUCKET               (nombre del bucket)

3. Crear workflow: `.github/workflows/supabase-backup.yml`
```

### 5.3 Workflow propuesto (referencia, NO ejecutar todavía)

```yaml
# .github/workflows/supabase-backup.yml
name: Supabase Daily Backup

on:
  schedule:
    - cron: '0 5 * * *'   # 02:00 ART = 05:00 UTC
  workflow_dispatch:       # Permite trigger manual

jobs:
  backup:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    steps:
      - name: Install pg_dump v15
        run: |
          sudo apt-get update
          sudo apt-get install -y postgresql-client-15

      - name: Generate backup
        run: |
          DATE_PATH=$(date -u +'%Y/%m/%d')
          FILENAME="backup-$(date -u +'%Y-%m-%dT%H%M%SZ').dump"
          pg_dump "$SUPABASE_DB_URL" \
            --format=custom \
            --compress=9 \
            --no-owner \
            --no-acl \
            --verbose \
            --file="$FILENAME"
          ls -lh "$FILENAME"
          echo "FILENAME=$FILENAME" >> $GITHUB_ENV
          echo "DATE_PATH=$DATE_PATH" >> $GITHUB_ENV
        env:
          SUPABASE_DB_URL: ${{ secrets.SUPABASE_DB_URL }}

      - name: Setup gcloud SDK
        uses: google-github-actions/setup-gcloud@v2
        with:
          service_account_key: ${{ secrets.GCP_SA_KEY }}
          export_default_credentials: true

      - name: Upload to GCS
        run: |
          gsutil -h "Content-Type:application/octet-stream" \
                 cp "$FILENAME" \
                 "gs://${{ secrets.GCS_BUCKET }}/${DATE_PATH}/${FILENAME}"

      - name: Verify upload
        run: |
          gsutil ls -l "gs://${{ secrets.GCS_BUCKET }}/${DATE_PATH}/${FILENAME}"

      - name: Cleanup local file
        if: always()
        run: rm -f "$FILENAME"

      - name: Notify on failure
        if: failure()
        uses: actions/github-script@v7
        with:
          script: |
            // Crear issue automático si falla
            await github.rest.issues.create({
              ...context.repo,
              title: `🚨 Backup falló · ${new Date().toISOString().slice(0,10)}`,
              body: `Workflow: ${context.workflow}\nRun: ${context.runId}\nVer: ${context.serverUrl}/${context.repo.owner}/${context.repo.repo}/actions/runs/${context.runId}`,
              labels: ['ops', 'backup', 'urgent']
            });
```

### 5.4 Paso 3 — Validación

**Tiempo:** 1-2 horas

```
1. Trigger manual del workflow desde GitHub Actions UI
2. Esperar a que termine (~3-5 min)
3. Verificar en GCS console: bucket tiene 1 archivo .dump
4. Descargar el archivo a máquina local:
   gsutil cp gs://tops-nexus-supabase-backups/[fecha]/backup-*.dump /tmp/

5. Restore en sandbox separado (verificar integridad):
   pg_restore --list /tmp/backup-*.dump | head -20
   pg_restore --dbname=$SANDBOX_DB_URL --no-owner --no-acl /tmp/backup-*.dump

6. Smoke check:
   SELECT count(*) FROM clients;   -- debe matchar prod
   SELECT count(*) FROM orders;
   SELECT count(*) FROM customer_invoices;
```

### 5.5 Paso 4 — Documentación

Después de validación exitosa, generar:

1. `docs/runbooks/RESTORE-FROM-GCS-BACKUP.md` — runbook paso a paso
2. `docs/runbooks/BACKUP-MONITORING.md` — cómo verificar últimos N backups
3. `PRE-FLIGHT-BACKUP-REPORT-V2.md` — re-emisión como PASS

### 5.6 Paso 5 — Restore test mensual

Programar restore test mensual:
- Workflow `.github/workflows/restore-test.yml` (cron mensual)
- Descarga backup más reciente
- Restore en sandbox temporal
- Compara checksum básico (count de tablas críticas)
- Si OK: closing issue
- Si FAIL: abrir issue P0

---

## 6 · Riesgos identificados

| ID | Riesgo | Severidad | Mitigación |
|----|--------|-----------|------------|
| BKP.R1 | Service Account JSON leak (commit accidental) | media | `.gitignore` + pre-commit hook + secret scanning GitHub |
| BKP.R2 | pg_dump versión mismatch con Postgres remoto | media | usar pg_dump v15 (Supabase usa Postgres 15) y validar con `pg_dump --version` en workflow |
| BKP.R3 | Bucket público por error | crítica | "Public access prevention: enforced" en setup |
| BKP.R4 | Backup completo expone PII a GCP | media | bucket privado + uniform access + audit GCP nivel proyecto |
| BKP.R5 | GitHub Actions free tier excedido | baja | 30 min/mes × 12 = 360 min/año << 2000 min/mes free |
| BKP.R6 | GCS facturación inesperada | baja | budget alert en GCP a $5/mes |
| BKP.R7 | Restore test mensual no se hace | media | workflow automático + issue tracking |
| BKP.R8 | Cuenta GCP comprometida → backups borrados | media | versioning enabled + soft delete 30 días |
| BKP.R9 | Costo de egress al hacer restore desde Glacier | baja | restore tests usan archivo reciente (Standard), no Archive |

---

## 7 · Cronograma propuesto

```
Día 1 (sesión coordinación, ~30 min)
  └── Aprobación del usuario · selección final de provider · acceso a GCP Workspace TOPS

Día 1-2 (DevOps, ~3-4 horas)
  ├── Setup proyecto GCP `tops-nexus-ops` (si no existe)
  ├── Crear bucket + lifecycle policy
  ├── Crear Service Account + JSON key
  └── Configurar GitHub Secrets

Día 2 (DevOps, ~2 horas)
  ├── Crear workflow YAML
  ├── Trigger manual primera vez
  ├── Validar archivo en bucket
  └── Restore test en sandbox

Día 2-3 (DevOps, ~2 horas)
  ├── Documentar runbooks
  ├── Configurar restore test automático
  └── Generar PRE-FLIGHT-BACKUP-REPORT-V2.md como PASS
```

**Total trabajo:** 1-2 días calendario · 5-7 horas DevOps + 30 min usuario.

---

## 8 · Plan B si Opción B falla (Opción A como fallback)

Si por motivos organizacionales (acceso a GCP TOPS no disponible, etc.) Opción B se bloquea:

- Caer a **Opción A (AWS S3)** con setup equivalente
- Costo ligeramente mayor (~$0.02/mes diferencia)
- Mismo nivel de funcionalidad

Cambios al plan:
- Crear cuenta AWS si TOPS no tiene
- Reemplazar GCS por S3 en workflow YAML
- Reemplazar `gsutil` por `aws s3` cli
- Mismo lifecycle pero con AWS storage classes (S3 Standard → IA → Glacier IR → Deep Archive)

---

## 9 · Documentos a generar al cerrar

1. `BACKUP-SETUP-CLOSURE.md` — registros de ejecución del setup
2. `docs/runbooks/RESTORE-FROM-GCS-BACKUP.md` — runbook restore
3. `docs/runbooks/BACKUP-MONITORING.md` — runbook monitoring
4. `PRE-FLIGHT-BACKUP-REPORT-V2.md` — re-emisión como PASS
5. `.github/workflows/supabase-backup.yml` (PR aparte cuando se autorice)
6. `.github/workflows/restore-test.yml` (idem)

---

## 10 · Decisiones pendientes del usuario

| # | Decisión | Default propuesto |
|---|----------|---------------------|
| 1 | Aprobar Opción B (GCS) o usar Opción A (S3) o D (managed) | **Opción B** |
| 2 | Project GCP nuevo `tops-nexus-ops` o reusar existente | nuevo (más limpio) |
| 3 | Region del bucket | `southamerica-east1` (latencia con TOPS) |
| 4 | Horario del cron (02:00 ART por default) | confirmar o cambiar |
| 5 | Quién implementa (Usuario directo, DevOps externo, dev TOPS) | TBD |
| 6 | Budget alert threshold en GCP | $5/mes |
| 7 | Backup retention precisa (10 años AFIP es mínimo legal — ¿más?) | 10 años (mínimo) |
| 8 | ¿Notificaciones por Slack o email si backup falla? | Slack vía workflow secret o email |

---

## 11 · Conclusión

🏆 **Recomendación final: Opción B — GitHub Actions + pg_dump + Google Cloud Storage**

**Razones (resumen):**
- Integración nativa con Google Workspace TOPS ya activo
- Costo despreciable ~$0.18/mes (~$45 a 10 años)
- Complejidad baja (1-2 días setup)
- Cumple retention AFIP 10 años con Archive class
- Restore portátil sin lock-in
- Score 8.3/10 (vs A 7.7, C 3.6, D 6.9)
- Plan B claro (caer a A) si organizativamente no procede

**No requiere upgrade de Supabase plan.** Sigue en Pro tier ($25/mes).

**Esperando aprobación del usuario para arrancar setup.**

---

## 12 · Restricciones honradas

- 🛑 NO IMPLEMENTAR · NO CREAR buckets · NO CREAR Service Accounts
- 🛑 NO EJECUTAR workflows · NO HACER backups
- 🛑 NO MODIFICAR producción
- 🛑 NO COMMITEAR Secrets · NO crear PR todavía
- 🛑 NO INVENTAR cifras — cálculos basados en pricing público actual de S3/GCS (verificable)
- 🛑 NO TOCAR Supabase · Drive · ARCA · credenciales
