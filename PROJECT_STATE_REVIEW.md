# PROJECT_STATE_REVIEW — Auditoría de contexto · CRM Comercial F2.1

**Proyecto:** TOPS Nexus — Logística TOPS (Verotin S.A.)
**Repo:** `/Users/martinbattaglia/CODE/tops-ordenes`
**Rama activa:** `feature/crm-comercial-f2-1` @ `a76fff7`
**Fecha de la auditoría:** 2026-06-06
**Naturaleza:** solo auditoría y confirmación de contexto. **Sin código. Sin ramas nuevas. Sin migraciones. Sin tocar nada.**

> Este documento verifica el estado **real del repositorio** contra los tres documentos de handoff (`CRM_COMMERCIAL_HANDOFF.md`, `TOPS_NEXUS_EXECUTIVE_ROADMAP_2026.md`, `TOPS_NEXUS_EXECUTIVE_SUMMARY_ONE_PAGE.md`). Confirma lo que coincide y **señala dos discrepancias** que los documentos no mencionan.

---

## 0. Método de verificación

Se contrastó la documentación contra el repo con comprobaciones de solo lectura:

- `git branch -a -v`, `git log` de la rama activa y de `main` (local y `origin`).
- Inventario de migraciones en `supabase/migrations/`.
- Presencia de los archivos fuente CRM y de las rutas `/comercial/*`.
- Apuntado del entorno (`.env.local`) — solo presencia de claves, **sin exponer secretos**.
- Estado del árbol de trabajo (`git status`).

---

## 1. Qué está TERMINADO (verificado en el repo)

| Frente | Evidencia en repo | Estado |
|---|---|---|
| **Digital Twin Luján 3159** | rama `feature/mapa-premium-lujan-3159` @ `c1e4fb4`; ruta `/comercial/mapa-lujan` | ✅ en rama |
| **Digital Twin Magaldi 1765** | rama `feature/mapa-premium-magaldi-1765` @ `8f35e6a`; ruta `/comercial/mapa-magaldi` | ✅ en rama |
| **Motor Corporativo de Capacidad** | `src/lib/wms/corporate-capacity.ts` presente; integración en `feature/dashboard-vacancia-corporativo` @ `1f7d255` | ✅ en rama |
| **Dashboard de Vacancia** | ruta `/comercial/dashboard-vacancia` presente | ✅ en rama |
| **Dominio CRM (10 tablas, enums, RLS, ledgers)** | migraciones `0041`–`0046` presentes en `supabase/migrations/` | ✅ en archivos |
| **Hook de capacidad `committed_m2`** | `src/lib/comercial/committed-capacity.ts` presente (F2.1-4, `c91b4d0`) | ✅ activado |
| **Ficha 360° + persistencia** | rutas `/comercial/oportunidades` y `/comercial/oportunidades/[id]`; `opportunities-supabase.ts` + `opportunities-mapper.ts` presentes (F2.1-6/7) | ✅ en rama |
| **Capture Bridge (UX-1)** | `capture-bridge.ts` + `capture-actions.ts` presentes (`a76fff7`) | ✅ en rama |

**Cadena de commits CRM confirmada** (rama `feature/crm-comercial-f2-1`, de más reciente a más antiguo): `a76fff7` → `e84effa` → `25b07fc` → `c91b4d0` → `eddbc6d` → `b7fb1aa` → `7e54291` → `817e264` → `070006b` → `236559f` → `acbcc62` → `384d885`. **Coincide exactamente con el handoff.**

---

## 2. Qué está VALIDADO

| Validación | Fuente | Estado |
|---|---|---|
| **Staging CRM — 46/46 tests PASS** | commit `eddbc6d`; script `supabase/tests/CRM_STAGING_VALIDATION.sql` (referenciado) | ✅ GO documentado |
| **R-G1** (contratos `ON DELETE RESTRICT`) | gate `7e54291`, migración `0044` | ✅ resuelto |
| **R-G2** (`has_permission()` bajo rol) | verificado en staging (`eddbc6d`) | ✅ resuelto |
| **R-G3** (`profiles_public` sin email) | migración `0046` | ✅ resuelto |
| **E2E Ficha 360° en staging** | oportunidad sembrada → leída → mapeada (handoff §8) | ✅ PASS |
| **Capture Bridge anmat** | Playwright real → `__nexusCapture()` → persistencia tx+rollback (handoff §9) | ✅ PASS |

> **Importante:** la validación fue contra **STAGING** (`vrxosunxlhohmqymxots`), **nunca contra PROD**. Confirmado por el guard del entorno (ver §4).

---

## 3. Qué está PENDIENTE

| # | Pendiente | Tipo |
|---|---|---|
| P-1 | **Write-path** — server actions de transición de etapa (`advanceStage`), escritura de `crm_stage_history`, gestión de `committed_state` (reservado→comprometido→ocupado), disparo de onboarding al ganar | Construcción (próximo frente recomendado) |
| P-2 | **Conectar "siguiente acción"** de la Ficha 360° a las server actions (hoy solo cambia de tab) | Construcción |
| P-3 | **F2.1-5 — Webhook Clientify HMAC** + ingreso de leads + promoción lead→oportunidad | Construcción |
| P-4 | **Exponer `window.__nexusCapture`** en los bundles del cotizador y propuesta-general (1 línea, con Comercial) | Coordinación + construcción |
| P-5 | **Owner resolution** — `owner_id`/`changed_by` (uuid→nombre) vía `profiles_public` | Construcción menor |
| P-6 | **Camino a producción** — aplicar `0041`–`0046` a PROD + estrategia de merge a `main` + deploy Netlify + smoke tests | Decisión de Dirección + ejecución |
| P-7 | **Reconciliación seed Digital Twin** (`warehouse_*` D/S provisionales → PB reales auditados) | Construcción |

---

## 4. RIESGOS ABIERTOS

### 4.1 Riesgos ya documentados (confirmados en el repo)

| # | Riesgo | Verificación | Sev. |
|---|---|---|---|
| RA-1 | **App runtime apunta a PROD (sin tablas `crm_*`)** → reads caen a fallback local, writes fallan suave. Persistencia real solo probada en staging. | **Confirmado:** `.env.local` tiene `NEXT_PUBLIC_SUPABASE_URL` → `arsksytgdnzukbmfgkju` (PROD) y `STAGING_DB_URL` → `vrxosunxlhohmqymxots` (staging). | 🔴 Alta |
| RA-2 | **5 ramas de feature aisladas sin merge**; estrategia de integración a `main` indefinida | **Confirmado:** todas las ramas existen y divergen de `main`. | 🟠 Media |
| RA-3 | Cotizador/propuesta-general bundleados no capturan hasta exponer el hook | Documentado; bridge ya persistiría. | 🟠 Media |
| RA-4 | Seed `warehouse_*` con códigos D/S provisionales ≠ realidad PB auditada | Documentado, no ejecutado. | 🟠 Media |
| RA-5 | Resolución `owner_id`/`changed_by` vía `profiles_public` | Menor. | 🟡 Baja |
| RA-6 | Nada desplegado (Netlify); stack no probado en deploy | Confirmado. | 🟠 Media |

### 4.2 Hallazgos NUEVOS de esta auditoría (no estaban en el handoff)

> Estos dos puntos no contradicen el trabajo hecho, pero **afectan directamente la estrategia de salida a producción (P-6 / RA-2)** y conviene resolverlos antes de cualquier merge.

**🔶 HALLAZGO A — `main` local desincronizado de `origin/main`.**
- `main` **local** está en `c3fb359` (como dicen los docs), pero **`origin/main` está en `7d74aa3`** — más adelantado.
- `origin/main` incorpora commits de **seguridad e infraestructura** posteriores: `2b57d00` (Gate 5.5 — admin guards en settings + role label autoritativo), `d906a7b` (runbook de ejecución 0040 + smoke test), `7d74aa3` (fix del workflow de backup Supabase + reportes A2/A2.1).
- **Implicancia:** "`main` intacto en `c3fb359`" es cierto **solo en local**. El verdadero punto de integración (`origin/main`) ya se movió. La estrategia de merge de las 5 ramas debe partir de `7d74aa3`, no de `c3fb359`. **Riesgo de divergencia / merge sorpresa si se planifica sobre el hash viejo.**

**🔶 HALLAZGO B — migración `0040_profiles_pii_lockdown.sql` sin commitear.**
- El archivo `supabase/migrations/0040_profiles_pii_lockdown.sql` existe en el árbol de trabajo pero está **untracked** (no commiteado en ninguna rama local).
- En paralelo, `origin/main` **sí** referencia un `0040` (commit `d906a7b`, "0040 execution runbook").
- **Implicancia:** la rama CRM construye `0041`–`0046` sobre una base que **localmente no incluye `0040` commiteado**. Hay que confirmar que el `0040` del árbol local es idéntico al `0040` de `origin/main` y que el orden de migraciones queda consistente antes de aplicar la cadena CRM a cualquier entorno. **Posible hueco de orden de migraciones.**

### 4.3 Higiene del árbol de trabajo (cosmético, no bloqueante)

- **20 archivos untracked**, incluidos los 3 docs de handoff, 14 reportes en `docs/handoff/` y `docs/`, y la migración `0040`. Nada commiteado en esta sesión.
- Directorios de caché residual: `.next_corrupt_backup/`, `.next_old_1780729913/`, `.playwright-mcp/` — limpiables sin riesgo.

### 4.4 Riesgos cerrados (confirmados)

R-G1 (cascade contratos → RESTRICT) ✅ · R-G2 (`has_permission`) ✅ · R-G3 (`profiles_public`) ✅ · R7/R8 del roadmap (cascade-delete + bug RBAC) ✅.

---

## 5. PRÓXIMO PASO RECOMENDADO

El read-path (Ficha 360° + persistencia + captura) está cerrado y validado en staging. El siguiente frente de **mayor valor** y **menor dependencia externa** es el **write-path**, porque vuelve el CRM operable end-to-end y activa el hook de capacidad con datos reales — sin depender aún de Clientify (F2.1-5) ni de la decisión de salida a producción.

**Recomendación primaria — Write-path (P-1 + P-2), sobre `feature/crm-comercial-f2-1`, validando contra staging:**
1. `advanceStage(opportunityId, toStage, note)` + persistencia de ediciones de oportunidad, escribiendo `crm_stage_history` y moviendo `committed_state` según etapa (reservado en propuesta/negociación, comprometido al ganar, ocupado al completar onboarding).
2. Conectar la **"siguiente acción"** de la Ficha 360° a esas server actions.
3. Validar en staging (tx+rollback) que las transiciones escriben el ledger, mueven `committed_state`, y que el dashboard refleja la vacancia comercial/proyectada resultante (cierra el lazo F2.1-4 ↔ CRM con datos reales).

**Antes de cualquier paso a producción (recomendación de higiene, independiente del write-path):**
- Resolver **Hallazgo A**: replanificar la estrategia de merge tomando `origin/main` @ `7d74aa3` como base real (no `c3fb359`).
- Resolver **Hallazgo B**: confirmar la identidad/orden del `0040` antes de aplicar `0041`–`0046` en cualquier entorno.

**Alternativa válida** si el negocio prioriza el tope de embudo: **F2.1-5 (webhook Clientify HMAC + leads)**.

**Transversal y bloqueado por decisión:** la **salida a producción** (aplicar a PROD + merge + deploy Netlify) requiere **autorización explícita de Dirección** y la resolución previa de los Hallazgos A y B.

---

## Confirmación de comprensión

- El proyecto **no es nuevo**: continúa desde un estado documentado y validado. Arquitectura aprobada, no se rediseña.
- **`main` (origen de producción) no se toca; nada está desplegado.** Todo vive en ramas aisladas.
- Restricciones permanentes vigentes: **NO** `main`, **NO** Netlify, **NO** PROD, **NO** Supabase PROD (`arsksytgdnzukbmfgkju`), **NO** Clientify PROD. Staging (`vrxosunxlhohmqymxots`) **SÍ**, con guard de URL y validaciones en transacción + ROLLBACK.
- **No se escribió código, no se abrieron ramas, no se aplicaron migraciones.** Solo auditoría.

*Esperando aprobación del frente de trabajo antes de implementar.*
