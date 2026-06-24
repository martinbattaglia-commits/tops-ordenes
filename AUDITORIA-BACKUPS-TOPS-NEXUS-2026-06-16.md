# AUDITORÍA DE BACKUPS — TOPS NEXUS

**Fecha de auditoría:** 2026-06-16 (UTC temprano)
**Alcance:** Estrictamente lectura. No se modificó, commiteó, pusheó ni borró nada. Solo verificación y evidencia.
**Sistemas auditados:** GitHub · GitHub Actions · Netlify · Supabase · Google Drive
**Método:** Repo local (`/CODE/tops-ordenes`, git) + GitHub Actions (Chrome) + Netlify API (MCP) + Supabase Dashboard (Chrome) + Google Drive API (MCP).

---

## RESUMEN EJECUTIVO

**Estado General: 🟡 ATENCIÓN** (base sólida con redundancia real, pero con brechas concretas a cerrar)

TOPS NEXUS **sí está respaldado y los backups de base de datos se ejecutan a diario**, con **dos mecanismos independientes y verificados**:

1. **Supabase nativo** — backups físicos diarios automáticos, retención 7 días (último: **15-jun 09:15 UTC**).
2. **Dump lógico externo → Google Drive** — `pg_dump` diario vía GitHub Actions, con verificación de integridad, subido a la carpeta "TOPS Nexus Backups" (último: **15-jun 10:51 UTC**).

El código está **100% sincronizado** entre repositorio local, GitHub (`main`) y Netlify productivo (`nexus.logisticatops.com`): no hay divergencia.

**Lo que requiere atención (🟡):**

- **Sin Point-in-Time Recovery (PITR)** en Supabase → ante un incidente, la pérdida máxima de datos puede llegar a ~24 h (RPO diario) sobre información fiscal/tesorería.
- **Workflow "Contratos · Drive Sync" FALLANDO** — su primera corrida programada (16-jun 00:00 UTC) terminó en error. Es una ingesta de cartera, no un backup, pero es un proceso automático roto.
- **Objetos de Supabase Storage NO incluidos** en los backups de DB (cobertura a confirmar).
- **Copia externa con punto único de falla** (una sola Service Account + una sola carpeta de Drive, sin política de retención automatizada garantizada para los 10 años AFIP).
- Trabajo local no respaldado (ramas sin push + 3 stashes) — riesgo bajo.

**Acción inmediata recomendada:** arreglar/re-lanzar el sync de contratos y confirmar que la corrida de backup de hoy (16-jun) impacte; en paralelo, evaluar habilitar PITR.

---

## GITHUB

**Estado: 🟢 CORRECTO**

| Ítem | Evidencia |
|------|-----------|
| Repositorio | `github.com/martinbattaglia-commits/tops-ordenes` |
| Rama productiva | `main` — sincronizada con `origin/main` (**0 adelante / 0 atrás**), árbol de trabajo limpio |
| Último commit en `main` | `3b966f8` "feat(nav): agregar Conciliación al sidebar de Tesorería" — 2026-06-14 01:02 ART |
| Frescura de refs remotas | `fetch` 2026-06-16 02:45 UTC |
| Actividad reciente (30 d) | Alta: picos de 39–40 commits/día (29–30 may, 06–07 jun); cadencia normal de trabajo con huecos esperables de fin de semana. Sin commits aún el 15 y 16-jun. |
| Tags de seguridad | `safety/*`, `canonical/*`, `arca/*`, `erp/*` (snapshots locales antes de operaciones riesgosas — buena práctica) |

**Hallazgos:**

- `main` está completamente pusheado: no hay pérdida de la rama productiva ante una falla del disco local. **Respaldo de la línea principal: OK.**
- **Trabajo local no respaldado en GitHub (riesgo bajo):**
  - 1 rama por delante del remoto: `claude/sad-pascal-38a567` (**+1 commit** no presente en `origin/main`).
  - Varias ramas **solo locales** (sin upstream): `feat/demo-meli`, `feat/storage-privacy`, `fix/netlify-heap`, `fix/netlify-node22`, `feature/dashboard-vacancia-corporativo`, `feature/mapa-premium-lujan-3159`, `feature/mapa-premium-magaldi-1765`, `integration/main-canonical`, entre otras.
  - **3 stashes locales** (`feat/demo-meli`, `claude/silly-franklin-68d835`, `main`) — por definición nunca se pushean.
- ~50 ramas locales en total; la mayoría obsoletas (detrás de `main`). No es riesgo de pérdida, pero conviene higiene de ramas.
- **El repositorio es PÚBLICO** (`public_repo: true` en metadatos de Netlify). El secret-scan de Netlify dio limpio (0 hallazgos en 1145 archivos), pero el código de un ERP con lógica fiscal queda expuesto.

**Riesgo:** 🟢 Bajo (línea principal respaldada). Residual bajo por trabajo local sin push y por repo público.

---

## BACKUPS AUTOMÁTICOS (GitHub Actions)

**Estado: 🟡 ATENCIÓN** (el backup de DB funciona; el sync de contratos falla)

Dos workflows activos en `.github/workflows/`:

### 1. `supabase-backup.yml` — "Supabase Daily Backup" 🟢

- **Programación:** `cron: 0 5 * * *` (02:00 ART nominal) + disparo manual.
- **Qué hace:** `pg_dump` de la DB de **producción** (formato custom, compress 9) → **verifica integridad** con `pg_restore --list` → sube a Google Drive ("TOPS Nexus Backups") → **verifica** el archivo subido (tamaño > 0 y carpeta correcta). **Abre un issue automático** (`ops/backup/urgent`) si falla.
- **Historial (GitHub Actions):** 22 corridas. Las corridas **programadas recientes #15–#22 salieron todas "completed successfully"**. Las #1–#10 (manuales) fueron del setup y la migración GCS→Drive. **Operativamente estable desde ~07-jun.**
- **Última corrida exitosa:** #22 (programada) — backup del 15-jun.
- **Observación:** las corridas aterrizan ~08:00–10:51 UTC, **no** a las 05:00 UTC nominales → latencia/variabilidad del scheduler de GitHub. No compromete el backup (completa igual a diario), pero la etiqueta "02:00 ART" no refleja la hora real.

### 2. `contratos-drive-sync.yml` — "Contratos · Drive Sync" 🔴

- **Programación:** `cron: 0 0 * * *` (21:00 ART). Dispara un POST a `/api/comercial/contratos/sync` (ingesta de la cartera contractual desde Drive hacia Nexus).
- **Historial:** **1 sola corrida — FALLÓ.** Run #1 (programada, **14-jun 23:59 ART ≈ 15-jun 03:00 UTC**; el scheduler de GitHub la disparó con ~3 h de retraso sobre el horario nominal de 21:00 ART): *Status Failure*, "Process completed with exit code 1" (el endpoint no devolvió HTTP 200). La siguiente corrida (noche 15→16-jun) aún no figura registrada a la hora de esta auditoría.
- **Naturaleza:** es una **ingesta de datos**, no un backup de código ni de DB. Su falla no compromete la integridad de los backups, pero **es un proceso automático roto** en su primera ejecución real.

**Riesgo:** 🟡 Medio. Backup de DB: sólido y con auto-alerta. Sync de contratos: roto → la cartera contractual no se está actualizando automáticamente.

---

## NETLIFY

**Estado: 🟢 CORRECTO**

| Ítem | Evidencia |
|------|-----------|
| Proyecto | `tops-ordenes` (site `d84a7d34-b90c-4e61-aff6-678abf1ac432`), plan `nf_team_dev` |
| URL productiva | `https://nexus.logisticatops.com` (dominio propio) |
| Deploy actual | `6a2e280c…` — estado **`ready`**, rama **`main`**, commit **`3b966f8`** |
| Publicado | 2026-06-14 04:05 UTC · build 123 s · sin `error_message` |
| Modo | Auto-deploy desde GitHub (`manual_deploy: false`) |
| Seguridad | Secret-scan: 1145 archivos escaneados, **0 secretos detectados** |

**Hallazgos:** El deploy productivo corre exactamente el HEAD de `main` (`3b966f8`) = `origin/main` = repo local. **Cero divergencia GitHub ↔ Netlify.** No hay commits de `main` pendientes de desplegar (no hubo commits a `main` el 15/16-jun). Último deploy alineado con el último commit (14-jun).

**Riesgo:** 🟢 Bajo. (Netlify no es un backup en sí, pero su estado y sincronía descartan divergencia productiva.)

---

## SUPABASE

**Estado: 🟡 ATENCIÓN** (backups nativos OK; sin PITR; Storage sin cobertura)

Proyecto **`arsksytgdnzukbmfgkju`** = **`tops-ordenes-prod`** (PRODUCTION), organización en plan **Pro**.

| Capa | Estado | Evidencia |
|------|--------|-----------|
| **Backups físicos programados (nativos)** | 🟢 **HABILITADO** | Diarios, retención **7 días**. Visibles: 09, 10, 11, 12, 13, 14 y **15-jun (09:15 UTC)**, tipo PHYSICAL, todos con botón *Restore*. |
| **Point-in-Time Recovery (PITR)** | 🔴 **NO habilitado** | Pestaña PITR: *"Point in Time Recovery is a Pro Plan add-on"* (botón *Enable add-on*). |
| **Objetos de Storage** | ⚠️ **NO incluidos** | Aviso del panel: *"Database backups do not include objects stored via the Storage API… Restoring an old backup does not restore objects that have been deleted since then."* |

**Hallazgos:**

- La DB productiva tiene **doble cobertura diaria**: backup físico nativo (7 días) + dump lógico externo a Drive. Es una posición robusta.
- **Sin PITR**, el mejor punto de recuperación es el último backup diario → **RPO de hasta ~24 h** ante un incidente. Para datos de tesorería/fiscales, PITR reduciría ese RPO a minutos.
- **Storage (archivos subidos vía Storage API) no está cubierto** por estos backups ni por el `pg_dump`. *Nota:* la documentación contractual parece vivir en Google Drive (la sync de contratos toma Drive como fuente de verdad), por lo que el impacto real depende de cuánto se use Storage. **Alcance exacto de Storage: NO VERIFICABLE** en esta auditoría.

**Riesgo:** 🟡 Medio-Alto por ausencia de PITR sobre datos críticos; 🟡 Medio por Storage sin backup confirmado.

---

## GOOGLE DRIVE

**Estado: 🟢 CORRECTO** (copia externa real y diaria) — con dependencia de punto único

| Ítem | Evidencia |
|------|-----------|
| Carpeta de backups | "TOPS Nexus Backups" (`1Erng2SywVN9ymHqUzkT0iMRrKSmrHWBw`), dueño **martin.battaglia@logisticatops.com** |
| Mecanismo | Service Account `tops-ordenes-drive@…` con domain-wide delegation (impersona al usuario para usar su cuota) |
| Dumps diarios | 04-jun (697 KB, inicial) · 07-jun (910 KB) · 08-jun (986 KB) · 09-jun · 10-jun · 11-jun (×2) · 12-jun · 13-jun (1.16 MB) · 14-jun (1.25 MB) · **15-jun (1.25 MB)** |
| Último backup | `backup-2026-06-15T104804Z.dump` — 1.25 MB — creado 2026-06-15 10:51 UTC |
| Continuidad | Cadena diaria continua **07→15-jun**. Hueco **05 y 06-jun** (ventana de setup/migración GCS→Drive, antes de estabilizar el workflow el 07-jun). |
| Retención | Se conservan **todos** los dumps (sin pruning) — coherente con AFIP RG 1415 (10 años), pero **sin lifecycle automatizado** que lo garantice. |

**Hallazgos:**

- **Confirmado que los backups realmente aterrizan**: el tamaño crece de forma consistente (697 KB → 1.25 MB), señal de datos reales, no archivos vacíos. El workflow además valida integridad antes de subir.
- 16-jun **aún sin dump** — esperado: la corrida programada de hoy todavía no se ejecutó a esta hora UTC temprana.
- **Punto único de falla:** una sola Service Account + una sola carpeta en un único Drive personal. Si se borra la carpeta, se revoca la SA o se desactiva la delegación, se pierde la única copia off-platform. No hay segunda copia ni Shared Drive.
- `infra/gcs/lifecycle.json` es **legado** (Google Cloud Storage, reemplazado por Drive el 04-jun).

**Riesgo:** 🟡 Medio por dependencia de punto único y falta de lifecycle garantizado para la retención de 10 años.

---

## MATRIZ DE RIESGOS

| # | Riesgo | Severidad | Impacto | Acción recomendada |
|---|--------|-----------|---------|--------------------|
| 1 | **Sin PITR en Supabase** | 🟠 Media-Alta | Pérdida de hasta ~24 h de datos (fiscal/tesorería) ante incidente | Evaluar y habilitar el add-on PITR (Pro) |
| 2 | **Workflow "Contratos · Drive Sync" fallando** | 🟠 Media | Cartera contractual no se actualiza automáticamente | Revisar `CRON_SECRET`/`APP_URL` y el endpoint `/api/comercial/contratos/sync`; re-lanzar |
| 3 | **Objetos de Supabase Storage sin backup verificado** | 🟠 Media | Archivos en Storage podrían no tener respaldo | Confirmar uso de Storage; definir backup si hay buckets críticos |
| 4 | **Copia externa con punto único de falla** (1 SA + 1 carpeta, sin lifecycle) | 🟠 Media | Pérdida de la única copia off-platform; retención 10 años no garantizada | 2ª copia / Shared Drive + verificación de retención AFIP |
| 5 | **Trabajo local sin push** (ramas + 3 stashes) | 🟡 Baja | Pérdida de trabajo experimental ante falla del disco | Pushear lo valioso o descartar; limpiar stashes |
| 6 | **Variabilidad horaria de las corridas de backup** | 🟡 Baja | Backup tardío (no a las 02:00 ART) | Monitorear; ajustar expectativa o cron |
| 7 | **Repositorio público** | 🟡 Baja-Media | Exposición del código del ERP | Evaluar pasar el repo a privado |

---

## VEREDICTO FINAL

**1. ¿TOPS NEXUS está respaldado correctamente?**
**Sí.** La base de datos productiva tiene **doble respaldo diario verificado** (Supabase nativo, retención 7 días + dump lógico externo a Google Drive). El código de la línea principal está íntegramente en GitHub y desplegado en Netlify, sin divergencia. La postura es sólida, con brechas acotadas.

**2. ¿Existe riesgo de pérdida de información?**
**Acotado, pero existe.** Sin PITR, el peor caso es ~24 h de datos. Quedan fuera de cobertura verificada: los objetos de Supabase Storage, y el trabajo local sin pushear. La copia externa depende de un único punto (SA + carpeta de Drive).

**3. ¿Los backups se ejecutan diariamente?**
**Sí**, mediante dos mecanismos independientes:
- Supabase nativo: visible 09→15-jun (último 15-jun 09:15 UTC).
- Dump → Drive: continuo 07→15-jun (último 15-jun 10:51 UTC).
La corrida de hoy (16-jun) está **pendiente** (aún no llegó su horario programado).

**4. ¿Cuál es el punto más débil del esquema actual?**
Dos, en este orden: **(a) la ausencia de PITR** (RPO de ~24 h sobre datos fiscales/tesorería) y **(b) los objetos de Supabase Storage sin backup confirmado**. Secundariamente, el **sync de contratos roto** y la **copia externa con punto único de falla**.

**5. ¿Qué acción debería realizarse inmediatamente?**
- **Hoy:** arreglar/re-lanzar **"Contratos · Drive Sync"** (falla activa) y **confirmar que el backup de hoy (16-jun)** impacte en Supabase y en Drive.
- **Esta semana:** evaluar habilitar **PITR**; confirmar el alcance de **Storage** y, si aplica, definir su backup; agregar una **segunda copia externa** (Shared Drive) y verificar la retención de 10 años.

---

### Notas de método y limitaciones

- Auditoría **read-only**: no se ejecutaron acciones de escritura, commits, push, borrados ni cambios de configuración.
- Fechas de backups de Drive tomadas de `createdTime` (Drive API) — hora autoritativa de aterrizaje del archivo.
- Estado de corridas de GitHub Actions tomado de las etiquetas de accesibilidad de cada run (éxito/fallo) y de la página de cada corrida.
- **NO VERIFICABLE** en esta pasada: el código HTTP exacto de la falla del sync de contratos (requiere expandir logs); el volumen real de objetos en Supabase Storage; la garantía técnica de retención a 10 años en Drive.
