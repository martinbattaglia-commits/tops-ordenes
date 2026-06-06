# CRM Write E2E en PRODUCCIÓN — Reporte de Cierre

**Proyecto:** TOPS Nexus — Logística TOPS (Verotin S.A.)
**Fecha:** 2026-06-06
**Entorno:** app local (puerto 3030) → **Supabase PROD** (`arsksytgdnzukbmfgkju`)
**Sesión:** Chrome real del usuario, perfil admin (`comercial.edit = true`)
**Autor:** CTO de Release

---

## 1. Resultado ejecutivo

> ## 🟡 E2E PARCIAL — V1–V5 PASS · bloqueo real en V6 (hallazgo de UI **P0.3**)
> El camino **Lead → Calificar → Promover → Opportunity → Reservar** se ejecutó y **persistió en PROD** con reflejo correcto en el Dashboard de Vacancia en vivo (la reserva de 200 m² bajó la proyectada corporativa en exactamente 200 m²). El flujo **se detuvo en V6 (Ganado)** porque la Ficha 360° **no expone una acción para avanzar desde `calificado`** (ni desde `visita`). No es un fallo de datos ni de RPC: es un **hueco de cableado en la UI**. No se aplicó ningún workaround (directiva vigente).

| V | Hito | Resultado | Evidencia |
|---|---|---|---|
| **V1** | Lead creado (webhook real) | ✅ PASS | `POST /api/clientify/webhook/<token>` → HTTP 200 `{action: inserted, leadId}`. Token inválido → 401 (control). LEAD-2026-0001 "E2E Andromaco", CUIT 30-99999999-9, fuente google_ads. |
| **V2** | Calificar | ✅ PASS | Bandeja: Contactar → Calificar → `status = calificado` (persistido). |
| **V2/V3** | Promover + Opportunity | ✅ PASS | Mini-form SERVICIO=ANMAT + 200 m² → redirección a Ficha 360°. OPP-2026-0001, `estado=calificado`, lead `status=promovido` + `opportunity_id`. |
| **V4** | Reservar capacidad | ✅ PASS | Tab Capacidad → Pedro Luján 3159 + unidad "Cubiculo ANMAT PA4" → "Reservar capacidad". Banner "Capacidad reservada". |
| **V5** | `committed_state = reservado` + reflejo Dashboard | ✅ PASS | Header `CALIFICADO · RESERVADO`. Dashboard en vivo: **VACANCIA PROYECTADA 35.5% / 3.570 m²** (`− reservado`), línea **"CRM: reservado 200 m² · comprometido 0 m²"**. Δ proyectada corporativa = −200 m² exactos (3.770 → 3.570). |
| **V6** | Ganado (committed `comprometido` + onboarding auto) | 🔴 **BLOQUEADO** | **No hay acción de avance en la UI para `calificado`** (ver §3, P0.3). No se forzó por RPC. |
| **V7** | Onboarding completado | ⚪ No alcanzado | Depende de V6. |
| **V8** | `committed_state = ocupado` (anti-doble-conteo) | ⚪ No alcanzado | Depende de V6. |
| **V9** | Dashboard ciclo completo (reservado→comprometido→ocupado restaura) | 🟡 Parcial | Tramo **reservado** verificado en vivo (V5). Tramos comprometido/ocupado no alcanzados. |

**Lectura:** el Write-Path transaccional (RPCs SECURITY INVOKER), el inbound por webhook (P0.1), la promoción lead→opp, la reserva de capacidad y el **bucle committed_state → Dashboard** quedaron **validados de punta a punta en PROD**. La cadena se corta en un punto de UI, no de backend.

---

## 2. Evidencia detallada

### BEFORE (baseline Dashboard, pre-E2E)
- Corporativo: comercializable 10.049 m² · disponible 3.770 m² · ocupado 6.279 m² · vacancia 37.5%.
- Física = Comercial = Proyectada = 3.770 m² (sin compromisos CRM).
- ANMAT disponible 508 m² · Pedro Luján ANMAT 401 m².

### AFTER reserva (V5)
- **VACANCIA PROYECTADA: 35.5% / 3.570 m²** (= 3.770 − 200 reservado).
- Física y Comercial intactas en 3.770 m² (la reserva no consume físico ni comprometido — correcto).
- Línea CRM explícita: **"reservado 200 m² · comprometido 0 m²"**.
- ➡️ Confirma el modelo anti-doble-conteo y la derivación de bandas (W-4) **operando en PROD real**.

---

## 3. Hallazgo P0.3 — UI sin acción de avance en `calificado` / `visita`

**Síntoma:** tras reservar capacidad, la Ficha 360° en `calificado` ofrece solo *"Validar capacidad y reservar"* (navega al tab Capacidad), *"Perder"* y *"PDF"*. **No hay botón para avanzar a `propuesta`.** El stepper de pipeline es solo de lectura.

**Causa raíz** — `src/app/(app)/comercial/oportunidades/[id]/Opportunity360View.tsx`, mapa `primaryCta`:
```
calificado  → { mode: "tab", tab: "capacidad" }        // NO avanza
visita      → { mode: "tab", tab: "cotizaciones" }      // NO avanza
propuesta   → { mode: "advance", to: "negociacion" }    // avanza ✓
negociacion → { mode: "advance", to: "ganado" }         // avanza ✓
```
Las etapas `calificado` y `visita` tienen CTA de *navegación a tab*, no de *avance de etapa*. No existe un control secundario de avance. Resultado: una vez en `calificado`/`visita`, la UI **no permite progresar** a `propuesta` → `negociacion` → `ganado`.

**Por qué no se detectó antes:** las validaciones W-1…W-4 en staging ejercieron `crm_advance_stage` **por RPC directo** (`calificado→propuesta→negociacion→ganado`), nunca por la UI. El backend soporta la transición (D-3: `calificado→propuesta` directo permitido). El hueco es exclusivamente de cableado de la Ficha.

**Severidad:** 🔴 P0 funcional — sin esto, ninguna oportunidad puede ganarse desde la interfaz. Bloquea el resto del E2E (V6–V9).

**Fix propuesto (frente pequeño P0.3, fuera de este E2E):** exponer avance en `calificado` y `visita`. Opciones:
1. CTA secundaria *"Pasar a propuesta"* (`mode: advance, to: propuesta`) junto a *"Validar capacidad y reservar"*, y *"Pasar a propuesta"* en `visita`.
2. Stepper de pipeline clickable hacia la siguiente etapa válida (reutiliza `advanceStage`, ya cableado y RLS-protegido).
- Sin tocar backend (RPC + RLS ya cubren la transición). Validable en staging por UI + re-test del E2E.

---

## 4. Riesgos residuales tras el E2E (estado)

| # | Riesgo | Estado |
|---|---|---|
| RR-1 | Datos de prueba en CRM productivo | 🟠 **ABIERTO** → cleanup en §5 (lead + opp `reservado` + sync_log). |
| RR-2 | Dashboard en vivo alterado por la opp de prueba | 🟠 **ACTIVO** — proyectada corporativa −200 m² **ahora mismo**. Se restaura al ejecutar el cleanup (§5). |
| RR-4 | `CLIENTIFY_WEBHOOK_SECRET` temporal en `.env.local` | ✅ **CERRADO** — `.env.local` restaurado desde backup (secret removido). Reiniciar el dev server para purgarlo de memoria. |
| RR-6 | Cleanup vs `crm_contracts` RESTRICT | ✅ N/A — no se creó contrato. |

---

## 5. CLEANUP (pendiente — ejecutar en SQL Editor de PROD)

> El borrado definitivo en PROD se ejecuta por tu **mecanismo oficial (SQL Editor, operado por vos)**. Es **time-sensitive**: la opp de prueba está en `reservado` y mantiene el Dashboard corporativo −200 m² hasta que se borre.

FKs verificados: `crm_leads.opportunity_id` = `ON DELETE SET NULL`; `stage_history`/`quotes`/`proposals`/`onboarding` = `CASCADE`; sin contrato (RESTRICT no aplica).

```sql
-- 1) Borrar la oportunidad de prueba (cascada: stage_history, quotes, proposals, onboarding;
--    pone lead.opportunity_id = null). OPP-2026-0001.
delete from public.crm_opportunities
 where id = '86c3ad00-27bb-44e7-96be-a9c0c3d26613';

-- 2) Borrar el lead de prueba. LEAD-2026-0001 "E2E Andromaco".
delete from public.crm_leads
 where id = '41ab48d0-dc56-43c4-a5cf-85883b9d58f0';

-- 3) Borrar la traza de sync del webhook de prueba.
delete from public.clientify_sync_log
 where clientify_id = 'e2e-prod-001';

-- 4) VERIFICAR limpieza (debe dar 0 / 0 / 0):
select
  (select count(*) from public.crm_opportunities where id = '86c3ad00-27bb-44e7-96be-a9c0c3d26613') as opp_restante,
  (select count(*) from public.crm_leads          where id = '41ab48d0-dc56-43c4-a5cf-85883b9d58f0') as lead_restante,
  (select count(*) from public.clientify_sync_log where clientify_id = 'e2e-prod-001')              as synclog_restante;
```

Tras el cleanup, el Dashboard debe volver a **proyectada = 3.770 m² / 37.5%** y la bandeja de leads a **0**.

---

## 6. Veredicto

- **Backend (Write-Path + Inbound + capacidad + committed→Dashboard):** ✅ **GO** — validado en PROD real (V1–V5).
- **UI de avance de etapa:** 🔴 **NO-GO** hasta **P0.3** (no se puede ganar una oportunidad desde la interfaz).
- **E2E completo (hasta Ocupado):** ⏸️ **re-test pendiente** tras P0.3.

### Próximos frentes (sin merge/PR/deploy en esta entrega)
1. **Cleanup PROD** (§5) — inmediato, restaura el Dashboard.
2. **P0.3** — exponer avance `calificado`/`visita` en la Ficha (frente pequeño, staging-first).
3. **Re-test E2E** V6–V9 tras P0.3 (Ganado → Onboarding auto P0.2 → Ocupado → Dashboard restaura).
