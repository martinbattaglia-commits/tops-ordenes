# TOPS NEXUS — A2.1 · BACKUP WORKFLOW REMEDIATION

> Corrección del workflow `.github/workflows/supabase-backup.yml` para que el backup de DB pueda ejecutarse con
> éxito cuando el owner cargue los secrets. Fecha: 2026-06-04. **Editado solo el archivo local del workflow
> (entregable). NO se ejecutó, NO se cargaron secrets, NO se tocó GitHub/GCP/Supabase/Netlify, NO push, NO commit.**

---

## 1. Auditoría del workflow (estado previo)

| # | Hallazgo | Severidad |
|---|---|---|
| H1 | **`apt-get install postgresql-client-15` sin repo PGDG** → en `ubuntu-latest` (24.04 *noble*) ese repo solo trae el cliente **16** → "Unable to locate package" → **exit 100**. **Causa raíz del fallo de A2.** | 🔴 Rompe el run en el step 1 |
| H2 | **Sin validación de secrets** → si faltan, el run muere más adelante con error opaco (y antes ni llegaba por H1). | 🟠 |
| H3 | **Sin `set -euo pipefail`** en los `run` → errores intermedios podían no propagarse. | 🟠 |
| H4 | **Sin verificación del dump** (tamaño/integridad) antes de subir → podía subir un archivo vacío/corrupto. | 🟠 |
| H5 | **Sin validación de `gcloud`** antes del upload. | 🟡 |
| H6 | `actions/github-script@v7` corre en Node 20 (aviso de deprecación; **no fatal**). | 🟡 |
| H7 | `rm -f "$FILENAME"` en cleanup con `$FILENAME` posiblemente unbound bajo `set -u`. | 🟡 |

**Riesgos de seguridad:** ninguno nuevo. La SA es write-only (`objectCreator`), `permissions` mínimas
(`contents: read`, `issues: write`), secrets no se imprimen (GitHub los enmascara; la validación usa `-z`, sin volcar valores). El acceso a PROD es **solo lectura** (`pg_dump`).

---

## 2. Corrección de la instalación de pg_dump — opción elegida

**Elegida: Opción A — Repositorio oficial PGDG (`apt.postgresql.org`).**

| Opción | Decisión | Motivo |
|---|---|---|
| **A) PGDG apt repo** | ✅ **ELEGIDA** | Instala el cliente **15 exacto** (matchea el server Supabase). Mantiene el job en el runner host → `google-github-actions/auth@v2` + `setup-gcloud@v2` + `gcloud storage` funcionan sin cambios. Método recomendado por PostgreSQL. Cambio mínimo y determinístico. |
| B) `container: postgres:15` | ❌ | La imagen `postgres:15` no trae `gcloud`/`curl`/python que esperan las google-actions → habría que instalar gcloud dentro del contenedor o partir en 2 jobs. Más piezas móviles y frágil. |
| C) `docker run postgres:15 pg_dump` | ❌ | Aísla pg_dump pero agrega complejidad de volúmenes/montaje para pasar la conn string y recuperar el `.dump`. Sin ventaja sobre A. |

Implementación (key con `signed-by`, sin `apt-key` deprecado):
```bash
sudo install -d /usr/share/postgresql-common/pgdg
sudo curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
  -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc
echo "deb [signed-by=...] https://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" \
  | sudo tee /etc/apt/sources.list.d/pgdg.list
sudo apt-get update && sudo apt-get install -y postgresql-client-15
```

---

## 3. Hardening aplicado

| Mejora | Cómo |
|---|---|
| **Fail-fast de secrets** | Nuevo step inicial que valida `SUPABASE_DB_URL`/`GCP_SA_KEY`/`GCS_BUCKET` no vacíos → `::error::` + `exit 1` con mensaje accionable. |
| **`set -euo pipefail`** | En todos los `run` → corta ante el primer error, variables no definidas y fallos en pipes. |
| **Validación de pg_dump** | `command -v pg_dump` + `pg_dump --version` + `pg_restore --version` tras instalar. |
| **Validación del dump** | `test -s` (no vacío) + **`pg_restore --list` (integridad)** antes de subir. |
| **Validación de gcloud** | `command -v gcloud` + `gcloud --version` antes del upload. |
| **Códigos de salida claros** | Cada chequeo usa `::error::` y `exit 1`; mensajes en español accionables. |
| **Cleanup seguro** | `rm -f "${FILENAME:-}"` (no rompe bajo `set -u` si nunca se definió). |

Pasos finales: **10** (antes 7). Triggers intactos (`schedule` diario + `workflow_dispatch`). Notificación de fallo (issue) intacta.

---

## 4. Simulación estática (sin ejecutar)

| Check | Resultado |
|---|---|
| Parseo YAML | ✅ OK (validado con Ruby `YAML.load_file`) |
| Errores de sintaxis YAML | ✅ ninguno |
| Secrets referenciados | ✅ exactamente `SUPABASE_DB_URL`, `GCP_SA_KEY`, `GCS_BUCKET` |
| Vars propias (`FILENAME`/`DATE_PATH`) | ✅ definidas vía `$GITHUB_ENV` en "Generar backup" y consumidas en Upload/Verify/Cleanup |
| Pasos muertos (sin `run`/`uses`) | ✅ **0** |
| `if:` condicionales | ✅ `Cleanup` (`always()`), `Notify` (`failure()`) |

> No se ejecutó el workflow ni se hizo dry-run con credenciales: validación **estática** únicamente.

---

## 5. Causa raíz del fallo (resumen)

El run de A2 falló con **exit 100** en el step **`Install pg_dump v15`**: en `ubuntu-latest` el repo de Ubuntu no
provee `postgresql-client-15` (solo 16), y el workflow no agregaba el repo PGDG. El run moría **antes** de usar los
secrets — por eso, aunque los 3 secrets estuvieran cargados, **igual habría fallado**. Eran **dos bloqueantes
independientes**: (1) install roto [corregido acá], (2) secrets ausentes [pendiente del owner].

---

## 6. Riesgos remanentes

| Riesgo | Detalle | Mitigación |
|---|---|---|
| **Acoplamiento de versión** | Si Supabase actualiza el server más allá de PG15, `pg_dump 15` fallará ("server version newer"). | Verificar versión real del server; si >15, cambiar a `postgresql-client-16/17` en la línea de install. |
| **Cambio no desplegado** | La corrección está en el **working tree local**, NO en GitHub. Actions corre la versión de la rama por defecto en GitHub → **el fix no surte efecto hasta commit+push de `main`**. | Commit + push (autorización del owner; es Fase B / fuera de A2.1). |
| **Secrets ausentes** | El backup seguirá fallando (ahora con mensaje claro en el step de validación) hasta cargar los 3 secrets. | A2 retest tras cargarlos. |
| **Disponibilidad de PGDG** | Depende de `apt.postgresql.org` (estable, pero dependencia externa). | Aceptable; alternativa de contingencia: Opción B/C. |
| **github-script Node20** | Aviso de deprecación (no fatal). | Bump futuro a versión con Node24 cuando aplique. |

---

## 7. Prerrequisitos para volver a ejecutar A2 (retest)

1. **Commit + push** del workflow corregido a `main` (para que GitHub Actions use la versión arreglada). *(Requiere autorización — no incluido en A2.1.)*
2. **Cargar los 3 GitHub Secrets:** `SUPABASE_DB_URL` (PROD, `sslmode=require`), `GCP_SA_KEY` (JSON SA write-only), `GCS_BUCKET` (`tops-nexus-supabase-backups`).
3. (Opcional) confirmar la **versión real** del server Supabase; si es >15, ajustar el `postgresql-client-XX`.
4. **Re-ejecutar** `gh workflow run "Supabase Daily Backup"` → esperar **success** → registrar duración + tamaño real del dump.
5. **Verificar** el objeto en GCS (`gcloud auth login` + `gcloud storage ls`).
6. **Cerrar** el issue `🚨 Backup Supabase falló` cuando haya un run verde.

---

## 8. Veredicto

> ## ✅ READY FOR A2 RETEST — *condicionado a (1) push del workflow y (2) carga de los 3 secrets*

El **bloqueante de código está corregido** (install PGDG + hardening), el workflow **parsea sin errores, sin pasos
muertos, con fail-fast y validaciones**. El backup **no puede tener éxito** hasta que el owner **(a) commitee+pushee**
la corrección y **(b) cargue los 3 secrets** — ambos fuera del alcance de A2.1. Resueltos esos dos puntos, A2 debería
pasar a **GO** y habilitar A3.

---

> **FIN — A2.1.** Solo se editó el archivo del workflow (working tree). No se ejecutó, no se cargaron secrets,
> no se tocó GitHub/GCP/Supabase/Netlify, no hubo commit/push, no se avanzó a A3.
