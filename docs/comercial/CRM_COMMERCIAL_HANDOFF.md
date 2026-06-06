# CRM_COMMERCIAL_HANDOFF — Transferencia de estado · CRM Comercial F2.1

**Proyecto:** TOPS Nexus — Logística TOPS (Verotin S.A.)
**Repo:** `/Users/martinbattaglia/CODE/tops-ordenes`
**Fecha:** 2026-06-06
**Propósito:** transferir íntegramente el estado del CRM Comercial F2.1 a un chat nuevo de Claude Code, sin depender del historial de conversación. **Documento autocontenido. No hay código nuevo acá.**

---

## RESUMEN EJECUTIVO

TOPS Nexus está incorporando su **CRM Comercial** sobre una base de **capacidad corporativa** (dos depósitos modelados como gemelos digitales). En esta fase (F2.1) se construyó y **validó contra staging** todo el núcleo: modelo de datos CRM en Supabase, motor de capacidad consolidado, dashboard de vacancia, la **Ficha 360° de Oportunidad** (pantalla central) leyendo del modelo real, y el **Capture Bridge** que persiste cotizaciones/propuestas desde los artefactos existentes.

**Estado:** todo vive en **ramas de feature aisladas**; **`main` está intacto y nada está en producción**. Las migraciones CRM están **aplicadas y validadas en STAGING (46/46 tests GO)**, nunca en producción. Es un estado *"listo para ejecutar / decidir salida a producción"*, no *"en vivo"*.

**Decisión inmediata pendiente:** definir el camino a producción (aplicar migraciones a prod + estrategia de merge + deploy) **o** continuar construyendo features (write-path / Clientify) sobre staging.

---

## RESUMEN TÉCNICO

- **Stack:** Next.js 14 (App Router) + Supabase (Postgres 17) + Tailwind. RBAC propio (tabla `roles`/`permissions`/`user_roles` + `has_permission()`), RLS por rol.
- **Dominio CRM:** 10 tablas `crm_*` (migraciones 0041–0046), 10 enums, RLS por `has_permission('comercial.*')`, ledgers append-only, vista `profiles_public` (sin email).
- **Motor de capacidad:** `src/lib/wms/corporate-capacity.ts` — puro, consolida Luján + Magaldi; hook `committed_m2` ACTIVO (F2.1-4).
- **Ficha 360°:** `/comercial/oportunidades/[id]` — lee de Supabase `crm_*` con fallback a muestra local; capacidad en vivo vía `findAvailability`.
- **Capture Bridge:** `window.__nexusCapture()` (CB-2) → `crm_quotes(+items)` / `crm_proposals`.
- **Restricciones permanentes:** NO tocar `main`, Netlify, producción, **Supabase PROD (ref `arsksytgdnzukbmfgkju`)**, Clientify PROD, ARCA, Custody. Staging SÍ.

---

## 1. Arquitectura actual

```
Google Ads → Clientify (tope embudo, NO integrado aún)
                  │ (futuro: webhook HMAC → crm_leads)
                  ▼
   CRM Nexus (dominio crm_*) ── Ficha 360° (pantalla central)
        │  service_type + m²                     │
        ├──► Motor Corporativo de Capacidad ◄────┤ findAvailability / committed_m2
        │      (Luján + Magaldi, vacancia)        │
        ├──► Cotización (Capture Bridge → crm_quotes+items)
        ├──► Propuesta (Capture Bridge → crm_proposals)
        ├──► Contrato (crm_contracts)
        └──► Onboarding (crm_onboarding + tasks) → Cliente activo
```

- **Frontera de sistema (ratificada):** Clientify = leads/contactos/marketing; **Nexus** = oportunidad en adelante (híbrido por etapa).
- **Capa de capacidad:** los Digital Twins (modelos locales `lujan3159-map.ts`, `magaldi1765-map.ts`) → motor `corporate-capacity.ts` → dashboard + CRM.

---

## 2. Ramas existentes (todas aisladas · `main` intacto en `c3fb359`)

| Rama | Hash | Contenido |
|---|---|---|
| `feature/mapa-premium-lujan-3159` | `c1e4fb4` | Digital Twin premium Luján 3159 (mapa + modelo local) |
| `feature/mapa-premium-magaldi-1765` | `8f35e6a` | Digital Twin premium corporativo Magaldi 1765 |
| `feature/dashboard-vacancia-corporativo` | `1f7d255` | **Integración**: mergea ambos mapas + motor de capacidad + dashboard |
| `feature/crm-comercial-f2-1` | `a76fff7` | **Rama activa** (desde la de integración): dominio CRM + Ficha 360° + Capture Bridge |
| `main` | `c3fb359` | **Producción · intacto** (ningún feature mergeado) |

> La rama de trabajo es **`feature/crm-comercial-f2-1`** (hereda motor + dashboard + ambos modelos de sede). Ninguna rama está pusheada/mergeada.

---

## 3. Commits relevantes (rama `feature/crm-comercial-f2-1`)

| Hash | Hito |
|---|---|
| `384d885` | F2.1-1 · enums + núcleo (crm_leads, crm_opportunities) |
| `acbcc62` | F2.1-2 · capa de negocio (quotes/proposals/contracts/onboarding/sync) + arquitectura de dominio |
| `236559f` | CRM_UX_REVIEW (validación de experiencia) |
| `070006b` | CRM_CAPTURE_BRIDGE_ARCHITECTURE (diseño UX-1, CB-2 ratificado) |
| `817e264` | F2.1-3 · RBAC seed + `profiles_public` + **fix RLS** (has_permission) |
| `7e54291` | F2.1-GATE · validación estructural + **R-G1** (contratos `ON DELETE RESTRICT`) |
| `b7fb1aa` | Script + runbook de validación de staging |
| `eddbc6d` | **Staging validation ejecutada → GO (46/46, R-G2 confirmado)** |
| `c91b4d0` | F2.1-4 · activar hook de capacidad (committed/reserved + vacancia comercial/proyectada) |
| `25b07fc` | F2.1-6 · **Ficha 360°** de Oportunidad |
| `e84effa` | F2.1-7 · **persistencia real** (Supabase) para la Ficha 360° |
| `a76fff7` | UX-1 · **Capture Bridge** (`window.__nexusCapture`) → crm_quotes/proposals |

---

## 4. Migraciones 0041–0046 (en `supabase/migrations/`)

| Migración | Tablas | Notas |
|---|---|---|
| `0041_crm_enums.sql` | — | 10 enums: lead_status, service (anmat/general/oficinas), stage (8), committed_state (none/reservado/comprometido/ocupado), quote/proposal/contract/onboarding status, onboarding_task |
| `0042_crm_core.sql` | `crm_leads`, `crm_opportunities` | eje; campos capacidad: `capacity_feasible`, `assigned_site`, `assigned_units` (jsonb), `committed_state`. FK circular leads↔opp por ALTER |
| `0043_crm_quotes_proposals.sql` | `crm_quotes`, `crm_quote_items`, `crm_proposals` | public_id COT-/PROP-; pdf→documents |
| `0044_crm_contracts_onboarding.sql` | `crm_contracts`, `crm_onboarding`, `crm_onboarding_tasks` | **contracts.opportunity_id = ON DELETE RESTRICT (R-G1)**; resto cascade |
| `0045_crm_sync_audit.sql` | `crm_stage_history`, `clientify_sync_log` | ledgers append-only (sin UPDATE = inmutables) |
| `0046_crm_rbac_seed.sql` | — | permisos `comercial.create/delete/admin` + mapeo a roles + vista `profiles_public(id, full_name)` |

- **RLS (las 10 tablas):** SELECT `has_permission('comercial.view')` · INSERT/UPDATE `has_permission('comercial.edit')` · DELETE `is_admin()` (bypass admin incluido). Ledgers sin UPDATE.
- **Convenciones:** uuid PK + `short_id`/`public_id` por trigger; `tg_touch_updated_at`; soft-delete `deleted_at` (excepto onboarding/ledgers).

---

## 5. Estado de staging

- **Proyecto:** `tops-nexus-staging` · ref **`vrxosunxlhohmqymxots`** · pooler `aws-1-sa-east-1` · Postgres **17.6**.
- **CLI linkeada a staging** (`supabase/.temp/`). Conexión SQL cruda vía **`STAGING_DB_URL`** en `.env.local` (usar `pg`; no hay claves supabase-js de staging).
- **Esquema base 0001–0040: aplicado.** **CRM 0041–0046: aplicado y validado.**
- **Validación (commit `eddbc6d`):** `CRM_STAGING_VALIDATION.sql` (46 tests) → **46/46 PASS**. R-G1, R-G2, R-G3, public_ids, ledgers, RLS por rol verificados.
- **Sin datos residuales** (las validaciones y evidencias usan transacción + ROLLBACK; las secuencias de public_id sí avanzaron — cosmético).
- ⚠️ **PROD (`arsksytgdnzukbmfgkju`) NO tiene las tablas `crm_*`** y **no debe tocarse** sin autorización. La app apunta a PROD (`NEXT_PUBLIC_SUPABASE_URL`), por eso en runtime cae al fallback local.

---

## 6. Estado del Capacity Engine

- `src/lib/wms/corporate-capacity.ts` — **puro**, recibe `CommittedSnapshot` por parámetro (sin acceder a Supabase). `COMMITTED_M2_ENABLED = true` (F2.1-4).
- **Snapshot:** `src/lib/comercial/committed-capacity.ts` arma el snapshot desde `crm_opportunities` (reservado=propuesta/negociación, comprometido=ganado; **ocupado NO se cuenta** — ya está en ocupación física: anti-doble-conteo). Solo cuenta oportunidades con `assigned_site`.
- **Métricas:** vacancia **física** / **comercial** (− comprometido) / **proyectada** (− reservado), por categoría y por sede.
- **Cifras base (sin compromisos):** comercializable **10.049 m²**, disponible físico **3.770 m²**, vacancia **37,5%**. ANMAT 2.085/508 · CG 7.804/3.212 · Oficinas 160/50. Racks 906/2.377 · Coworking 11 islas.
- **`findAvailability(req, snapshot)`** — matching demanda↔oferta (base física/comercial/proyectada). Validado por código.

---

## 7. Estado del Dashboard

- Ruta **`/comercial/dashboard-vacancia`** (server async). `page.tsx` llama `getCommittedSnapshot()` y pasa el snapshot a la vista; sin compromisos CRM → snapshot `{}` → vacancia física (activación segura, no rompe).
- Muestra: resumen ejecutivo, **banda física/comercial/proyectada**, por categoría, por sede, y **motor de matching** (presets 300 m² ANMAT, 800 m² CG, 20 puestos coworking). Export CSV/PDF, responsive, claro/oscuro.
- QA verde; construido en la rama de integración, heredado por la rama CRM.

---

## 8. Estado de la Ficha 360°

- Rutas **`/comercial/oportunidades`** (lista) y **`/comercial/oportunidades/[id]`** (ficha). Server async.
- **Fuente (F2.1-7):** Supabase `crm_*` vía `opportunities-supabase.ts` (nested select) + `opportunities-mapper.ts` (puro snake→camel), con **fallback a muestra local** (`opportunities-data.ts`). Badge de **fuente** (Supabase/local) en la UI.
- **Integra en una vista:** Opportunity · **Capacidad** (findAvailability en vivo) · Cotizaciones · Propuestas · Contrato · Onboarding · Historial. Pipeline stepper de 8 etapas + botón "siguiente acción".
- **Evidencia E2E (staging):** oportunidad completa sembrada → leída → mapeada por el mapper real → Ficha correcta. PASS.
- **Limitación menor:** `owner_id`/`changed_by` (uuid→nombre) se muestran como "—" (resolver vía `profiles_public` = follow-up).

---

## 9. Estado del Capture Bridge (UX-1)

- **Contrato CB-2:** el host lee `iframe.contentWindow.__nexusCapture()` (same-origin) → `parseCapture()` (Zod) → server action `saveCaptureForOpportunity` → `crm_quotes(+items)` / `crm_proposals`.
- **Archivos:** `capture-bridge.ts` (Zod), `capture-actions.ts` (server action), `CaptureEmbed.tsx` (iframe + botón "Guardar en Nexus" en la barra del host), wiring en la Ficha (tabs Cotizaciones/Propuestas).
- **Hooks en artefactos** (`public/tools/*/index.html`, additive, sin tocar su lógica):
  - **propuesta-anmat** (inline + localStorage): hook **robusto, funcionando** → crm_proposals. ✅
  - **cotizador** y **propuesta-general** (bundles base64+gzip **opacos**, sin estado expuesto): el hook existe pero devuelve **`unavailable:true`** con nota. `parseCapture` los rechaza.
- **Evidencia:** Playwright (browser real) → `__nexusCapture()` de anmat devuelve `ProposalCapture`; persistencia en staging (tx+rollback) PROP/COT con ítems. PASS.

---

## 10. Riesgos abiertos

| # | Riesgo | Estado |
|---|---|---|
| RA-1 | **App apunta a PROD (sin tablas `crm_*`)** → reads caen a fallback local, writes fallan suave. Persistencia real solo probada en staging. | Abierto — decisión de salida a prod |
| RA-2 | **4 ramas aisladas sin merge**; estrategia de integración a `main` indefinida | Abierto |
| RA-3 | **Cotizador/propuesta-general bundleados** no capturan hasta que su mantenedor exponga `window.__nexusCapture` desde el bundle (1 línea) | Abierto (el bridge ya los persistiría) |
| RA-4 | **Seed Digital Twin `warehouse_*`** usa códigos D/S provisionales ≠ realidad auditada (PB-codes). Los mapas/motor usan **modelos locales** (correctos); el seed quedaría desactualizado si se usara `warehouse_sectors` como fuente | Abierto (reconciliación documentada, no ejecutada) |
| RA-5 | Resolución `owner_id`/`changed_by` (uuid→nombre) vía `profiles_public` | Abierto (menor) |
| RA-6 | Nada desplegado (Netlify); el stack completo no se probó en deploy | Abierto |
| — | **R-G1** (cascade contratos) → **RESUELTO** (restrict). **R-G2** (has_permission) → **RESUELTO** (verificado en staging). **R-G3** (profiles_public) → **RESUELTO**. | Cerrados |

---

## 11. Próximos frentes (NO abiertos)

| Frente | Descripción |
|---|---|
| **Write-path** | Server actions para transiciones de etapa: escribir `crm_stage_history`, mover `estado`, gestionar `committed_state` (reservado→comprometido→ocupado), disparar onboarding al ganar |
| **F2.1-5** | Webhook Clientify con **HMAC** + ingreso de leads (`crm_leads`, `clientify_sync_log`) + promoción lead→oportunidad |
| **Exponer hook en bundles** | Con Comercial: definir `window.__nexusCapture` dentro de cotizador/propuesta-general (additive) → captura robusta |
| **Owner resolution** | Resolver nombres vía `profiles_public` en el mapper |
| **Camino a producción** | Aplicar 0041–0046 a prod (con autorización) + estrategia de merge a `main` + deploy Netlify + smoke |
| **Reconciliación seed** | `warehouse_*` D/S → PB (alinear vacancia "oficial" con la realidad) |

---

## Documentación de referencia (en la rama, para el chat nuevo)

- **Dominio/CRM** (`docs/comercial/`): `CRM_DOMAIN_ARCHITECTURE`, `COMMERCIAL_F2_1_ARCHITECTURE`, `CRM_UX_REVIEW`, `CRM_CAPTURE_BRIDGE_ARCHITECTURE` + `…_IMPLEMENTATION`, `CRM_360_VIEW_ARCHITECTURE`, `CRM_PERSISTENCE_ARCHITECTURE`, `CRM_F2_1_GATE`, `CRM_STAGING_*` (validation + runbook + results + GO/NO-GO), `COMMERCIAL_MODULE_MASTER_PLAN`, `CLIENTIFY_NEXUS_DATA_MODEL`, `COMMERCIAL_PIPELINE_DESIGN`, `ONBOARDING_AUTOMATION_DESIGN`, `COMMERCIAL_KPI_DASHBOARD`, `VACANCY_SOURCE_OF_TRUTH_ANALYSIS`.
- **Capacidad** (`docs/corporate/`): `TOPS_CORPORATE_CAPACITY_ARCHITECTURE`, `CORPORATE_CAPACITY_ENGINE_REPORT`, `CORPORATE_VACANCY_DASHBOARD_REPORT`.
- **Sedes** (`docs/lujan/`, `docs/magaldi/`): audits, data models, inconsistencias, reportes.
- **Validación staging:** `supabase/tests/CRM_STAGING_VALIDATION.sql`.

## Notas de entorno para el chat nuevo

- Trabajar en **`feature/crm-comercial-f2-1`**. NO `main`, NO Netlify, NO PROD, NO Supabase PROD (`arsksytgdnzukbmfgkju`), NO Clientify PROD.
- **Staging:** CLI linkeada; correr SQL crudo con `pg` + `STAGING_DB_URL` (guard: la URL debe contener `vrxosunxlhohmqymxots` y NO `arsksytgdnzukbmfgkju`). Validaciones en transacción + ROLLBACK.
- **Tooling probado:** `npx tsc --noEmit`, `npx next lint`, `npm run build` (caché `.next` puede dar un falso "PageNotFound" en collect-page-data → reintentar build, se auto-sana). `npx tsx` para TS+pg: poner el script **en la raíz del repo** (resuelve node_modules) y envolver en **IIFE async** (tsx -e no soporta top-level await con pg). Playwright disponible (cargar artefactos vía server estático http, no `file://`).

---

## PRÓXIMO PASO RECOMENDADO

**Construir el write-path (server actions de transición de etapa)** sobre la rama `feature/crm-comercial-f2-1`, validando contra staging:

1. Implementar `advanceStage(opportunityId, toStage, note)` y la persistencia de ediciones de oportunidad, escribiendo `crm_stage_history` y actualizando `committed_state` según la etapa (reservado en propuesta/negociación, comprometido al ganar, ocupado al completar onboarding).
2. Conectar la **"siguiente acción"** de la Ficha 360° (hoy solo cambia de tab) a esas server actions.
3. Validar en staging (tx+rollback) que las transiciones escriben el ledger y mueven `committed_state`, y que el dashboard refleja la vacancia comercial/proyectada resultante (cierra el lazo F2.1-4 ↔ CRM con datos reales).

**Por qué primero esto:** el read-path (Ficha 360° + persistencia + captura) ya está cerrado y probado; el write-path lo vuelve **operable** end-to-end y activa de verdad el hook de capacidad con datos reales — sin depender aún de Clientify (F2.1-5) ni de la decisión de salida a producción.

> Alternativa válida si el negocio prioriza el tope de embudo: **F2.1-5 (Clientify webhook HMAC + leads)**. La decisión de **salida a producción** (aplicar a prod + merge + deploy) es transversal y requiere autorización explícita de Dirección.

**Sin código en este documento. Frentes no abiertos. Transferencia completa.**
