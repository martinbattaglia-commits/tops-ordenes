# PRE-FLIGHT · BACKUP REPORT

**Fecha:** 2026-05-29
**Pre-condición:** P0.1 — Verificar backup externo Supabase configurado y validado en restore.
**Estado:** 🔴 **FAIL**
**Modo:** verificación · sin modificar nada · evidencia trazable.

---

## 1 · Resultado

| Aspecto | Estado | Evidencia |
|---------|--------|-----------|
| pg_dump scripts en repo | ❌ ausentes | `ls scripts/ \| grep -iE "backup\|dump\|restore"` → 0 matches |
| Env vars de backup en `.env.local` | ❌ ausentes | `grep -iE "S3_BACKUP\|GCS_BACKUP\|BACKUP_BUCKET\|PGDUMP\|WAL_ARCHIVE\|RESTORE_TOKEN"` → 0 matches |
| Servicio de backup externo configurado | ❌ no documentado | sin documentación de S3/GCS/Azure Blob para backups |
| Cron de backup activo | ❌ no documentado | sin scheduled function ni GitHub Actions ni docker-cron documentado |
| Plan de restore validado | ❌ nunca ejecutado | sin reporte de restore test en `docs/` |
| PITR de Supabase Pro (built-in) | ⚠️ asumido | Supabase Pro plan incluye PITR 7 días — **NO sustituye backup externo** |

**Verdict:** ❌ **FAIL — backup externo no existe, no está configurado, no está validado.**

---

## 2 · Evidencia objetiva

### 2.1 Scripts en repo

```bash
$ ls scripts/ | grep -iE "backup|dump|restore"
(0 resultados)
```

Hay 19 scripts en `scripts/` (verificable con `ls scripts/`). Ninguno relacionado con backup/restore.

### 2.2 Env vars

```bash
$ grep -iE "S3_BACKUP|GCS_BACKUP|BACKUP_BUCKET|PGDUMP|WAL_ARCHIVE|RESTORE_TOKEN" .env.local | grep -v "^#"
(0 resultados — vars ausentes)
```

`.env.local` tiene credenciales para Supabase, Netlify, Resend, Clientify, Hikvision, OpenAI, ARCA, WhatsApp. **Cero variables relacionadas con backup externo.**

### 2.3 Memoria persistente del proyecto

`~/.claude/projects/-Users-martinbattaglia-CODE/memory/tops_nexus_state.md`:

> **Datos reales:** clients 2, orders 10, order_services 22, operators 7, services 13, vendors 10, products 20, purchase_orders 1, po_items 1. **(Sin backup externo = RP6.)**

`(Sin backup externo = RP6)` es declaración explícita en la memoria persistente, validada en sesiones anteriores. RP6 es el risk ID heredado de la auditoría que el proyecto ERP V2 mismo identificó como **bloqueante para FASE 4+** (`docs/TOPS-NEXUS-ERP-V2-MASTER-PLAN.md §7.1 RG5`).

### 2.4 PITR de Supabase Pro (clarificación)

Supabase Pro plan incluye **PITR (Point-in-Time Recovery) 7 días** automático. Esto significa:
- ✅ Si hoy borro un cliente por accidente, puedo recuperar el estado de ayer
- ❌ Si Supabase entero sufre un incidente (data center, account compromise, billing issue, etc.), no hay copia externa
- ❌ Si quiero migrar a otro proveedor (Postgres self-hosted, Neon, etc.), no hay dump portátil
- ❌ Para compliance/auditoría AFIP a 10 años, no hay garantía documental

**PITR built-in NO sustituye backup externo.** Es complementario.

---

## 3 · Impacto de mantenerlo así

Riesgos materializables:

| Riesgo | Probabilidad | Severidad si ocurre |
|--------|--------------|---------------------|
| Cuenta Supabase suspendida por billing/dispute | baja | crítica (sin acceso a datos) |
| Bug de Supabase corrompe DB | muy baja | crítica |
| Operador con service_role elimina tabla por error | baja | crítica (PITR sí recupera, pero ventana 7d) |
| Migración 0014 destructiva por bug en idempotencia | media | crítica (pérdida de transactions ARS) |
| Auditoría AFIP requiere datos >7 días sin PITR | alta a mediano plazo | alta (multa) |
| Migración a otro proveedor en futuro | media | alta (re-build manual) |

---

## 4 · Plan de remediación propuesto

### 4.1 Opción A — pg_dump diario → S3 (recomendada)

**Pasos:**
1. Crear bucket S3 dedicado: `tops-nexus-supabase-backups`
2. Crear IAM user con permiso `s3:PutObject` solo a ese bucket
3. Configurar GitHub Action o Netlify Scheduled Function:
   ```
   schedule: 0 5 * * *   (02:00 ART diario)
   tarea:
     pg_dump $SUPABASE_DB_URL --format=custom > backup.dump
     aws s3 cp backup.dump s3://tops-nexus-supabase-backups/$(date +%Y/%m/%d).dump
   ```
4. Lifecycle policy: retener 90 días en S3 Standard + glacier después
5. Validar restore: crear sandbox separado + ejecutar `pg_restore` en él + verificar checksum
6. Documentar runbook restore en `docs/runbooks/RESTORE-FROM-S3.md`

**Costo estimado:** S3 ~$0.50/mes (1GB × $0.023 × 90 días) + IAM gratis + GHA gratis (10k min/mes incluidos en plan free)

**Tiempo de implementación:** 1-2 días

### 4.2 Opción B — wal-g a S3 (PITR externo + dumps)

Similar a A pero usa wal-g para WAL archiving continuo → RPO de minutos en vez de horas.

**Costo:** ~$2/mes
**Tiempo:** 2-3 días

### 4.3 Opción C — Servicio managed (snaplet/replibyte/restic)

Tercero gestiona backups + restore por API.

**Costo:** $20-100/mes según volumen
**Tiempo:** 1 día setup

### 4.4 Opción D — pg_dump local manual semanal (último recurso)

Ruth/JL ejecuta `pg_dump` manual a un disco/Drive personal una vez por semana.

**Pros:** cero costo, cero infra
**Cons:** depende de humano, sin trazabilidad, sin testing

---

## 5 · Recomendación

**Opción A** — pg_dump diario → S3 con GitHub Action.

**Justificación:**
- Mínima complejidad
- Costo despreciable (<$1/mes)
- Sin dependencia de tercero managed
- Restore portátil (cualquier postgres lo lee)
- Cumple compliance AFIP retention 10 años (S3 glacier)
- 1-2 días de trabajo
- Runbook documentado → cualquier dev puede restaurar

**Plan B si Opción A falla:** Opción C con proveedor managed.

---

## 6 · Conclusión

🔴 **P0.1 BACKUP = FAIL.**

**No procede ETAPA 1** (schema + data layer) hasta cerrar este FAIL.

**Acción requerida del usuario:**
1. Aprobar Opción A (u otra)
2. Asignar responsable (DevOps externo o usuario directo)
3. Ejecutar implementación (~1-2 días)
4. Validar primer dump + primer restore en sandbox
5. Documentar y re-generar este reporte como PASS

---

## 7 · Restricciones honradas

- 🛑 NO IMPLEMENTAR backup (solo plan)
- 🛑 NO MODIFICAR infra
- 🛑 NO TOCAR producción
- 🛑 NO INVENTAR — toda evidencia citada de filesystem + memoria persistente verificable
