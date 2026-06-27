# CRM–Clientify Sync — Documentación Técnica

**Módulo:** `src/app/api/clientify/sync-deals/`  
**Versión actual:** `2.1.0`  
**Última actualización:** 2026-06-27

---

## 1. Arquitectura del sincronizador

```
GitHub Actions (cron 21:00 ART)
        │
        ▼  POST /api/clientify/sync-deals  (Bearer CRON_SECRET)
┌───────────────────────────────────────┐
│         sync-deals/route.ts           │
│                                       │
│  1. listPipelines()                   │
│     GET /deals/pipelines/             │
│     → filtra VISIBLE_PIPELINE_NAMES   │
│        (ANMAT, Cargas Generales,      │
│         Oficinas)                     │
│                                       │
│  2. listDeals() × pipeline            │
│     GET /deals/?pipeline_id=X         │
│     → mapDeal() → UiDeal[]            │
│                                       │
│  3. Enriquecimiento incremental       │
│     [solo deals "lost"]               │
│     Pre-query caché → alreadyEnriched │
│     Para cada deal nuevo/sin reason:  │
│       GET /deals/{id}/                │
│       → normalizeLossReason()         │
│     Deals ya enriquecidos: skip       │
│                                       │
│  4. persistDealsSync()                │
│     RPC clientify_replace_deals_cache │
│     (DELETE + INSERT atómico)         │
│     + INSERT clientify_deal_snapshots │
│                                       │
│  5. INSERT sync_log                   │
│     (métricas + versión)              │
└───────────────────────────────────────┘
        │
        ▼
   Supabase (prod)
   ┌─────────────────────────────┐
   │ clientify_deals_cache       │
   │ clientify_deal_snapshots    │
   │ clientify_dashboard_sync_log│
   └─────────────────────────────┘
        │
        ▼
   v_clientify_deals_enriched
   (JOIN cache + crm_deal_overlay)
        │
        ▼
   Tablero Comercial (Next.js)
```

---

## 2. Filtro de pipelines visibles

El tenant Clientify tiene cuatro pipelines:

| Pipeline         | Visible en Nexus | Motivo                          |
|------------------|------------------|---------------------------------|
| ANMAT            | ✅ Sí             | Pipeline comercial activo       |
| Cargas Generales | ✅ Sí             | Pipeline comercial activo       |
| Alquiler de Oficinas | ✅ Sí        | Pipeline comercial activo       |
| Logística Tops   | ❌ No             | Pipeline legacy/catch-all       |

El filtro vive en `src/lib/comercial/pipeline-filter.ts` y es un filtro **visual de lectura** — no borra datos ni modifica Clientify.

---

## 3. Estrategia de enriquecimiento incremental de `lost_reason`

### Problema de origen

El endpoint `GET /deals/` (lista) **no incluye** el campo `lost_reason`. Solo está disponible en `GET /deals/{id}/` (endpoint individual).

### Solución

N+1 selectivo para deals perdidos únicamente:

```
Deals perdidos del run actual
        │
        ▼
Pre-query Supabase:
  SELECT deal_id FROM clientify_deals_cache
  WHERE status='lost' AND lost_reason IS NOT NULL
        │
        ▼  alreadyEnriched = Set<deal_id>
        │
  ┌─────────────────────────────────────────┐
  │ Para cada deal perdido:                 │
  │   if deal_id ∈ alreadyEnriched → SKIP  │
  │   else → GET /deals/{deal_id}/          │
  │           normalizeLossReason()         │
  │           d.lossReason = canonical      │
  └─────────────────────────────────────────┘
        │
        ▼
  persistDealsSync() escribe lost_reason normalizado
```

**Resultado en condiciones normales (estado estable):**
- Primera ejecución: ~N requests individuales (donde N = total deals perdidos).
- Ejecuciones siguientes: 0 requests individuales si no hubo nuevos deals perdidos.
- Cada deal nuevo perdido: 1 request individual en la primera ejecución en que aparece.

### Batching y rate limiting

Lotes de 10 deals con 300 ms de pausa entre lotes.  
Rate limit de Clientify: 300 req/min → seguro con esta estrategia.

---

## 4. Normalización de `lost_reason` (LossReasonNormalizer)

**Módulo:** `src/lib/clientify/loss-reason-normalizer.ts`

Clientify permite texto libre en `lost_reason`. Para analytics consistente, se normaliza a 5 categorías canónicas **antes de persistir** en Supabase:

| Entrada cruda (Clientify)            | Categoría canónica     |
|--------------------------------------|------------------------|
| `"Precio"`, `"precio"`, `"Price"`    | `Precio`               |
| `"Condiciones"`, `"No había Disponibilidad de Espacio"`, `"Sin capacidad"` | `Condiciones` |
| `"No contesta N/A"`, `"N/A"`, `"No responde"`, `"Sin respuesta"` | `No contesta / N/A` |
| `"Otros"`, `"Other"`, texto no reconocido | `Otros`            |
| `null`, `""`, `"   "`                | `Sin clasificar`       |

**`isCanonical(value)`** → `true` si ya es categoría canónica exacta.  
**`normalizeLossReason(raw)`** → devuelve `CanonicalReason`.

El normalizer es idempotente para los valores canónicos de Clientify (`"Precio"`, `"Condiciones"`, `"Otros"` round-trip correctamente).

---

## 5. Caché (`clientify_deals_cache`)

La tabla actúa como snapshot del estado actual de deals en Clientify.

- **Estrategia:** DELETE + INSERT atómico vía RPC `clientify_replace_deals_cache`.
- **No acumula historial** — eso es responsabilidad de `clientify_deal_snapshots`.
- **`lost_reason`:** columna TEXT, almacena la categoría canónica normalizada. NULL significa que el deal no está perdido o que aún no fue enriquecido.

### Vista `v_clientify_deals_enriched`

```sql
SELECT c.*, o.horizonte, o.prioridad, ..., c.deal_source, c.lost_reason
FROM clientify_deals_cache c
LEFT JOIN crm_deal_overlay o ON c.deal_id = o.deal_id
```

El tablero lee siempre de esta vista.

---

## 6. Resiliencia y manejo de errores

| Escenario                | Comportamiento                                                     |
|--------------------------|--------------------------------------------------------------------|
| Timeout de Clientify     | `getDeal()` lanza `ClientifyError`; el bloque `catch` lo absorbe; el deal queda con `lossReason = null`; el sync continúa |
| Error HTTP 4xx/5xx       | Idem; best-effort; no interrumpe el sync del resto                |
| Rate limit (429)         | `ClientifyError` absorbido; batch tiene pausa de 300ms entre lotes|
| Respuesta parcial / JSON inválido | `getDeal()` lanza; absorbido; deal sin lost_reason       |
| `lost_reason` vacío      | `normalizeLossReason("")` → `"Sin clasificar"`                    |
| Campos nulos en deal     | `mapDeal()` usa `?? null` / `?? 0` en todos los campos            |
| Supabase admin no disponible | Returns 503 antes de ejecutar el sync                        |
| Fallo total del sync     | `catch` externo inserta fila de error en sync_log; returns 502    |

---

## 7. Log de sincronización (`clientify_dashboard_sync_log`)

| Columna                | Tipo    | Descripción                                          |
|------------------------|---------|------------------------------------------------------|
| `run_id`               | UUID    | Identificador único del run                          |
| `trigger`              | TEXT    | `"cron"` o `"manual"`                               |
| `status`               | TEXT    | `"completed"` / `"error"`                            |
| `finished_at`          | TIMESTAMPTZ | Fecha de finalización                           |
| `duration_ms`          | INT     | Duración total en milisegundos                       |
| `pipelines`            | INT     | Pipelines procesados                                 |
| `deals_synced`         | INT     | Total de deals en caché al finalizar                 |
| `errors`               | INT     | Número de errores                                    |
| `lost_reason_enriched` | INT     | Deals perdidos a los que se consultó `GET /deals/{id}/` |
| `lost_reason_skipped`  | INT     | Deals perdidos omitidos (ya tenían `lost_reason`)    |
| `sync_version`         | TEXT    | Versión semántica del sincronizador                  |
| `message`              | TEXT    | Resumen legible de la ejecución                      |

---

## 8. Migraciones aplicadas

| Migración | Descripción                                                  |
|-----------|--------------------------------------------------------------|
| `0093`    | Refresca vista `v_clientify_deals_enriched` con `deal_source`|
| `0094`    | Actualiza RPC para incluir `deal_source` en el replace       |
| `0095`    | Añade columna `lost_reason` a `clientify_deals_cache`; actualiza RPC y vista |
| `0096`    | Añade columnas de observabilidad a `clientify_dashboard_sync_log` |

---

## 9. Observabilidad

El **panel de diagnóstico** está disponible en el Tablero Comercial, al pie de la página, en la sección colapsable **"Diagnóstico del Sincronizador"**.

Muestra:
- Estado y fecha de la última ejecución
- Duración del sync
- Deals sincronizados / pipelines
- Deals enriquecidos y omitidos en el último run
- Versión del sincronizador
- Tabla con las últimas 10 ejecuciones

---

## 10. Parámetros de operación

| Parámetro           | Valor         | Descripción                              |
|---------------------|---------------|------------------------------------------|
| Cron schedule       | `21:00 ART`   | Disparo automático diario                |
| `maxDuration`       | 60 s          | Límite Netlify serverless                |
| Batch enrichment    | 10 deals      | Requests paralelos por lote              |
| Pausa entre lotes   | 300 ms        | Throttle para rate limit Clientify       |
| Historial dashboard | 10 runs       | Ejecuciones visibles en Diagnóstico      |
| `SYNC_VERSION`      | `2.1.0`       | Versión actual (actualizar en route.ts)  |

---

## 11. Diagrama de consistencia

```
Clientify (fuente)    SCOPE del sync     Nexus (caché)
──────────────────    ──────────────     ──────────────
Open:    11           ANMAT             Open:    11 ✓
Expired: 53           Cargas Gen.       Expired:  1 (52 en Logística Tops, excluido)
Won:     26           Oficinas          Won:      8 (18 en Logística Tops, excluido)
Lost:   120           ──────────────    Lost:    67 (48 en Logística Tops + 5 sin pip.)
Total:  210           87 deals          Total:   87

La diferencia de 123 deals corresponde íntegramente al pipeline "Logística Tops"
(legacy/catch-all), excluido por diseño vía isVisibleCommercialPipeline().
Esta diferencia es ESPERADA y CORRECTA.
```
