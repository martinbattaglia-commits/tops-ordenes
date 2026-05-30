# GCS-BACKUP-DRYRUN

**Bloqueante:** P0.1 (Backup externo Supabase) · **Simulación en papel · NADA se ejecuta**
**Fecha:** 2026-05-30
**Naturaleza:** traza punta-a-punta del backup+restore **sin crear recursos, sin conectarse a GCP, sin conectarse a Supabase**. Predice qué pasaría al ejecutar el `BACKUP-EXECUTION-RUNBOOK.md` con el diseño Opción B aprobado.
**Veredicto final:** ver §10.

> 🛑 **Restricciones honradas (Track B · preparación):** NO CREAR PROYECTOS · NO CREAR BUCKETS · NO CREAR SERVICE ACCOUNTS · NO CREAR SECRETS · NO CREAR WORKFLOWS · NO EJECUTAR BACKUPS · NO HACER RESTORE · NO DEPLOY · NO MERGE · NO PUSH · NO COMMIT. Este documento es papel: describe lo que ocurriría, no lo hace.

---

## 0 · Modelo de referencia (de qué dependen las trazas)

Toda traza de abajo se evalúa contra el diseño **ya aprobado por Presidencia (2026-05-29)** y documentado en `BACKUP-IMPLEMENTATION-PLAN.md` + `BACKUP-EXECUTION-RUNBOOK.md`. Parámetros fijados:

| Parámetro | Valor confirmado | Fuente |
|-----------|------------------|--------|
| Estrategia | Opción B — GitHub Actions + `pg_dump` + GCS | Runbook §0 |
| Proyecto GCP | `tops-nexus-ops` (nuevo, aislado) | Runbook §0 |
| Bucket | `tops-nexus-supabase-backups` · `southamerica-east1` · privado | Runbook §0, §3 |
| Service Account | `supabase-backup-uploader@tops-nexus-ops.iam.gserviceaccount.com` | Runbook §0 |
| Rol de la SA | `roles/storage.objectCreator` (write-only, sin read/delete) | Runbook §4 |
| Secrets | `SUPABASE_DB_URL`, `GCP_SA_KEY`, `GCS_BUCKET` | Runbook §5 |
| Workflow | `.github/workflows/supabase-backup.yml` | Runbook §6 |
| Cron | `0 5 * * *` (05:00 UTC = 02:00 ART) + `workflow_dispatch` | Runbook §6 |
| Comando dump | `pg_dump --format=custom --compress=9 --no-owner --no-acl --verbose` | Runbook §6 |
| Cliente pg | `postgresql-client-15` (Supabase = Postgres 15) | Runbook §6 |
| Layout en bucket | `gs://<bucket>/YYYY/MM/DD/backup-<ISO>.dump` | Runbook §6 |
| Restore test | en SANDBOX `vrxosunxlhohmqymxots`, nunca en prod | Runbook §7.3 |
| Lifecycle | Standard→Nearline@90d→Archive@365d→Delete@3650d | Runbook §3.2 |
| Retención objetivo | 10 años (AFIP RG 1415) | Runbook §0 |

**Conteos de referencia de PROD** (memoria persistente, read-only previo): clients ~2, orders ~10, order_services ~22, operators ~7, services ~13, vendors ~10, products ~20, purchase_orders ~1. Sirven como oráculo del smoke-check post-restore.

---

## 1 · Estado de partida verificado (read-only · 2026-05-30)

| Ítem | Estado | Evidencia |
|------|--------|-----------|
| `.github/workflows/` en repo | ❌ no existe | inventario de filesystem (Track B apertura) |
| Workflow `supabase-backup.yml` | ❌ no existe | idem |
| Proyecto GCP `tops-nexus-ops` | ❌ no creado | nada ejecutado |
| Bucket `tops-nexus-supabase-backups` | ❌ no creado | nada ejecutado |
| Service Account uploader | ❌ no creada | nada ejecutado |
| GitHub Secrets (3) | ❌ no configurados | nada ejecutado |
| Diseño Opción B | ✅ aprobado y documentado | `BACKUP-EXECUTION-RUNBOOK.md` §0 |
| Runbook paso-a-paso | ✅ operable sin interpretación | `BACKUP-EXECUTION-RUNBOOK.md` §2–§7 |
| `SUPABASE_DB_URL` de prod | ⚪ existe pero no extraída como secret | obtenible en Supabase Dashboard (P1.5) |

**Lectura:** el diseño está 100% especificado; la infraestructura está 0% creada. La distancia entre hoy y "backup vivo" es **ejecución manual del runbook**, no diseño adicional.

---

## 2 · Pre-condiciones de ejecución (gate humano, fuera de mi alcance)

Estas no las puede cerrar este documento — requieren acción del presidente/Workspace:

| ID | Pre-condición | Quién | Riesgo si falta |
|----|---------------|-------|-----------------|
| P1.2 | GCP **habilitado** en Google Workspace TOPS | admin.google.com | 🔴 bloqueó el intento anterior — verificar PRIMERO |
| P1.3 | Cuenta de **billing GCP** activa | presidente | sin billing, GCS no funciona |
| P1.5 | `SUPABASE_DB_URL` de prod (`sslmode=require`) | presidente | sin esto, `pg_dump` no conecta |
| P1.6 | Acceso admin al repo para Secrets+Actions | presidente | sin esto, no hay workflow |

> ⚠️ **P1.2 es el riesgo histórico real**: el proceso se frenó antes porque Workspace tenía GCP deshabilitado (Runbook §1, BKP.R8). Este es el primer punto a confirmar el día de la ejecución.

---

## 3 · ESCENARIO 1 — Backup exitoso (camino feliz, punta a punta)

**Disparador simulado:** GitHub → Actions → "Supabase Daily Backup" → Run workflow (`workflow_dispatch`), o cron `0 5 * * *`.

**Traza paso a paso (lo que haría cada step del YAML):**

| # | Step | Acción | Resultado esperado |
|---|------|--------|--------------------|
| 1 | Install pg_dump v15 | `apt-get install postgresql-client-15` | `pg_dump (PostgreSQL) 15.x` |
| 2 | Generate backup | `pg_dump "$SUPABASE_DB_URL" --format=custom --compress=9 --no-owner --no-acl --file=backup-<ISO>.dump` | archivo `.dump` ~pocos MB (DB chica); `ls -lh` lo muestra |
| 3 | Auth to GCP | `google-github-actions/auth@v2` con `GCP_SA_KEY` | credencial OK, identidad = SA uploader |
| 4 | Setup Cloud SDK | `setup-gcloud@v2` | `gcloud` disponible |
| 5 | Upload to GCS | `gcloud storage cp backup-<ISO>.dump gs://<bucket>/YYYY/MM/DD/` | objeto creado (SA tiene `objectCreator`) |
| 6 | Verify upload | `gcloud storage ls -l gs://<bucket>/YYYY/MM/DD/backup-<ISO>.dump` | 1 línea con tamaño > 0 |
| 7 | Cleanup local | `rm -f backup-<ISO>.dump` (`if: always()`) | runner limpio |

**Análisis de viabilidad de cada paso:**
- Step 2: `--format=custom` produce dump portátil restaurable con `pg_restore`. `--no-owner --no-acl` evita choques de roles al restaurar en otra DB (sandbox). ✅ coherente con el restore de §6.
- Step 3→5: la SA tiene **solo** `objectCreator`. `cp` (crear objeto) está permitido; un `ls`/`rm` sobre el bucket NO lo estaría — pero el workflow nunca borra del bucket, solo sube. El `ls` del Step 6 corre con la misma SA: **objectCreator NO incluye `storage.objects.list`**. ⚠️ ver §9 (Hallazgo H1).
- Step 7: borra el `.dump` local del runner efímero. La key de SA vive solo como secret, nunca en disco. ✅

**Resultado simulado:** 🟢 backup subido a `gs://tops-nexus-supabase-backups/2026/05/30/backup-2026-05-30T0500..Z.dump` — **con la salvedad H1 sobre el Step 6** (la verificación `ls` podría fallar por permisos aunque el `cp` haya sido exitoso).

---

## 4 · ESCENARIO 2 — Fallo de autenticación GCP

**Disparador simulado:** `GCP_SA_KEY` ausente, mal pegado (JSON truncado/roto), key revocada, o billing deshabilitado.

**Dónde rompe:** Step 3 "Auth to Google Cloud".

**Traza:**
- `google-github-actions/auth@v2` falla al parsear/validar `credentials_json` → step sale con exit ≠ 0.
- Steps 4–6 **no corren** (job aborta en el primer fallo).
- Step 7 (`if: always()`) **sí corre** → borra cualquier `.dump` parcial. ✅ no deja basura.
- Step "Notify on failure" (`if: failure()`) corre → **abre un GitHub issue** `🚨 Backup falló · <fecha>` con labels `ops,backup,urgent`.

**Datos:** el `.dump` ya se generó en Step 2 (la DB se leyó), pero **nunca salió del runner** y se borró en Step 7. No hay objeto en el bucket. No hay fuga: la key no toca disco, el dump no toca el bucket.

**Resultado simulado:** 🟡 backup del día **no producido**, pero **falla ruidosa y visible** (issue automático). RPO se degrada al último backup exitoso previo. Sin corrupción, sin fuga. Acción correctiva: re-pegar `GCP_SA_KEY` o reactivar billing → re-run.

---

## 5 · ESCENARIO 3 — Fallo de pg_dump

**Disparador simulado:** `SUPABASE_DB_URL` mal formada / sin `sslmode=require`, DB inaccesible (red/pooler), credencial Postgres rotada, o **mismatch de versión** (cliente ≠ Postgres 15 → "server version mismatch", BKP.R2).

**Dónde rompe:** Step 2 "Generate backup".

**Traza:**
- `pg_dump` sale con exit ≠ 0; el `--file` queda inexistente o truncado.
- Steps 3–6 **no corren**.
- Step 7 (`if: always()`) borra el truncado si existe. ✅
- Step "Notify on failure" → **issue automático**.

**Sub-caso crítico (dump truncado que "parece" exitoso):** si `pg_dump` muriera a mitad pero devolviera exit 0 (improbable con `--format=custom`, que escribe header/footer), el archivo subiría corrupto. **Mitigación de diseño:** el formato custom valida integridad y el restore-test de §6 (`pg_restore --list`) lo detectaría. Por eso **un backup sin restore-test no cuenta** (BKP.R7).

**Resultado simulado:** 🟡 backup del día no producido; falla visible vía issue. Sin objeto en bucket → no contamina la cadena de backups buenos. Acción correctiva: corregir `SUPABASE_DB_URL` o fijar `postgresql-client-15`.

---

## 6 · ESCENARIO 4 — Restore completo en SANDBOX (la prueba que cierra P0.1)

**Premisa:** existe al menos 1 `.dump` válido en el bucket (Escenario 1). Restauramos en **sandbox `vrxosunxlhohmqymxots`**, NUNCA en prod (Runbook §7.3).

**Traza paso a paso:**

| # | Comando | Resultado esperado |
|---|---------|--------------------|
| 1 | `gcloud storage cp gs://<bucket>/YYYY/MM/DD/backup-<ISO>.dump /tmp/backup.dump` | descarga OK (requiere identidad con **read**, ver H2) |
| 2 | `pg_restore --list /tmp/backup.dump \| head -30` | TOC legible → dump íntegro y restaurable |
| 3 | `pg_restore --dbname="$SANDBOX_DB_URL" --no-owner --no-acl /tmp/backup.dump` | tablas/datos recreados en sandbox |
| 4 | smoke SQL: `SELECT count(*) FROM clients/orders/operators` | ~2 / ~10 / ~7 (coherente con prod) |
| 5 | `rm -f /tmp/backup.dump` | limpieza |

**Análisis:**
- Step 1 necesita **read** sobre el bucket. La SA del workflow es write-only (`objectCreator`) → **no sirve para descargar**. El restore-test lo corre un humano con su **propia identidad GCP** (presidente/operador con acceso al proyecto), no la SA. ✅ esto es correcto y deseado (separación de privilegios), pero debe quedar explícito → ver §9 (H2).
- Step 2 (`pg_restore --list`) es el validador de integridad real: si el dump está corrupto, falla acá **antes** de tocar el sandbox.
- Step 3 con `--no-owner --no-acl` evita choques de roles (el dump no trae owners → se restaura bajo el rol del que ejecuta). ✅ por eso Step 2 del backup usa los mismos flags.
- Step 4 compara contra el oráculo de prod. Conteos coherentes ⇒ backup **restaurable y válido** ⇒ convierte `PRE-FLIGHT-BACKUP-REPORT` de 🔴 FAIL a 🟢 PASS.

**Resultado simulado:** 🟢 restore íntegro, datos coherentes, P0.1 cerrable — **siempre que el operador use una identidad con read (no la SA write-only)**.

---

## 7 · ESCENARIO 5 — Restore fallido

**Disparador simulado:** dump corrupto/truncado, `SANDBOX_DB_URL` incorrecta, sandbox con schema incompatible, o cliente `pg_restore` ≠ v15.

**Traza según punto de fallo:**

| Falla en | Síntoma | Daño |
|----------|---------|------|
| Step 1 (download) | `cp` 403/404 — identidad sin read, u objeto inexistente | ninguno (no se tocó la DB) |
| Step 2 (`--list`) | error de parseo del TOC | ninguno — **se detecta el dump malo ANTES de restaurar** |
| Step 3 (`pg_restore`) | errores de objetos; restore parcial | **solo en SANDBOX**, prod intacta |
| Step 4 (smoke) | conteos ≠ esperado | señal de restore incompleto |

**Garantía de diseño clave:** el restore-test corre **exclusivamente en sandbox** (Runbook §7.3 "Nunca restaurar sobre producción"). Un restore fallido **jamás** daña producción. El peor caso es un sandbox sucio → se re-crea o se descarta.

**Resultado simulado:** 🟡 restore-test falla → **NO se cierra P0.1** (correcto: un backup no restaurable no es backup). Producción nunca en riesgo. Acción: regenerar dump / corregir versión cliente / re-probar.

---

## 8 · Tabla consolidada de escenarios

| # | Escenario | Rompe en | Prod en riesgo | Falla visible | Veredicto |
|---|-----------|----------|----------------|---------------|-----------|
| 1 | Backup exitoso | — | no | n/a | 🟢 (salvo H1 en verify) |
| 2 | Fallo auth GCP | Step 3 auth | no | issue auto | 🟡 recuperable |
| 3 | Fallo pg_dump | Step 2 dump | no | issue auto | 🟡 recuperable |
| 4 | Restore en sandbox | — | no | n/a | 🟢 cierra P0.1 |
| 5 | Restore fallido | download/list/restore | **no (solo sandbox)** | error local | 🟡 no cierra P0.1 |

**Patrón:** en los 5 escenarios, **producción nunca corre riesgo** (el flujo es read-only sobre prod: `pg_dump` lee, nunca escribe; el restore va a sandbox). Todas las fallas son ruidosas (issue automático o error en consola) y recuperables.

---

## 9 · Hallazgos (cosas a confirmar el día de la ejecución)

Ninguno bloquea el diseño; son precisiones operativas:

- **H1 · Verify upload (Step 6) vs SA write-only.** La SA tiene `roles/storage.objectCreator`, que **no incluye `storage.objects.list`**. El `gcloud storage ls` del Step 6 corre con esa misma SA y **puede devolver 403**, aunque el `cp` del Step 5 haya subido bien. → **Opciones:** (a) cambiar Step 6 por una verificación que no liste (p.ej. confiar en el exit-0 del `cp`, que ya falla si no sube); (b) otorgar a la SA `roles/storage.objectViewer` además de creator (rompe el principio write-only); o (c) reemplazar el `ls` por `gcloud storage objects describe` (requiere `get`, tampoco en creator). **Recomendado: (a)** — quitar el Step 6 o degradarlo a no-bloqueante, porque `gcloud storage cp` ya retorna error si la subida falla. Decisión a tomar en la ejecución; no afecta la validez del backup.
- **H2 · Restore-test usa identidad humana, no la SA.** El download del restore (§6 Step 1) necesita **read**; la SA es write-only por diseño. El operador que corre el restore-test debe autenticarse con su **propia cuenta GCP** con acceso al proyecto `tops-nexus-ops`. Esto es correcto (la SA de CI no debe poder leer/exfiltrar backups), pero conviene anotarlo en el runbook de restore para que nadie intente usar `GCP_SA_KEY` para descargar.
- **H3 · P1.2 (GCP habilitado en Workspace) es el riesgo histórico.** Verificar en `admin.google.com` **antes** de empezar (frenó el intento anterior, BKP.R8).
- **H4 · `pg_dump`/`pg_restore` deben ser v15.** Mismatch de versión = falla (BKP.R2). El YAML ya fija `postgresql-client-15`; el restore-test manual debe usar la misma versión.

---

## 10 · VEREDICTO

# 🟢 LISTO PARA IMPLEMENTAR BACKUP

**Evidencia que sostiene el 🟢:**
1. **Diseño completo y aprobado** — Opción B fijada por Presidencia (2026-05-29), con todos los parámetros cerrados (proyecto, bucket, región, SA, rol, secrets, cron, flags de dump). Cero decisiones de diseño pendientes.
2. **Runbook operable sin interpretación** — `BACKUP-EXECUTION-RUNBOOK.md` §2–§7 da los comandos exactos, valores confirmados y verificaciones de cada paso.
3. **Las 5 trazas cierran coherentes** — camino feliz produce un dump portátil; los 3 modos de falla son ruidosos (issue automático), recuperables y **dejan producción intacta**; el restore-test valida integridad real en sandbox antes de cerrar P0.1.
4. **Seguridad correcta** — bucket privado + `public-access-prevention`, proyecto aislado, SA write-only, key como secret nunca en disco, restore solo en sandbox.
5. **Compliance** — lifecycle 10 años (AFIP RG 1415) ya definida.

**Condiciones de ejecución (no son bloqueos de diseño, son gates humanos):**
- ✅ Resolver pre-condiciones P1.2 (GCP habilitado), P1.3 (billing), P1.5 (`SUPABASE_DB_URL`), P1.6 (acceso repo) — §2.
- ✅ Aplicar decisión sobre **H1** (Step 6 verify) al momento de crear el workflow.
- ✅ Correr **H2** (restore-test con identidad humana, no la SA).
- ✅ El cierre de P0.1 lo da el **restore-test exitoso** (§6), no el primer backup.

**Lo que este 🟢 NO afirma:** que la infraestructura exista (no existe — §1). Afirma que **el diseño es ejecutable tal como está escrito** y que ejecutar el runbook producirá un backup restaurable. La siguiente conversación de Track B puede ser exclusivamente: *"ejecutar o no ejecutar el runbook"*.

---

## 11 · Restricciones honradas

- 🛑 NO se creó proyecto / bucket / service account / secret / workflow.
- 🛑 NO se ejecutó backup ni restore. NO se conectó a GCP ni a Supabase.
- 🛑 NO DEPLOY · NO MERGE · NO PUSH · NO COMMIT.
- 🛑 NO se inventaron cifras: todo trazado a `BACKUP-EXECUTION-RUNBOOK.md`, `BACKUP-IMPLEMENTATION-PLAN.md` y `PRE-FLIGHT-BACKUP-REPORT.md`.
