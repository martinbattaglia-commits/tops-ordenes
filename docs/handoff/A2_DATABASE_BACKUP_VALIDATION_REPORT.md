# TOPS NEXUS — A2 · DATABASE BACKUP VALIDATION REPORT

> Validación real del sistema de backup de base de datos (Fase A · P0 · A2). Fecha: 2026-06-04.
> Ejecutado con `gh`/`gcloud` en **modo lectura**. **No se modificó nada** (sin IAM, sin workflows, sin buckets,
> sin Storage, sin Netlify, sin staging, sin commits, sin push). **No se avanzó a A3.**
>
> ## ⛔ VEREDICTO: **NO-GO** — el backup de DB **NUNCA funcionó** (workflow roto + secrets ausentes).

---

## 1. GitHub

| Verificación | Resultado |
|---|---|
| Workflow `supabase-backup.yml` ("Supabase Daily Backup") existe y está `active` | ✅ **PRESENTE** (id 288830440) |
| Secret `SUPABASE_DB_URL` | ❌ **AUSENTE** |
| Secret `GCP_SA_KEY` | ❌ **AUSENTE** |
| Secret `GCS_BUCKET` | ❌ **AUSENTE** |
| Historial de runs | **1 run total** (programado 2026-06-04 08:42 UTC) → **failure** |
| ¿Algún run exitoso alguna vez? | ❌ **No** — nunca hubo un backup OK |
| Efecto colateral de fallo | El step "Notify on failure" **abrió un issue**: `🚨 Backup Supabase falló · 2026-06-04` (labels `ops/backup/urgent`, OPEN) |

> Secrets verificados por **nombre** (`gh secret list`), sin exponer valores.

---

## 2. Ejecución manual del workflow

**No se lanzó una ejecución manual — decisión fundamentada (no es una omisión).**

Motivo: el último run (programado, hoy) ya falló en **18s** y la causa es **previa a los secrets**, por lo que un
run manual fallaría de forma idéntica y **abriría otro issue "urgent" redundante**, sin aportar validación:

- **Step que falló:** `Install pg_dump v15` → `apt-get install -y postgresql-client-15` → **exit code 100**
  (paquete no disponible en el runner `ubuntu-latest` actual sin agregar el repo PGDG). El run muere **antes** de
  `Generate backup`, o sea **antes de usar `SUPABASE_DB_URL`**.
- Implica **dos defectos independientes**:
  1. 🐞 **Bug en el workflow:** el step de instalación de `pg_dump 15` no funciona en el runner → debe corregirse
     (agregar repo PGDG de PostgreSQL, o usar la imagen oficial de Supabase/`postgres:15`, o `pg_dump` ya presente).
  2. 🔑 **Secrets ausentes:** aunque se arregle (1), faltan los 3 secrets → fallaría en `Generate backup`/`Auth to GCP`.

> Si el owner igualmente desea un run manual de evidencia: `gh workflow run "Supabase Daily Backup"` (fallará en
> ~15–20s y abrirá un nuevo issue). **No recomendado** hasta corregir (1) y cargar (2).

| Métrica solicitada | Valor |
|---|---|
| Duración | ~15–18s (del run fallido) |
| Tamaño del dump | **N/A** (nunca se generó un dump) |
| Estado final | **failure** (exit 100 en `Install pg_dump v15`) |

---

## 3. Google Cloud Storage

| Verificación | Resultado |
|---|---|
| Bucket `tops-nexus-supabase-backups` | ⚠️ **No verificable ahora** — `gcloud` requiere re-login (`Reauthentication failed... run: gcloud auth login`) |
| Nuevo dump | **N/A** — no se generó ninguno (ningún run exitoso) |
| Dumps históricos | **0 esperados** (ningún backup subió jamás un objeto) |

> No se descargó nada ni se modificaron permisos. La verificación directa del bucket queda **pendiente del owner**
> (requiere `gcloud auth login` interactivo). Lógicamente, sin un run exitoso, **no hay objetos `.dump`** en GCS.

---

## 4. Evidencia recopilada

- `gh secret list` → ninguno de los 3 secrets requeridos presente.
- `gh run list --workflow=supabase-backup.yml` → 1 run, `completed/failure`, `schedule`, 2026-06-04T08:42:11Z.
- `gh run view 26940948984` → falla en step **"Install pg_dump v15"**, `Process completed with exit code 100`.
- `gh issue list --label backup` → `🚨 Backup Supabase falló · 2026-06-04` OPEN (auto-abierto por el workflow).
- `gcloud storage ls` → token expirado (re-auth pendiente); sin acceso de lectura en esta sesión.

*(Capturas para el expediente las debe tomar el owner desde las consolas: Actions run fallido, lista de Secrets, issue abierto, bucket GCS.)*

---

## 5. Estado real del backup de DB

| Dimensión | Estado |
|---|---|
| Workflow definido y versionado | ✅ |
| Workflow **ejecutable correctamente** | ❌ (bug en install de `pg_dump 15`) |
| Secrets configurados | ❌ (3 ausentes) |
| Backup exitoso alguna vez | ❌ **NUNCA** |
| Dump en GCS | ❌ ninguno |
| Alertstring de fallo | ✅ (abre issue — funcionando, ya hay 1 abierto) |

**Conclusión:** la afirmación previa "backup de DB diseñado/commiteado pero operación no verificada" se **corrige a
la baja**: el backup **está roto y nunca produjo un respaldo**. Hoy **no existe ningún backup de la DB de producción**.

---

## 6. GO / NO-GO para A3 (restore test)

> ## 🛑 **NO-GO para A3.**

A3 (probar un restore real) **requiere un dump válido** para restaurar — y **no existe ninguno**. No se puede
validar un restore sin un backup.

**Prerrequisitos para volver a intentar A2 (y recién después A3), en orden:**
1. **Corregir el workflow** (step de `pg_dump 15`): usar repo PGDG o contenedor `postgres:15`/imagen Supabase. *(modificación de workflow — fuera del alcance de A2; requiere autorización explícita)*
2. **Cargar los 3 GitHub Secrets** (`SUPABASE_DB_URL` de PROD con `sslmode=require`, `GCP_SA_KEY`, `GCS_BUCKET`).
3. **Re-ejecutar** el workflow (manual) → esperar **success** → registrar duración y **tamaño real del dump**.
4. **Verificar el objeto en GCS** (`gcloud auth login` + `gcloud storage ls`).
5. Cerrar el issue `🚨 Backup falló` cuando haya un run verde.
6. **Recién entonces:** GO para A3 (otorgar `objectViewer` a una SA de lectura + restore a proyecto efímero).

---

## 7. Impacto en resiliencia

Este hallazgo **rebaja** la estimación previa: la dimensión **Backups** no es ~45 sino más cerca de **~20**
(workflow presente pero nunca exitoso, sin ningún respaldo real, Storage también sin backup). El **score global
de resiliencia real es < 45**. Resolver A2 (workflow + secrets + primer backup verde) es ahora el **P0 #1** antes
que cualquier restore.

---

> **FIN — A2 Database Backup Validation.** Solo lectura. No se ejecutó el workflow manual (decisión fundamentada),
> no se cambió IAM/workflows/buckets/Storage/Netlify/staging, no hubo commits/push. Detenido: no se avanza a A3.
