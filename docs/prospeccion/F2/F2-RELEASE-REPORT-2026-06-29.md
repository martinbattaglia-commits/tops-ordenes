# F2 — Prospección Inteligente · Release Report
**Estado:** `CERRADA ✅` · **Fecha de cierre:** 2026-06-29 · **Versión en producción:** `b1ea521`

---

## 1. Objetivo

Convertir Nexus de importador pasivo de contactos en un **motor de decisión comercial**. Dado un CSV de LinkedIn Sales Navigator (u otras fuentes soportadas por UDIE/F1), F2 construye automáticamente un perfil de empresa a partir de la evidencia que el CSV trae, calcula un Lead Score 0-100 explicable, clasifica cada prospecto (`🟢 Importar / 🟡 Revisar / 🔴 Descartar`) y provee un gate de aprobación humana antes de sincronizar a Clientify CRM.

**Principio rector:** Clientify recibe únicamente oportunidades calificadas y aprobadas por humano.

---

## 2. Arquitectura implementada

### 2.1 Patrón elegido: Pure Isomorphic ScoringStrategy

El cálculo `perfil → score → decisión → explicación` es un conjunto de **funciones puras** (cero I/O) que corre en dos lugares con el mismo código:

- **Servidor (autoritativo):** calcula, persiste y avanza el estado del prospecto.
- **Navegador (preview):** muestra el score en tiempo real sin llamadas al servidor.

El servidor **siempre recalcula** antes de persistir (anti-tamper). El navegador solo pinta.

### 2.2 Capas involucradas

```
UI: ProspeccionView (client) + AccionesProspecto
       ↓
Server Action: qualification-actions.ts / approval-actions.ts / export-actions.ts
       ↓
Use Cases:  QualifyProspects / ApproveProspect / RejectProspect / ExportToClientify
       ↓
Domain:  ScoringStrategy (ICP general-v1) · Enrichment · DecisionTrace · ProspectAggregate
       ↓
Adapters: ClientifyExportAdapter · RPC prospeccion_record_qualification / approve / reject
       ↓
DB (Supabase): prospeccion_enrichment · prospeccion_scores · prospeccion_scores_current
               prospeccion_export_log · prospeccion_crm_refs
```

### 2.3 Máquina de estados (completa tras F2)

```
raw → imported → enriquecido → scoreado → aprobado → sincronizado
                                         ↘ rechazado
```

---

## 3. Componentes agregados

### 3.1 Dominio (`src/lib/prospeccion/`)

| Archivo | Responsabilidad |
|---------|-----------------|
| `domain/scoring/icp-general-v1.ts` | Estrategia ICP versión 1 — 6 dimensiones de scoring |
| `domain/scoring/score-engine.ts` | Motor puro: recibe perfil, retorna score+decisión+DecisionTrace |
| `domain/enrichment/csv-enricher.ts` | Extrae perfil de empresa desde columnas CSV ya normalizadas |
| `domain/enrichment/profile-normalizer.ts` | Normaliza industria, tamaño, geografía, señales logísticas |
| `adapters/clientify/clientify-export.adapter.ts` | Driven adapter — crea/actualiza contactos en Clientify |
| `use-cases/qualify-prospects.ts` | Orquesta enrichment + scoring + persistencia (RPC atómica) |
| `use-cases/approve-prospect.ts` | Gate humano: transición scoreado → aprobado |
| `use-cases/reject-prospect.ts` | Gate humano: transición any → rechazado |
| `use-cases/export-to-clientify.ts` | Lote de exportación + registro en export_log |

### 3.2 Server Actions (`src/app/(app)/comercial/prospeccion/`)

| Archivo | Acción |
|---------|--------|
| `actions/qualification-actions.ts` | `qualifyProspect()` — dispara pipeline scoring |
| `actions/approval-actions.ts` | `approveProspect()` / `rejectProspect()` |
| `actions/export-actions.ts` | `exportApprovedToClientify()` |

### 3.3 UI

| Componente | Cambio |
|-----------|--------|
| `ProspeccionView` | Columnas Score + Clasificación + Motivo + botones Aprobar/Rechazar/Enviar a Clientify |
| `ExportModal` | Modal de confirmación con conteo de prospectos aprobados |
| `DashboardTab` | Stats: importados / calificados / score promedio / distribución decisión / top industrias / top cargos |
| `AccionesProspecto` | Botones contextuales por estado (ícono esmeralda=Aprobar, rojo=Rechazar, azul=Clientify) |

---

## 4. Migraciones aplicadas

### 4.1 `0106_prospeccion_qualification.sql`

| Objeto | Tipo | Descripción |
|--------|------|-------------|
| `prospeccion_enrichment` | TABLE | Perfil de empresa enriquecido — append-only, 23 columnas |
| `prospeccion_scores` | TABLE | Scoring inmutable — append-only, 21 columnas + DecisionTrace jsonb |
| `prospeccion_scores_current` | VIEW | `DISTINCT ON (prospect_id)` — última puntuación vigente (`security_invoker=true`) |
| `prospeccion_record_qualification(jsonb)` | RPC SECURITY DEFINER | Pipeline atómico en 4 pasos por prospecto (enrichment→enriquecido→score→scoreado) |
| 6 índices | INDEX | `prospect_idx`, `industry_idx`, `source_idx`, `decision_idx`, `score_idx`, `created_at DESC` |

### 4.2 `0107_prospeccion_approval.sql`

| Objeto | Tipo | Descripción |
|--------|------|-------------|
| `approved_at/by`, `rejected_at/by`, `rejection_reason` | COLUMNS | Columnas de aprobación/rechazo en `prospeccion_prospects` |
| `prospeccion_export_log` | TABLE | Registro append-only de lotes exportados — 9 columnas |
| `prospeccion_approve_prospect(uuid, uuid)` | RPC SECURITY DEFINER | Gate humano: scoreado/enriquecido/imported → aprobado |
| `prospeccion_reject_prospect(uuid, uuid, text)` | RPC SECURITY DEFINER | Gate humano: any → rechazado (bloquea cliente_creado) |
| `prospeccion.approve` | PERMISSION | `action='sign'` (equivalente aprobación humana) |
| `prospeccion.export` | PERMISSION | `action='export'` — sincronización al CRM |
| Role grants | RBAC SEED | comercial + director_ops + admin para ambos permisos |

> **Nota técnica:** `action='approve'` no existe en `permission_action_t`; se usa `action='sign'` como equivalente semántico. El control real es por slug (`prospeccion.approve`), no por el campo action.

---

## 5. Motor de scoring (ICP general-v1)

### 5.1 Dimensiones (6)

| Dimensión | Peso | Señal evaluada |
|-----------|------|----------------|
| Industria | 30% | `industry_normalized` (ideal/compatible/neutral/incompatible) |
| Geografía | 20% | `is_argentina` — presencia en Argentina |
| Tipo negocio | 15% | `is_b2b` — empresa B2B |
| Señales logísticas | 20% | `has_depositos` + `has_import_export` + `has_distribucion_nacional` + `has_cds` + `terceriza_almacenamiento` |
| Mercado objetivo | 10% | `dentro_mercado_objetivo` |
| Crecimiento | 5% | `growth_signal` (none/low/mid/high) |

### 5.2 Umbrales de clasificación

| Decisión | Rango | UI |
|---------|-------|-----|
| Importar | ≥ 75 | 🟢 |
| Revisar | 50 – 74 | 🟡 |
| Descartar | < 50 | 🔴 |

### 5.3 DecisionTrace

Envelope JSON persistido en `prospeccion_scores.decision_trace` que permite reconstruir la decisión completa: `{ factors, penalties, hard_fails, model_version, icp_config_version, strategy_id, confidence_version, business_unit }`.

---

## 6. Integración Clientify

### 6.1 Flujo

```
prospeccion_prospects (status=aprobado)
  → ClientifyExportAdapter.export()
    → resolveOrCreateContact()  (dedup por email si existe)
      → postContact(payload)    (solo campos con valor no vacío)
    → upsert prospeccion_crm_refs  (prospect_id, crm_provider, crm_contact_id, url)
    → UPDATE prospects SET status='sincronizado'
  → INSERT prospeccion_export_log  (lote completo, results jsonb, total_ok, total_errors)
```

### 6.2 Payload enviado a Clientify

```typescript
{
  first_name,                          // siempre presente
  ...(lastName      && { last_name }),
  ...(p.cargo       && { title }),
  ...(p.company_name && { company_name }),
  ...(p.email       && { emails: [{ type: 1, email }] }),
  ...(p.phone       && { phones: [{ type: 1, phone }] }),
  ...(p.cuit        && { taxpayer_identification_number }),
  channel: "linkedin",
  contact_source: "Prospección Inteligente TOPS",
}
```

> Campos opcionales se incluyen **solo cuando tienen valor**. `medium` eliminado: Clientify lo rechaza con 400 si no pertenece a su enum interno.

### 6.3 Deduplicación en CRM

Si el prospecto tiene email, se busca primero en Clientify (`searchContactByEmail`). Si existe, se reutiliza el contacto sin duplicar. Si no existe, se crea.

---

## 7. Testing

| Suite | Archivos | Tests | Estado |
|-------|----------|-------|--------|
| import-engine (F1+F2) | 2 | 14 | ✅ |
| scoring + enrichment | 5 | 42 | ✅ |
| domain VOs + AR | 4 | 31 | ✅ |
| boundary guard | 1 | 2 | ✅ |
| udie readers | 1 | 3 | ✅ |
| otros módulos Nexus | 32 | 193 | ✅ |
| **TOTAL** | **45** | **285** | **✅ 0 fallos** |

---

## 8. Validación E2E post-deploy

Ejecutada en producción el 2026-06-29 sobre `nexus.logisticatops.com` con sesión autenticada.

| Paso | Evidencia | Estado |
|------|-----------|--------|
| `/api/version` = `b1ea521` | `{"version":"b1ea521","environment":"production","builtAt":"2026-06-29T14:49:26.840Z"}` | ✅ |
| Bandeja carga 3 prospectos con scores/clasificación | UI: UiPath 42/🔴, Travis —/—, Coderio 22/🔴 | ✅ |
| Dashboard tab: stats correctos | avg score 32.0, distribución 2 descartados, 1 aprobado | ✅ |
| Aprobar Coderio desde UI | status `scoreado` → `aprobado` | ✅ |
| Modal exportación muestra "2 prospectos aprobados" | Confirmar exportación | ✅ |
| Clientify acepta la creación | contact_id 165281767 (UiPath) + 165281768 (Coderio) | ✅ |
| Status prospects → `sincronizado` | UI actualizada tras respuesta | ✅ |
| `prospeccion_export_log` registra lote | `total_ok=2 / total_errors=0 / prospect_count=2` | ✅ |
| `prospeccion_crm_refs` tiene ambas referencias | crm_provider=clientify, crm_contact_id y URL Clientify | ✅ |

---

## 9. Commits

| Hash | Descripción |
|------|-------------|
| `98e1f32` | `feat(prospeccion): F2 — motor de calificación inteligente + exportación a Clientify` |
| `732ed22` | `fix(mig-0107): corregir action='sign' para prospeccion.approve` |
| `b1ea521` | `fix(prospeccion): eliminar medium inválido y campos opcionales vacíos en export a Clientify` |

**Commit final en producción:** `b1ea521`

---

## 10. Lecciones aprendidas

### 10.1 Problemas encontrados

| # | Problema | Diagnóstico | Resolución |
|---|----------|-------------|------------|
| P-1 | `action='approve'` rechazado al aplicar 0107 | `permission_action_t` no tiene `approve` en el enum | Usar `action='sign'` — el slug es el control real |
| P-2 | Unique constraint `(module, action)` bloqueó insert | `prospeccion.admin` ya ocupaba `action='admin'` para ese módulo | `action='sign'` disponible |
| P-3 | `medium: "nexus_prospeccion"` rechazado por Clientify 400 | Campo es enum cerrado del CRM, no acepta valores arbitrarios | Eliminar `medium`; el origen queda en `contact_source` |
| P-4 | Botón Aprobar con `textContent` vacío (solo ícono) | React/Tailwind: botones de acción son íconos sin texto DOM | Localizar por `title="Aprobar"` en lugar de por texto |
| P-5 | Click `.click()` sobre botón React no actualizaba el estado | `dispatchEvent` con `MouseEvent` no dispara handlers sintéticos correctamente | Usar `.click()` nativo directamente sobre el elemento exacto |

### 10.2 Decisiones arquitectónicas clave

- **Pure Isomorphic Strategy** sobre async event-driven: se prioriza Lead Score instantáneo en preview sin sacrificar auditabilidad. El rail Outbox queda reservado para F3.
- **Append-only scoring**: `prospeccion_scores` es inmutable. La vista `prospeccion_scores_current` con `DISTINCT ON` expone solo la última puntuación sin borrar historial.
- **DecisionTrace como jsonb en la tabla de scores**: no requiere tabla nueva; permite replay y auditoría completos.
- **`security_invoker=true` en la view**: la vista hereda la RLS del caller, sin elevar privilegios.
- **Campos opcionales en payload Clientify solo si tienen valor**: evita rechazos por campos vacíos/enum-inválidos en futuras versiones de la API.
- **Slug como control de permiso**, no el campo `action`: permite mapear semánticamente aprobación a `sign` sin perder legibilidad en el código.

### 10.3 Riesgos evitados

- **Double-export**: dedup por email en Clientify antes de crear contacto nuevo.
- **Estado inconsistente en export parcial**: el lote registra resultados por prospecto en `prospeccion_export_log.results` (jsonb); errores individuales no cancelan el lote.
- **Anti-tamper en scoring**: el servidor siempre recalcula; el cliente solo pinta el preview.
- **Migración 0107 con enum inválido**: corregido antes de aplicar en producción; la migración final es idempotente y válida.

### 10.4 Recomendaciones para F3

1. Contratar proveedor de enriquecimiento externo (Apollo/PDL/ZoomInfo) antes de comenzar.
2. Extender `permission_action_t` si se requiere un action semánticamente nuevo (`approve`) en lugar de reutilizar `sign`.
3. Implementar retry con backoff en `ClientifyExportAdapter` para errores transitorios 5xx.
4. Agregar `dead-letter` para exports fallidos individuales (actualmente solo se registran en `errors` jsonb).
5. Considerar el rail Outbox (`prospeccion_events`) para el pipeline de enriquecimiento asíncrono.

---

## 11. Resumen ejecutivo

| Campo | Valor |
|-------|-------|
| Commit final | `b1ea521` |
| Versión en producción | `b1ea521` |
| Deploy URL | `https://nexus.logisticatops.com` |
| Deploy netlify ID | `6a4285f4afff4005e4bbc4d7` |
| Fecha deploy | 2026-06-29T14:49:26Z |
| Ambiente | `production` (Supabase `arsksytgdnzukbmfgkju` + Netlify `tops-ordenes`) |
| Tests | 285/285 ✅ |
| Typecheck | 0 errores ✅ |
| Lint | 0 errores ✅ |
| Build | exit 0 ✅ |
| Migraciones aplicadas | 0106 + 0107 |
| Estado F2 | **CERRADA ✅** |
| Riesgos remanentes | Ninguno bloqueante. Ver §10.4 para recomendaciones F3. |

---

*Documento generado al cierre formal de F2 · 2026-06-29 · TOPS NEXUS ERP*
