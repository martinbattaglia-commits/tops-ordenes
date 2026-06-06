# CLIENTIFY_INTEGRATION_PREREQUISITES — F2.2-0 · Capa de infraestructura

**Proyecto:** TOPS Nexus — Logística TOPS (Verotin S.A.)
**Fecha:** 2026-06-06
**Frente:** F2.2-0 — cerrar incertidumbres previas a implementar Clientify (**sin código de feature**).
**Acompaña a:** `CLIENTIFY_WEBHOOK_AUTH_RESEARCH.md` · `CLIENTIFY_INTEGRATION_ARCHITECTURE.md`

> Cierra: (2) consolidación del cliente de escritura (T-1), (3) variables de entorno, (4) estrategia de staging, (5) fallback de auth. La auth de webhook (1) se resuelve en el doc de research: **Clientify no firma → token-en-URL**.

---

## 1. Consolidación del cliente Clientify (T-1) — especificación

### 1.1 Situación actual (verificada en el repo)
| Archivo | Rol | Estado | Métodos |
|---|---|---|---|
| `src/lib/clientify/client.ts` | **Lectura, tipado, EN USO** por las 3 rutas (`ping/sync-deals/webhook`) | ✅ canónico | `listContacts, getContact, listCompanies, listPipelines, listDeals, getDeal, listActivities, ping` + `ClientifyError` |
| `src/lib/clientify.ts` | **Escritura, HUÉRFANO** (no lo importa nadie) | ⚠️ a absorber/eliminar | `clientify.{createContact, updateContact, createCompany, listContacts, getContact, searchContacts, listCompanies, ping}` |

Ambos: auth `Authorization: Token`, base `https://api.clientify.net/v1`, retries con backoff, `cache:no-store`, `server-only`. Difieren solo en estilo (funciones sueltas vs objeto `clientify.*`) y manejo de error (throw `ClientifyError` vs `{ok:false}`).

### 1.2 Decisión de consolidación
- **Canónico = `src/lib/clientify/client.ts`** (es el que está en uso y mejor tipado).
- **Portar** del huérfano, como funciones nuevas del módulo canónico (mismo estilo `throw ClientifyError`):
  - `createContact(payload)` → `POST contacts/`
  - `updateContact(id, payload)` → `PATCH contacts/{id}/`
  - `createCompany(payload)` → `POST companies/`
  - (Futuro outbound, F2.2-6/F2.4) `createDeal`, `updateDeal`, `moveDealStage`, `closeDeal` → `POST/PATCH deals/…`
- **Política de escritura:** `maxRetries: 1` (no duplicar ante 5xx), idempotencia por clave de negocio donde aplique.
- **Eliminar** `src/lib/clientify.ts` (huérfano) tras portar. `grep` previo confirma 0 imports externos (ya verificado: no lo usa ninguna ruta/componente).
- **Sin cambios** en los métodos de lectura existentes (no romper `ping/sync-deals/webhook`).

### 1.3 Alcance de ejecución
> Esta es la **especificación**. La consolidación es un cambio mecánico de infraestructura (additivo en el canónico + borrado del huérfano), **listo para ejecutarse como primer paso de código de F2.2-1**. No se ejecuta en F2.2-0 (doc-only). Para **inbound-first (D-1)** los métodos de escritura **no se usan todavía** (el inbound no escribe en Clientify); la consolidación se hace ahora para **eliminar la deuda del archivo huérfano** y dejar una sola superficie.

---

## 2. Variables de entorno requeridas

### 2.1 Existentes (verificadas en `env.ts` / `clientify.ts`)
| Var | Uso | Default |
|---|---|---|
| `CLIENTIFY_API_KEY` | token de la API (lectura; escritura futura) | — (requerida) |
| `CLIENTIFY_BASE_URL` | base de la API | `https://api.clientify.net/v1` |
| `CLIENTIFY_TIMEOUT_MS` | timeout (cliente huérfano) | `15000` |
| `CLIENTIFY_MAX_RETRIES` | reintentos | `3` |
| `CRON_SECRET` | protege `GET /api/clientify/sync-deals` | — (opcional) |
| `STAGING_DB_URL` | conexión cruda `pg` a staging (validación) | — |

### 2.2 Nueva (a agregar en `env.ts`, additivo)
| Var | Uso | Notas |
|---|---|---|
| **`CLIENTIFY_WEBHOOK_SECRET`** | **token secreto de la URL del webhook** (no es clave HMAC — Clientify no firma). Se compara timing-safe contra el segmento/ível de la URL entrante. | ≥ 32 bytes URL-safe. Generar una vez. Nunca logear. |

**Spec del cambio en `env.ts`** (bloque `clientify`):
```
clientify: {
  apiKey: …, baseUrl: …, configured: …,
  webhookSecret: process.env.CLIENTIFY_WEBHOOK_SECRET?.trim() ?? "",
  webhookConfigured: Boolean(process.env.CLIENTIFY_WEBHOOK_SECRET?.trim()),
}
```
> Additivo, no rompe nada. Se aplica junto con el handler (F2.2-2). En `.env.local` (dev/staging) y, llegado el momento, en Netlify (prod) — **no ahora**.

### 2.3 Forma de la URL del webhook
- **Producción (futuro):** `https://nexus.logisticatops.com/api/clientify/webhook/<CLIENTIFY_WEBHOOK_SECRET>`
- El token va en **path** (route dinámica `webhook/[token]/route.ts`) para minimizar fugas por logs de query. Validación timing-safe; mismatch → `401`.

---

## 3. Estrategia de staging

### 3.1 Realidad del entorno (verificada)
- **No hay tenant/sandbox de Clientify** declarado (apitracker: "Sandbox: —"). → **no** se valida contra un Clientify de prueba.
- **Supabase staging** (`vrxosunxlhohmqymxots`) sí está disponible (mismo que F2.1).
- La **app desplegable apunta a Supabase PROD** (sin `crm_*`) → la validación del ingest **no** se hace por la ruta desplegada, sino **directo contra staging** con `pg` (patrón F2.1).

### 3.2 Cómo se validará cada pieza (en su sub-fase)
| Pieza | Estrategia de validación |
|---|---|
| **RPC `crm_ingest_lead`** (F2.2-1) | `pg` + `BEGIN…ROLLBACK` contra staging; payloads fixture; asserts de upsert/dedup/asignación (igual que W-1). |
| **Handler webhook + token** (F2.2-2) | Tests de unidad del verificador de token (timing-safe, 401) + **payloads Clientify capturados** (vía webhook.site o un evento real read-only) reinyectados al handler apuntando a Supabase staging. |
| **Lecturas del cliente** (`ping/listDeals`) | Solo lectura. Si se autoriza, diagnóstico read-only contra Clientify PROD (no muta). Si no, fixtures. |
| **Outbound (escritura a Clientify)** | **Diferido** (F2.2-6/F2.4). Requiere sandbox o autorización explícita. **No se prueba en F2.2 inbound-first.** |

### 3.3 Reglas (heredadas de F2.1, vigentes)
- Guard de URL: `STAGING_DB_URL` debe contener `vrxosunxlhohmqymxots` y **no** `arsksytgdnzukbmfgkju`.
- Todo en transacción + ROLLBACK; sin datos residuales.
- **NO** Clientify PROD (escritura), **NO** Supabase PROD, **NO** Netlify, **NO** `main`.

### 3.4 Captura de payloads reales (sin tocar PROD de escritura)
Para tener fixtures fieles: configurar **temporalmente** un webhook de Clientify apuntando a **webhook.site** (no a Nexus), disparar un cambio de contacto, y **guardar el JSON** como fixture. Es lectura del lado Clientify (no muta datos de negocio) y no toca Nexus. Documentar el shape en F2.2-1.

---

## 4. Fallback de autenticación (resumen — detalle en research §4)

Como **Clientify no firma** (no HMAC), el esquema **no es un fallback sino el mecanismo primario**:

1. **Token-en-URL** (path), timing-safe vs `CLIENTIFY_WEBHOOK_SECRET` → `401` si no coincide. **(primario)**
2. **HTTPS** (transporte).
3. **Idempotencia** (`clientify_id` unique) → reentrega/replay viejo no hace daño.
4. **Reconciliación por pull** (`sync-deals` cron) → backbone confiable ante webhook perdido/duplicado.
5. **IP allowlist** (opcional) si Clientify publica su rango de egreso.

> Degradación conocida y mitigada (no agujero silencioso): el token-en-URL no prueba integridad del payload; lo compensan idempotencia + reconciliación. **Gate pre-prod:** confirmar con soporte Clientify (firma / IPs / sandbox).

---

## 5. Checklist de cierre de F2.2-0

| # | Ítem | Estado |
|---|---|---|
| 1 | Mecanismo de auth de webhook **confirmado** (no HMAC → token-en-URL) | ✅ (research) |
| 2 | Consolidación del cliente (T-1) **especificada** (canónico + portar + borrar huérfano) | ✅ (este doc §1) |
| 3 | Variables de entorno **definidas** (+`CLIENTIFY_WEBHOOK_SECRET`) | ✅ (§2) |
| 4 | Estrategia de staging **definida** (fixtures + `pg`/staging; sin sandbox Clientify; outbound diferido) | ✅ (§3) |
| 5 | Fallback **documentado** (token-en-URL primario + capas) | ✅ (§4 + research) |
| — | **Gate pre-prod:** ticket a soporte Clientify (firma / IPs / sandbox) | ⏳ pendiente (no bloquea F2.2-1) |

---

## 6. Qué NO se hizo (frontera de F2.2-0)

- ❌ Webhook handler, RPC `crm_ingest_lead`, bandeja de leads, sincronización (sub-fases siguientes).
- ❌ Ejecutar la consolidación del cliente / editar `env.ts` (especificado, no aplicado).
- ❌ Tocar Clientify PROD (escritura), Supabase PROD, Netlify, `main`.

> **F2.2-0 cerrado a nivel diseño/infra.** Listo para **F2.2-1** (RPC `crm_ingest_lead` + consolidación del cliente como primer commit), validado contra staging. Previa aprobación.
