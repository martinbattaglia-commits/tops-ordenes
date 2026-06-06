# CLIENTIFY_WEBHOOK_HANDLER_STAGING_RESULTS — F2.2-2 · Evidencia

**Proyecto:** TOPS Nexus — Logística TOPS (Verotin S.A.)
**Fecha:** 2026-06-06
**Entorno:** `tops-nexus-staging` · ref **`vrxosunxlhohmqymxots`**
**Harness:** `scripts/f222-webhook-staging.mts` · Build: `npm run build`

## Resultado

> ## ✅ GO — 19/19 PASS (unit + integración) · tsc ✅ · lint ✅ · build ✅
> Token timing-safe, normalización defensiva y contrato normalizador↔RPC validados contra staging. ROLLBACK — sin residuos.

---

## 1. Compilación

| Check | Resultado |
|---|---|
| `npx tsc --noEmit` | ✅ exit 0 |
| `npx next lint` (webhook.ts + route + env) | ✅ sin warnings |
| `npm run build` | ✅ `Compiled successfully` · rutas `ƒ /api/clientify/webhook` y `ƒ /api/clientify/webhook/[token]` |

---

## 2. QA — 19/19 PASS

### (A) Unit — verificación de token
| Caso | Resultado |
|---|---|
| token correcto → true | ✅ |
| token incorrecto → false | ✅ |
| largo distinto → false | ✅ |
| provisto vacío → false | ✅ |
| secret vacío → false (**fail-closed**) | ✅ |

### (A) Unit — normalización
| Caso | Resultado |
|---|---|
| flat `ClientifyContact`: clientify_id / full_name / email[] / phone[] / cuit / source | ✅ (6/6) |
| enveloped `{event, object_type, data}`: usa `data.id` + `event` | ✅ (2/2) |
| sin identidad → null | ✅ |
| no-objeto → null | ✅ |

### (B) Integración — normalizador → `crm_ingest_lead` (staging, tx+rollback)
| Caso | Resultado | Detalle |
|---|---|---|
| Payload realista (contacto Clientify) → inserted + owner asignado | ✅ | action=inserted owner=U1 |
| Reentrega (Clientify reintenta) → idempotencia end-to-end | ✅ | action=updated, mismo lead |
| Payload enveloped → inserted | ✅ | action=inserted |
| `clientify_sync_log` inbound escrito | ✅ | 3 filas |

**TOTAL 19 · PASS 19 · FAIL 0.**

---

## 3. Método y limitación honesta

- **Cubierto:** las piezas puras del handler (token + normalización) con los módulos reales de la app, y el contrato normalizador↔RPC end-to-end contra staging (la RPC es la misma que invoca el handler).
- **No ejercitado por HTTP:** la capa de transporte del route (recepción HTTP + `createAdminClient()` service-role) no se prueba contra staging porque el runtime local apunta a **Supabase PROD** (sin `crm_*`/0048) y **no hay claves supabase-js de staging** (solo `pg`). Se cubre con **build** (compila/bundlea el route) + unit del verificador + integración del normalizador→RPC. La prueba HTTP real corresponde a un entorno con Supabase `crm_*` + el webhook configurado en Clientify (post-decisión de salida).

---

## 4. Estado de producción

- **PROD / `main` / Netlify / Clientify (PROD/escritura):** intactos.
- **Staging:** `0048` ya aplicada (F2.2-1); F2.2-2 no agrega migraciones. Sin datos de prueba (rollback).

> **F2.2-2 GO.** Handler implementado y validado. Listo para F2.2-3 (bandeja) o F2.2-5 (pull) **previa aprobación**.
