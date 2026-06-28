# Post-mortem: lost_reason silenciado por la optimización de skip

**Fecha:** 2026-06-27  
**Severidad:** Media (dato incorrecto en producción, sin pérdida de deals)  
**Estado:** RESUELTO

---

## Síntoma

El Donut de Análisis de Pérdidas del Tablero Comercial mostraba "Sin clasificar: 100%" para todos los deals perdidos, sin importar cuántas veces se sincronizara. El log de sync reportaba correctamente "67 enriquecidos" en el primer run y "67 omitidos (ya almacenados)" en el segundo, pero la base de datos siempre mostraba `lost_reason = NULL`.

---

## Investigación

### Paso 1 — Base de datos

```sql
SELECT lost_reason, COUNT(*) FROM clientify_deals_cache
WHERE status = 'lost'
GROUP BY lost_reason;
-- Resultado: lost_reason NULL, count 87 → todos en NULL
```

### Paso 2 — Log de sync

```
Run 1: lost_reason enriched: 67
Run 2: lost_reason enriched: 0, skipped: 67
-- Después del Run 2: todos los lost_reason volvieron a NULL
```

### Paso 3 — RPC

La función `clientify_replace_deals_cache` hace:
```sql
DELETE FROM clientify_deals_cache WHERE true;
INSERT INTO clientify_deals_cache SELECT * FROM jsonb_populate_recordset(...);
```
Es un **reemplazo completo** en cada sync.

### Paso 4 — El bug

En `sync-deals/route.ts`, la optimización de skip leía solo `deal_id` del cache:

```typescript
// ANTES (bug)
const { data } = await adminForRead
  .from("clientify_deals_cache")
  .select("deal_id")  // ← solo ID, sin lost_reason
  .eq("status", "lost").not("lost_reason", "is", null);
```

Los deals "omitidos" no volvían a ser fetcheados desde Clientify, pero tampoco recibían el valor almacenado. El objeto `UiDeal` quedaba con `lossReason = null`.

Cuando la RPC hacía el INSERT, insertaba `lost_reason = NULL`, borrando los valores del Run 1.

---

## Causa raíz

La optimización de skip (evitar re-fetchear deals ya enriquecidos desde `GET /deals/{id}`) estaba incompleta: **ahorraba la llamada a la API pero no preservaba el dato que esa llamada habría devuelto**.

El DELETE+INSERT de la RPC hacía que el dato existente no sobreviviera al segundo sync.

---

## Fix

```typescript
// DESPUÉS (fix)
const { data } = await adminForRead
  .from("clientify_deals_cache")
  .select("deal_id, lost_reason")  // ← también lost_reason
  .eq("status", "lost").not("lost_reason", "is", null);

const storedReasonsMap = buildStoredReasonsMap(data ?? []);

// REINYECCIÓN antes del REPLACE:
reinjectedStoredReasons(deals, storedReasonsMap);
```

La función `reinjectedStoredReasons` copia el valor almacenado a los deals omitidos **antes** de que lleguen al INSERT de la RPC.

---

## Verificación

```
Paso 0: UPDATE clientify_deals_cache SET lost_reason = NULL WHERE status = 'lost'
Run 1: 67 enriquecidos → DB: No contesta/N/A=38, Precio=18, Condiciones=11, null=20
Run 2: 67 omitidos → DB: valores IDÉNTICOS al Run 1 ✓
```

---

## Mecanismos de prevención

### 1. Tests automáticos (`src/lib/comercial/sync-lost-reason.test.ts`)

- **Test 1** — Dos syncs consecutivos: el Run 2 produce exactamente los mismos valores que el Run 1.
- **Test 2** — Persistencia: `buildCacheRows` mapea correctamente `lossReason → lost_reason` para los 5 motivos canónicos.
- **Test 3** — E2E: flujo completo `Clientify raw → normalizeLossReason → buildCacheRows → aggregación del Donut`.
- **Test 4** — Health check: `checkLostReasonIntegrity` detecta drops y no genera falsos positivos.

**Regresión documentada como test:**
```typescript
it("SIN el fix: el Sync 2 hubiera borrado todos los valores", () => {
  const rowsWithoutFix = buildCacheRows(dealsWithoutReinject);
  expect(rowsWithoutFix.every((r) => r.lost_reason === null)).toBe(true);
});
```

### 2. Health check en producción (`checkLostReasonIntegrity`)

Después de cada `persistDealsSync`, el sync compara cuántos deals tenían `lost_reason` antes y después. Si la cuenta baja sin justificación, el log del sync registra:

```
[WARN] lost_reason integrity: N registro(s) perdieron su valor.
Antes: 67 enriquecidos. Ahora: 0 de 67 deals perdidos.
```

Y el campo `status` del log pasa de `"completed"` a `"completed_with_warnings"`.

### 3. Funciones puras (`src/lib/comercial/sync-lost-reason.ts`)

La lógica de reinyección y health check está extraída del route en funciones puras con tipos explícitos, testables de forma aislada sin mocks de Supabase.

---

## Lección

> La optimización de "skip" resuelve el problema de la latencia (evitar 67 llamadas a `GET /deals/{id}`), pero no resuelve el problema de persistencia. En un sistema de REPLACE completo, **omitir un fetch no equivale a preservar el dato**: hay que llevar el dato almacenado hasta el INSERT explícitamente.

---

## Archivos modificados

| Archivo | Cambio |
|---|---|
| `src/app/api/clientify/sync-deals/route.ts` | Fix + health check + import de funciones puras |
| `src/lib/comercial/sync-lost-reason.ts` | NUEVO: funciones puras `reinjectedStoredReasons`, `buildStoredReasonsMap`, `checkLostReasonIntegrity` |
| `src/lib/comercial/sync-lost-reason.test.ts` | NUEVO: 31 tests en 4 suites |
| `docs/superpowers/lost-reason-bug-postmortem.md` | NUEVO: este documento |
