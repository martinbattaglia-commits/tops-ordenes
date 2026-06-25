# Security Architecture — Reglas (normativo)

> **Refina la Decisión 8** y endurece la Security Architecture de la Parte VII. Normativo. Defensa en profundidad con la RLS como frontera primaria (RBAC dormido en prod).

## SEC-1 — RLS como frontera primaria
Toda tabla `prospeccion_*` tiene **RLS habilitada**; policies vía `has_permission`/`is_admin`. **NUNCA `using(true)` en tablas con PII.** Las lecturas de usuario van por el **cliente anon** (sujeto a RLS). Mientras el enforcement de RBAC esté dormido, **la RLS es la seguridad de registro** — no los page guards (que caen fail-open).

## SEC-2 — RPC-first (escrituras críticas)
Las escrituras que cambian estado o tocan PII van **solo** vía RPC `SECURITY DEFINER` con `search_path` fijo, **grant a `service_role`** y `revoke` de `public/anon/authenticated`. El front **nunca** escribe directo. Outbox y bitácoras de jobs: escribibles solo por `service_role`.

## SEC-3 — Mínimo privilegio y separación de clientes
Cliente **anon** (RLS) para lecturas de usuario; **`service_role` solo en `src/lib/supabase/server.ts`** (jamás al cliente). Los driving adapters autentican al caller (`auth.getUser()`) **antes** de invocar el caso de uso. Cada componente con el mínimo privilegio necesario.

## SEC-4 — Zero Trust
Toda request **autenticada y autorizada** (sin confianza implícita por red/origen). Entradas inbound (webhooks/cron) **verificadas** (token/HMAC timing-safe, `CRON_SECRET`) **fail-closed**: si falta el secreto → rechazar. **Sin endpoints de mutación sin autenticar.**

## SEC-5 — Gestión y rotación de secretos
Secretos **por nombre**, nunca en repo (`.env` gitignored), nunca al cliente. Keys/`service_role` solo backend. **Gotcha documentado:** Netlify CLI **no inyecta env vars secretas** a funciones (caso `clientify_key`) → verificar en runtime. **Política de rotación**: rotar ante exposición + rotación periódica. `env-check` valida presencia (PASS/FAIL, **nunca imprime el valor**).

## SEC-6 — Auditoría y trazabilidad
Auditoría **append-only** (`audit_log`/`clientify_sync_log`/outbox). `correlation_id` + `causation_id` extremo a extremo. **Toda acción sensible** (approve, sync, export, admin, acceso a PII cruda) se audita con actor + timestamp. Inmutable (DG-7).

## SEC-7 — Protección de PII de terceros
Los prospectos son **PII de terceros** (a veces sin consentimiento, ej. LinkedIn). Reglas: **minimización** (guardar solo lo necesario para calificar); lectura de owners por `profiles_public` (sin email); **clasificación de sensibilidad por campo**; el **acceso a PII cruda se loguea**. Evaluar **cifrado a nivel columna** (pgcrypto) para los campos más sensibles según política.

## SEC-8 — Ciclo de vida de PII / derecho al olvido
**Política de retención explícita** para la PII de prospectos. **Anonimización/seudonimización** de prospectos archivados/rechazados. **Procedimiento de "olvido"** (soft-delete + purga/redacción de campos PII conservando el evento de auditoría) para solicitudes del titular del dato. **Nunca** borrado físico de auditoría; los **campos PII sí** pueden redactarse/anonimizarse.

## SEC-9 — Gobierno del bypass de admin
`is_admin()` bypassa RLS/`has_permission` por diseño → el admin **ve toda la PII**. Es un **riesgo documentado y aceptado**; el acceso admin a PII cruda se **audita**. Opción futura: restricción a nivel campo incluso para admin sobre la PII más sensible.

## SEC-10 — Postura ante la activación de RBAC
Cuando se seedee `user_roles` y `RBAC_ENFORCE=1`, el RBAC pasa a ser **segunda capa** (page/route guards) **sobre** la RLS (defensa en profundidad). Hasta entonces, la RLS + allowlist del middleware es la frontera real. **El diseño de F0 DEBE ser correcto bajo AMBOS estados** (RBAC dormido y activo).

## SEC-11 — Threat model (OWASP) y SSRF en enrichment
El módulo direcciona: **injection** (RPC/parametrizado), **prompt-injection** (AI-4), **broken access control** (RLS+RBAC), **secrets exposure** (SEC-5) y —crítico para enrichment— **SSRF**: los fetch a URLs **provenientes de datos externos/scrapeados** DEBEN validar el destino (**allowlist de esquemas/hosts, bloqueo de IPs internas/metadata, sin redirects a privadas, timeout**). Un fetch de enrichment a una URL arbitraria sin validación es una vulnerabilidad.

## SEC-12 — Cifrado
**TLS en tránsito** (HTTPS/Supabase). **Cifrado at-rest** (gestionado por Supabase). Evaluar **cifrado a nivel columna** (pgcrypto) para PII sensible si la política lo exige. Claves privadas (estilo X.509 ARCA) **nunca** en repo ni DB (regla existente G9).

---

**Objetivo** — Garantizar confidencialidad, integridad, trazabilidad y cumplimiento sobre datos sensibles de terceros, con la frontera correcta dado el estado real del RBAC.
**Alcance** — Todas las tablas `prospeccion_*`, RPCs, adapters, crons, webhooks y el manejo de PII; aplica desde F0.
**Decisiones tomadas** — SEC-1..SEC-12: RLS-primary; RPC-first; mínimo privilegio; Zero Trust fail-closed; secrets + rotación; auditoría inmutable; protección + ciclo de vida + olvido de PII; gobierno de admin-bypass; doble-postura RBAC; threat model + SSRF en enrichment; cifrado.
**Decisiones descartadas** — confiar en guards de app (fail-open hoy); `service_role` ubicuo; perímetro sin enforcement por fila; borrado físico de auditoría.
**Justificación** — Es la única postura honesta dado RBAC dormido; protege PII de terceros desde el día 1 y escala a defensa en profundidad; agrega SSRF y ciclo de vida de PII que un blueprint enterprise no puede omitir.
**Riesgos** — Bug de policy RLS → tests + nunca `using(true)`; admin ve PII → auditado + restricción futura; PII/LinkedIn → decisión legal documentada (SEC-7/8); SSRF → SEC-11.
**Impacto sobre la arquitectura** — Condiciona toda policy RLS, toda RPC, los adapters de enrichment (validación SSRF), el manejo de secretos y el ciclo de vida del dato; es gate del Architecture Review.

---

## §5. Privacy by Design

> **Principio:** Los datos de terceros son prestados, no poseídos. Minimizar recolección, limitar uso, garantizar eliminación.

### 5.1 Fuentes de Import Permitidas y Prohibidas

| Fuente | Tipo | Estado |
|---|---|:---:|
| CSV exportado por el usuario de su propia cuenta de LinkedIn Navigator | Manual | ✅ PERMITIDA |
| Scraping automatizado de LinkedIn vía Firecrawl/Apify/BrightData | Automática | ❌ PROHIBIDA |
| Scraping de sitios web de empresas (datos institucionales públicos) | Automática | ✅ con límites |
| APIs B2B con licencia propia (Apollo.io, ZoomInfo, PDL) | Automática | ✅ con contrato |
| Forms propios con consentimiento explícito | Automática | ✅ |

**CC-L1:** El adaptador `LinkedInCsvImportAdapter` SÓLO procesa CSV exportados manualmente. El campo `source` del evento `ProspectImported` DEBE registrar `'linkedin_csv_manual'`. Adaptadores con scraping automático de LinkedIn son RECHAZADOS en Architecture Review sin excepción.

### 5.2 Política de Retención

| Estado terminal | Plazo máx. desde el evento terminal | Acción |
|---|---|---|
| `cliente_creado` | Indefinido (migra al módulo Cliente) | PII transferida al perfil del Cliente |
| `sincronizado` | 24 meses desde `sincronized_at` | Soft-delete PII (§5.3) |
| `rechazado` | 12 meses desde `rejected_at` | Soft-delete PII |
| `duplicado` | 6 meses desde `duplicado_at` | Soft-delete PII |
| `raw`/`importado` sin avanzar | 90 días desde `created_at` | Soft-delete PII automático |

Cron: `prospeccion-retention-cleanup` (GitHub Actions, 03:00 ART). Invoca RPC `prospeccion_pii_erase(prospect_id)`.

### 5.3 Mecanismo de Borrado PII Compatible con Outbox Append-Only

El Outbox es append-only (ADR-004/OB-4). La solución es **preservar la cadena de auditoría pero vaciar el payload PII**:

- En `prospeccion_prospects`: `full_name → '[BORRADO]'`, `email/phone/linkedin_url → null`, `raw → '{}'`, `pii_erased_at = now()`.
- En `prospeccion_events`: reemplazar `payload` de ese `aggregate_id` por `{_pii_erased: true, _erased_at: "...", event_type: <preservado>}`.
- Insertar `ProspectPiiErased` con `status = 'processed'` para auditoría.

**Campos PII:** `full_name`, `email`, `phone`, `linkedin_url`, `raw`.  
**Campos NO-PII (preservados):** `id`, `short_id`, `status`, timestamps, `source_type`, `company_domain`, `company_name`.

**INV-PR-8:** Después de `prospeccion_pii_erase(id)`, `pii_erased_at IS NOT NULL` y ningún campo PII contiene datos reales.

### 5.4 Marco Legal

| Marco | Aplicabilidad | Artículo clave |
|---|---|---|
| **Ley 25.326** (Argentina) | Aplica directamente | Art. 5 consentimiento, Art. 17 supresión |
| **RGPD** (UE) | Si prospectos son personas físicas de la UE | Art. 6, Art. 17, Art. 30 RAT |
| **LinkedIn ToS** | Restricción contractual | §8.2 prohíbe scraping |

**Registro de Actividades de Tratamiento (RAT):** Responsable: VEROTIN S.A. / martin.battaglia@logisticatops.com. Finalidad: calificación de prospectos comerciales. Categorías: nombre, email, cargo, empresa, teléfono, LinkedIn URL. Destinatarios: Clientify (F5). Plazos: §5.2. Medidas técnicas: RLS + TLS + redacción pre-LLM + soft-delete PII.

### 5.5 Reglas de Enforcement Privacy

- **SEC-PRIV-1:** Ningún adaptador del Enrichment Manager puede recibir el campo `raw` completo. Solo campos mínimos (company_domain, company_name, source_type).
- **SEC-PRIV-2:** La redacción pre-LLM ES un contrato testeable. El adaptador de IA DEBE tener test unitario que verifique que el input al provider NO contiene `full_name`, `email`, `phone`, ni `linkedin_url`. Gate: DoD-8.
- **SEC-PRIV-3:** Todo PR que introduzca scraping automático de LinkedIn es RECHAZADO en Architecture Review independientemente de la calidad técnica.
